const express = require('express')
const router = express.Router()
const { exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

// ── GET /api/ports ─────────────────────────────────────────────────────────────
// Returns all detailed open ports, protocols, and their corresponding running processes/commands
router.get('/', async (req, res) => {
  try {
    // Query TCP and UDP sockets in listening state with process IDs
    exec('ss -tlunp 2>/dev/null', (err, stdout) => {
      if (err) {
        return res.status(500).json({ error: `ss query failed: ${err.message}` })
      }

      const lines = stdout.split('\n').slice(1) // skip the header
      const ports = []

      for (const line of lines) {
        if (!line.trim()) continue

        // Example line:
        // tcp   LISTEN 0      4096         0.0.0.0:14001      0.0.0.0:*    users:(("docker-proxy",pid=165606,fd=8))
        const tokens = line.trim().split(/\s+/)
        if (tokens.length < 5) continue

        const protocol = tokens[0] // tcp/udp
        const state = tokens[1]    // LISTEN/UNCONN
        const localAddr = tokens[4] // 0.0.0.0:14001 or [::]:14001

        let ip = ''
        let port = ''

        if (localAddr.includes(']:')) {
          const parts = localAddr.split(']:')
          ip = parts[0].replace('[', '')
          port = parts[1]
        } else if (localAddr.includes(':')) {
          const lastColon = localAddr.lastIndexOf(':')
          ip = localAddr.substring(0, lastColon)
          port = localAddr.substring(lastColon + 1)
        } else {
          ip = localAddr
          port = ''
        }

        if (!port) continue

        let processName = ''
        let pid = null

        // Parse users string e.g. users:(("node",pid=788842,fd=21))
        const usersMatch = line.match(/users:\(([^)]+)\)/)
        if (usersMatch) {
          const content = usersMatch[1]
          const nameMatch = content.match(/"([^"]+)"/)
          const pidMatch = content.match(/pid=(\d+)/)

          if (nameMatch) processName = nameMatch[1]
          if (pidMatch) pid = parseInt(pidMatch[1], 10)
        }

        ports.push({
          protocol,
          state,
          address: localAddr,
          ip,
          port: parseInt(port, 10),
          process: processName || 'unknown',
          pid: pid || null,
          command: '' // resolved next
        })
      }

      // Read cmdlines for PIDs
      const promises = ports.map(item => {
        if (!item.pid) return Promise.resolve(item)
        return new Promise(resolve => {
          fs.readFile(`/proc/${item.pid}/cmdline`, 'utf8', (err, data) => {
            if (!err && data) {
              item.command = data.split('\0').filter(Boolean).join(' ').trim()
            }
            if (!item.command) {
              fs.readFile(`/proc/${item.pid}/comm`, 'utf8', (err2, data2) => {
                if (!err2 && data2) {
                  item.command = data2.trim()
                }
                resolve(item)
              })
            } else {
              resolve(item)
            }
          })
        })
      })

      Promise.all(promises).then(results => {
        // Sort ports ascending
        results.sort((a, b) => a.port - b.port)
        res.json(results)
      })
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/ports/kill/:pid ─────────────────────────────────────────────────
// Force terminate the running process on a given port to release it
router.delete('/kill/:pid', async (req, res) => {
  const pid = parseInt(req.params.pid)
  if (!pid) return res.status(400).json({ error: 'PID required' })

  try {
    logger.info(`Killing process with PID ${pid} to free up port`)
    // Run kill -9 to force kill
    await execAsync(`kill -9 ${pid}`)
    res.json({ success: true, message: `Process ${pid} force terminated` })
  } catch (err) {
    res.status(500).json({ error: `Failed to terminate process: ${err.message}` })
  }
})

// ── GET /api/ports/available?start=3000&count=5 ───────────────────────────────
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
