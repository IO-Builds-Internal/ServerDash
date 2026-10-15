const express = require('express')
const router = express.Router()
const { exec, execFile } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const ACCOUNTS_FILE = path.join(__dirname, '..', '..', 'data', 'ftp_accounts.json')

// Helper: load/save accounts local database
function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'))
    }
  } catch (e) {
    logger.error('Error loading FTP accounts', { error: e.message })
  }
  return []
}

function saveAccounts(accounts) {
  try {
    fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true })
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8')
  } catch (e) {
    logger.error('Error saving FTP accounts', { error: e.message })
  }
}

// ── GET /api/ftp/status ────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    // Check if vsftpd is installed
    let installed = false
    try {
      await execAsync('dpkg -l | grep -q vsftpd')
      installed = true
    } catch {
      installed = false
    }

    let running = false
    let systemdStatus = 'unknown'
    if (installed) {
      try {
        const { stdout } = await execAsync('systemctl is-active vsftpd')
        systemdStatus = stdout.trim()
        running = systemdStatus === 'active'
      } catch (err) {
        systemdStatus = 'inactive'
        running = false
      }
    }

    res.json({
      installed,
      running,
      status: systemdStatus
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/ftp/install ──────────────────────────────────────────────────────
router.post('/install', async (req, res) => {
  try {
    logger.info('Installing vsftpd service...')
    // Run apt-get install vsftpd
    await execAsync('apt-get update && apt-get install -y vsftpd')

    // Create a pristine, NAT-friendly vsftpd.conf configuration
    const configContent = `listen=NO
listen_ipv6=YES
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES
xferlog_enable=YES
connect_from_port_20=YES
chroot_local_user=YES
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
utf8_filesystem=YES
allow_writeable_chroot=YES
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40100
`
    fs.writeFileSync('/etc/vsftpd.conf', configContent, 'utf8')

    // Restart and enable the vsftpd daemon
    await execAsync('systemctl enable vsftpd && systemctl restart vsftpd')

    logger.info('vsftpd service successfully installed and configured.')
    res.json({ success: true, message: 'FTP server (vsftpd) successfully installed and configured with chroot security.' })
  } catch (err) {
    logger.error('vsftpd installation failed', { error: err.message })
    res.status(500).json({ error: `vsftpd installation failed: ${err.message}` })
  }
})

// ── POST /api/ftp/service ──────────────────────────────────────────────────────
router.post('/service', async (req, res) => {
  const { action } = req.body
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: 'Invalid service action' })
  }

  try {
    logger.info(`Running systemctl ${action} vsftpd`)
    await execAsync(`systemctl ${action} vsftpd`)
    res.json({ success: true, message: `FTP Service successfully ${action}ed` })
  } catch (err) {
    res.status(500).json({ error: `Failed to perform service action: ${err.message}` })
  }
})

// ── GET /api/ftp/users ─────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const dbAccounts = loadAccounts()
    const verified = []

    for (const acc of dbAccounts) {
      try {
        // Query passwd to confirm if user is active on system
        await execAsync(`getent passwd ${acc.username}`)
        verified.push(acc)
      } catch {
        // System user deleted manually or missing, omit
      }
    }

    // If verified length differs, sync with DB
    if (verified.length !== dbAccounts.length) {
      saveAccounts(verified)
    }

    res.json(verified)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/ftp/users ────────────────────────────────────────────────────────
