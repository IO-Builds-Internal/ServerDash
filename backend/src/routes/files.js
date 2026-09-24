const express = require('express')
const router = express.Router()
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

// ── File Manager Security Jail ────────────────────────────────────────────────
// Whitelist of allowed root directories for web server management
const DEFAULT_ALLOWED_ROOTS = [
  '/var/www',               // Site documents, web applications, uploads
  '/etc/nginx',             // Nginx virtual host configurations & snippets
  '/var/log',               // Application, access, and error logs
  '/var/backups',           // ServerDash backups and snapshots
  '/tmp/serverdash-uploads' // File staging directory
]

// Absolute blacklist for critical operating system secrets, kernels, & devices
const CRITICAL_BLOCKED = [
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/etc/security',
  '/etc/pam.d',
  '/etc/polkit-1',
  '/root/.ssh',
  '/etc/ssl/private',
]

function getAllowedRoots() {
  const roots = [...DEFAULT_ALLOWED_ROOTS]
  // In development, also allow the local project workspace and tmp
  if (process.env.NODE_ENV !== 'production') {
    roots.push(path.resolve(__dirname, '../../../'))
    roots.push('/tmp')
  }
  // Check settings.json for user-configured extra roots
  try {
    const settingsPath = path.join(__dirname, '..', '..', 'data', 'settings.json')
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      if (Array.isArray(settings?.allowedRoots)) {
        roots.push(...settings.allowedRoots)
      }
    }
  } catch {}
  return roots.map(r => path.resolve(r))
}

function isSafePath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false

  const normalized = path.resolve(path.normalize(targetPath))

  // 1. Check critical blocked paths (exact match or subpath)
  const isBlocked = CRITICAL_BLOCKED.some(b => 
    normalized === b || normalized.startsWith(b + path.sep) || normalized.startsWith(b + '/')
  )
  if (isBlocked) return false

  // Disallow any hidden SSH credentials anywhere
  if (normalized.includes('/.ssh') || normalized.endsWith('/.ssh')) return false

  // 2. Resolve symlinks to prevent symlink traversal
  let real = normalized
  try {
    if (fs.existsSync(normalized)) {
      real = fs.realpathSync(normalized)
    } else {
      const parent = path.dirname(normalized)
      if (fs.existsSync(parent)) {
        real = path.resolve(fs.realpathSync(parent), path.basename(normalized))
      }
    }
  } catch {
    return false
  }

  // 3. Re-verify real dereferenced target against critical blocked list
  const isRealBlocked = CRITICAL_BLOCKED.some(b => 
    real === b || real.startsWith(b + path.sep) || real.startsWith(b + '/')
  )
  if (isRealBlocked || real.includes('/.ssh')) return false

  // 4. Must fall within one of the allowed roots
  const allowedRoots = getAllowedRoots()
  return allowedRoots.some(root => 
    real === root || real.startsWith(root + path.sep) || real.startsWith(root + '/')
  )
}

const multer = require('multer')
const uploadDir = '/tmp/serverdash-uploads/'
if (!fs.existsSync(uploadDir)) {
  try { fs.mkdirSync(uploadDir, { recursive: true }) } catch {}
}
const upload = multer({ dest: uploadDir })

// ── GET /api/files/roots — list allowed root directories ──────────────────────
router.get('/roots', (req, res) => {
  const roots = getAllowedRoots()
  const availableRoots = roots.map(r => ({
    path: r,
    exists: fs.existsSync(r),
    name: path.basename(r) || r
  }))
  res.json({ roots: availableRoots })
})

