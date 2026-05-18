const express = require('express')
const router = express.Router()
const { exec, spawn } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const multer = require('multer')
const upload = multer({ dest: '/tmp/site-uploads/' })

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`
const cleanDomain = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '')
const cleanName = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

function nodeShellPrefix(nodeVersion) {
  if (!nodeVersion || nodeVersion === 'system') return ''
  return `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm install ${nodeVersion} >/dev/null 2>&1 || true; nvm use ${nodeVersion} >/dev/null 2>&1 || true; `
}

function phpFpmSock(version) {
  const exact = `/run/php/php${version}-fpm.sock`
  if (fs.existsSync(exact)) return exact
  try {
    const found = fs.readdirSync('/run/php').find(f => /^php.*-fpm\.sock$/.test(f))
    if (found) return `/run/php/${found}`
  } catch {}
  return exact
}

function phpLocationBlock(version) {
  return `location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:${phpFpmSock(version)};
    }`
}

function staticCacheBlock() {
  return `location ~* \\.(?:css|js|jpg|jpeg|gif|png|webp|avif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        access_log off;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }`
}

async function tryExec(command, send, label, options = {}) {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: options.timeout || 120000, maxBuffer: 1024 * 1024 * 10 })
    const output = `${stdout || ''}${stderr || ''}`.trim()
    if (output && send) output.split('\n').filter(Boolean).slice(-(options.tail || 12)).forEach(l => send(l))
    return { ok: true, output }
  } catch (err) {
    if (send) send(`⚠ ${label || 'command'}: ${err.message}`)
    return { ok: false, error: err }
  }
}

async function ensurePhpRuntime(version, send) {
  send(`▶ Checking PHP ${version} runtime...`)
  const check = await tryExec(`php -v 2>/dev/null | head -1`, null, 'php check', { timeout: 10000 })
  if (check.ok && check.output) {
    send(`✓ ${check.output}`)
    return
  }
  send('Installing PHP-FPM packages...')
  const install = await tryExec(
    `apt-get update 2>&1 && apt-get install -y php${version}-fpm php${version}-mysql php${version}-curl php${version}-gd php${version}-xml php${version}-mbstring php${version}-zip unzip curl mariadb-client 2>&1`,
    send,
    'PHP install',
    { timeout: 300000, tail: 18 }
  )
  if (!install.ok) {
    await tryExec(`apt-get install -y php-fpm php-mysql php-curl php-gd php-xml php-mbstring php-zip unzip curl mariadb-client 2>&1`, send, 'fallback PHP install', { timeout: 300000, tail: 18 })
  }
}

async function ensureDatabaseService(send) {
  const ping = await tryExec('mysqladmin ping 2>&1', null, 'database ping', { timeout: 10000 })
  if (ping.ok && ping.output.includes('alive')) {
    send('✓ MariaDB/MySQL is running')
    return true
  }

  send('▶ Installing/starting MariaDB for WordPress...')
  await tryExec('apt-get update 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server mariadb-client php-mysql 2>&1', send, 'MariaDB install', { timeout: 300000, tail: 18 })
  await tryExec('systemctl enable --now mariadb 2>&1 || systemctl enable --now mysql 2>&1', send, 'MariaDB start', { timeout: 60000, tail: 8 })

  const finalPing = await tryExec('mysqladmin ping 2>&1', send, 'database ping', { timeout: 10000, tail: 4 })
  return finalPing.ok && finalPing.output.includes('alive')
}

async function prepareWordPress({ sitePath, domain, phpVersion, wpTitle, wpAdminUser, wpAdminPass, wpAdminEmail, send }) {
  send('▶ Installing WordPress files...')
  if (!fs.existsSync(path.join(sitePath, 'wp-settings.php'))) {
    await execAsync(`cd ${shellQuote(sitePath)} && curl -fsSL https://wordpress.org/latest.tar.gz | tar -xz --strip-components=1`, { timeout: 180000 })
  }
  send('✓ WordPress files ready')

  const dbName = cleanName(`wp_${domain.replace(/\./g, '_')}`) || 'wordpress'
  const dbUser = cleanName(`wp_${domain.split('.')[0]}`) || 'wp_user'
  const dbPass = require('crypto').randomBytes(18).toString('base64url')
  const adminPass = wpAdminPass || require('crypto').randomBytes(18).toString('base64url')
  const adminEmail = wpAdminEmail || `admin@${domain}`
  const title = wpTitle || domain

  const databaseAvailable = await ensureDatabaseService(send)
  send('▶ Creating WordPress database...')
  const sql = [
    'CREATE DATABASE IF NOT EXISTS `' + dbName + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
    `CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPass.replace(/'/g, "''")}';`,
    `ALTER USER '${dbUser}'@'localhost' IDENTIFIED BY '${dbPass.replace(/'/g, "''")}';`,
    'GRANT ALL PRIVILEGES ON `' + dbName + "`.* TO '" + dbUser + "'@'localhost';",
    'FLUSH PRIVILEGES;',
  ].join(' ')
  const sqlFile = `/tmp/serverdash-wp-${Date.now()}.sql`
  fs.writeFileSync(sqlFile, sql, 'utf8')
  const dbReady = databaseAvailable
    ? await tryExec(`mysql -uroot < ${shellQuote(sqlFile)} 2>&1`, send, 'database setup', { timeout: 60000, tail: 8 })
    : { ok: false }
  try { fs.unlinkSync(sqlFile) } catch {}

  let salts = ''
  try {
    salts = (await execAsync('curl -fsSL https://api.wordpress.org/secret-key/1.1/salt/ 2>/dev/null', { timeout: 15000 })).stdout
  } catch {
    const crypto = require('crypto')
    const keys = ['AUTH_KEY','SECURE_AUTH_KEY','LOGGED_IN_KEY','NONCE_KEY','AUTH_SALT','SECURE_AUTH_SALT','LOGGED_IN_SALT','NONCE_SALT']
    salts = keys.map(k => `define('${k}', '${crypto.randomBytes(48).toString('base64url')}');`).join('\n')
  }

  fs.writeFileSync(path.join(sitePath, 'wp-config.php'), `<?php
define('DB_NAME', '${dbName}');
define('DB_USER', '${dbUser}');
define('DB_PASSWORD', '${dbPass}');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
${salts}
$table_prefix = 'wp_';
define('WP_DEBUG', false);
if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
require_once ABSPATH . 'wp-settings.php';
`, 'utf8')
  send('✓ wp-config.php written')

  await tryExec(`chown -R www-data:www-data ${shellQuote(sitePath)} 2>&1`, send, 'permissions', { timeout: 60000, tail: 4 })

  send('▶ Installing WordPress core via WP-CLI if available...')
  await tryExec(
    `command -v wp >/dev/null 2>&1 || (curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp && chmod +x /usr/local/bin/wp); cd ${shellQuote(sitePath)} && wp core install --allow-root --url=${shellQuote(`http://${domain}`)} --title=${shellQuote(title)} --admin_user=${shellQuote(wpAdminUser || 'admin')} --admin_password=${shellQuote(adminPass)} --admin_email=${shellQuote(adminEmail)} 2>&1`,
    send,
    'WP-CLI install',
    { timeout: 180000, tail: 12 }
  )

  fs.writeFileSync(path.join(sitePath, '.serverdash-wordpress.txt'), [
    `URL: http://${domain}`,
    `Admin user: ${wpAdminUser || 'admin'}`,
    `Admin password: ${adminPass}`,
    `Admin email: ${adminEmail}`,
    `Database: ${dbName}`,
    `Database user: ${dbUser}`,
    `Database password: ${dbPass}`,
    `Database setup: ${dbReady.ok ? 'created' : 'manual setup may be required'}`,
  ].join('\n') + '\n', 'utf8')

  send('✓ WordPress credentials saved to .serverdash-wordpress.txt')
}

