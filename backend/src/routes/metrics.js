const express = require('express')
const router = express.Router()
const ssh = require('../sshPool')
const logger = require('../logger')
const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '../../data')
const HISTORY_FILE = path.join(DATA_DIR, 'metrics-history.json')
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000
const HISTORY_MIN_WRITE_MS = 5000
const BACKGROUND_SAMPLE_MS = 5000

// Store previous network readings to calculate per-second rates
let prevNet = null
let prevNetTime = null
let historyCache = null
let lastHistoryWrite = 0
let latestMetrics = null
let latestMetricsTime = 0

function loadHistory() {
  if (historyCache) return historyCache
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
      historyCache = Array.isArray(parsed) ? parsed : []
    } else {
      historyCache = []
    }
  } catch (err) {
    logger.warn('Metric history load failed', { error: err.message })
    historyCache = []
  }
  return historyCache
}

function saveHistory(history, force = false) {
  const now = Date.now()
  if (!force && now - lastHistoryWrite < HISTORY_MIN_WRITE_MS) return
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
    lastHistoryWrite = now
  } catch (err) {
    logger.warn('Metric history save failed', { error: err.message })
  }
}

function appendHistory(sample) {
  const cutoff = Date.now() - HISTORY_RETENTION_MS
  const history = loadHistory()
    .filter(item => Date.parse(item.timestamp) >= cutoff)
  history.push(sample)
  historyCache = history
  saveHistory(history)
}

function parseCpu(topOutput) {
  const line = topOutput.split('\n').find(l => l.includes('%Cpu') || l.includes('Cpu(s)'))
  if (!line) return 0
  const idle = line.match(/(\d+\.?\d*)\s*(?:id|idle)/)
  if (idle) return parseFloat((100 - parseFloat(idle[1])).toFixed(1))
  const us = line.match(/(\d+\.?\d*)\s*us/)
  return us ? parseFloat(us[1]) : 0
}

function parseRam(freeOutput) {
  const lines = freeOutput.split('\n')
  const memLine = lines.find(l => l.startsWith('Mem:'))
  if (!memLine) return { used: 0, total: 0 }
  const parts = memLine.trim().split(/\s+/)
  return {
    total: parseFloat((parseInt(parts[1]) / 1024).toFixed(2)),
    used: parseFloat((parseInt(parts[2]) / 1024).toFixed(2)),
    free: parseFloat((parseInt(parts[3]) / 1024).toFixed(2)),
  }
}

function parseDisk(dfOutput) {
  const lines = dfOutput.split('\n')
  const dataLine = lines[1]
  if (!dataLine) return { used: 0, total: 0 }
  const parts = dataLine.trim().split(/\s+/)
  const parseSize = (s) => {
    if (!s) return 0
    const n = parseFloat(s)
    if (s.endsWith('G')) return n
    if (s.endsWith('T')) return n * 1024
    if (s.endsWith('M')) return n / 1024
    return n
  }
  return {
    total: parseSize(parts[1]),
    used: parseSize(parts[2]),
    available: parseSize(parts[3]),
    usePct: parseInt(parts[4]) || 0,
  }
}

// Returns cumulative bytes {rx, tx}
function readNetBytes(netOutput) {
  const lines = netOutput.split('\n').slice(2)
  let totalRx = 0, totalTx = 0
  for (const line of lines) {
    if (!line.trim() || line.includes('lo:')) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 10) {
      totalRx += parseInt(parts[1]) || 0
      totalTx += parseInt(parts[9]) || 0
    }
  }
  return { rx: totalRx, tx: totalTx }
}

// Returns human-friendly speed in B/s, KB/s or MB/s
function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return { value: parseFloat(bytesPerSec.toFixed(1)), unit: 'B/s' }
  if (bytesPerSec < 1024 * 1024) return { value: parseFloat((bytesPerSec / 1024).toFixed(1)), unit: 'KB/s' }
  return { value: parseFloat((bytesPerSec / 1024 / 1024).toFixed(2)), unit: 'MB/s' }
}

