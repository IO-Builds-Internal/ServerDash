const express = require('express')
const router = express.Router()
const nodemailer = require('nodemailer')
const { exec, spawn } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const logger = require('../logger')

// In-memory config store
let smtpConfig = {}
let emailLogs = []

// Auto-detect SMTP from Supabase Docker container
async function detectSupabaseSmtp() {
  try {
    const { stdout } = await execAsync("docker inspect supabase-auth 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); [print(e) for c in d for e in c.get('Config',{}).get('Env',[]) if 'SMTP' in e]\"")
    const env = {}
    stdout.split('\n').filter(Boolean).forEach(line => {
      const [k, ...v] = line.split('=')
      env[k] = v.join('=')
    })
    if (env.GOTRUE_SMTP_HOST && env.GOTRUE_SMTP_HOST !== 'supabase-mail') {
      return {
        host: env.GOTRUE_SMTP_HOST,
        port: parseInt(env.GOTRUE_SMTP_PORT || '587'),
        username: env.GOTRUE_SMTP_USER || '',
        password: env.GOTRUE_SMTP_PASS || '',
        fromAddress: env.GOTRUE_SMTP_ADMIN_EMAIL || '',
        encryption: parseInt(env.GOTRUE_SMTP_PORT) === 465 ? 'SSL' : 'TLS',
        source: 'supabase-auto',
      }
    }
  } catch { }
  return null
}

// GET /api/smtp/server-info
router.get('/server-info', (req, res) => {
  const os = require('os')
  let hostname = os.hostname() || 'localhost'
  
  let ip = '127.0.0.1'
  try {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          ip = net.address
          break
        }
      }
    }
  } catch {}

  res.json({ hostname, ip })
})

// GET /api/smtp/config
router.get('/config', async (req, res) => {
  if (!smtpConfig.host) {
    const detected = await detectSupabaseSmtp()
    if (detected) smtpConfig = detected
  }
  const { password, ...safe } = smtpConfig
  res.json({ ...safe, password: password ? '••••••••' : '', detected: smtpConfig.source === 'supabase-auto' })
})

// GET /api/smtp/detect - Force re-detect
router.get('/detect', async (req, res) => {
  const detected = await detectSupabaseSmtp()
  if (detected) { smtpConfig = detected; res.json({ found: true, ...detected, password: '••••••••' }) }
  else res.json({ found: false, message: 'No external SMTP found in Supabase config' })
})

// POST /api/smtp/config
router.post('/config', (req, res) => {
  const { host, port, username, password, fromAddress, encryption } = req.body
  smtpConfig = { host, port: parseInt(port), username, password, fromAddress, encryption }
  logger.info('SMTP config updated', { host, username })
  res.json({ success: true })
})