async function prepareMailboxes({ sitePath, domain, mailboxes, send }) {
  const rows = String(mailboxes || '').split('\n').map(l => l.trim()).filter(Boolean)
  if (!rows.length) return
  const requestPath = path.join(sitePath, '.serverdash-mailboxes.txt')
  fs.writeFileSync(requestPath, rows.join('\n') + '\n', 'utf8')
  send(`✓ Mailbox request saved to ${requestPath}`)
  for (const row of rows) {
    const [address] = row.split(':')
    const local = (address || '').split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '')
    if (!local) continue
    const maildir = `/var/mail/vhosts/${domain}/${local}/Maildir`
    await tryExec(`mkdir -p ${shellQuote(`${maildir}/cur`)} ${shellQuote(`${maildir}/new`)} ${shellQuote(`${maildir}/tmp`)} 2>&1`, send, `mailbox ${address}`, { timeout: 10000, tail: 2 })
  }
  send('⚠ Maildir folders prepared where possible. Postfix/Dovecot virtual mailbox wiring may still need server-level configuration.')
}

// ── GET /api/sites/check-repo?url= — check if git repo is public or private ──
router.get('/check-repo', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })
  try {
    // git ls-remote exits 0 for public, non-zero for private (without creds)
    await execAsync(`git ls-remote --exit-code --heads "${url}" 2>/dev/null`, { timeout: 8000 })
    res.json({ accessible: true, visibility: 'public' })
  } catch {
    res.json({ accessible: false, visibility: 'private' })
  }
})

// ── GET /api/sites/node-versions — available Node.js versions via nvm ──────────
router.get('/node-versions', async (req, res) => {
  try {
    const { stdout } = await execAsync('nvm ls-remote --lts 2>/dev/null | tail -20 || node -v 2>/dev/null', { timeout: 10000 })
    const versions = stdout.split('\n').filter(Boolean)
      .map(l => l.trim().replace(/[^v0-9.]/g, ''))
      .filter(v => /^v\d+/.test(v))
      .reverse()
      .slice(0, 12)
    const current = await execAsync('node -v 2>/dev/null').then(r => r.stdout.trim()).catch(() => '')
    res.json({ versions: versions.length ? versions : ['v20.x (lts)', 'v18.x (lts)', 'v16.x'], current })
  } catch {
    res.json({ versions: ['v20.x (LTS)', 'v18.x (LTS)', 'v16.x'], current: '' })
  }
})

// ── GET /api/sites/suggest-port — suggest next available port ─────────────────
router.get('/suggest-port', async (req, res) => {
  const start = parseInt(req.query.start || '3000')
  try {
    const { stdout } = await execAsync("ss -tlnp 2>/dev/null | grep LISTEN | awk '{print $4}' | grep -oP ':\\K[0-9]+'")
    const used = new Set(stdout.split('\n').filter(Boolean).map(Number))
    let p = start
    while (used.has(p) && p < 65000) p++
    res.json({ port: p, used: [...used].sort((a,b) => a-b) })
  } catch {
    res.json({ port: start, used: [] })
  }
})

// ── POST /api/sites/create-deploy (SSE) — full wizard deployment ──────────────
function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()
  return (data) => res.write(`data: ${data}\n\n`)
}


