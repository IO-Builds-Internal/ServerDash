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


// Ensure logs directory exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs')

const app = express()
const PORT = process.env.PORT || 4001

// ─── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://${require('os').hostname()}:5173`,
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman)
    if (!origin) return cb(null, true)
    // Allow any configured allowed origin
    if (allowedOrigins.some(o => origin === o || origin.startsWith(o.replace(':5173', '')))) {
      return cb(null, true)
    }
    // BUG-01 FIX: actually reject disallowed origins in production
    if (process.env.NODE_ENV === 'production') {
      return cb(new Error(`CORS: origin ${origin} not allowed`))
    }
    // In development, allow all but log a warning
    logger.warn('CORS: allowing non-listed origin in dev mode', { origin })
    cb(null, true)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser(process.env.COOKIE_SECRET || 'serverdash-cookie-secret'))

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

// ── Apple Passkey / WebAuthn Auth routes (public — no auth middleware) ─────────
const webAuthnRouter = require('./src/routes/auth-webauthn')
app.use('/api/auth', webAuthnRouter)



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
