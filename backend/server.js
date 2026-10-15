require('dotenv').config()
const express = require('express')
const cookieParser = require('cookie-parser')
const pkg = require('./package.json')
const cors = require('cors')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
const fs = require('fs')
const path = require('path')

const logger = require('./src/logger')
const { authMiddleware } = require('./src/authMiddleware')
const { startBackupScheduler } = require('./src/backupScheduler')


// Ensure logs directory exists with restricted permissions (SD-15)
if (!fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true, mode: 0o700 })

const app = express()
const PORT = process.env.PORT || 4001
const HOST = process.env.HOST || '127.0.0.1'

// Trust loopback proxy from local Nginx reverse proxy (SD-12)
app.set('trust proxy', 'loopback')

// ─── Security Headers (SD-16) ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})

// ─── CORS Allowlist (SD-02: Exact-match Set) ──────────────────────────────────
const allowedOriginsSet = new Set(
  [
    ...(process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean),
    process.env.VPS_HOST ? `http://${process.env.VPS_HOST}` : null,
    process.env.VPS_HOST ? `https://${process.env.VPS_HOST}` : null,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4001',
    'http://127.0.0.1:4001',
  ].filter(Boolean)
)

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server or same-origin requests with no origin header
    if (!origin) return cb(null, true)

    if (allowedOriginsSet.has(origin)) {
      return cb(null, true)
    }

    // Permit localhost with any port in non-production mode
    if (process.env.NODE_ENV !== 'production') {
      try {
        const u = new URL(origin)
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          return cb(null, true)
        }
      } catch {}
    }

    logger.warn('CORS request rejected for origin', { origin, allowed: Array.from(allowedOriginsSet) })
    return cb(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Setup-Token'],
}))

// Retain raw request body for webhook HMAC signature verification (SD-04)
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser(process.env.COOKIE_SECRET || 'serverdash-cookie-secret'))

// ─── Sec-Fetch-Site & Cross-Site CSRF Protection (SD-01) ──────────────────────
app.use('/api', (req, res, next) => {
  // Allow external webhooks to reach their handler (strictly /sites/:id/webhook)
  if (/^\/sites\/[^/]+\/webhook$/.test(req.path)) {
    return next()
  }

  const secFetchSite = req.headers['sec-fetch-site']
  if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
    const origin = req.headers.origin
    const isAllowed = origin && allowedOriginsSet.has(origin)
    let isDevLocal = false
    if (!isAllowed && origin && process.env.NODE_ENV !== 'production') {
      try {
        const u = new URL(origin)
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') isDevLocal = true
      } catch {}
    }

    if (!isAllowed && !isDevLocal) {
      logger.warn('Blocked cross-site/unauthorized same-site request via Sec-Fetch-Site', { 
        path: req.path, 
        secFetchSite, 
        origin, 
        ip: req.ip 
      })
      return res.status(403).json({ error: 'Cross-site requests forbidden' })
    }
  }

  // Reject cross-origin state-changing actions
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.headers.origin
    if (origin && !allowedOriginsSet.has(origin)) {
      if (process.env.NODE_ENV !== 'production') {
        try {
          const u = new URL(origin)
          if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return next()
        } catch {}
      }
      logger.warn('Blocked state-changing request with unapproved Origin', { path: req.path, origin })
      return res.status(403).json({ error: 'Unauthorized request origin' })
    }
  }

  next()
})

// HTTP request logging with query parameter redaction (SD-15)
morgan.token('safe-url', (req) => {
  try {
    const url = new URL(req.originalUrl || req.url, 'http://localhost')
    if (url.searchParams.has('command')) url.searchParams.set('command', '[REDACTED]')
    if (url.searchParams.has('token')) url.searchParams.set('token', '[REDACTED]')
    if (url.searchParams.has('password')) url.searchParams.set('password', '[REDACTED]')
    if (url.searchParams.has('setupToken')) url.searchParams.set('setupToken', '[REDACTED]')
    if (url.searchParams.has('secret')) url.searchParams.set('secret', '[REDACTED]')
    return url.pathname + url.search
  } catch {
    return req.originalUrl || req.url
  }
})

app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length]', {
  stream: { write: (msg) => logger.http(msg.trim()) }
}))

