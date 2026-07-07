const { exec, spawn } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const logger = require('./logger')

/**
 * Local executor — since the backend runs ON the VPS,
 * we use child_process instead of SSH for zero-latency local command execution.
 */
class LocalExecutor {
  isConnected() { return true }

  async exec(command, options = {}) {
    logger.info('Local exec', { command: command.substring(0, 120) })
    
    const cleanEnv = { ...process.env }
    ;['POSTGRES_PORT', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_DB', 'JWT_SECRET', 'JWT_JWKS', 'ADMIN_PASSWORD', 'LOCAL_JWT_SECRET', 'ADMIN_EMAIL', 'PORT'].forEach(k => delete cleanEnv[k])

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: options.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: '/bin/bash',
        env: cleanEnv,
      })
      return { stdout: stdout || '', stderr: stderr || '', code: 0 }
    } catch (err) {
      if (!options.ignoreErrors) {
        logger.warn('Local exec error', { command: command.substring(0, 80), code: err.code, message: err.message?.substring(0, 200) })
      }
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message || '',
        code: err.code || 1,
      }
    }
  }

  async disconnect() {}

  /**
   * Stream command output via a callback (for SSE endpoints).
   * Returns a ChildProcess so the caller can kill it on client disconnect.
   */
  stream(command, onData, onEnd) {
    const cleanEnv = { ...process.env }
    ;['POSTGRES_PORT', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_DB', 'JWT_SECRET', 'JWT_JWKS', 'ADMIN_PASSWORD', 'LOCAL_JWT_SECRET', 'ADMIN_EMAIL', 'PORT'].forEach(k => delete cleanEnv[k])
    
    const child = spawn('/bin/bash', ['-c', command], { env: cleanEnv })
    child.stdout.on('data', d => onData(d.toString()))
    child.stderr.on('data', d => onData(d.toString()))
    child.on('close', code => onEnd(code))
    return child
  }

  /**
   * Upload a local file to a destination path (for file manager uploads).
   * Since backend and VPS are the same machine, just move the tmp file.
   */
  async putFile(localPath, remotePath) {
    const fs = require('fs')
    fs.copyFileSync(localPath, remotePath)
    fs.unlinkSync(localPath)
  }

  async getConnection() { return this }
}

const pool = new LocalExecutor()
module.exports = pool
