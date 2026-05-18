const express = require('express')
const router = express.Router()
const ssh = require('../sshPool')
const logger = require('../logger')

// Helper parser for UFW numbered status
function parseUfwStatus(output) {
  const lines = output.split('\n')
  const statusLine = lines.find(l => l.toLowerCase().startsWith('status:'))
  const active = statusLine ? statusLine.toLowerCase().split(':')[1]?.trim() === 'active' : false
  
  const rules = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('[')) continue
    
    try {
      const indexMatch = trimmed.match(/^\[\s*(\d+)\]\s+(.+)$/)
      if (!indexMatch) continue
      
      const index = parseInt(indexMatch[1])
      const rest = indexMatch[2].trim()
      
      // Match the UFW action ALLOW/DENY/REJECT/LIMIT (case-insensitive)
      const actionMatch = rest.match(/\s+(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT))?\s+/i)
      if (!actionMatch) continue
      
      const action = actionMatch[1].toUpperCase()
      const direction = actionMatch[2] ? actionMatch[2].toUpperCase() : 'IN'
      
      const actionIndex = rest.indexOf(actionMatch[0])
      const to = rest.substring(0, actionIndex).trim()
      
      let fromAndComment = rest.substring(actionIndex + actionMatch[0].length).trim()
      let from = fromAndComment
      let comment = ''
      
      // Look for a comment starting with # or v6 flag
      const commentMatch = fromAndComment.match(/#\s*(.+)$/)
      if (commentMatch) {
        from = fromAndComment.substring(0, commentMatch.index).trim()
        comment = commentMatch[1].trim()
      } else if (fromAndComment.includes(' (v6)')) {
        from = fromAndComment.replace(' (v6)', '').trim()
        comment = 'IPv6 rule'
      }
      
      rules.push({ index, to, action, direction, from, comment })
    } catch (e) {
      logger.warn('Failed parsing rule line', { line, error: e.message })
    }
  }
  
  return { active, rules }
}

// ── GET /api/firewall ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { stdout } = await ssh.exec('ufw status numbered', { ignoreErrors: true })
    const parsed = parseUfwStatus(stdout || '')
    res.json(parsed)
  } catch (err) {
    logger.error('Firewall fetch failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/firewall/toggle ────────────────────────────────────────────────
router.post('/toggle', async (req, res) => {
  const { active } = req.body
  try {
    const cmd = active ? 'ufw --force enable' : 'ufw disable'
    const { stdout, stderr, code } = await ssh.exec(cmd)
    if (code !== 0) {
      throw new Error(stderr || stdout || 'Failed to toggle firewall state')
    }
    logger.info('Firewall toggled successfully', { active })
    res.json({ success: true })
  } catch (err) {
    logger.error('Firewall toggle failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/firewall/rules ─────────────────────────────────────────────────
router.post('/rules', async (req, res) => {
  const { to, action, from, proto, comment } = req.body
  
  if (!to && !from) {
    return res.status(400).json({ error: 'Port (to) or Source IP (from) is required.' })
  }
  
  try {
    const safeAction = ['allow', 'deny', 'reject', 'limit'].includes(action?.toLowerCase())
      ? action.toLowerCase()
      : 'allow'
      
    let cmd = `ufw ${safeAction}`
    
    if (from && from.toLowerCase() !== 'anywhere' && from.trim() !== '') {
      // Validate IP / Subnet format roughly
      const safeFrom = from.replace(/[^a-zA-Z0-9.:/]/g, '')
      cmd += ` from ${safeFrom}`
    }
    
    if (to) {
      const safeTo = to.replace(/[^0-9:]/g, '') // allowed numeric ports or ranges (e.g. 8000:8080)
      cmd += ` to any port ${safeTo}`
    }
    
    if (proto && ['tcp', 'udp'].includes(proto.toLowerCase())) {
      cmd += ` proto ${proto.toLowerCase()}`
    }
    
    if (comment && comment.trim() !== '') {
      const safeComment = comment.replace(/[^a-zA-Z0-9\s-_]/g, '')
      cmd += ` comment '${safeComment}'`
    }
    
    const { stdout, stderr, code } = await ssh.exec(cmd)
    if (code !== 0) {
      throw new Error(stderr || stdout || 'Failed to add firewall rule')
    }
    
    logger.info('Added firewall rule', { command: cmd })
    res.json({ success: true, message: 'Rule added successfully!' })
  } catch (err) {
    logger.error('Firewall add rule failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/firewall/rules/:index ────────────────────────────────────────
router.delete('/rules/:index', async (req, res) => {
  const { index } = req.params
  try {
    const idx = parseInt(index)
    if (isNaN(idx)) return res.status(400).json({ error: 'Invalid rule index' })
    
    // We execute ufw --force delete [index]
    const { stdout, stderr, code } = await ssh.exec(`ufw --force delete ${idx}`)
    if (code !== 0) {
      throw new Error(stderr || stdout || 'Failed to delete firewall rule')
    }
    
    logger.info('Deleted firewall rule', { index: idx })
    res.json({ success: true, message: 'Rule deleted successfully!' })
  } catch (err) {
    logger.error('Firewall delete rule failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
