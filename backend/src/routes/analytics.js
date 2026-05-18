const express = require('express')
const router = express.Router()
const ssh = require('../sshPool')
const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const geoip = require('geoip-lite')

const HISTORY_FILE = path.join(__dirname, '../../data/analytics-history.json')
const MAX_HISTORY_POINTS = 1440 // 24 hours at 1-minute intervals

// Country Code to Full Name Mapping
const countryNames = {
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  CA: 'Canada',
  AU: 'Australia',
  IN: 'India',
  SG: 'Singapore',
  NL: 'Netherlands',
  JP: 'Japan',
  CN: 'China',
  BR: 'Brazil',
  ES: 'Spain',
  IT: 'Italy',
  RU: 'Russia',
  FI: 'Finland',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  CH: 'Switzerland',
  KR: 'South Korea',
  ZA: 'South Africa',
  AE: 'United Arab Emirates',
  LK: 'Sri Lanka'
}

// Convert ISO Country Code to Emoji Flag
function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode === 'Unknown') return '🏳️'
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0))
  try {
    return String.fromCodePoint(...codePoints)
  } catch (e) {
    return '🏳️'
  }
}

// Helper to load history
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
    }
  } catch (err) {
    logger.warn('Failed to load analytics history', { error: err.message })
  }
  return []
}

// Helper to save history
function saveHistory(history) {
  try {
    const dir = path.dirname(HISTORY_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8')
  } catch (err) {
    logger.error('Failed to save analytics history', { error: err.message })
  }
}

// ── GET /api/analytics ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // 1. Get Live Sockets & Online Users from 'ss'
    // Port 80, 443, 4001, 5173
    const ssCmd = "ss -tna state established '( sport = :80 or sport = :443 or sport = :4001 or sport = :5173 )'"
    const { stdout: ssOutput } = await ssh.exec(ssCmd, { ignoreErrors: true })
    
    const ssLines = (ssOutput || '').split('\n').filter(l => l.trim() !== '')
    const activeConnections = ssLines.length
    
    // Parse unique remote IPs actively connected
    const uniqueLiveIPs = new Set()
    for (const line of ssLines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 5) {
        const remotePart = parts[4] // e.g. "127.0.0.1:12345" or "[::1]:12345"
        const remoteIp = remotePart.substring(0, remotePart.lastIndexOf(':'))
        if (remoteIp && remoteIp !== '127.0.0.1' && remoteIp !== '[::1]' && remoteIp !== '::1') {
          uniqueLiveIPs.add(remoteIp)
        }
      }
    }
    const liveUsers = uniqueLiveIPs.size === 0 && activeConnections > 0 ? 1 : uniqueLiveIPs.size

    // 2. Parse Nginx access log (tail last 5,000 requests)
    const logCmd = "tail -n 5000 /var/log/nginx/access.log"
    const { stdout: logOutput } = await ssh.exec(logCmd, { ignoreErrors: true })
    
    const logLines = (logOutput || '').split('\n').filter(l => l.trim() !== '')
    
    // Nginx combined log regex
    const logRegex = /^(\S+) \S+ \S+ \[(.*?)\] "(\S+) (\S+) \S+" (\d+) (\d+) "([^"]*)" "([^"]*)"/
    
    let totalRequests = logLines.length
    const uniqueVisitorIPs = new Set()
    let totalBandwidthBytes = 0
    
    const topIPs = {}
    const topPaths = {}
    const topOrigins = {}
    const topCountries = {}
    const statusCodes = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
    const topUserAgents = { Chrome: 0, Firefox: 0, Safari: 0, Edge: 0, Bots: 0, Other: 0 }

    for (const line of logLines) {
      const match = line.match(logRegex)
      if (!match) continue
      
      const ip = match[1]
      const timeStr = match[2]
      const method = match[3]
      const pathStr = match[4]
      const status = parseInt(match[5])
      const bytes = parseInt(match[6])
      const referrer = match[7]
      const userAgent = match[8]

      // Unique visitors
      uniqueVisitorIPs.add(ip)
      
      // Bandwidth
      totalBandwidthBytes += isNaN(bytes) ? 0 : bytes

      // Top IPs
      topIPs[ip] = (topIPs[ip] || 0) + 1

      // Top Paths
      topPaths[pathStr] = (topPaths[pathStr] || 0) + 1

      // Geolocation Lookup via local geoip-lite
      if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.')) {
        const key = '🏳️ Local / Internal'
        topCountries[key] = (topCountries[key] || 0) + 1
      } else {
        const geo = geoip.lookup(ip)
        if (geo && geo.country) {
          const name = countryNames[geo.country] || geo.country
          const flag = getFlagEmoji(geo.country)
          const key = `${flag} ${name}`
          topCountries[key] = (topCountries[key] || 0) + 1
        } else {
          const key = '🏳️ Local / Internal'
          topCountries[key] = (topCountries[key] || 0) + 1
        }
      }

      // Top requested origins / requested hosts from referrer
      if (referrer && referrer !== '-') {
        try {
          const urlObj = new URL(referrer)
          const originHost = urlObj.hostname
          topOrigins[originHost] = (topOrigins[originHost] || 0) + 1
        } catch (e) {
          // ignore invalid urls
        }
      }

      // Status codes grouping
      if (status >= 200 && status < 300) statusCodes['2xx']++
      else if (status >= 300 && status < 400) statusCodes['3xx']++
      else if (status >= 400 && status < 500) statusCodes['4xx']++
      else if (status >= 500) statusCodes['5xx']++

      // User agents grouping
      const uaLower = userAgent.toLowerCase()
      if (uaLower.includes('bot') || uaLower.includes('crawl') || uaLower.includes('spider')) topUserAgents.Bots++
      else if (uaLower.includes('edg/')) topUserAgents.Edge++
      else if (uaLower.includes('chrome')) topUserAgents.Chrome++
      else if (uaLower.includes('firefox')) topUserAgents.Firefox++
      else if (uaLower.includes('safari')) topUserAgents.Safari++
      else topUserAgents.Other++
    }

    const uniqueUsers = uniqueVisitorIPs.size

    // 3. Compile history point (rolling 24-hour log at 1-min intervals)
    const currentHistory = loadHistory()
    const now = Date.now()
    
    currentHistory.push({
      timestamp: now,
      connections: activeConnections,
      liveUsers: liveUsers,
      uniqueUsers: uniqueUsers,
      requests: totalRequests
    })

    if (currentHistory.length > MAX_HISTORY_POINTS) {
      currentHistory.shift()
    }
    
    saveHistory(currentHistory)

    // Formulate top tables arrays
    const topIPsArr = Object.entries(topIPs)
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const topPathsArr = Object.entries(topPaths)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const topOriginsArr = Object.entries(topOrigins)
      .map(([origin, count]) => ({ origin, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const topCountriesArr = Object.entries(topCountries)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    res.json({
      connections: activeConnections,
      liveUsers: liveUsers,
      uniqueUsers: uniqueUsers,
      totalRequests: totalRequests,
      bandwidthBytes: totalBandwidthBytes,
      statusCodes,
      topIPs: topIPsArr,
      topPaths: topPathsArr,
      topOrigins: topOriginsArr,
      topCountries: topCountriesArr,
      topUserAgents,
      history: currentHistory
    })

  } catch (err) {
    logger.error('Traffic analytics collection failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