// POST /api/smtp/test
router.post('/test', async (req, res) => {
  const { to } = req.body
  if (!smtpConfig.host) return res.status(400).json({ error: 'SMTP not configured' })

  try {
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port || 587,
      secure: smtpConfig.encryption === 'SSL',
      auth: { user: smtpConfig.username, pass: smtpConfig.password },
      tls: smtpConfig.encryption === 'TLS' ? { rejectUnauthorized: false } : undefined,
    })

    await transporter.sendMail({
      from: smtpConfig.fromAddress,
      to,
      subject: 'ServerDash Test Email',
      text: 'This is a test email from ServerDash. Your SMTP configuration is working correctly.',
      html: '<h2>ServerDash Test Email</h2><p>Your SMTP configuration is working correctly. ✓</p>',
    })

    const log = { id: Date.now(), timestamp: new Date().toISOString(), to, subject: 'ServerDash Test Email', status: 'sent', error: null }
    emailLogs.unshift(log)
    logger.info('Test email sent', { to })
    res.json({ success: true })
  } catch (err) {
    const log = { id: Date.now(), timestamp: new Date().toISOString(), to, subject: 'ServerDash Test Email', status: 'failed', error: err.message }
    emailLogs.unshift(log)
    logger.error('Test email failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// GET /api/smtp/logs
router.get('/logs', (req, res) => {
  res.json(emailLogs.slice(0, 200))
})

// DELETE /api/smtp/logs
router.delete('/logs', (req, res) => {
  emailLogs = []
  res.json({ success: true })
})

// GET /api/smtp/postfix
router.get('/postfix', async (req, res) => {
  try {
    const [status, queue, logs] = await Promise.all([
      execAsync('systemctl is-active postfix 2>&1').then(r => r.stdout.trim()).catch(() => 'inactive'),
      execAsync('mailq 2>&1 | tail -1').then(r => r.stdout).catch(() => ''),
      execAsync('tail -30 /var/log/mail.log 2>/dev/null || journalctl -u postfix -n 30 --no-pager 2>/dev/null || echo "Postfix not installed"').then(r => r.stdout).catch(() => 'Not available'),
    ])

    const isRunning = status === 'active'
    const queueMatch = queue.match(/(\d+)\s+request/)
    const queueCount = queueMatch ? parseInt(queueMatch[1]) : 0
    const logLines = logs.split('\n').filter(Boolean)

    res.json({ status: isRunning ? 'running' : 'stopped', queueCount, logs: logLines })
  } catch (err) {
    res.json({ status: 'unknown', queueCount: 0, logs: [err.message] })
  }
})

// POST /api/smtp/postfix/:action
router.post('/postfix/:action', async (req, res) => {
  const { action } = req.params
  const validActions = ['start', 'stop', 'restart', 'flush']
  if (!validActions.includes(action)) return res.status(400).json({ error: 'Invalid action' })

  try {
    const cmd = action === 'flush'
      ? 'postfix flush 2>&1'
      : `systemctl ${action} postfix 2>&1`
    const { stdout, stderr } = await execAsync(cmd).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || e.message }))
    res.json({ success: true, output: stdout + stderr })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/smtp/install-postfix  — SSE streaming install
router.post('/install-postfix', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (msg) => res.write(`data: ${msg}\n\n`)
  const { domain = 'mail.example.com', fromDomain } = req.body

  try {
    send('▶ Checking if Postfix is already installed...')
    const { stdout: which } = await execAsync('which postfix 2>/dev/null || echo ""').catch(() => ({ stdout: '' }))
    if (which.trim()) {
      send('✓ Postfix is already installed')
    } else {
      send('▶ Installing Postfix and mailutils (non-interactive)...')
      const install = spawn('/bin/bash', ['-c', 'DEBIAN_FRONTEND=noninteractive apt-get install -y postfix mailutils 2>&1'])
      await new Promise((resolve) => {
        install.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(`  ${l}`)))
        install.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(`  ${l}`)))
        install.on('close', code => {
          if (code === 0) send('✓ Postfix installed successfully')
          else send(`⚠ Install exited with code ${code}`)
          resolve()
        })
      })
    }

    // Configure as internet site
    send('▶ Configuring Postfix as Internet Site...')
    const maildomain = fromDomain || domain.replace(/^mail\./, '') || 'localhost'
    
    // Write /etc/mailname
    const fs = require('fs')
    fs.writeFileSync('/etc/mailname', maildomain + '\n')
    send(`✓ Set /etc/mailname to: ${maildomain}`)

    // Patch /etc/postfix/main.cf
    try {
      let conf = fs.readFileSync('/etc/postfix/main.cf', 'utf8')
      const set = (key, val) => {
        const re = new RegExp(`^${key}\\s*=.*`, 'm')
        if (re.test(conf)) conf = conf.replace(re, `${key} = ${val}`)
        else conf += `\n${key} = ${val}`
      }
      set('myhostname', domain)
      set('mydomain', maildomain)
      set('myorigin', '/etc/mailname')
      set('inet_interfaces', 'all')
      set('inet_protocols', 'all')
      set('mydestination', `$myhostname, ${maildomain}, localhost.${maildomain}, localhost`)
      set('smtpd_tls_security_level', 'may')
      set('smtp_tls_security_level', 'may')
      fs.writeFileSync('/etc/postfix/main.cf', conf)
      send('✓ /etc/postfix/main.cf configured')
    } catch (e) {
      send(`⚠ Could not write main.cf: ${e.message}`)
    }

    // Restart Postfix
    send('▶ Starting/restarting Postfix...')
    try {
      const { stdout } = await execAsync('systemctl restart postfix 2>&1')
      send('✓ Postfix started')
      if (stdout) stdout.split('\n').filter(Boolean).forEach(l => send(`  ${l}`))
    } catch (e) {
      send(`⚠ Restart issue: ${e.stderr || e.message}`)
    }

    // Test with local send
    send('▶ Running self-test: sending local test mail...')
    try {
      await execAsync(`echo "ServerDash Postfix test" | mail -s "Postfix Test" root@localhost 2>&1`)
      send('✓ Local test mail sent to root@localhost')
    } catch (e) {
      send(`⚠ Test mail failed: ${e.message}`)
    }

    send(`✓ Postfix setup complete!`)
    send(`  Hostname: ${domain}`)
    send(`  Domain: ${maildomain}`)
    send(`  Use this VPS as relay: smtp.${maildomain} port 25`)
    send(`  Or configure in SMTP settings: host=localhost, port=25, no auth`)
    
    // Auto-update smtpConfig to point to localhost
    smtpConfig = { host: 'localhost', port: 25, username: '', password: '', fromAddress: `noreply@${maildomain}`, encryption: 'None' }
    send('✓ SMTP Config auto-set to use local Postfix (localhost:25)')

  } catch (err) {
    send(`✗ Error: ${err.message}`)
    logger.error('Postfix install error', { error: err.message })
  }
  res.end()
})