// ── Parse a single nginx config file into a site object ──────────────────────
function parseNginxConfig(content, filename) {
  const serverName = (content.match(/server_name\s+([^;]+);/) || [])[1]?.trim().split(/\s+/) || []
  const root = (content.match(/root\s+([^;]+);/) || [])[1]?.trim()
  const proxyPass = (content.match(/proxy_pass\s+([^;]+);/) || [])[1]?.trim()
  const sslCert = content.includes('ssl_certificate')
  const listen80 = content.includes('listen 80') || content.includes('listen [::]:80')
  const listen443 = content.includes('listen 443') || content.includes('listen [::]:443')

  // Detect type
  let type = 'static'
  if (proxyPass) type = proxyPass.includes('php') ? 'php' : 'proxy'
  else if (content.includes('php')) type = 'php'

  // Detect port from proxy_pass or named upstream
  let proxyPort = null
  if (proxyPass) {
    const portMatch = proxyPass.match(/:(\d+)/)
    if (portMatch) {
      proxyPort = portMatch[1]
    } else {
      const upstreamName = proxyPass.replace(/^https?:\/\//, '').trim()
      const upstreamRegex = new RegExp(`upstream\\s+${upstreamName}\\s*\\{[^}]*server\\s+([^;\\s]+)`, 'i')
      const upstreamMatch = content.match(upstreamRegex)
      if (upstreamMatch) {
        const serverAddr = upstreamMatch[1].trim()
        const serverPortMatch = serverAddr.match(/:(\d+)/)
        if (serverPortMatch) {
          proxyPort = serverPortMatch[1]
        }
      }
    }
  }

  const primaryDomain = serverName[0] || filename
  return {
    id: filename.replace(/[^a-z0-9]/gi, '-'),
    domain: primaryDomain,
    aliases: serverName.slice(1),
    type,
    status: 'active',
    ssl: sslCert,
    port: listen443 ? 443 : listen80 ? 80 : null,
    proxyPort,
    root: root || null,
    configFile: `/etc/nginx/sites-enabled/${filename}`,
    gitRepo: null,
    lastDeployed: null,
  }
}

// ── GET /api/sites ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const sitesDir = '/etc/nginx/sites-enabled'
    const files = fs.readdirSync(sitesDir).filter(f => !f.startsWith('.'))

    const sites = []
    for (const file of files) {
      const fullPath = path.join(sitesDir, file)
      try {
        // Resolve symlinks
        const realPath = fs.realpathSync(fullPath)
        const content = fs.readFileSync(realPath, 'utf8')
        const site = parseNginxConfig(content, file)
        sites.push(site)
      } catch { /* skip unreadable */ }
    }

    // Merge with /var/www directories to catch sites without nginx configs
    try {
      const wwwDirs = fs.readdirSync('/var/www').filter(d => d !== 'html')
      for (const dir of wwwDirs) {
        if (!sites.find(s => s.root?.includes(dir) || s.domain?.includes(dir))) {
          sites.push({
            id: `www-${dir}`,
            domain: dir,
            type: 'static',
            status: 'no-nginx',
            ssl: false,
            root: `/var/www/${dir}`,
            configFile: null,
            gitRepo: null,
            lastDeployed: null,
          })
        }
      }
    } catch { /* /var/www might not exist */ }

    res.json(sites)
  } catch (err) {
    logger.error('Sites list error', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

function getDatabaseCredentials(siteRoot) {
  if (!siteRoot || !fs.existsSync(siteRoot)) return null
  
  // 1. Try reading .serverdash-wordpress.txt
  const sdFile = path.join(siteRoot, '.serverdash-wordpress.txt')
  if (fs.existsSync(sdFile)) {
    try {
      const content = fs.readFileSync(sdFile, 'utf8')
      const dbNameMatch = content.match(/Database:\s*([^\n]+)/)
      const dbUserMatch = content.match(/Database user:\s*([^\n]+)/)
      const dbPassMatch = content.match(/Database password:\s*([^\n]+)/)
      if (dbNameMatch || dbUserMatch || dbPassMatch) {
        return {
          dbName: dbNameMatch ? dbNameMatch[1].trim() : '',
          dbUser: dbUserMatch ? dbUserMatch[1].trim() : '',
          dbPass: dbPassMatch ? dbPassMatch[1].trim() : '',
          isWordPress: true
        }
      }
    } catch {}
  }

  // 2. Fallback: Read wp-config.php directly using regex
  const wpConfig = path.join(siteRoot, 'wp-config.php')
  if (fs.existsSync(wpConfig)) {
    try {
      const content = fs.readFileSync(wpConfig, 'utf8')
      const dbNameMatch = content.match(/define\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]\s*\)/)
      const dbUserMatch = content.match(/define\(\s*['"]DB_USER['"]\s*,\s*['"]([^'"]+)['"]\s*\)/)
      const dbPassMatch = content.match(/define\(\s*['"]DB_PASSWORD['"]\s*,\s*['"]([^'"]+)['"]\s*\)/)
      if (dbNameMatch || dbUserMatch || dbPassMatch) {
        return {
          dbName: dbNameMatch ? dbNameMatch[1].trim() : '',
          dbUser: dbUserMatch ? dbUserMatch[1].trim() : '',
          dbPass: dbPassMatch ? dbPassMatch[1].trim() : '',
          isWordPress: true
        }
      }
    } catch {}
  }

  return null
}

// ── GET /api/sites/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const sitesDir = '/etc/nginx/sites-enabled'
    const files = fs.readdirSync(sitesDir).filter(f => !f.startsWith('.'))

    for (const file of files) {
      const parsedId = file.replace(/[^a-z0-9]/gi, '-')
      if (parsedId === id) {
        const fullPath = path.join(sitesDir, file)
        const realPath = fs.realpathSync(fullPath)
        const content = fs.readFileSync(realPath, 'utf8')
        const site = parseNginxConfig(content, file)
        if (site.type === 'php' || site.root) {
          site.database = getDatabaseCredentials(site.root)
        }
        return res.json(site)
      }
    }

    if (id.startsWith('www-')) {
      const dir = id.slice(4)
      const site = {
        id,
        domain: dir,
        type: 'static',
        status: 'no-nginx',
        ssl: false,
        root: `/var/www/${dir}`,
        configFile: null,
        gitRepo: null,
        lastDeployed: null,
      }
      site.database = getDatabaseCredentials(site.root)
      return res.json(site)
    }

    res.status(404).json({ error: 'Site not found' })
  } catch (err) {
    logger.error('Site detail error', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/sites/:id/db-reset-password ──────────────────────────────────────────
router.post('/:id/db-reset-password', async (req, res) => {
  try {
    const { id } = req.params
    const sitesDir = '/etc/nginx/sites-enabled'
    const files = fs.readdirSync(sitesDir).filter(f => !f.startsWith('.'))
    let foundSite = null

    for (const file of files) {
      const parsedId = file.replace(/[^a-z0-9]/gi, '-')
      if (parsedId === id) {
        const fullPath = path.join(sitesDir, file)
        const realPath = fs.realpathSync(fullPath)
        const content = fs.readFileSync(realPath, 'utf8')
        foundSite = parseNginxConfig(content, file)
        break
      }
    }

    if (!foundSite && id.startsWith('www-')) {
      const dir = id.slice(4)
      foundSite = {
        id,
        domain: dir,
        root: `/var/www/${dir}`,
      }
    }

    if (!foundSite || !foundSite.root) {
      return res.status(404).json({ error: 'Site or root directory not found' })
    }

    const credentials = getDatabaseCredentials(foundSite.root)
    if (!credentials || !credentials.dbUser) {
      return res.status(400).json({ error: 'No database credentials detected for this site' })
    }

    const newPass = require('crypto').randomBytes(18).toString('base64url')

    // 1. Run MariaDB/MySQL update query
    const sql = `ALTER USER '${credentials.dbUser}'@'localhost' IDENTIFIED BY '${newPass.replace(/'/g, "''")}'; FLUSH PRIVILEGES;`
    const sqlFile = `/tmp/serverdash-db-reset-${Date.now()}.sql`
    fs.writeFileSync(sqlFile, sql, 'utf8')
    try {
      await execAsync(`mysql -uroot < ${shellQuote(sqlFile)}`, { timeout: 15000 })
    } catch (dbErr) {
      logger.error('MariaDB password reset sql error', { error: dbErr.message })
      return res.status(500).json({ error: `Failed to update MariaDB user password: ${dbErr.message}` })
    } finally {
      try { fs.unlinkSync(sqlFile) } catch {}
    }

    // 2. Update wp-config.php if present
    const wpConfig = path.join(foundSite.root, 'wp-config.php')
    if (fs.existsSync(wpConfig)) {
      let configContent = fs.readFileSync(wpConfig, 'utf8')
      configContent = configContent.replace(
        /define\(\s*['"]DB_PASSWORD['"]\s*,\s*['"]([^'"]*)['"]\s*\)/,
        `define('DB_PASSWORD', '${newPass}')`
      )
      fs.writeFileSync(wpConfig, configContent, 'utf8')
    }

    // 3. Update .serverdash-wordpress.txt if present
    const sdFile = path.join(foundSite.root, '.serverdash-wordpress.txt')
    if (fs.existsSync(sdFile)) {
      let content = fs.readFileSync(sdFile, 'utf8')
      content = content.replace(/Database password:\s*[^\n]+/, `Database password: ${newPass}`)
      fs.writeFileSync(sdFile, content, 'utf8')
    }

    logger.info('Database password reset successful', { domain: foundSite.domain, user: credentials.dbUser })
    res.json({ success: true, newPassword: newPass })
  } catch (err) {
    logger.error('DB Password Reset error', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/sites/:id/config ──────────────────────────────────────────────────
router.get('/:id/config', async (req, res) => {
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === req.params.id)
    if (!site || !site.configFile) return res.status(404).json({ error: 'Config not found' })
    const realPath = fs.realpathSync(site.configFile)
    const content = fs.readFileSync(realPath, 'utf8')
    res.json({ content, path: realPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/sites/:id/config ─────────────────────────────────────────────────
router.post('/:id/config', async (req, res) => {
  const { content } = req.body
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === req.params.id)
    if (!site || !site.configFile) return res.status(404).json({ error: 'Config not found' })
    const realPath = fs.realpathSync(site.configFile)
    const oldContent = fs.readFileSync(realPath, 'utf8')
    fs.writeFileSync(realPath, content, 'utf8')

    // Test and reload nginx
    try {
      await execAsync('nginx -t 2>&1')
      await execAsync('systemctl reload nginx 2>&1')
    } catch (e) {
      // Rollback on failure
      fs.writeFileSync(realPath, oldContent, 'utf8')
      throw new Error(`Invalid Nginx config (rolled back): ${e.message}`)
    }
    
    logger.info('Nginx config updated', { site: site.domain })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function getNginxSites() {
  const sitesDir = '/etc/nginx/sites-enabled'
  const files = fs.readdirSync(sitesDir).filter(f => !f.startsWith('.'))
  const sites = []
  for (const file of files) {
    try {
      const realPath = fs.realpathSync(path.join(sitesDir, file))
      const content = fs.readFileSync(realPath, 'utf8')
      sites.push(parseNginxConfig(content, file))
    } catch { }
  }
  return sites
}


// ── POST /api/sites/create ─────────────────────────────────────────────────────
router.post('/create', async (req, res) => {
  const { domain, type = 'static', gitRepo, branch = 'main', port = 3000, envVars = [] } = req.body
  if (!domain) return res.status(400).json({ error: 'domain required' })

  try {
    const sitePath = `/var/www/${domain}`
    fs.mkdirSync(sitePath, { recursive: true })

    if (gitRepo) {
      await execAsync(`git clone ${gitRepo} ${sitePath} --branch ${branch} 2>&1 || (cd ${sitePath} && git pull) 2>&1`)
    }

    if (type === 'node') {
      await execAsync(`cd ${sitePath} && npm install --production 2>&1`)
      await execAsync(`pm2 start ${sitePath}/index.js --name ${domain} -- --port ${port} 2>&1 || true`)
    }

    const nginxConf = type === 'proxy' || type === 'node' ? `server {
    listen 80;
    server_name ${domain};
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}` : `server {
    listen 80;
    server_name ${domain};
    root ${sitePath}${type === 'static' ? '/dist' : ''};
    index index.html index.php;
    location / { try_files $uri $uri/ /index.html; }
    ${type === 'php' ? 'location ~ \\.php$ { fastcgi_pass unix:/run/php/php8.2-fpm.sock; fastcgi_index index.php; include fastcgi_params; fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name; }' : ''}
}`

    fs.writeFileSync(`/etc/nginx/sites-available/${domain}`, nginxConf)
    await execAsync(`ln -sf /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/${domain}`)
    try {
      await execAsync('nginx -t 2>&1')
    } catch (e) {
      await execAsync(`rm -f /etc/nginx/sites-enabled/${domain}`)
      throw new Error(`Nginx test failed, config removed: ${e.message}`)
    }
    await execAsync('systemctl reload nginx')
    logger.info('Site created', { domain, type })
    res.json({ success: true, domain, type, root: sitePath })
  } catch (err) {
    logger.error('Site create error', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/sites/:id/deploy SSE ────────────────────────────────────────────
router.post('/:id/deploy', async (req, res) => {
  const send = sseSetup(res)
  const { id } = req.params

  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) { send('✗ Site not found'); return res.end() }

    send(`Deploying ${site.domain}…`)
    const root = site.root || `/var/www/${site.domain}`

    const commitHash = req.body?.commitHash || req.query?.commitHash
    if (fs.existsSync(path.join(root, '.git'))) {
      if (commitHash) {
        send(`Restoring / Rolling back to commit ${commitHash}…`)
        await execAsync(`cd "${root}" && git fetch origin 2>&1 || true`)
        const { stdout: resetOut } = await execAsync(`cd "${root}" && git reset --hard ${shellQuote(commitHash)} 2>&1`)
        resetOut.split('\n').filter(Boolean).forEach(l => send(l))
      } else {
        send('git pull…')
        const { stdout: gitOut } = await execAsync(`cd "${root}" && git pull 2>&1`)
        gitOut.split('\n').filter(Boolean).forEach(l => send(l))
      }
    }

    let installCmd = 'npm install --production'
    let buildCmd = 'npm run build'
    let restartCmd = `pm2 restart "${site.domain}"`
    let nodeVersion = 'system'

    const metaPath = path.join(root, '.serverdash.json')
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        if (meta.installCommand !== undefined) installCmd = meta.installCommand
        if (meta.buildCommand !== undefined) buildCmd = meta.buildCommand
        if (meta.restartCommand !== undefined) restartCmd = meta.restartCommand
        if (meta.nodeVersion !== undefined) nodeVersion = meta.nodeVersion
      } catch (e) {}
    }

    const prefix = nodeShellPrefix(nodeVersion)

    if (fs.existsSync(path.join(root, 'package.json'))) {
      if (installCmd && installCmd.trim()) {
        send(`${installCmd}…`)
        await execAsync(`cd "${root}" && ${prefix}${installCmd} 2>&1`)
      }
      if (buildCmd && buildCmd.trim()) {
        send(`${buildCmd}…`)
        try {
          await execAsync(`cd "${root}" && ${prefix}${buildCmd} 2>&1`)
          send('✓ Build complete')
        } catch (e) {
          send(`⚠ Build failed: ${e.message}`)
        }
      }
    }

    if (restartCmd && restartCmd.trim()) {
      try {
        send(`Restarting application: ${restartCmd}…`)
        const { stdout: restartOut } = await execAsync(`cd "${root}" && ${prefix}${restartCmd} 2>&1`)
        restartOut.split('\n').filter(Boolean).forEach(l => send(l))
        send('✓ Application restarted')
      } catch (e) {
        send(`⚠ Restart failed: ${e.message}`)
      }
    }

    await execAsync('systemctl reload nginx')
    send('✓ nginx reloaded')
    send('✓ Deployment complete')
  } catch (err) {
    send(`✗ Error: ${err.message}`)
  }
  res.end()
})

// ── GET /api/sites/:id/env ────────────────────────────────────────────────────
router.get('/:id/env', async (req, res) => {
  const { id } = req.params
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })
    const root = site.root || `/var/www/${site.domain}`
    const envPath = path.join(root, '.env')
    let content = ''
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8')
    }
    res.json({ env: content })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/sites/:id/env ───────────────────────────────────────────────────
router.post('/:id/env', async (req, res) => {
  const { id } = req.params
  const { envContent } = req.body
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })
    const root = site.root || `/var/www/${site.domain}`
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true })
    }
    const envPath = path.join(root, '.env')
    fs.writeFileSync(envPath, envContent || '', 'utf8')
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/sites/:id/build-settings ──────────────────────────────────────────
router.get('/:id/build-settings', async (req, res) => {
  const { id } = req.params
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })
    const root = site.root || `/var/www/${site.domain}`
    const metaPath = path.join(root, '.serverdash.json')
    let settings = {
      installCommand: 'npm install --production',
      buildCommand: 'npm run build',
      restartCommand: `pm2 restart "${site.domain}"`,
      nodeVersion: 'system'
    }
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        settings = { ...settings, ...meta }
      } catch (e) {}
    }
    res.json(settings)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/sites/:id/build-settings ─────────────────────────────────────────
router.post('/:id/build-settings', async (req, res) => {
  const { id } = req.params
  const { installCommand, buildCommand, restartCommand, nodeVersion } = req.body
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })
    const root = site.root || `/var/www/${site.domain}`
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true })
    }
    const metaPath = path.join(root, '.serverdash.json')
    const settings = {
      installCommand: installCommand || 'npm install --production',
      buildCommand: buildCommand || 'npm run build',
      restartCommand: restartCommand || `pm2 restart "${site.domain}"`,
      nodeVersion: nodeVersion || 'system'
    }
    fs.writeFileSync(metaPath, JSON.stringify(settings, null, 2), 'utf8')
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/sites/:id/git ─────────────────────────────────────────────────────
router.get('/:id/git', async (req, res) => {
  const { id } = req.params
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })
    const root = site.root || `/var/www/${site.domain}`
    
    const hasGit = fs.existsSync(path.join(root, '.git'))
    if (!hasGit) {
      return res.json({ hasGit: false })
    }

    let repoUrl = ''
    let branch = 'main'
    try {
      const { stdout: urlOut } = await execAsync(`cd "${root}" && git config --get remote.origin.url || true`)
      repoUrl = urlOut.trim()
      const { stdout: branchOut } = await execAsync(`cd "${root}" && git branch --show-current || true`)
      branch = branchOut.trim()
    } catch (e) {}

    let lastCommit = null
    let commits = []
    try {
      const { stdout: commitOut } = await execAsync(`cd "${root}" && git log -1 --format="%h|%an|%ae|%ad|%s" --date=relative || true`)
      if (commitOut.trim()) {
        const [hash, author, email, date, subject] = commitOut.trim().split('|')
        lastCommit = { hash, author, email, date, subject }
      }
      const { stdout: commitsOut } = await execAsync(`cd "${root}" && git log -20 --format="%h|%an|%ae|%ad|%s" --date=relative || true`)
      if (commitsOut.trim()) {
        commits = commitsOut.trim().split('\n').filter(Boolean).map(line => {
          const [hash, author, email, date, subject] = line.split('|')
          return { hash, author, email, date, subject }
        })
      }
    } catch (e) {}

    let behindCount = 0
    try {
      await execAsync(`cd "${root}" && git fetch origin 2>/dev/null || true`, { timeout: 10000 })
      const { stdout: behindOut } = await execAsync(`cd "${root}" && git rev-list HEAD..origin/${branch} --count || true`)
      behindCount = parseInt(behindOut.trim()) || 0
    } catch (e) {}

    res.json({
      hasGit: true,
      repoUrl,
      branch,
      lastCommit,
      behindCount,
      commits
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/sites/:id/restart ───────────────────────────────────────────────
router.post('/:id/restart', async (req, res) => {
  const { id } = req.params
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })
    await execAsync(`pm2 restart ${site.domain} 2>&1 || true`)
    await execAsync('systemctl reload nginx')
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/sites/:id/ssl ───────────────────────────────────────────────────
router.post('/:id/ssl', async (req, res) => {
  const { id } = req.params
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })

    const domain = site.domain
    logger.info('Starting SSL configuration', { domain })

    const { stdout, stderr } = await execAsync(
      `certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@${domain} 2>&1`,
      { timeout: 120000 }
    )
    
    await execAsync('systemctl reload nginx')
    logger.info('SSL configuration completed', { domain })
    res.json({ success: true, output: stdout || stderr || 'SSL certificate configured' })
  } catch (err) {
    logger.error('SSL configuration error', { id, error: err.message })
    res.status(500).json({ error: err.message })
  }
})


// ── DELETE /api/sites/:id ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const deleteFiles = req.query.deleteFiles === 'true'
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })

    // Only remove if we have an nginx config for it
    if (site.configFile) {
      const realPath = fs.realpathSync(site.configFile)
      try { await execAsync(`rm -f "${site.configFile}"`) } catch { }
      try { await execAsync(`rm -f "${realPath}"`) } catch { }
    }
    
    if (deleteFiles) {
      const root = site.root || `/var/www/${site.domain || id}`
      if (root.startsWith('/var/www/')) {
        await execAsync(`rm -rf "${root}"`)
        logger.info('Deleted site files', { root })
      }
    }

    await execAsync('nginx -t && systemctl reload nginx')
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/sites/:id/logs ────────────────────────────────────────────────────
router.get('/:id/logs', async (req, res) => {
  const { id } = req.params
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    const domain = site?.domain || id
    const { stdout } = await execAsync(`tail -q -n 100 /var/log/nginx/${domain}-access.log /var/log/nginx/${domain}-error.log /var/log/nginx/access.log 2>/dev/null || true`)
    res.json({ logs: stdout.split('\n').filter(Boolean) })
  } catch (err) {
    res.json({ logs: [`Error reading logs: ${err.message}`] })
  }
})

// ── POST /api/sites/create-wizard — SSE wizard deployment ─────────────────────
router.post('/create-wizard', upload.single('zip'), async (req, res) => {
  const send = sseSetup(res)
  logger.info('Wizard start', { body: req.body, file: req.file ? req.file.originalname : null })
  const {
    type='static',
    source='git',
    gitRepo,
    branch='main',
    gitUser,
    gitToken,
    port=3000,
    envVars='',
    ssl='false',
    nodeVersion='system',
    nodeInstallCommand='npm install',
    nodeBuildCommand='npm run build',
    nodeStartCommand='npm start',
    nodeOutputDir='',
    phpPreset='blank',
    phpVersion='8.2',
    wpTitle='',
    wpAdminUser='admin',
    wpAdminPass='',
    wpAdminEmail='',
    mailboxes='',
    customPath='',
  } = req.body
  const domain = cleanDomain(req.body.domain)
  if (!domain) { send('✗ valid domain required'); return res.end() }

  const sitePath = customPath && customPath.trim() ? path.resolve(customPath.trim()) : `/var/www/${domain}`

  try {
    send(`▶ Creating site: ${domain} (${type})`)
    fs.mkdirSync(sitePath, { recursive: true })
    send(`✓ Created directory: ${sitePath}`)

    // --- Source ---
    if (source === 'git' && gitRepo && type !== 'proxy') {
      let cloneUrl = gitRepo
      if (gitUser && gitToken) {
        const u = new URL(gitRepo)
        u.username = gitUser; u.password = gitToken
        cloneUrl = u.toString()
      }
      if (fs.existsSync(path.join(sitePath, '.git'))) {
        send('git pull origin ' + branch)
        const { stdout } = await execAsync(`cd "${sitePath}" && git pull origin ${branch} 2>&1`)
        stdout.split('\n').filter(Boolean).forEach(l => send(l))
      } else {
        send(`git clone ${gitRepo} …`)
        const { stdout } = await execAsync(`git clone "${cloneUrl}" "${sitePath}" --branch ${branch} 2>&1`)
        stdout.split('\n').filter(Boolean).forEach(l => send(l))
      }
      send('✓ Repository cloned')
    } else if (source === 'zip') {
      if (req.file) {
        send('Extracting ZIP…')
        await execAsync(`unzip -o "${req.file.path}" -d "${sitePath}" 2>&1`)
        fs.unlinkSync(req.file.path)
        send('✓ ZIP extracted')
      } else {
        send('No ZIP uploaded, skipping source import')
      }
    } else {
      send('No source selected, creating configuration only')
    }

    // --- .env ---
    if (envVars && envVars.trim()) {
      const envPath = path.join(sitePath, '.env')
      fs.writeFileSync(envPath, envVars + '\n', 'utf8')
      send('✓ .env file written')
    }

    // --- Node.js: install/build/start with PM2 ──────────────────────────────
    if (type === 'node') {
      if (fs.existsSync(path.join(sitePath, 'package.json'))) {
        const prefix = nodeShellPrefix(nodeVersion)
        if (nodeInstallCommand && nodeInstallCommand.trim()) {
          send(`${nodeInstallCommand}…`)
          const { stdout: installOut } = await execAsync(`cd ${shellQuote(sitePath)} && ${prefix}${nodeInstallCommand} 2>&1`, { timeout: 240000, maxBuffer: 1024 * 1024 * 10 })
          installOut.split('\n').filter(Boolean).slice(-12).forEach(l => send(l))
        }
        if (nodeBuildCommand && nodeBuildCommand.trim()) {
          try {
            send(`${nodeBuildCommand}…`)
            const { stdout: buildOut } = await execAsync(`cd ${shellQuote(sitePath)} && ${prefix}${nodeBuildCommand} 2>&1`, { timeout: 240000, maxBuffer: 1024 * 1024 * 10 })
            buildOut.split('\n').filter(Boolean).slice(-12).forEach(l => send(l))
            send('✓ Build complete')
          } catch (e) {
            send(`⚠ Build command failed: ${e.message}`)
          }
        } else {
          send('(no build command, skipping)')
        }
      }
      try {
        await execAsync(`pm2 delete ${shellQuote(domain)} 2>/dev/null || true`)
        const prefix = nodeShellPrefix(nodeVersion)
        const startCommand = nodeStartCommand && nodeStartCommand.trim()
          ? nodeStartCommand.trim()
          : fs.existsSync(path.join(sitePath, 'server.js')) ? 'node server.js' : fs.existsSync(path.join(sitePath, 'app.js')) ? 'node app.js' : 'node index.js'
        const pm2Command = `cd ${shellQuote(sitePath)} && PORT=${parseInt(port) || 3000} ${prefix}${startCommand}`
        await execAsync(`pm2 start bash --name ${shellQuote(domain)} -- -lc ${shellQuote(pm2Command)} 2>&1`, { timeout: 60000 })
        await execAsync('pm2 save 2>/dev/null || true')
        send(`✓ PM2 started: ${domain} on port ${port}`)
      } catch (e) { send(`⚠ PM2: ${e.message}`) }
    }

    // --- Python / Flask: virtualenv, pip packages, PM2 daemon running ────────────────────────
    if (type === 'python' || type === 'flask') {
      send('▶ Preparing Python and virtual environment dependencies...')
      await tryExec('apt-get update 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv python3-pip gunicorn 2>&1', send, 'python packages', { timeout: 180000, tail: 14 })

      const venvPath = path.join(sitePath, 'venv')
      if (!fs.existsSync(venvPath)) {
        send('Creating isolated python3 virtualenv...')
        await tryExec(`python3 -m venv "${venvPath}" 2>&1`, send, 'venv create', { timeout: 60000 })
      }

      const pipBin = path.join(venvPath, 'bin', 'pip')
      const reqPath = path.join(sitePath, 'requirements.txt')

      if (fs.existsSync(reqPath)) {
        send('requirements.txt detected! Installing python packages into venv...')
        await tryExec(`"${pipBin}" install -r "${reqPath}" 2>&1`, send, 'pip install', { timeout: 180000, tail: 12 })
      } else {
        send('No requirements.txt found. Installing Flask and Gunicorn by default...')
        await tryExec(`"${pipBin}" install flask gunicorn 2>&1`, send, 'pip default install', { timeout: 90000 })
      }

      // Check/create app entrypoint boilerplate
      const appFile = path.join(sitePath, 'app.py')
      const mainFile = path.join(sitePath, 'main.py')
      const wsgiFile = path.join(sitePath, 'wsgi.py')

      let entryModule = 'app'
      if (fs.existsSync(wsgiFile)) entryModule = 'wsgi'
      else if (fs.existsSync(mainFile)) entryModule = 'main'
      else if (!fs.existsSync(appFile)) {
        send('Creating boilerplate Flask app.py...')
        fs.writeFileSync(appFile, `from flask import Flask, jsonify
app = Flask(__name__)

@app.route('/')
def hello():
    return jsonify(status="ok", message="Hello from Flask deployed on ServerDash!")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=${port})
`, 'utf8')
      }

      try {
        await execAsync(`pm2 delete ${shellQuote(domain)} 2>/dev/null || true`)
        const gunicornPath = path.join(venvPath, 'bin', 'gunicorn')
        const startCommand = `"${gunicornPath}" --bind 127.0.0.1:${port} ${entryModule}:app`
        
        send(`PM2 launching Flask Gunicorn application: ${startCommand}…`)
        await execAsync(`pm2 start bash --name ${shellQuote(domain)} -- -lc ${shellQuote(`cd ${shellQuote(sitePath)} && ${startCommand}`)} 2>&1`, { timeout: 60000 })
        await execAsync('pm2 save 2>/dev/null || true')
        send(`✓ PM2 started: ${domain} (Flask) on port ${port}`)
      } catch (e) {
        send(`⚠ PM2: ${e.message}`)
      }
    }

    // --- PHP / WordPress ────────────────────────────────────────────────────
    if (type === 'php') {
      await ensurePhpRuntime(phpVersion, send)
      if (phpPreset === 'wordpress') {
        await prepareWordPress({
          sitePath,
          domain,
          phpVersion,
          wpTitle,
          wpAdminUser,
          wpAdminPass,
          wpAdminEmail,
          send,
        })
      } else if (phpPreset === 'laravel' && fs.existsSync(path.join(sitePath, 'composer.json'))) {
        send('composer install --no-dev --optimize-autoloader…')
        await tryExec(`cd ${shellQuote(sitePath)} && composer install --no-dev --optimize-autoloader 2>&1`, send, 'composer install', { timeout: 240000, tail: 14 })
        await tryExec(`cd ${shellQuote(sitePath)} && php artisan key:generate --force 2>&1 && php artisan config:cache 2>&1`, send, 'laravel optimize', { timeout: 120000, tail: 10 })
      }
      await prepareMailboxes({ sitePath, domain, mailboxes, send })
    }

    // --- Static builds: auto-build common package projects ───────────────────
    if (type === 'static' && fs.existsSync(path.join(sitePath, 'package.json'))) {
      send('Detected package.json for static site')
      try {
        send('npm install…')
        await execAsync(`cd ${shellQuote(sitePath)} && npm install 2>&1`, { timeout: 180000, maxBuffer: 1024 * 1024 * 10 })
        send('npm run build…')
        await execAsync(`cd ${shellQuote(sitePath)} && npm run build 2>&1`, { timeout: 180000, maxBuffer: 1024 * 1024 * 10 })
        send('✓ Static build complete')
      } catch (e) {
        send(`⚠ Static build skipped/failed: ${e.message}`)
      }
    }

    // --- Nginx config ────────────────────────────────────────────────────────
    const phpRoot = phpPreset === 'laravel' && fs.existsSync(path.join(sitePath, 'public')) ? `${sitePath}/public` : sitePath
    const requestedNodeOutput = nodeOutputDir ? path.join(sitePath, nodeOutputDir) : ''
    const webRoot = type==='static'
      ? (fs.existsSync(path.join(sitePath,'dist'))?`${sitePath}/dist`:fs.existsSync(path.join(sitePath,'build'))?`${sitePath}/build`:sitePath)
      : type === 'php'
        ? phpRoot
        : requestedNodeOutput && fs.existsSync(requestedNodeOutput)
          ? requestedNodeOutput
          : sitePath
    let nginxConf
    if (type==='proxy' || type==='node' || type==='python' || type==='flask') {
      nginxConf = `server {
    listen 80;
    server_name ${domain};
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
    }`
    } else {
      nginxConf = `server {
    listen 80;
    server_name ${domain};
    root ${webRoot};
    index index.html${type==='php'?' index.php':''};
    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;
    ${staticCacheBlock()}
    location / { try_files $uri $uri/ ${type==='php' ? '/index.php?$query_string' : '/index.html'}; }
    ${type==='php'?phpLocationBlock(phpVersion):''}
}`
    }

    const confPath = `/etc/nginx/sites-available/${domain}`
    fs.writeFileSync(confPath, nginxConf, 'utf8')
    await execAsync(`ln -sf "${confPath}" /etc/nginx/sites-enabled/${domain}`)
    
    try {
      await execAsync('nginx -t 2>&1')
    } catch (e) {
      await execAsync(`rm -f /etc/nginx/sites-enabled/${domain}`)
      throw new Error(`Nginx test failed, config removed: ${e.message}`)
    }
    
    await execAsync('systemctl reload nginx')
    send('✓ Nginx configured and reloaded')

    // --- SSL ─────────────────────────────────────────────────────────────────
    if (ssl === 'true') {
      send('Running certbot…')
      try {
        const { stdout: certOut } = await execAsync(`certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@${domain} 2>&1`, { timeout: 120000 })
        certOut.split('\n').filter(Boolean).forEach(l => send(l))
        send('✓ SSL certificate installed')
      } catch (e) { send(`⚠ SSL failed: ${e.message}`) }
    }

    send('✓ Site deployment complete!')
    logger.info('Wizard deployed site', { domain, type })
  } catch (err) {
    send(`✗ Error: ${err.message}`)
    logger.error('Wizard deploy error', { error: err.message })
  }
  res.end()
})

async function syncPostfixMail(domain, mailboxes = [], forwarders = []) {
  try {
    // 1. Sync vmailbox
    const vmailboxPath = '/etc/postfix/vmailbox'
    let vmailboxContent = ''
    if (fs.existsSync(vmailboxPath)) {
      vmailboxContent = fs.readFileSync(vmailboxPath, 'utf8')
    }
    // Filter out existing domain lines
    let vmailLines = vmailboxContent.split('\n').filter(line => {
      const trim = line.trim()
      if (!trim || trim.startsWith('#')) return true
      return !trim.includes(`@${domain}`)
    })
    // Append current mailboxes
    mailboxes.forEach(m => {
      vmailLines.push(`${m.username}@${domain}   ${domain}/${m.username}/`)
    })
    fs.writeFileSync(vmailboxPath, vmailLines.join('\n') + '\n', 'utf8')

    // 2. Sync virtual (forwarders)
    const virtualPath = '/etc/postfix/virtual'
    let virtualContent = ''
    if (fs.existsSync(virtualPath)) {
      virtualContent = fs.readFileSync(virtualPath, 'utf8')
    }
    // Filter out existing domain lines
    let virtualLines = virtualContent.split('\n').filter(line => {
      const trim = line.trim()
      if (!trim || trim.startsWith('#')) return true
      return !trim.includes(`@${domain}`)
    })
    // Append current forwarders
    forwarders.forEach(f => {
      virtualLines.push(`${f.source}@${domain}   ${f.target}`)
    })
    fs.writeFileSync(virtualPath, virtualLines.join('\n') + '\n', 'utf8')

    // Ensure virtual_mailbox_domains is configured in main.cf
    try {
      let mainCf = fs.readFileSync('/etc/postfix/main.cf', 'utf8')
      let changed = false
      if (!mainCf.includes('virtual_mailbox_domains')) {
        mainCf += `\nvirtual_mailbox_domains = hash:/etc/postfix/vmail_domains\nvirtual_mailbox_base = /var/mail/vhosts\nvirtual_mailbox_maps = hash:/etc/postfix/vmailbox\nvirtual_minimum_uid = 100\nvirtual_uid_maps = static:5000\nvirtual_gid_maps = static:5000\n`
        changed = true
      }
      if (!mainCf.includes('virtual_alias_maps')) {
        mainCf += `\nvirtual_alias_maps = hash:/etc/postfix/virtual\n`
        changed = true
      }
      if (changed) {
        fs.writeFileSync('/etc/postfix/main.cf', mainCf, 'utf8')
      }
      
      // Ensure vmail_domains list contains the domain
      const domainsPath = '/etc/postfix/vmail_domains'
      let domsContent = fs.existsSync(domainsPath) ? fs.readFileSync(domainsPath, 'utf8') : ''
      if (!domsContent.includes(domain)) {
        domsContent += `${domain} OK\n`
        fs.writeFileSync(domainsPath, domsContent, 'utf8')
      }
    } catch {}

    // Postmap and system reload
    await execAsync('postmap /etc/postfix/vmailbox && postmap /etc/postfix/virtual && postmap /etc/postfix/vmail_domains && systemctl reload postfix').catch(() => {})
  } catch (err) {
    logger.error('Error syncing Postfix mail configs', { error: err.message })
  }
}

// Helper to resolve site details
function resolveSiteRoot(id) {
  const sitesDir = '/etc/nginx/sites-enabled'
  const files = fs.readdirSync(sitesDir).filter(f => !f.startsWith('.'))
  for (const file of files) {
    const parsedId = file.replace(/[^a-z0-9]/gi, '-')
    if (parsedId === id) {
      const fullPath = path.join(sitesDir, file)
      const realPath = fs.realpathSync(fullPath)
      const content = fs.readFileSync(realPath, 'utf8')
      const site = parseNginxConfig(content, file)
      if (!site.root) {
        site.root = `/var/www/${site.domain}`
      }
      if (!fs.existsSync(site.root)) {
        try { fs.mkdirSync(site.root, { recursive: true }) } catch (e) {}
      }
      return site
    }
  }
  if (id.startsWith('www-')) {
    const domain = id.slice(4)
    const root = `/var/www/${domain}`
    if (!fs.existsSync(root)) {
      try { fs.mkdirSync(root, { recursive: true }) } catch (e) {}
    }
    return { id, domain, root }
  }
  return null
}

// ── GET /api/sites/:id/mail ───────────────────────────────────────────────────
router.get('/:id/mail', (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })

  const metaPath = path.join(site.root, '.serverdash.json')
  let mailSettings = { smtp: { host: '', port: '587', username: '', password: '', encryption: 'TLS' }, mailboxes: [], forwarders: [] }

  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      if (meta.mail) mailSettings = { ...mailSettings, ...meta.mail }
    } catch {}
  }

  // Safe mapping - hide passwords
  const safeMailboxes = (mailSettings.mailboxes || []).map(({ password, ...safe }) => safe)
  res.json({ ...mailSettings, mailboxes: safeMailboxes, domain: site.domain })
})

// ── POST /api/sites/:id/mail/smtp ──────────────────────────────────────────────
router.post('/:id/mail/smtp', (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })

  const metaPath = path.join(site.root, '.serverdash.json')
  let meta = {}
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch {}
  }

  if (!meta.mail) meta.mail = { smtp: {}, mailboxes: [], forwarders: [] }
  meta.mail.smtp = req.body

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
  res.json({ success: true, message: 'SMTP configurations saved successfully.' })
})