// Rate limiting (SD-12)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/', limiter)

// Dedicated strict limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/auth', authLimiter)

// Stricter rate limit for exec endpoint
const execLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { error: 'Too many command executions' },
})

// ─── Public Routes ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: pkg.version || '1.3.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// ── Apple Passkey / WebAuthn Auth routes (public — no auth middleware) ─────────
const webAuthnRouter = require('./src/routes/auth-webauthn')
const { validateSession } = require('./src/routes/auth-webauthn')
app.use('/api/auth', webAuthnRouter)

// Settings (persisted file store)
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json')
fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true, mode: 0o700 })

let settings = {}
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  }
} catch (e) {
  logger.error('Error loading settings file', { error: e.message })
}

// GET /api/settings: public for branding, authenticated for full settings (SD-10)
app.get('/api/settings', (req, res) => {
  const token = req.cookies?.admin_session
  if (token && validateSession(token)) {
    // Return full settings without exposing sensitive raw encrypted credentials
    const safeSettings = { ...settings }
    if (safeSettings.github) {
      const { encryptedToken, ...safeGh } = safeSettings.github
      safeSettings.github = safeGh
    }
    return res.json(safeSettings)
  }
  // Unauthenticated: only return branding info
  return res.json({ branding: settings.branding || {} })
})



// ─── Protected Routes ──────────────────────────────────────────────────────────
const metricsRouter = require('./src/routes/metrics')
const sitesRouter = require('./src/routes/sites')
const dockerRouter = require('./src/routes/docker')
const packagesRouter = require('./src/routes/packages')
const filesRouter = require('./src/routes/files')
const smtpRouter = require('./src/routes/smtp')
const supabaseRouter = require('./src/routes/supabase')
const portsRouter = require('./src/routes/ports')
const ftpRouter = require('./src/routes/ftp')
const snapshotsRouter = require('./src/routes/snapshots')
const firewallRouter = require('./src/routes/firewall')
const analyticsRouter = require('./src/routes/analytics')
const processesRouter = require('./src/routes/processes')
const githubRouter = require('./src/routes/github')

// Apply auth to all /api routes below this point
app.use('/api', authMiddleware)

app.use('/api/metrics', metricsRouter)
app.use('/api/sites', sitesRouter)
app.use('/api/docker', dockerRouter)
app.use('/api/packages/exec-stream', execLimiter)
app.use('/api/packages', packagesRouter)
// BUG-05 FIX: removed duplicate /api/exec → packagesRouter mount that leaked all package endpoints
app.use('/api/files', filesRouter)
app.use('/api/smtp', smtpRouter)
app.use('/api/supabase', supabaseRouter)
app.use('/api/ports', portsRouter)
app.use('/api/ftp', ftpRouter)
app.use('/api/snapshots', snapshotsRouter)
app.use('/api/firewall', firewallRouter)
app.use('/api/analytics', analyticsRouter)
app.use('/api/processes', processesRouter)
app.use('/api/github', githubRouter)

// POST /api/settings/:section requires authenticated admin (SD-23: prevent prototype pollution)
app.post('/api/settings/:section', (req, res) => {
  const section = String(req.params.section || '')
  if (!section || ['__proto__', 'constructor', 'prototype'].includes(section)) {
    return res.status(400).json({ error: 'Invalid settings section' })
  }
  settings[section] = req.body
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 })
  } catch (e) {
    logger.error('Error saving settings file', { error: e.message })
  }
  logger.info('Settings updated', { section, user: req.user?.email })
  res.json({ success: true })
})

