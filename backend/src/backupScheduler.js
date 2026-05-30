const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const logger = require('./logger')

const PROJECTS_FILE = '/opt/supabase-projects/.projects.json'

const loadProjects = () => {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'))
    }
  } catch (e) {
    logger.error('Scheduler failed to load projects', { error: e.message })
  }
  return []
}

const checkAndRunBackups = async () => {
  logger.info('Scheduler checking Supabase auto-backups...')
  const projects = loadProjects()
  
  for (const project of projects) {
    const autoBackup = project.autoBackup !== undefined ? project.autoBackup : true
    if (!autoBackup) {
      logger.info(`Auto-backup disabled for ${project.name}, skipping`)
      continue
    }

    const interval = project.backupInterval || 'daily'
    const retention = project.backupRetention !== undefined ? project.backupRetention : 2
    const backupsDir = path.join(project.composePath, 'instance_backups')

    // Ensure backups directory exists
    if (!fs.existsSync(backupsDir)) {
      try { fs.mkdirSync(backupsDir, { recursive: true }) } catch (e) {
        logger.error(`Could not create backups directory for ${project.name}`, { error: e.message })
        continue
      }
    }

    // Determine if backup is due
    let latestBackupTime = 0
    try {
      const files = fs.readdirSync(backupsDir)
      const zips = files.filter(f => f.endsWith('.zip'))
      
      for (const f of zips) {
        const st = fs.statSync(path.join(backupsDir, f))
        if (st.mtimeMs > latestBackupTime) {
          latestBackupTime = st.mtimeMs
        }
      }
    } catch (e) {
      logger.error(`Error reading backups directory for ${project.name}`, { error: e.message })
    }

    const now = Date.now()
    const diffMs = now - latestBackupTime
    const intervalMs = interval === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000

    if (latestBackupTime === 0 || diffMs >= intervalMs) {
      logger.info(`Backup is due for ${project.name} (latest backup: ${latestBackupTime ? new Date(latestBackupTime).toISOString() : 'never'})`)
      
      const backupScript = '/opt/supabase-projects/scripts/full_backup.sh'
      const cmd = `bash "${backupScript}" "${project.composePath}" ${retention}`
      
      logger.info(`Executing background backup for ${project.name}: ${cmd}`)
      
      exec(cmd, { timeout: 600000 }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`Auto-backup failed for ${project.name}`, { error: error.message, stderr })
        } else {
          logger.info(`Auto-backup completed successfully for ${project.name}`, { stdout: stdout.substring(0, 500) })
        }
      })
    } else {
      const nextDue = new Date(latestBackupTime + intervalMs).toISOString()
      logger.info(`Backup not due yet for ${project.name}. Next scheduled backup: ${nextDue}`)
    }
  }
}

const startBackupScheduler = () => {
  // Run an initial check 30 seconds after startup (allows system services to settle)
  setTimeout(() => {
    checkAndRunBackups().catch(err => {
      logger.error('Initial auto-backup check failed', { error: err.message })
    })
  }, 30000)

  // Repeat checks every 1 hour (3600000 ms)
  setInterval(() => {
    checkAndRunBackups().catch(err => {
      logger.error('Auto-backup check interval failed', { error: err.message })
    })
  }, 3600000)
  
  logger.info('Supabase background auto-backup scheduler successfully initialized.')
}

module.exports = {
  startBackupScheduler
}