// ── POST /api/sites/:id/mail/mailbox ───────────────────────────────────────────
router.post('/:id/mail/mailbox', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' })
  }

  const metaPath = path.join(site.root, '.serverdash.json')
  let meta = {}
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch {}
  }

  if (!meta.mail) meta.mail = { smtp: {}, mailboxes: [], forwarders: [] }
  if (!meta.mail.mailboxes) meta.mail.mailboxes = []

  if (meta.mail.mailboxes.some(m => m.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Mailbox account username already exists.' })
  }

  meta.mail.mailboxes.push({ username, password, createdAt: new Date().toISOString() })
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

  await syncPostfixMail(site.domain, meta.mail.mailboxes, meta.mail.forwarders || [])

  res.json({ success: true, message: `Virtual mailbox '${username}@${site.domain}' successfully created.` })
})

// ── DELETE /api/sites/:id/mail/mailbox/:username ────────────────────────────────
router.delete('/:id/mail/mailbox/:username', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })
  const username = req.params.username

  const metaPath = path.join(site.root, '.serverdash.json')
  let meta = {}
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch {}
  }

  if (!meta.mail || !meta.mail.mailboxes) return res.status(400).json({ error: 'No mailboxes found' })

  meta.mail.mailboxes = meta.mail.mailboxes.filter(m => m.username.toLowerCase() !== username.toLowerCase())
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

  await syncPostfixMail(site.domain, meta.mail.mailboxes, meta.mail.forwarders || [])

  res.json({ success: true, message: `Virtual mailbox '${username}' deleted successfully.` })
})