// GET /api/smtp/accounts - List VPS mailboxes
router.get('/accounts', async (req, res) => {
  try {
    // Find all users under /home that have a Maildir
    const { stdout } = await execAsync('find /home -maxdepth 2 -name "Maildir" -type d 2>/dev/null')
    const accounts = []
    
    const paths = stdout.split('\n').filter(Boolean)
    for (const p of paths) {
      const parts = p.split('/')
      const username = parts[2] // /home/username/Maildir
      if (username) {
        // Get user details
        try {
          const { stdout: pwdOut } = await execAsync(`getent passwd ${username}`)
          const pwdParts = pwdOut.trim().split(':')
          accounts.push({
            username,
            uid: pwdParts[2],
            home: pwdParts[5],
            shell: pwdParts[6]
          })
        } catch {}
      }
    }
    
    // Get destinations from Postfix mydestination
    let domains = []
    try {
      const fs = require('fs')
      if (fs.existsSync('/etc/postfix/main.cf')) {
        const conf = fs.readFileSync('/etc/postfix/main.cf', 'utf8')
        const match = conf.match(/^mydestination\s*=\s*(.+)$/m)
        if (match) {
          domains = match[1].split(',').map(d => d.trim()).filter(Boolean)
        }
      }
    } catch {}

    res.json({ accounts, domains })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/smtp/accounts/create - Create system user and maildir
router.post('/accounts/create', async (req, res) => {
  const { username, password, domain } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' })
  }

  const cleanUser = username.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (cleanUser.length < 2) {
    return res.status(400).json({ error: 'invalid username' })
  }

  try {
    // 1. Check if user already exists
    let userExists = false
    try {
      await execAsync(`id ${cleanUser}`)
      userExists = true
    } catch {}

    // 2. Create user if not exists
    if (!userExists) {
      logger.info(`Creating system user: ${cleanUser}`)
      await execAsync(`useradd -m -s /bin/bash ${cleanUser}`)
    }

    // 3. Set password
    logger.info(`Setting password for system user: ${cleanUser}`)
    await execAsync(`echo "${cleanUser}:${password}" | chpasswd`)

    // 4. Set up Maildir structure
    logger.info(`Setting up Maildir for user: ${cleanUser}`)
    const homeDir = `/home/${cleanUser}`
    await execAsync(`mkdir -p ${homeDir}/Maildir/{cur,new,tmp}`)
    await execAsync(`chown -R ${cleanUser}:${cleanUser} ${homeDir}/Maildir`)
    await execAsync(`chmod -R 700 ${homeDir}/Maildir`)

    // 5. Add domain to Postfix mydestination if provided
    if (domain && domain.trim()) {
      const cleanDomain = domain.trim().toLowerCase().replace(/[^a-z0-9\.-]/g, '')
      const fs = require('fs')
      const mainCfPath = '/etc/postfix/main.cf'
      
      if (fs.existsSync(mainCfPath)) {
        let conf = fs.readFileSync(mainCfPath, 'utf8')
        const match = conf.match(/^mydestination\s*=\s*(.+)$/m)
        if (match) {
          const currentDest = match[1]
          if (!currentDest.includes(cleanDomain)) {
            logger.info(`Adding domain ${cleanDomain} to Postfix mydestination`)
            const newDest = `${currentDest.trim()}, ${cleanDomain}, mail.${cleanDomain}`
            conf = conf.replace(/^mydestination\s*=.+$/m, `mydestination = ${newDest}`)
            fs.writeFileSync(mainCfPath, conf)
            
            // Reload Postfix & Dovecot
            await execAsync('systemctl reload postfix')
            await execAsync('systemctl reload dovecot')
          }
        }
      }
    }

    res.json({ success: true, username: cleanUser, message: 'Mailbox account successfully configured' })
  } catch (err) {
    logger.error('Failed to create mail account', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