// ── GET /api/files/list?path=... ──────────────────────────────────────────────
router.get('/list', async (req, res) => {
  const allowedRoots = getAllowedRoots()
  const defaultRoot = allowedRoots.find(r => fs.existsSync(r)) || allowedRoots[0] || '/var/www'
  
  let rawPath = req.query.path
  if (!rawPath || rawPath === '/') {
    rawPath = defaultRoot
  }

  const dirPath = path.resolve(path.normalize(rawPath))
  if (!isSafePath(dirPath)) {
    return res.status(403).json({ error: 'Access denied: Path is outside allowed directories or restricted by security policy' })
  }

  if (!fs.existsSync(dirPath)) {
    return res.status(404).json({ error: `Directory not found: ${dirPath}` })
  }

  try {
    let files = []

    // Try GNU ls with execFile (safe argument array, no shell injection)
    try {
      const { stdout } = await execFileAsync('ls', ['-la', '--time-style=+%Y-%m-%dT%H:%M:%S', dirPath])
      const lines = stdout.split('\n').slice(1).filter(Boolean)

      files = lines.map(line => {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 7) return null
        const permissions = parts[0]
        const size = parseInt(parts[4]) || 0
        const modified = parts[5] || ''

        const nameParts = parts.slice(6)
        const arrowIdx = nameParts.indexOf('->')
        const name = arrowIdx > 0 ? nameParts.slice(0, arrowIdx).join(' ') : nameParts.join(' ')
        const linkTarget = arrowIdx > 0 ? nameParts.slice(arrowIdx + 1).join(' ') : null

        if (!name || name === '.' || name === '..') return null

        return {
          name,
          type: permissions.startsWith('d') ? 'dir' : permissions.startsWith('l') ? 'link' : 'file',
          size,
          modified: modified.substring(0, 10),
          permissions,
          linkTarget,
        }
      }).filter(Boolean)
    } catch {
      // Fallback to native Node.js readdir (e.g. macOS dev or non-GNU environments)
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      files = entries.map(ent => {
        const fullPath = path.join(dirPath, ent.name)
        let stats = null
        try { stats = fs.statSync(fullPath) } catch {}
        return {
          name: ent.name,
          type: ent.isDirectory() ? 'dir' : ent.isSymbolicLink() ? 'link' : 'file',
          size: stats?.size || 0,
          modified: stats?.mtime ? stats.mtime.toISOString().substring(0, 10) : '',
          permissions: ent.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--',
          linkTarget: null
        }
      })
    }

    res.json({ path: dirPath, files })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/files/read?path=... ──────────────────────────────────────────────
router.get('/read', async (req, res) => {
  if (!req.query.path) return res.status(400).json({ error: 'path required' })
  const filePath = path.resolve(path.normalize(req.query.path))
  if (!isSafePath(filePath)) {
    return res.status(403).json({ error: 'Access denied: Path is outside allowed directories or restricted by security policy' })
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    res.json({ content, path: filePath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/files/write ─────────────────────────────────────────────────────
router.post('/write', async (req, res) => {
  const { path: filePath, content } = req.body
  if (!filePath) return res.status(400).json({ error: 'path required' })
  const safe = path.resolve(path.normalize(filePath))
  if (!isSafePath(safe)) {
    return res.status(403).json({ error: 'Access denied: Path is outside allowed directories or restricted by security policy' })
  }
  try {
    fs.writeFileSync(safe, content || '', 'utf8')
    logger.info('File written', { path: safe })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/files/mkdir ─────────────────────────────────────────────────────
router.post('/mkdir', async (req, res) => {
  const { path: dirPath } = req.body
  if (!dirPath) return res.status(400).json({ error: 'path required' })
  const safe = path.resolve(path.normalize(dirPath))
  if (!isSafePath(safe)) {
    return res.status(403).json({ error: 'Access denied: Path is outside allowed directories or restricted by security policy' })
  }
  try {
    fs.mkdirSync(safe, { recursive: true })
    logger.info('Directory created', { path: safe })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/files/rename ────────────────────────────────────────────────────
router.post('/rename', async (req, res) => {
  const { from, to } = req.body
  if (!from || !to) return res.status(400).json({ error: 'from and to required' })
  const safeSrc = path.resolve(path.normalize(from))
  const safeDst = path.resolve(path.normalize(to))
  if (!isSafePath(safeSrc) || !isSafePath(safeDst)) {
    return res.status(403).json({ error: 'Access denied: Path is outside allowed directories or restricted by security policy' })
  }
  try {
    fs.renameSync(safeSrc, safeDst)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/files/delete ──────────────────────────────────────────────────
router.delete('/delete', async (req, res) => {
  const { paths } = req.body
  if (!paths || !Array.isArray(paths)) return res.status(400).json({ error: 'paths array required' })
  const errors = []
  for (const p of paths) {
    const safe = path.resolve(path.normalize(p))
    if (!isSafePath(safe)) {
      errors.push(`Blocked: ${p} (Outside allowed directory)`)
      continue
    }
    try {
      // Native recursive file deletion (no shell command interpolation)
      fs.rmSync(safe, { recursive: true, force: true })
      logger.info('Deleted', { path: safe })
    } catch (e) {
      errors.push(`${p}: ${e.message}`)
    }
  }
  if (errors.length) res.status(207).json({ success: false, errors })
  else res.json({ success: true })
})

// ── POST /api/files/upload ────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const destPath = path.resolve(path.normalize(req.body.path || '/var/www'))
  if (!isSafePath(destPath)) {
    try { fs.unlinkSync(req.file.path) } catch {}
    return res.status(403).json({ error: 'Access denied: Destination outside allowed directories' })
  }
  try {
    const destFile = path.join(destPath, path.basename(req.file.originalname))
    if (!isSafePath(destFile)) {
      try { fs.unlinkSync(req.file.path) } catch {}
      return res.status(403).json({ error: 'Access denied: Target filename violates security policy' })
    }
    fs.copyFileSync(req.file.path, destFile)
    fs.unlinkSync(req.file.path)
    logger.info('File uploaded', { path: destFile })
    res.json({ success: true, path: destFile })
  } catch (err) {
    try { fs.unlinkSync(req.file.path) } catch {}
    logger.error('Upload error', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/files/download?path=... ──────────────────────────────────────────
router.get('/download', async (req, res) => {
  if (!req.query.path) return res.status(400).json({ error: 'path required' })
  const filePath = path.resolve(path.normalize(req.query.path))
  if (!isSafePath(filePath)) {
    return res.status(403).json({ error: 'Access denied: Path is outside allowed directories or restricted by security policy' })
  }
  try {
    const filename = path.basename(filePath)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.sendFile(filePath)
  } catch (err) {
    res.status(404).json({ error: 'File not found' })
  }
})

// ── POST /api/files/copy ──────────────────────────────────────────────────────
router.post('/copy', async (req, res) => {
  const { from, to } = req.body
  if (!from || !Array.isArray(from) || !to) return res.status(400).json({ error: 'from array and to destination required' })
  const safeDst = path.resolve(path.normalize(to))
  if (!isSafePath(safeDst)) {
    return res.status(403).json({ error: 'Access denied: Destination outside allowed directories' })
  }
  const errors = []
  for (const src of from) {
    const safeSrc = path.resolve(path.normalize(src))
    if (!isSafePath(safeSrc)) {
      errors.push(`Blocked: ${src} (Outside allowed directory)`)
      continue
    }
    try {
      const destTarget = path.join(safeDst, path.basename(safeSrc))
      // Native recursive copy (no shell command interpolation)
      fs.cpSync(safeSrc, destTarget, { recursive: true })
      logger.info('Copied', { from: safeSrc, to: destTarget })
    } catch (e) {
      errors.push(`${src}: ${e.message}`)
    }
  }
  if (errors.length) res.status(207).json({ success: false, errors })
  else res.json({ success: true })
})

// ── POST /api/files/move ──────────────────────────────────────────────────────
router.post('/move', async (req, res) => {
  const { from, to } = req.body
  if (!from || !Array.isArray(from) || !to) return res.status(400).json({ error: 'from array and to destination required' })
  const safeDst = path.resolve(path.normalize(to))
  if (!isSafePath(safeDst)) {
    return res.status(403).json({ error: 'Access denied: Destination outside allowed directories' })
  }
  const errors = []
  for (const src of from) {
    const safeSrc = path.resolve(path.normalize(src))
    if (!isSafePath(safeSrc)) {
      errors.push(`Blocked: ${src} (Outside allowed directory)`)
      continue
    }
    try {
      const destTarget = path.join(safeDst, path.basename(safeSrc))
      try {
        fs.renameSync(safeSrc, destTarget)
      } catch (err) {
        // Cross-device fallback
        fs.cpSync(safeSrc, destTarget, { recursive: true })
        fs.rmSync(safeSrc, { recursive: true, force: true })
      }
      logger.info('Moved', { from: safeSrc, to: destTarget })
    } catch (e) {
      errors.push(`${src}: ${e.message}`)
    }
  }
  if (errors.length) res.status(207).json({ success: false, errors })
  else res.json({ success: true })
})

// ── POST /api/files/compress ──────────────────────────────────────────────────
router.post('/compress', async (req, res) => {
  const { paths, archiveName } = req.body
  if (!paths || !Array.isArray(paths) || !archiveName) return res.status(400).json({ error: 'paths array and archiveName required' })
  
  if (paths.length === 0) return res.status(400).json({ error: 'At least one path required' })
  const cleanArchive = path.basename(archiveName)
  const targetDir = path.resolve(path.dirname(paths[0]))
  const safeDst = path.resolve(path.join(targetDir, cleanArchive))
  if (!isSafePath(safeDst)) return res.status(403).json({ error: 'Access denied: Archive destination outside allowed directories' })

  try {
    const relativePaths = paths.map(p => {
      const safeSrc = path.resolve(path.normalize(p))
      if (!isSafePath(safeSrc)) throw new Error(`Access denied for path: ${p}`)
      return path.basename(safeSrc)
    })
    
    // Use execFile with safe array arguments (no shell injection)
    await execFileAsync('zip', ['-r', cleanArchive, ...relativePaths], { cwd: targetDir })
    logger.info('Archived files', { archive: safeDst, count: paths.length })
    res.json({ success: true, archive: safeDst })
  } catch (err) {
    logger.error('Compression failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/files/extract ───────────────────────────────────────────────────
router.post('/extract', async (req, res) => {
  const { filePath } = req.body
  if (!filePath) return res.status(400).json({ error: 'filePath required' })
  const safeSrc = path.resolve(path.normalize(filePath))
  if (!isSafePath(safeSrc)) return res.status(403).json({ error: 'Access denied: File outside allowed directories' })

  const targetDir = path.dirname(safeSrc)
  try {
    // Use execFile with safe array arguments (no shell injection)
    await execFileAsync('unzip', ['-o', safeSrc, '-d', targetDir])
    logger.info('Extracted ZIP archive', { archive: safeSrc, destination: targetDir })
    res.json({ success: true, destination: targetDir })
  } catch (err) {
    logger.error('Extraction failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.isSafePath = isSafePath
module.exports.getAllowedRoots = getAllowedRoots