// ── GET /api/system/swap ────────────────────────────────────────────────────────
app.get('/api/system/swap', async (req, res) => {
  const { exec } = require('child_process')
  const { promisify } = require('util')
  const execAsync = promisify(exec)
  
  try {
    // 1. Get swap size using free command
    const { stdout: freeOut } = await execAsync('free -b')
    const lines = freeOut.split('\n')
    let totalSwap = 0
    let usedSwap = 0
    
    for (const line of lines) {
      if (line.toLowerCase().startsWith('swap:')) {
        const parts = line.split(/\s+/).filter(Boolean)
        totalSwap = parseInt(parts[1]) || 0
        usedSwap = parseInt(parts[2]) || 0
        break
      }
    }
    
    // 2. Check if /swapfile exists on disk and its size
    let swapFileExists = false
    let swapFileSize = 0
    try {
      const fs = require('fs')
      if (fs.existsSync('/swapfile')) {
        swapFileExists = true
        const stats = fs.statSync('/swapfile')
        swapFileSize = stats.size
      }
    } catch {}

    res.json({
      active: totalSwap > 0,
      totalSwapBytes: totalSwap,
      usedSwapBytes: usedSwap,
      swapFileExists,
      swapFileSizeBytes: swapFileSize
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/system/swap ───────────────────────────────────────────────────────
app.post('/api/system/swap', async (req, res) => {
  const { exec } = require('child_process')
  const { promisify } = require('util')
  const execAsync = promisify(exec)
  const fs = require('fs')
  
  const { sizeGB } = req.body
  if (sizeGB === undefined || typeof sizeGB !== 'number' || sizeGB < 0 || sizeGB > 32) {
    return res.status(400).json({ error: 'sizeGB must be a number between 0 and 32' })
  }

  try {
    logger.info(`Swap file reconfiguration requested: ${sizeGB} GB`)

    // 1. Turn off active swap file first
    try {
      await execAsync('swapoff /swapfile 2>/dev/null || swapoff -a 2>/dev/null')
    } catch (e) {
      logger.warn('Error turning off swap, might not be active', { error: e.message })
    }

    if (sizeGB > 0) {
      // 2. Allocate space (try fallocate first, fall back to dd for compatibility)
      try {
        await execAsync(`fallocate -l ${sizeGB}G /swapfile`)
      } catch (err) {
        logger.info('fallocate failed, falling back to dd...')
        await execAsync(`dd if=/dev/zero of=/swapfile bs=1M count=${sizeGB * 1024}`)
      }

      // 3. Set correct permissions
      await execAsync('chmod 600 /swapfile')

      // 4. Format swapfile
      await execAsync('mkswap /swapfile')

      // 5. Activate swapfile
      await execAsync('swapon /swapfile')

      // 6. Ensure persistent entry is in /etc/fstab
      if (fs.existsSync('/etc/fstab')) {
        let fstab = fs.readFileSync('/etc/fstab', 'utf8')
        if (!fstab.includes('/swapfile')) {
          fstab += '\n/swapfile none swap sw 0 0\n'
          fs.writeFileSync('/etc/fstab', fstab)
        }
      }
      logger.info(`Successfully created and enabled ${sizeGB} GB swap file`)
      res.json({ success: true, message: `Successfully created and enabled ${sizeGB} GB swap file.` })
    } else {
      // 7. Disable and delete swapfile
      if (fs.existsSync('/swapfile')) {
        fs.unlinkSync('/swapfile')
      }
      
      // Remove persistent entry from fstab
      if (fs.existsSync('/etc/fstab')) {
        let fstab = fs.readFileSync('/etc/fstab', 'utf8')
        fstab = fstab.split('\n').filter(line => !line.includes('/swapfile')).join('\n')
        fs.writeFileSync('/etc/fstab', fstab)
      }
      logger.info('Successfully disabled and deleted swap file')
      res.json({ success: true, message: 'Successfully disabled and deleted swap file.' })
    }
  } catch (err) {
    logger.error('Failed to configure swap file', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ─── Error Handler (SD-23: no internal stack leak in production) ─────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack })
  const status = err.status || 500
  const message = status === 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error'
  res.status(status).json({ error: message })
})

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

// ─── Start (SD-16: bind to loopback HOST by default) ──────────────────────────
app.listen(PORT, HOST, () => {
  logger.info(`ServerDash backend running on ${HOST}:${PORT}`, {
    env: process.env.NODE_ENV,
    vpsHost: process.env.VPS_HOST || '(not configured)',
    githubClientId: process.env.GITHUB_CLIENT_ID ? '✓ configured' : '✗ not set (GitHub integration disabled)',
  })
  
  // Start the background Supabase backup scheduler
  try {
    startBackupScheduler()
  } catch (err) {
    logger.error('Failed to start backup scheduler', { error: err.message })
  }
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) })
})

module.exports = app