function parseUptime(uptimeOutput) {
  const loadMatch = uptimeOutput.match(/load average:\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/)
  return {
    loadAvg: loadMatch ? {
      m1: parseFloat(loadMatch[1]),
      m5: parseFloat(loadMatch[2]),
      m15: parseFloat(loadMatch[3]),
    } : { m1: 0, m5: 0, m15: 0 }
  }
}

async function collectMetrics() {
  const [cpuRes, ramRes, diskRes, netRes, uptimeRes, procUptimeRes] = await Promise.all([
    ssh.exec('top -bn1 | head -5', { ignoreErrors: true }),
    ssh.exec('free -m', { ignoreErrors: true }),
    ssh.exec('df -h /', { ignoreErrors: true }),
    ssh.exec('cat /proc/net/dev', { ignoreErrors: true }),
    ssh.exec('uptime', { ignoreErrors: true }),
    ssh.exec('cat /proc/uptime', { ignoreErrors: true }),
  ])

  const uptimeSeconds = procUptimeRes.stdout
    ? parseFloat(procUptimeRes.stdout.split(' ')[0])
    : 0

  const { loadAvg } = parseUptime(uptimeRes.stdout || '')
  const ram = parseRam(ramRes.stdout || '')
  const disk = parseDisk(diskRes.stdout || '')
  const cpu = parseCpu(cpuRes.stdout || '')

  const now = Date.now()
  const curNet = readNetBytes(netRes.stdout || '')

  let netIn = { value: 0, unit: 'KB/s' }
  let netOut = { value: 0, unit: 'KB/s' }

  if (prevNet && prevNetTime) {
    const dt = (now - prevNetTime) / 1000
    if (dt > 0) {
      netIn = formatSpeed((curNet.rx - prevNet.rx) / dt)
      netOut = formatSpeed((curNet.tx - prevNet.tx) / dt)
    }
  }

  prevNet = curNet
  prevNetTime = now

  const timestamp = new Date().toISOString()
  const payload = {
    cpu: { usage: cpu },
    ram,
    disk,
    network: {
      in: netIn.value,
      inUnit: netIn.unit,
      out: netOut.value,
      outUnit: netOut.unit,
      totalRxGB: parseFloat((curNet.rx / 1024 / 1024 / 1024).toFixed(2)),
      totalTxGB: parseFloat((curNet.tx / 1024 / 1024 / 1024).toFixed(2)),
    },
    uptime: Math.floor(uptimeSeconds),
    loadAvg,
    timestamp,
  }

  appendHistory({
    timestamp,
    cpu: cpu,
    ram: ram.total > 0 ? parseFloat(((ram.used / ram.total) * 100).toFixed(1)) : 0,
    ramUsed: ram.used,
    ramTotal: ram.total,
    disk: disk.usePct || (disk.total > 0 ? parseFloat(((disk.used / disk.total) * 100).toFixed(1)) : 0),
    diskUsed: disk.used,
    diskTotal: disk.total,
    netIn: netIn.value,
    netInUnit: netIn.unit,
    netOut: netOut.value,
    netOutUnit: netOut.unit,
    load1: loadAvg.m1,
    load5: loadAvg.m5,
    load15: loadAvg.m15,
    uptime: Math.floor(uptimeSeconds),
  })

  latestMetrics = payload
  latestMetricsTime = Date.now()
  return payload
}

// GET /api/metrics
router.get('/', async (req, res) => {
  try {
    if (latestMetrics && Date.now() - latestMetricsTime < BACKGROUND_SAMPLE_MS) {
      return res.json(latestMetrics)
    }
    res.json(await collectMetrics())
  } catch (err) {
    logger.error('Metrics fetch failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

async function collectBackgroundMetrics() {
  try {
    await collectMetrics()
  } catch (err) {
    logger.warn('Background metric sample failed', { error: err.message })
  }
}

setTimeout(collectBackgroundMetrics, 1000).unref()
setInterval(collectBackgroundMetrics, BACKGROUND_SAMPLE_MS).unref()

// GET /api/metrics/history?range=1h
router.get('/history', (req, res) => {
  const ranges = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  }
  const rangeMs = ranges[req.query.range] || ranges['1h']
  const cutoff = Date.now() - rangeMs
  const history = loadHistory().filter(item => Date.parse(item.timestamp) >= cutoff)
  res.json(history)
})

module.exports = router
