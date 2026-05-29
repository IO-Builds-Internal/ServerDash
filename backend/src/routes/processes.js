const express = require('express')
const router = express.Router()
const ssh = require('../sshPool')
const logger = require('../logger')

// GET /api/processes — List running processes sorted by CPU usage
router.get('/', async (req, res) => {
  try {
    // Fetch top 100 processes sorted by CPU usage
    const result = await ssh.exec('ps -eo pid,ppid,user,%cpu,%mem,time,comm,args --sort=-%cpu | head -n 100', { ignoreErrors: true })
    
    if (result.code !== 0) {
      return res.status(500).json({ error: result.stderr || 'Failed to list processes' })
    }

    const lines = result.stdout.trim().split('\n')
    const processes = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Match columns: pid, ppid, user, %cpu, %mem, time, comm, args
      // We parse the first 7 fields by splitting, and collect everything else as the arguments/full command line
      const parts = line.split(/\s+/)
      if (parts.length < 8) continue

      const pid = parseInt(parts[0], 10)
      const ppid = parseInt(parts[1], 10)
      const user = parts[2]
      const cpu = parseFloat(parts[3])
      const mem = parseFloat(parts[4])
      const time = parts[5]
      const command = parts[6]
      const args = parts.slice(7).join(' ')

      processes.push({
        pid,
        ppid,
        user,
        cpu,
        mem,
        time,
        command,
        args,
      })
    }

    res.json({ processes })
  } catch (err) {
    logger.error('Failed to list processes', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// POST /api/processes/:pid/terminate — Terminate process gracefully (SIGTERM -15)
router.post('/:pid/terminate', async (req, res) => {
  const pid = parseInt(req.params.pid, 10)
  if (isNaN(pid) || pid <= 0) {
    return res.status(400).json({ error: 'Invalid process ID (PID)' })
  }

  // Prevent killing critical system processes (e.g. systemd/init PID 1 or backend pid itself)
  if (pid === 1 || pid === process.pid) {
    return res.status(403).json({ error: 'Action denied: Cannot terminate critical system process' })
  }

  try {
    logger.info('Terminating process', { pid, user: req.user?.email })
    const result = await ssh.exec(`kill -15 ${pid}`)
    
    if (result.code !== 0) {
      return res.status(500).json({ error: result.stderr || `Failed to terminate process ${pid}` })
    }

    res.json({ success: true, message: `Termination signal sent to process ${pid}` })
  } catch (err) {
    logger.error('Failed to terminate process', { pid, error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// POST /api/processes/:pid/kill — Force kill process (SIGKILL -9)
router.post('/:pid/kill', async (req, res) => {
  const pid = parseInt(req.params.pid, 10)
  if (isNaN(pid) || pid <= 0) {
    return res.status(400).json({ error: 'Invalid process ID (PID)' })
  }

  // Prevent killing critical system processes
  if (pid === 1 || pid === process.pid) {
    return res.status(403).json({ error: 'Action denied: Cannot kill critical system process' })
  }

  try {
    logger.info('Force killing process', { pid, user: req.user?.email })
    const result = await ssh.exec(`kill -9 ${pid}`)
    
    if (result.code !== 0) {
      return res.status(500).json({ error: result.stderr || `Failed to kill process ${pid}` })
    }

    res.json({ success: true, message: `Process ${pid} force killed successfully` })
  } catch (err) {
    logger.error('Failed to kill process', { pid, error: err.message })
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
