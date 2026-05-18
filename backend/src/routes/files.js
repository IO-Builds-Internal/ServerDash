const express = require('express')
const router = express.Router()
const { exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

// Only block truly dangerous system paths (proc/sys/dev)
function isSafePath(p) {
  const normalized = path.normalize(p)
  const blocked = ['/proc', '/sys/kernel', '/dev/mem', '/dev/sda']
  return !blocked.some(b => normalized === b || normalized.startsWith(b + '/'))
}

const multer = require('multer')
const upload = multer({ dest: '/tmp/serverdash-uploads/' })

// GET /api/files/list?path=/
router.get('/list', async (req, res) => {
  const dirPath = path.normalize(req.query.path || '/')
  if (!isSafePath(dirPath)) return res.status(403).json({ error: 'Access denied' })

  try {
    const { stdout } = await execAsync(`ls -la --time-style=+"%Y-%m-%dT%H:%M:%S" "${dirPath}" 2>&1`)
    const lines = stdout.split('\n').slice(1).filter(Boolean) // skip 'total N'

    const files = lines.map(line => {
      const parts = line.trim().split(/\s+/)
      // With --time-style=+"...", columns are:
      // [0]permissions [1]links [2]user [3]group [4]size [5]datetime [6+]name
      if (parts.length < 7) return null
      const permissions = parts[0]
      const size = parseInt(parts[4]) || 0
      const modified = parts[5] || ''

      // Name starts at index 6; for symlinks format is "name -> target"
      const nameParts = parts.slice(6)
      const arrowIdx = nameParts.indexOf('->')
      const name = arrowIdx > 0 ? nameParts.slice(0, arrowIdx).join(' ') : nameParts.join(' ')
      const linkTarget = arrowIdx > 0 ? nameParts.slice(arrowIdx + 1).join(' ') : null

      if (!name || name === '.' || name === '..') return null

      return {
        name,
        type: permissions.startsWith('d') ? 'dir' : permissions.startsWith('l') ? 'link' : 'file',
        size,
        modified: modified.substring(0, 10), // YYYY-MM-DD
        permissions,
        linkTarget,
      }
    }).filter(Boolean)

    res.json({ path: dirPath, files })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/files/read?path=...
router.get('/read', async (req, res) => {
  const filePath = path.normalize(req.query.path)
  if (!isSafePath(filePath)) return res.status(403).json({ error: 'Access denied' })
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    res.json({ content, path: filePath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/files/write
router.post('/write', async (req, res) => {
  const { path: filePath, content } = req.body
  if (!filePath) return res.status(400).json({ error: 'path required' })
  const safe = path.normalize(filePath)
  if (!isSafePath(safe)) return res.status(403).json({ error: 'Access denied' })
  try {
    fs.writeFileSync(safe, content || '', 'utf8')
    logger.info('File written', { path: safe })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/files/mkdir
router.post('/mkdir', async (req, res) => {
  const { path: dirPath } = req.body
  if (!dirPath) return res.status(400).json({ error: 'path required' })
  const safe = path.normalize(dirPath)
  if (!isSafePath(safe)) return res.status(403).json({ error: 'Access denied' })
  try {
    fs.mkdirSync(safe, { recursive: true })
    logger.info('Directory created', { path: safe })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/files/rename
router.post('/rename', async (req, res) => {
  const { from, to } = req.body
  if (!from || !to) return res.status(400).json({ error: 'from and to required' })
  const safeSrc = path.normalize(from)
  const safeDst = path.normalize(to)
  if (!isSafePath(safeSrc) || !isSafePath(safeDst)) return res.status(403).json({ error: 'Access denied' })
  try {
    fs.renameSync(safeSrc, safeDst)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/files/delete
router.delete('/delete', async (req, res) => {
  const { paths } = req.body
  if (!paths || !Array.isArray(paths)) return res.status(400).json({ error: 'paths array required' })
  const errors = []
  for (const p of paths) {
    const safe = path.normalize(p)
    if (!isSafePath(safe)) { errors.push(`Blocked: ${p}`); continue }
    try {
      await execAsync(`rm -rf "${safe}"`)
      logger.info('Deleted', { path: safe })
    } catch (e) {
      errors.push(`${p}: ${e.message}`)
    }
  }
  if (errors.length) res.status(207).json({ success: false, errors })
  else res.json({ success: true })
})

// POST /api/files/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const destPath = path.normalize(req.body.path || '/var/www')
  if (!isSafePath(destPath)) return res.status(403).json({ error: 'Access denied' })
  try {
    const destFile = path.join(destPath, req.file.originalname)
    fs.copyFileSync(req.file.path, destFile)
    fs.unlinkSync(req.file.path)
    logger.info('File uploaded', { path: destFile })
    res.json({ success: true, path: destFile })
  } catch (err) {
    logger.error('Upload error', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// GET /api/files/download?path=...
router.get('/download', async (req, res) => {
  const filePath = path.normalize(req.query.path)
  if (!isSafePath(filePath)) return res.status(403).json({ error: 'Access denied' })
  try {
    const filename = path.basename(filePath)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.sendFile(path.resolve(filePath))
  } catch (err) {
    res.status(404).json({ error: 'File not found' })
  }
})

module.exports = router