router.post('/users', async (req, res) => {
  const { username, password, directory } = req.body

  if (!username || !password || !directory) {
    return res.status(400).json({ error: 'Username, password, and bound directory are required.' })
  }

  // Validate directory existence and ensure safe web/user path strictly BELOW base (SD-21, D)
  let realDir
  try {
    realDir = fs.realpathSync(path.resolve(directory))
    if (!fs.statSync(realDir).isDirectory()) {
      return res.status(400).json({ error: `Target path is not a directory: ${directory}` })
    }
  } catch {
    return res.status(400).json({ error: `Bound path directory does not exist: ${directory}` })
  }

  const safeBasePaths = ['/var/www/', '/home/']
  const isSafeDir = safeBasePaths.some(base => realDir.startsWith(base) && realDir.length > base.length)
  if (!isSafeDir) {
    return res.status(400).json({ error: 'FTP user cannot be bound to base system directories. Target must be strictly inside a subdirectory of /var/www or /home.' })
  }

  // Validate username constraint (alphanumeric only, 3-20 chars)
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be alphanumeric, between 3 to 20 characters.' })
  }

  // Prevent newline injection in chpasswd (Problem A)
  if (/[\r\n\0]/.test(password)) {
    return res.status(400).json({ error: 'Password cannot contain newline or null characters.' })
  }

  try {
    // Check if user already exists
    const dbAccounts = loadAccounts()
    if (dbAccounts.some(a => a.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: `FTP account username already registered: ${username}` })
    }

    try {
      await execFileAsync('getent', ['passwd', username])
      return res.status(400).json({ error: `System user already exists on the VPS: ${username}` })
    } catch {
      // User is available, proceed
    }

    // Ensure ftpusers group exists
    try {
      await execFileAsync('getent', ['group', 'ftpusers'])
    } catch {
      await execFileAsync('groupadd', ['ftpusers'])
    }

    // Create system user locked into directory, with no shell (nologin)
    logger.info(`Creating FTP system user ${username} bound to ${realDir}`)
    await execFileAsync('useradd', ['-d', realDir, '-s', '/usr/sbin/nologin', '-g', 'ftpusers', '-M', username])

    // Set the password safely via stdin (SD-05, A)
    const { spawn } = require('child_process')
    const chpass = spawn('chpasswd')
    chpass.stdin.write(`${username}:${password}\n`)
    chpass.stdin.end()
    await new Promise((resolve, reject) => {
      chpass.on('close', code => code === 0 ? resolve() : reject(new Error(`chpasswd failed with code ${code}`)))
      chpass.on('error', reject)
    })

    // Grant read/write ownership of directory to the FTP user
    await execFileAsync('chown', ['-R', `${username}:ftpusers`, realDir])
    await execFileAsync('chmod', ['-R', 'u+rwX,g+rwX', realDir])

    // Save to local database
    const newAcc = {
      username,
      directory,
      createdAt: new Date().toISOString()
    }
    dbAccounts.push(newAcc)
    saveAccounts(dbAccounts)

    res.json({ success: true, message: `FTP account '${username}' bound to '${directory}' created successfully.` })
  } catch (err) {
    logger.error('Failed to create FTP user', { error: err.message })
    res.status(500).json({ error: `Failed to create FTP account: ${err.message}` })
  }
})

// ── POST /api/ftp/users/password ───────────────────────────────────────────────
router.post('/users/password', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password || !/^[a-zA-Z0-9_-]{3,20}$/.test(username) || /[\r\n\0]/.test(password)) {
    return res.status(400).json({ error: 'Valid username and password (without newlines) are required.' })
  }

  try {
    await execFileAsync('getent', ['passwd', username])
    const { spawn } = require('child_process')
    const chpass = spawn('chpasswd')
    chpass.stdin.write(`${username}:${password}\n`)
    chpass.stdin.end()
    await new Promise((resolve, reject) => {
      chpass.on('close', code => code === 0 ? resolve() : reject(new Error(`chpasswd failed with code ${code}`)))
      chpass.on('error', reject)
    })
    res.json({ success: true, message: `Password for FTP account '${username}' successfully updated.` })
  } catch (err) {
    res.status(500).json({ error: `Failed to change password: ${err.message}` })
  }
})

// ── DELETE /api/ftp/users/:username ────────────────────────────────────────────
router.delete('/users/:username', async (req, res) => {
  const username = req.params.username
  if (!username || !/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username format.' })
  }

  try {
    logger.info(`Deleting FTP user account: ${username}`)
    // Delete Linux system user, keeping target files completely safe
    try {
      await execFileAsync('userdel', [username])
    } catch (e) {
      logger.warn(`User ${username} did not exist in system passwd or could not be deleted`, { error: e.message })
    }

    // Delete from JSON database
    const dbAccounts = loadAccounts()
    const filtered = dbAccounts.filter(a => a.username.toLowerCase() !== username.toLowerCase())
    saveAccounts(filtered)

    res.json({ success: true, message: `FTP user '${username}' successfully deleted from VPS.` })
  } catch (err) {
    res.status(500).json({ error: `Failed to delete FTP user: ${err.message}` })
  }
})

module.exports = router