// ── POST /api/sites/:id/mail/forwarder ─────────────────────────────────────────
router.post('/:id/mail/forwarder', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })
  const { source, target } = req.body

  if (!source || !target) {
    return res.status(400).json({ error: 'Source alias and target email are required.' })
  }

  const metaPath = path.join(site.root, '.serverdash.json')
  let meta = {}
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch {}
  }

  if (!meta.mail) meta.mail = { smtp: {}, mailboxes: [], forwarders: [] }
  if (!meta.mail.forwarders) meta.mail.forwarders = []

  if (meta.mail.forwarders.some(f => f.source.toLowerCase() === source.toLowerCase())) {
    return res.status(400).json({ error: 'Forwarder source alias already exists.' })
  }

  meta.mail.forwarders.push({ source, target, createdAt: new Date().toISOString() })
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

  await syncPostfixMail(site.domain, meta.mail.mailboxes || [], meta.mail.forwarders)

  res.json({ success: true, message: `Email forwarder '${source}@${site.domain}' -> '${target}' created.` })
})

// ── DELETE /api/sites/:id/mail/forwarder/:source ────────────────────────────────
router.delete('/:id/mail/forwarder/:source', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })
  const source = req.params.source

  const metaPath = path.join(site.root, '.serverdash.json')
  let meta = {}
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch {}
  }

  if (!meta.mail || !meta.mail.forwarders) return res.status(400).json({ error: 'No forwarders found' })

  meta.mail.forwarders = meta.mail.forwarders.filter(f => f.source.toLowerCase() !== source.toLowerCase())
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

  await syncPostfixMail(site.domain, meta.mail.mailboxes || [], meta.mail.forwarders)

  res.json({ success: true, message: `Email forwarder for '${source}' deleted successfully.` })
})

