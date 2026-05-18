const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const logger = require('../logger')

const BACKUP_DIR = '/var/backups/serverdash'

function getAvailableStorage() {
  try {
    const { execSync } = require('child_process')
    const stdout = execSync('df -B1 /var/backups/serverdash 2>/dev/null || df -B1 /').toString()
    const lines = stdout.trim().split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].replace(/\s+/g, ' ').split(' ')
      return {
        total: parseInt(parts[1]) || 0,
        used: parseInt(parts[2]) || 0,
        available: parseInt(parts[3]) || 0,
        usePercent: parts[4] || '0%'
      }
    }
  } catch (err) {
    logger.error('Failed to get disk space for snapshots', { error: err.message })
  }
  return null
}

// Ensure backup folder exists
if (!fs.existsSync(BACKUP_DIR)) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
  } catch (err) {
    logger.error('Failed to create snapshots directory', { error: err.message })
  }
}

// ── GET /api/snapshots ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return res.json({ snapshots: [], storage: getAvailableStorage() })
    }

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.tar.gz'))
      .map(f => {
        const filePath = path.join(BACKUP_DIR, f)
        const stats = fs.statSync(filePath)
        return {
          filename: f,
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime
        }
      })
      // Sort by newest first
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    res.json({
      snapshots: files,
      storage: getAvailableStorage()
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/snapshots ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const timestamp = new Date().toISOString().replace(/[^a-zA-Z0-9]/g, '-').slice(0, 19)
  const filename = `snapshot-${timestamp}.tar.gz`
  const targetPath = path.join(BACKUP_DIR, filename)
  const tempDir = `/tmp/sd-snap-${Date.now()}`

  try {
    // 1. Create temporary directory
    fs.mkdirSync(`${tempDir}/nginx`, { recursive: true })
    fs.mkdirSync(`${tempDir}/www`, { recursive: true })
    fs.mkdirSync(`${tempDir}/db`, { recursive: true })
    fs.mkdirSync(`${tempDir}/data`, { recursive: true })

    // 2. Backup Nginx virtual host configurations
    if (fs.existsSync('/etc/nginx/sites-available')) {
      await execAsync(`cp -r /etc/nginx/sites-available/* "${tempDir}/nginx/"`).catch(() => {})
    }

    // 3. Backup Website files (excluding heavy transient node_modules)
    if (fs.existsSync('/var/www')) {
      await execAsync(`rsync -a --exclude="node_modules" /var/www/ "${tempDir}/www/"`).catch(() => {})
    }

    // 4. Backup internal ServerDash metadata lists
    if (fs.existsSync('/root/ServerDash/backend/data')) {
      await execAsync(`cp -r /root/ServerDash/backend/data/* "${tempDir}/data/"`).catch(() => {})
    }

    // 5. Backup MySQL/MariaDB database dump
    try {
      await execAsync(`mysqldump --all-databases -u root > "${tempDir}/db/all_databases.sql"`)
    } catch (dbErr) {
      logger.error('MariaDB dump failed during server snapshot', { error: dbErr.message })
    }

    // 6. Compress everything into a tarball
    await execAsync(`cd "${tempDir}" && tar -czf "${targetPath}" .`)

    // Cleanup temporary workspace
    await execAsync(`rm -rf "${tempDir}"`)

    logger.info('Server snapshot generated successfully', { filename })
    res.json({ success: true, filename, message: 'VPS Snapshot generated successfully!' })
  } catch (err) {
    // Cleanup temporary workspace in case of crash
    await execAsync(`rm -rf "${tempDir}"`).catch(() => {})
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/snapshots/:filename/download ─────────────────────────────────────
router.get('/:filename/download', (req, res) => {
  const filename = req.params.filename
  // Prevent directory traversal attacks
  if (filename.includes('/') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' })
  }

  const filePath = path.join(BACKUP_DIR, filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Snapshot not found' })
  }

  res.download(filePath, filename)
})

// ── DELETE /api/snapshots/:filename ───────────────────────────────────────────
router.delete('/:filename', async (req, res) => {
  const filename = req.params.filename
  if (filename.includes('/') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' })
  }

  const filePath = path.join(BACKUP_DIR, filename)
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    
    // Also clean up any lingering crashed/clement temporary workspaces to free up storage
    await execAsync('rm -rf /tmp/sd-snap-* /tmp/sd-restore-snap-*').catch(() => {})
    
    res.json({ success: true, message: 'Server snapshot and all temporary file caches cleaned up successfully.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/snapshots/:filename/restore ──────────────────────────────────────
router.post('/:filename/restore', async (req, res) => {
  const filename = req.params.filename
  if (filename.includes('/') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' })
  }

  const filePath = path.join(BACKUP_DIR, filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Snapshot not found' })
  }

  const restoreTemp = `/tmp/sd-restore-snap-${Date.now()}`

  try {
    fs.mkdirSync(restoreTemp, { recursive: true })

    // 1. Decompress tarball
    await execAsync(`tar -xzf "${filePath}" -d "${restoreTemp}" || tar -xzf "${filePath}" -C "${restoreTemp}"`)

    // 2. Restore Website files
    const sourceWww = `${restoreTemp}/www`
    if (fs.existsSync(sourceWww)) {
      await execAsync(`cp -rf ${sourceWww}/* /var/www/`).catch(() => {})
    }

    // 3. Restore Nginx Configurations
    const sourceNginx = `${restoreTemp}/nginx`
    if (fs.existsSync(sourceNginx)) {
      await execAsync(`cp -rf ${sourceNginx}/* /etc/nginx/sites-available/`).catch(() => {})
      // Re-enable symlinks
      const vhosts = fs.readdirSync(sourceNginx)
      for (const host of vhosts) {
        await execAsync(`ln -sf "/etc/nginx/sites-available/${host}" "/etc/nginx/sites-enabled/${host}"`).catch(() => {})
      }
    }

    // 4. Restore Internal metadata databases
    const sourceData = `${restoreTemp}/data`
    if (fs.existsSync(sourceData)) {
      await execAsync(`cp -rf ${sourceData}/* /root/ServerDash/backend/data/`).catch(() => {})
    }

    // 5. Restore MySQL/MariaDB database dump
    const dbDump = `${restoreTemp}/db/all_databases.sql`
    if (fs.existsSync(dbDump)) {
      await execAsync(`mysql -u root < "${dbDump}"`).catch(() => {})
    }

    // 6. Test Nginx and reload daemon
    try {
      await execAsync('nginx -t')
      await execAsync('systemctl reload nginx')
    } catch {}

    // Cleanup temp
    await execAsync(`rm -rf "${restoreTemp}"`)

    logger.info('Server full snapshot restored successfully', { filename })
    res.json({ success: true, message: 'Server fully restored to selected snapshot successfully!' })
  } catch (err) {
    await execAsync(`rm -rf "${restoreTemp}"`).catch(() => {})
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
