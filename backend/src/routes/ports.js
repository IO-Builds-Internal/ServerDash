const express = require('express')
const router = express.Router()
const { exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const logger = require('../logger')

// ── GET /api/ports ─────────────────────────────────────────────────────────────
// Returns all used ports + a helper to check availability
router.get('/', async (req, res) => {
  try {
    const { stdout } = await execAsync("ss -tlnp 2>/dev/null | grep LISTEN")
    const ports = []
    for (const line of stdout.split('\n').filter(Boolean)) {
      const addrMatch = line.match(/[\s:](\d+)\s+/)
      const processMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/)
      if (addrMatch) {
        const port = parseInt(addrMatch[1])
        const addr = line.match(/\s+([^\s]+:\d+)\s+/)?.[1] || ''
        const isPublic = addr.startsWith('0.0.0.0') || addr.startsWith('[::]')
        ports.push({
          port,
          process: processMatch ? processMatch[1] : 'unknown',
          pid: processMatch ? parseInt(processMatch[2]) : null,
          address: addr,
          public: isPublic,
        })
      }
    }
    // Deduplicate
    const seen = new Set()
    const unique = ports.filter(p => {
      if (seen.has(p.port)) return false
      seen.add(p.port)
      return true
    }).sort((a, b) => a.port - b.port)

    res.json(unique)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/ports/available?start=3000&count=5 ───────────────────────────────
// Find N consecutive available ports starting from a given port
router.get('/available', async (req, res) => {
  const start = parseInt(req.query.start || '3000')
  const count = parseInt(req.query.count || '1')

  try {
    const { stdout } = await execAsync("ss -tlnp 2>/dev/null | grep LISTEN | awk '{print $4}' | grep -oP ':\\K[0-9]+'")
    const usedPorts = new Set(stdout.split('\n').filter(Boolean).map(Number))

    const available = []
    let candidate = start
    while (available.length < count && candidate < 65535) {
      if (!usedPorts.has(candidate)) available.push(candidate)
      candidate++
    }
    res.json({ available, requested: count, startedAt: start })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/ports/check?port=3000 ────────────────────────────────────────────
router.get('/check', async (req, res) => {
  const port = parseInt(req.query.port)
  if (!port) return res.status(400).json({ error: 'port required' })
  try {
    const { stdout } = await execAsync(`ss -tlnp "sport = :${port}" 2>/dev/null | grep -c LISTEN || echo 0`)
    const inUse = parseInt(stdout.trim()) > 0
    res.json({ port, available: !inUse, inUse })
  } catch {
    res.json({ port, available: true, inUse: false })
  }
})

module.exports = router