// ── POST /api/sites/:id/mail/test ──────────────────────────────────────────────
router.post('/:id/mail/test', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })
  const { to } = req.body

  const metaPath = path.join(site.root, '.serverdash.json')
  let smtpConfig = null
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      if (meta.mail && meta.mail.smtp && meta.mail.smtp.host) {
        smtpConfig = meta.mail.smtp
      }
    } catch {}
  }

  if (!smtpConfig) {
    return res.status(400).json({ error: 'SMTP relay is not configured for this website.' })
  }

  try {
    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: parseInt(smtpConfig.port) || 587,
      secure: smtpConfig.encryption === 'SSL',
      auth: { user: smtpConfig.username, pass: smtpConfig.password },
      tls: smtpConfig.encryption === 'TLS' ? { rejectUnauthorized: false } : undefined,
    })

    await transporter.sendMail({
      from: smtpConfig.username || `noreply@${site.domain}`,
      to,
      subject: `ServerDash Test Email for ${site.domain}`,
      text: `This is a test email using the custom isolated SMTP server configuration for ${site.domain}.`,
      html: `<h2>ServerDash Isolated SMTP Test</h2><p>Your website-specific SMTP configurations for <strong>${site.domain}</strong> are working correctly. ✓</p>`,
    })

    res.json({ success: true, message: 'Test email successfully sent using domain SMTP settings!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/sites/:id/backup ─────────────────────────────────────────────────
router.get('/:id/backup', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })

  const domain = site.domain
  const tmpBackupDir = `/tmp/sd-backup-${domain}-${Date.now()}`
  const zipPath = `/tmp/${domain}-full-backup-${Date.now()}.zip`

  try {
    // Ensure tmp dir exists
    fs.mkdirSync(`${tmpBackupDir}/files`, { recursive: true })

    // 1. Copy Nginx virtual host configuration
    const nginxAvailable = `/etc/nginx/sites-available/${domain}`
    if (fs.existsSync(nginxAvailable)) {
      fs.copyFileSync(nginxAvailable, `${tmpBackupDir}/nginx.conf`)
    }

    // 2. Export database if attached and credentials are found
    if (site.database && site.database.name) {
      const sqlFile = `${tmpBackupDir}/db.sql`
      try {
        await execAsync(
          `mysqldump -u "${site.database.user}" -p"${site.database.password}" "${site.database.name}" > "${sqlFile}"`
        )
      } catch (dbErr) {
        logger.error(`Database export failed during backup of ${domain}`, { error: dbErr.message })
      }
    }

    // 3. Copy website files
    if (fs.existsSync(site.root)) {
      await execAsync(`cp -r ${site.root}/* "${tmpBackupDir}/files/"`).catch(() => {})
    }

    // 4. Copy .serverdash.json if present
    const metaFile = path.join(site.root, '.serverdash.json')
    if (fs.existsSync(metaFile)) {
      fs.copyFileSync(metaFile, `${tmpBackupDir}/.serverdash.json`)
    }

    // 5. Zip up the entire backup folder
    await execAsync(`cd "${tmpBackupDir}" && zip -r "${zipPath}" .`)

    // Clean up temporary workspace directory
    await execAsync(`rm -rf "${tmpBackupDir}"`)

    // 6. Serve the zip download
    res.download(zipPath, `${domain}-full-backup.zip`, async (err) => {
      // Cleanup the generated zip file after download finishes
      await execAsync(`rm -f "${zipPath}"`).catch(() => {})
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/sites/restore ───────────────────────────────────────────────────
router.post('/restore', upload.single('backupZip'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No backup zip file provided' })

  const localZip = req.file.path
  const restoreUuid = require('crypto').randomUUID()
  const extractDir = `/tmp/sd-restore-${restoreUuid}`

  try {
    fs.mkdirSync(extractDir, { recursive: true })

    // 1. Unzip the archive
    await execAsync(`unzip -o "${localZip}" -d "${extractDir}"`)

    // 2. Load and validate domain
    let domain = null
    const metaPath = `${extractDir}/.serverdash.json`
    const nginxPath = `${extractDir}/nginx.conf`

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        domain = meta.domain
      } catch {}
    }

    if (!domain && fs.existsSync(nginxPath)) {
      // Deduce domain from Nginx server_name
      const conf = fs.readFileSync(nginxPath, 'utf8')
      domain = (conf.match(/server_name\s+([^;]+);/) || [])[1]?.trim().split(/\s+/)[0]
    }

    if (!domain) {
      domain = `restored-site-${Date.now()}.com`
    }

    // 3. Restore Nginx Configuration
    if (fs.existsSync(nginxPath)) {
      fs.copyFileSync(nginxPath, `/etc/nginx/sites-available/${domain}`)
      await execAsync(`ln -sf "/etc/nginx/sites-available/${domain}" "/etc/nginx/sites-enabled/${domain}"`)
    }

    // Determine destination root folder
    const targetRoot = `/var/www/${domain}`
    fs.mkdirSync(targetRoot, { recursive: true })

    // 4. Copy website files
    const sourceFiles = `${extractDir}/files`
    if (fs.existsSync(sourceFiles)) {
      await execAsync(`cp -rf sourceFiles=${sourceFiles}/* "${targetRoot}/"`).catch(async () => {
        // Fallback robust copy
        await execAsync(`cp -rf "${sourceFiles}"/. "${targetRoot}/"`)
      })
    }

    // Copy .serverdash.json back
    if (fs.existsSync(metaPath)) {
      fs.copyFileSync(metaPath, `${targetRoot}/.serverdash.json`)
    }

    // 5. Restore SQL Database if exists
    const sqlPath = `${extractDir}/db.sql`
    if (fs.existsSync(sqlPath)) {
      // Find credentials from site's .serverdash.json or database connection files
      const dbCreds = getDatabaseCredentials(targetRoot)
      if (dbCreds && dbCreds.name) {
        // Create database if not exists
        await execAsync(`mysql -u root -e "CREATE DATABASE IF NOT EXISTS \`${dbCreds.name}\`;"`).catch(() => {})
        // Import SQL
        await execAsync(`mysql -u "${dbCreds.user}" -p"${dbCreds.password}" "${dbCreds.name}" < "${sqlPath}"`).catch(() => {})
      }
    }

    // 6. Test Nginx and reload
    try {
      await execAsync('nginx -t')
      await execAsync('systemctl reload nginx')
    } catch {}

    // Cleanup restore workspaces
    await execAsync(`rm -rf "${extractDir}"`)
    await execAsync(`rm -f "${localZip}"`)

    res.json({ success: true, message: `Website '${domain}' successfully restored from full backup zip!` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
