require('dotenv').config()
const express = require('express')
const pkg = require('./package.json')
const cors = require('cors')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
const fs = require('fs')
const path = require('path')

const logger = require('./src/logger')
const { authMiddleware } = require('./src/authMiddleware')
const { startBackupScheduler } = require('./src/backupScheduler')


// Ensure logs directory exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs')

const app = express()
const PORT = process.env.PORT || 3001

// ─── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://${require('os').hostname()}:5173`,
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman) or matching origins
    if (!origin || allowedOrigins.some(o => origin.startsWith(o.replace(':5173', '')))) {
      cb(null, true)
    } else {
      cb(null, true) // Open in dev — tighten in production
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// HTTP request logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) }
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/', limiter)

// Stricter rate limit for exec endpoint
const execLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
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

// ── Local auth routes (no Supabase) ────────────────────────────────────────────
const jwt = require('jsonwebtoken')
const crypto = require('crypto')

const AUTH_EMAIL = process.env.ADMIN_EMAIL || 'admin@serverdash.local'
const AUTH_PASSWORD = process.env.ADMIN_PASSWORD || 'ServerDash2026!'
const JWT_SECRET = process.env.LOCAL_JWT_SECRET
const JWT_EXPIRES = process.env.LOCAL_JWT_EXPIRES || '8h'

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' })
  }
  const safeCompare = (a, b) => {
    const aBuf = Buffer.from(a)
    const bBuf = Buffer.from(b)
    if (aBuf.length !== bBuf.length) {
      crypto.timingSafeEqual(bBuf, bBuf)
      return false
    }
    return crypto.timingSafeEqual(aBuf, bBuf)
  }

  const emailOk = safeCompare(email.toLowerCase().trim(), AUTH_EMAIL.toLowerCase().trim())
  const pwOk = safeCompare(password, AUTH_PASSWORD)

  if (!emailOk || !pwOk) {
    logger.warn('Login failed', { email })
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  if (!JWT_SECRET) {
    return res.status(503).json({ error: 'Server auth not configured' })
  }
  const token = jwt.sign(
    { sub: 'admin', email: AUTH_EMAIL, role: 'admin' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: JWT_EXPIRES }
  )
  // Decode to get expiry
  const decoded = jwt.decode(token)
  logger.info('Login success', { email })
  res.json({ token, expires_at: decoded.exp * 1000 })
})

// POST /api/auth/logout — token is stored client-side, just acknowledge
app.post('/api/auth/logout', (req, res) => res.json({ ok: true }))

// GET /api/auth/me — verify token and return user info (used by AuthContext on load)
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' })
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET, { algorithms: ['HS256'] })
    res.json({ email: payload.email, role: payload.role, expires_at: payload.exp * 1000 })
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token'
    res.status(401).json({ error: err.message, code })
  }
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
app.use('/api/packages', packagesRouter)
app.use('/api/exec', execLimiter, packagesRouter)
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

// Settings (persisted file store)
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json')
fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })

let settings = {}
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  }
} catch (e) {
  logger.error('Error loading settings file', { error: e.message })
}

app.get('/api/settings', (req, res) => res.json(settings))
app.post('/api/settings/:section', (req, res) => {
  settings[req.params.section] = req.body
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8')
  } catch (e) {
    logger.error('Error saving settings file', { error: e.message })
  }
  logger.info('Settings updated', { section: req.params.section, user: req.user?.email })
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

// ─── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack })
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`ServerDash backend running on port ${PORT}`, {
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
