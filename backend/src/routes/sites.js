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

// GitHub integration: auto-inject stored token for GitHub URLs
// getStoredGithubToken returns null if GitHub is not connected or URL is not GitHub
let getStoredGithubToken = () => null
try {
  const githubModule = require('./github')
  if (githubModule.getStoredGithubToken) getStoredGithubToken = githubModule.getStoredGithubToken
} catch {}

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

/**
 * Shared SPA detection: returns true if the project should be served as static
 * files (built with Vite/CRA/Next export) rather than run as a live Node server.
 *
 * Rules:
 *  1. If nodeSubtype is explicitly 'spa' → always SPA
 *  2. If nodeSubtype is explicitly 'server' → never SPA (user knows best)
 *  3. Otherwise auto-detect from package.json:
 *     - Has Vite/CRA/Next in deps AND
 *     - (no start script OR start script itself runs vite/react-scripts) AND
 *     - No custom nodeStartCommand was provided by the user
 */
function detectIsSpa(pkgJson, nodeStartCommand, nodeSubtype) {
  if (nodeSubtype === 'spa') return true
  if (nodeSubtype === 'server') return false
  try {
    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies }
    const hasVite = !!deps.vite || !!(pkgJson.scripts?.dev || '').includes('vite')
    const hasCra  = !!deps['react-scripts'] || !!(pkgJson.scripts?.start || '').includes('react-scripts')
    const hasNextStatic = !!deps.next && !((pkgJson.scripts?.start || '').includes('next start'))
    const hasNoStart = !pkgJson.scripts?.start
    const startIsFrontend = pkgJson.scripts?.start &&
      (pkgJson.scripts.start.includes('vite') || pkgJson.scripts.start.includes('react-scripts'))
    const noUserStartCmd = !(nodeStartCommand && nodeStartCommand.trim())
    return (hasVite || hasCra || hasNextStatic) && (hasNoStart || startIsFrontend) && noUserStartCmd
  } catch {
    return false
  }
}

/**
 * After starting a PM2 process, wait briefly then verify it is actually online.
 * Returns { ok, status } where status is the pm2 status string.
 */
async function checkPm2Health(domain) {
  try {
    await new Promise(r => setTimeout(r, 2500))
    const { stdout } = await execAsync(`pm2 jlist 2>/dev/null || echo '[]'`)
    const list = JSON.parse(stdout.trim() || '[]')
    const proc = list.find(p => p.name === domain)
    if (!proc) return { ok: false, status: 'not found' }
    return { ok: proc.pm2_env?.status === 'online', status: proc.pm2_env?.status || 'unknown' }
  } catch {
    return { ok: false, status: 'check failed' }
  }
}

/**
 * Resolve the best certbot contact email.
 * Prefers an existing renewal conf email, then falls back to the
 * server hostname-based email (never uses admin@{targetDomain} to
 * avoid failures on domains with no MX record).
 */
function getCertbotEmail(domain) {
  try {
    const renewalConf = `/etc/letsencrypt/renewal/${domain}.conf`
    if (fs.existsSync(renewalConf)) {
      const m = fs.readFileSync(renewalConf, 'utf8').match(/^email\s*=\s*(.+)/m)
      if (m) return m[1].trim()
    }
  } catch {}
  try {
    const { execSync } = require('child_process')
    const hostname = execSync('hostname -f 2>/dev/null || hostname', { timeout: 3000 }).toString().trim()
    return `ssl@${hostname}`
  } catch {}
  return 'ssl@localhost'
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
    `apt-get update 2>&1 && DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" php${version}-fpm php${version}-mysql php${version}-curl php${version}-gd php${version}-xml php${version}-mbstring php${version}-zip unzip curl mariadb-client 2>&1`,
    send,
    'PHP install',
    { timeout: 300000, tail: 18 }
  )
  if (!install.ok) {
    await tryExec(`DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" php-fpm php-mysql php-curl php-gd php-xml php-mbstring php-zip unzip curl mariadb-client 2>&1`, send, 'fallback PHP install', { timeout: 300000, tail: 18 })
  }
}

async function ensureDatabaseService(send) {
  const ping = await tryExec('mysqladmin ping 2>&1', null, 'database ping', { timeout: 10000 })
  if (ping.ok && ping.output.includes('alive')) {
    send('✓ MariaDB/MySQL is running')
    return true
  }

  send('▶ Installing/starting MariaDB for WordPress...')
  await tryExec('apt-get update 2>&1 && DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" mariadb-server mariadb-client php-mysql 2>&1', send, 'MariaDB install', { timeout: 300000, tail: 18 })
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
    const { stdout } = await execAsync('export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm ls-remote --lts 2>/dev/null | tail -20 || node -v 2>/dev/null', { timeout: 10000 })
    const versions = stdout.split('\n').filter(Boolean)
      .map(l => l.trim().replace(/[^v0-9.]/g, ''))
      .filter(v => /^v\d+/.test(v))
      .reverse()
      .slice(0, 12)
    const current = await execAsync('node -v 2>/dev/null').then(r => r.stdout.trim()).catch(() => '')
    res.json({ versions: versions.length ? versions : ['v22.x (lts)', 'v20.x (lts)', 'v18.x (lts)', 'v16.x'], current })
  } catch {
    res.json({ versions: ['v22.x (LTS)', 'v20.x (LTS)', 'v18.x (LTS)', 'v16.x'], current: '' })
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

  // Detect type
  let type = 'static'
  if (proxyPass) {
    const isSupabase = proxyPort === '8000' || 
                      proxyPass.includes('kong') || proxyPass.includes('studio') || 
                      filename.includes('supabase') || serverName.some(n => n.includes('supabase'))
    if (isSupabase) {
      type = 'supabase'
    } else {
      type = 'node' // default reverse proxy is Node/App
    }
  } else if (content.includes('fastcgi_pass') || content.includes('php') || (root && fs.existsSync(path.join(root, 'wp-config.php')))) {
    type = 'php' // PHP/WordPress
  }

  let primaryDomain = serverName[0] || filename
  const isSystemPanel = filename === 'serverdash' || primaryDomain === '_' || root === '/var/www/serverdash/dist'
  if (primaryDomain === '_') {
    primaryDomain = 'ServerDash Dashboard (Default/Catch-all)'
  }

  return {
    id: filename.replace(/[^a-z0-9]/gi, '-'),
    domain: primaryDomain,
    aliases: serverName.slice(1),
    type,
    status: 'active',
    ssl: sslCert,
    port: listen443 ? 443 : listen80 ? 80 : null,
    proxyPort,
    root: root || `/var/www/${primaryDomain}`,
    configFile: `/etc/nginx/sites-enabled/${filename}`,
    gitRepo: null,
    lastDeployed: null,
    isSystemPanel
  }
}

async function enrichSitesWithDiagnostics(sites) {
  const listeningPorts = new Set()
  try {
    const { stdout } = await execAsync("ss -tln -H | awk '{print $4}' | sed 's/.*://'")
    stdout.split('\n').filter(Boolean).forEach(p => {
      const portNum = parseInt(p.trim(), 10)
      if (!isNaN(portNum)) listeningPorts.add(portNum)
    })
  } catch (e) {
    logger.warn('Failed to get listening ports', { error: e.message })
  }

  let pm2List = []
  try {
    const { stdout } = await execAsync("pm2 jlist 2>/dev/null || echo '[]'")
    pm2List = JSON.parse(stdout.trim() || '[]')
  } catch (e) {
    logger.warn('Failed to get PM2 process list', { error: e.message })
  }

  for (const site of sites) {
    const pm2Proc = pm2List.find(p => p.name === site.domain || p.name === site.id)
    if (pm2Proc) {
      site.pm2 = {
        status: pm2Proc.pm2_env?.status,
        restarts: pm2Proc.pm2_env?.restart_time || 0,
        memory: pm2Proc.monit?.memory || 0,
        cpu: pm2Proc.monit?.cpu || 0,
        pid: pm2Proc.pid
      }

      if (pm2Proc.pm2_env?.status && pm2Proc.pm2_env?.status !== 'online') {
        site.warning = `PM2 process is "${pm2Proc.pm2_env.status}". It might be crashed or stopped. Check its logs.`
      }
    }

    if (site.proxyPort) {
      const portNum = parseInt(site.proxyPort, 10)
      if (!isNaN(portNum)) {
        if (!listeningPorts.has(portNum)) {
          site.warning = `Port Warning: Nginx is configured to proxy to port ${site.proxyPort}, but no service or process is currently listening on this port. Your site will show a 502 Bad Gateway until you start your app on port ${site.proxyPort}.`
        }
      }
    }
  }
  return sites
}

async function getPm2Process(domain, id) {
  try {
    const { stdout } = await execAsync("pm2 jlist 2>/dev/null || echo '[]'")
    const list = JSON.parse(stdout.trim() || '[]')
    return list.find(p => p.name === domain || (id && p.name === id))
  } catch {
    return null
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

    const enrichedSites = await enrichSitesWithDiagnostics(sites)
    res.json(enrichedSites)
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
      const wpUserMatch = content.match(/Admin user:\s*([^\n]+)/)
      const wpPassMatch = content.match(/Admin password:\s*([^\n]+)/)
      if (dbNameMatch || dbUserMatch || dbPassMatch) {
        return {
          dbName: dbNameMatch ? dbNameMatch[1].trim() : '',
          dbUser: dbUserMatch ? dbUserMatch[1].trim() : '',
          dbPass: dbPassMatch ? dbPassMatch[1].trim() : '',
          wpUser: wpUserMatch ? wpUserMatch[1].trim() : '',
          wpPass: wpPassMatch ? wpPassMatch[1].trim() : '',
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
        const [enrichedSite] = await enrichSitesWithDiagnostics([site])
        return res.json(enrichedSite)
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
      const [enrichedSite] = await enrichSitesWithDiagnostics([site])
      return res.json(enrichedSite)
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
    if (site.isSystemPanel) {
      return res.status(403).json({ error: 'Catastrophic Lockout Blocked: Modifying the active ServerDash dashboard host proxy is read-only.' })
    }
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

// ── POST /api/sites/:id/install-wordpress (SSE) ─────────────────────────────────
router.post('/:id/install-wordpress', async (req, res) => {
  const send = sseSetup(res)
  const { id } = req.params
  const { wpTitle, wpAdminUser, wpAdminPass, wpAdminEmail, phpVersion = '8.5' } = req.body || req.query || {}

  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) { send('✗ Site not found'); return res.end() }

    send(`▶ Initializing WordPress installation for ${site.domain}…`)
    const root = site.root || `/var/www/${site.domain}`
    fs.mkdirSync(root, { recursive: true })

    await prepareWordPress({
      sitePath: root,
      domain: site.domain,
      phpVersion,
      wpTitle,
      wpAdminUser,
      wpAdminPass,
      wpAdminEmail,
      send,
    })

    send('✓ WordPress successfully installed!')
  } catch (err) {
    send(`✗ Error: ${err.message}`)
  }
  res.end()
})

// ── POST /api/sites/:id/upload-zip ──────────────────────────────────────────────
router.post('/:id/upload-zip', upload.single('zip'), async (req, res) => {
  const { id } = req.params
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })
    if (!req.file) return res.status(400).json({ error: 'No ZIP file uploaded' })

    const root = site.root || `/var/www/${site.domain}`
    fs.mkdirSync(root, { recursive: true })

    logger.info('Extracting uploaded ZIP to site root', { root, originalname: req.file.originalname })
    await execAsync(`unzip -o "${req.file.path}" -d "${root}" 2>&1`)
    fs.unlinkSync(req.file.path)

    res.json({ success: true, message: 'ZIP file successfully uploaded and extracted!' })
  } catch (err) {
    logger.error('Upload ZIP error', { id, error: err.message })
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
    listen [::]:80;
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
    listen [::]:80;
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
      // Auto-inject stored GitHub token if available for this repo
      try {
        const { stdout: remoteUrl } = await execAsync(`cd "${root}" && git remote get-url origin 2>/dev/null || true`)
        const gitRemote = remoteUrl.trim()
        const storedToken = getStoredGithubToken(gitRemote)
        if (storedToken && gitRemote && gitRemote.includes('github.com')) {
          const u = new URL(gitRemote.replace(/^git@github\.com:/, 'https://github.com/').replace(/:(\w)/, '/$1'))
          u.username = 'oauth2'; u.password = storedToken
          await execAsync(`cd "${root}" && git remote set-url origin ${shellQuote(u.toString())} 2>&1`)
        }
      } catch {}

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

    let pkgJson = {}
    try {
      pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    } catch {}

    let installCmd = 'npm install --production'
    if (pkgJson.scripts?.['install:all']) {
      installCmd = 'npm run install:all'
    } else if (pkgJson.workspaces) {
      installCmd = 'npm install'
    }

    let buildCmd = pkgJson.scripts?.build ? 'npm run build' : ''
    let restartCmd = `pm2 restart "${site.domain}"`
    let nodeVersion = 'system'
    let customStartCmd = null

    const metaPath = path.join(root, '.serverdash.json')
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        if (meta.installCommand !== undefined) installCmd = meta.installCommand
        if (meta.buildCommand !== undefined) buildCmd = meta.buildCommand
        if (meta.restartCommand !== undefined) restartCmd = meta.restartCommand
        if (meta.nodeVersion !== undefined) nodeVersion = meta.nodeVersion
        if (meta.startCommand !== undefined) customStartCmd = meta.startCommand
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
          send(`✗ Build failed: ${e.message}`)
          throw new Error('Build step failed.')
        }
      }
    }

    const pm2Proc = await getPm2Process(site.domain, site.id)
    if (pm2Proc) {
      if (restartCmd === `pm2 restart "${site.domain}"`) {
        restartCmd = `pm2 restart "${pm2Proc.name}"`
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
    } else {
      try {
        send(`⚠ PM2 process "${site.domain}" not found. Running self-healing startup…`)
        
        let resolvedStartCmd = customStartCmd
        if (!resolvedStartCmd) {
          resolvedStartCmd = pkgJson.scripts?.start
            ? 'npm start'
            : fs.existsSync(path.join(root, 'server.js')) ? 'node server.js'
            : fs.existsSync(path.join(root, 'app.js'))    ? 'node app.js'
            : fs.existsSync(path.join(root, 'index.js'))  ? 'node index.js'
            : null
        }

        if (resolvedStartCmd) {
          const appPort = site.proxyPort || 3000
          const pm2Command = `cd ${shellQuote(root)} && PORT=${parseInt(appPort) || 3000} ${prefix}${resolvedStartCmd}`
          send(`▶ PM2 start: ${resolvedStartCmd} (port ${appPort})`)
          await execAsync(
            `pm2 start bash --name ${shellQuote(site.domain)} -- -lc ${shellQuote(pm2Command)} 2>&1`
          )
          await execAsync('pm2 save 2>/dev/null || true')
          send('✓ Application successfully healed and started!')
        } else {
          send('⚠ Could not determine start command. Please set it in "Build & Start Settings" and start it manually.')
        }
      } catch (e) {
        send(`✗ Self-healing PM2 startup failed: ${e.message}`)
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

// ── POST /api/sites/:id/webhook — GitHub/GitLab Auto CI/CD Webhook ────────────
router.post('/:id/webhook', async (req, res) => {
  const { id } = req.params

  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })

    const root = site.root || `/var/www/${site.domain}`

    // Return 202 Accepted immediately so GitHub doesn't timeout
    res.status(202).json({ message: 'Webhook received. Deployment triggered.' })

    // Proceed with deployment asynchronously
    ;(async () => {
      try {
        logger.info(`Webhook triggered deployment for ${site.domain}`)

        if (fs.existsSync(path.join(root, '.git'))) {
          logger.info(`[${site.domain}] git pull...`)
          await execAsync(`cd "${root}" && git pull 2>&1`)
        } else {
          logger.warn(`[${site.domain}] Webhook received but no .git directory found.`)
          return
        }

        let pkgJson = {}
        try {
          pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
        } catch {}

        let installCmd = 'npm install --production'
        if (pkgJson.scripts?.['install:all']) {
          installCmd = 'npm run install:all'
        } else if (pkgJson.workspaces) {
          installCmd = 'npm install'
        }

        let buildCmd = pkgJson.scripts?.build ? 'npm run build' : ''
        let restartCmd = `pm2 restart "${site.domain}"`
        let nodeVersion = 'system'
        let customStartCmd = null

        const metaPath = path.join(root, '.serverdash.json')
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
            if (meta.installCommand !== undefined) installCmd = meta.installCommand
            if (meta.buildCommand !== undefined) buildCmd = meta.buildCommand
            if (meta.restartCommand !== undefined) restartCmd = meta.restartCommand
            if (meta.nodeVersion !== undefined) nodeVersion = meta.nodeVersion
            if (meta.startCommand !== undefined) customStartCmd = meta.startCommand
          } catch (e) {}
        }

        const prefix = nodeShellPrefix(nodeVersion)

        if (fs.existsSync(path.join(root, 'package.json'))) {
          if (installCmd && installCmd.trim()) {
            logger.info(`[${site.domain}] ${installCmd}...`)
            await execAsync(`cd "${root}" && ${prefix}${installCmd} 2>&1`)
          }
          if (buildCmd && buildCmd.trim()) {
            logger.info(`[${site.domain}] ${buildCmd}...`)
            await execAsync(`cd "${root}" && ${prefix}${buildCmd} 2>&1`)
          }
        }

        const pm2Proc = await getPm2Process(site.domain, site.id)
        if (pm2Proc) {
          if (restartCmd === `pm2 restart "${site.domain}"`) {
            restartCmd = `pm2 restart "${pm2Proc.name}"`
          }
          if (restartCmd && restartCmd.trim()) {
            logger.info(`[${site.domain}] ${restartCmd}...`)
            await execAsync(`cd "${root}" && ${prefix}${restartCmd} 2>&1`)
          }
        } else {
          logger.info(`[${site.domain}] PM2 process not found. Running self-healing startup...`)
          let resolvedStartCmd = customStartCmd
          if (!resolvedStartCmd) {
            resolvedStartCmd = pkgJson.scripts?.start
              ? 'npm start'
              : fs.existsSync(path.join(root, 'server.js')) ? 'node server.js'
              : fs.existsSync(path.join(root, 'app.js'))    ? 'node app.js'
              : fs.existsSync(path.join(root, 'index.js'))  ? 'node index.js'
              : null
          }

          if (resolvedStartCmd) {
            const appPort = site.proxyPort || 3000
            const pm2Command = `cd ${shellQuote(root)} && PORT=${parseInt(appPort) || 3000} ${prefix}${resolvedStartCmd}`
            await execAsync(
              `pm2 start bash --name ${shellQuote(site.domain)} -- -lc ${shellQuote(pm2Command)} 2>&1`
            )
            await execAsync('pm2 save 2>/dev/null || true')
            logger.info(`[${site.domain}] Application successfully healed and started via webhook`)
          } else {
            logger.warn(`[${site.domain}] Could not determine start command for self-healing during webhook deploy`)
          }
        }

        logger.info(`[${site.domain}] Deployment completed successfully via webhook`)
      } catch (err) {
        logger.error(`[${site.domain}] Webhook deployment failed: ${err.message}`)
      }
    })()

  } catch (err) {
    // Only catch synchronous setup errors
    logger.error(`Webhook error: ${err.message}`)
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
  }
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
    let pkgJson = {}
    try {
      pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    } catch {}
    let installCmd = 'npm install --production'
    if (pkgJson.scripts?.['install:all']) {
      installCmd = 'npm run install:all'
    } else if (pkgJson.workspaces) {
      installCmd = 'npm install'
    }
    let settings = {
      installCommand: installCmd,
      buildCommand: pkgJson.scripts?.build ? 'npm run build' : '',
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
    const pm2Proc = await getPm2Process(site.domain, site.id)
    const targetName = pm2Proc ? pm2Proc.name : site.domain
    await execAsync(`pm2 restart ${shellQuote(targetName)} 2>&1 || true`)
    await execAsync('systemctl reload nginx')
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Helper: resolve the best certbot account for a domain ─────────────────────
const getCertbotAccount = (domain) => {
  // Check if a renewal config exists and has an account field
  try {
    const renewalConf = `/etc/letsencrypt/renewal/${domain}.conf`
    if (fs.existsSync(renewalConf)) {
      const content = fs.readFileSync(renewalConf, 'utf8')
      const m = content.match(/^account\s*=\s*([a-f0-9]+)/m)
      if (m) return m[1]
    }
  } catch {}
  // Fall back: pick the first production account found
  try {
    const accountsDir = '/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory'
    if (fs.existsSync(accountsDir)) {
      const accounts = fs.readdirSync(accountsDir).filter(a => a.length === 32)
      if (accounts.length === 1) return accounts[0]
      if (accounts.length > 1) return accounts[0] // return first; renewal conf is preferred
    }
  } catch {}
  return null
}

// ── POST /api/sites/:id/ssl ───────────────────────────────────────────────────
router.post('/:id/ssl', async (req, res) => {
  const { id } = req.params
  try {
    const sites = await getNginxSites()
    const site = sites.find(s => s.id === id)
    if (!site) return res.status(404).json({ error: 'Site not found' })

    const domain = site.domain
    logger.info('Starting SSL configuration', { domain })

    let output = ''

    // Check if cert already exists — if so, use renew instead of re-issuing
    const renewalConf = `/etc/letsencrypt/renewal/${domain}.conf`
    const certExists = fs.existsSync(renewalConf) &&
      fs.existsSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`)

    if (certExists) {
      // Re-install existing cert into nginx (handles the multiple-account ambiguity)
      logger.info('Cert already exists, re-installing into nginx', { domain })
      const { stdout } = await execAsync(
        `certbot install --nginx --cert-name ${domain} --non-interactive 2>&1`,
        { timeout: 60000 }
      ).catch(async () => {
        // Fallback: just ensure nginx config has SSL lines and reload
        return await execAsync(`certbot renew --cert-name ${domain} --force-renewal --non-interactive 2>&1`, { timeout: 120000 })
      })
      output = stdout || 'Certificate re-installed into Nginx'
    } else {
      // New cert — auto-detect account to avoid "choose an account" prompt
      const account = getCertbotAccount(domain)
      const accountFlag = account ? ` --account ${account}` : ''
      const certEmail = getCertbotEmail(domain)
      const { stdout } = await execAsync(
        `certbot --nginx -d ${domain} --non-interactive --agree-tos -m ${certEmail}${accountFlag} 2>&1`,
        { timeout: 120000 }
      )
      output = stdout || 'SSL certificate installed'
    }

    await execAsync('systemctl reload nginx')
    logger.info('SSL configuration completed', { domain })
    res.json({ success: true, output })
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
    let site = sites.find(s => s.id === id)

    if (id === 'serverdash' || site?.isSystemPanel || site?.domain?.includes('ServerDash') || site?.configFile?.includes('serverdash')) {
      return res.status(403).json({ error: 'Catastrophic Lockout Blocked: Deleting the ServerDash panel configuration is strictly forbidden.' })
    }

    // Fallback for no-nginx sites or sites that have already had their nginx config deleted
    if (!site) {
      const domain = id.startsWith('www-') ? id.slice(4) : id
      const possibleRoot = `/var/www/${domain}`
      if (fs.existsSync(possibleRoot)) {
        site = {
          id,
          domain,
          root: possibleRoot,
          configFile: null
        }
      }
    }

    if (!site) return res.status(404).json({ error: 'Site not found' })

    // Stop and delete PM2 process if exists to prevent process and port leaks
    try {
      const pm2Proc = await getPm2Process(site.domain, site.id)
      if (pm2Proc) {
        logger.info('Deleting PM2 process during site deletion', { name: pm2Proc.name })
        await execAsync(`pm2 delete ${shellQuote(pm2Proc.name)} 2>/dev/null || true`)
        await execAsync('pm2 save 2>/dev/null || true')
      }
    } catch (pm2Err) {
      logger.warn('Failed to delete PM2 process during site deletion', { error: pm2Err.message })
    }

    // Purge Nginx configuration files
    const configFiles = [
      site.configFile,
      `/etc/nginx/sites-enabled/${site.domain}`,
      `/etc/nginx/sites-available/${site.domain}`,
      `/etc/nginx/sites-enabled/${id}`,
      `/etc/nginx/sites-available/${id}`,
    ].filter(Boolean)

    for (const file of configFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file)
        }
        // Fallback realpath check
        try {
          const real = fs.realpathSync(file)
          if (fs.existsSync(real)) {
            fs.unlinkSync(real)
          }
        } catch {}
      } catch (e) {
        logger.warn('Failed to delete nginx config file', { file, error: e.message })
      }
    }
    
    if (deleteFiles) {
      const root = site.root || `/var/www/${site.domain || id}`
      
      // Clean up database if it's a WordPress site
      try {
        const credentials = getDatabaseCredentials(root)
        if (credentials && credentials.dbName) {
          logger.info('Cleaning up database for site during deletion', { domain: site.domain, dbName: credentials.dbName })
          const sqlQueries = [
            `DROP DATABASE IF EXISTS \`${credentials.dbName}\`;`,
          ]
          if (credentials.dbUser) {
            sqlQueries.push(`DROP USER IF EXISTS '${credentials.dbUser}'@'localhost';`)
          }
          const sql = sqlQueries.join(' ')
          const sqlFile = `/tmp/serverdash-wp-drop-${Date.now()}.sql`
          fs.writeFileSync(sqlFile, sql, 'utf8')
          await execAsync(`mysql -uroot < ${shellQuote(sqlFile)}`, { timeout: 30000 })
          try { fs.unlinkSync(sqlFile) } catch {}
        }
      } catch (dbErr) {
        logger.warn('Failed to drop database during site deletion', { error: dbErr.message })
      }

      if (root.startsWith('/var/www/')) {
        // Kill any processes having open files inside the root directory to prevent "Directory not empty" lock
        try {
          const { stdout: pids } = await execAsync(`lsof -t +D "${root}" || true`)
          const pidList = pids.split('\n').map(p => p.trim()).filter(Boolean)
          if (pidList.length > 0) {
            logger.info('Killing locked processes inside root', { root, pidList })
            await execAsync(`kill -9 ${pidList.join(' ')} || true`)
            // Small pause to let processes close descriptors
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        } catch (e) {
          logger.warn('Failed to kill processes using directory', { error: e.message })
        }

        await execAsync(`rm -rf "${root}"`)
        logger.info('Deleted site files', { root })
      }
    }

    try {
      await execAsync('nginx -t && systemctl reload nginx')
    } catch (e) {
      logger.warn('Nginx reload skipped or failed after deletion', { error: e.message })
    }
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
    nodeStartCommand='',       // empty = user didn't explicitly provide one
    nodeSubtype='',            // 'server' | 'spa' | '' (auto-detect)
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
      // Use explicitly provided credentials first, then fall back to stored GitHub token
      const effectiveToken = gitToken || getStoredGithubToken(gitRepo)
      const effectiveUser = gitUser || (effectiveToken && !gitToken ? 'oauth2' : '')
      if (effectiveUser && effectiveToken) {
        const u = new URL(gitRepo)
        u.username = effectiveUser; u.password = effectiveToken
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

    // Load package.json if it exists
    let pkgJson = {}
    const pkgPath = path.join(sitePath, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      } catch {}
    }

    // --- Node.js: install → build → PM2 start ────────────────────────────────
    // User explicitly selected "Node.js" in the wizard, so we ALWAYS run this
    // as a server app with PM2. No SPA auto-detection — use "Static/SPA" type for that.
    if (type === 'node') {
      const prefix = nodeShellPrefix(nodeVersion)

      // ── Step 1: Install dependencies ────────────────────────────────────────
      if (nodeInstallCommand && nodeInstallCommand.trim() && fs.existsSync(pkgPath)) {
        send(`▶ ${nodeInstallCommand}…`)
        const installResult = await tryExec(
          `cd ${shellQuote(sitePath)} && ${prefix}${nodeInstallCommand} 2>&1`,
          send, 'npm install', { timeout: 240000, tail: 10 }
        )
        if (!installResult.ok) send('⚠ Install had warnings — continuing anyway')
      }

      // ── Step 2: Build (optional) ─────────────────────────────────────────────
      const hasBuildScript = pkgJson.scripts?.build
      const shouldRunBuild = nodeBuildCommand && nodeBuildCommand.trim() && (nodeBuildCommand !== 'npm run build' || hasBuildScript)
      if (shouldRunBuild) {
        send(`▶ ${nodeBuildCommand}…`)
        await tryExec(
          `cd ${shellQuote(sitePath)} && ${prefix}${nodeBuildCommand} 2>&1`,
          send, 'build', { timeout: 300000, tail: 14 }
        )
        send('✓ Build complete')
      }

      // ── Step 3: Start with PM2 ───────────────────────────────────────────────
      // Resolve start command: explicit user value → package.json start → file scan
      const resolvedStartCmd = (nodeStartCommand && nodeStartCommand.trim())
        ? nodeStartCommand.trim()
        : pkgJson.scripts?.start
          ? 'npm start'
          : fs.existsSync(path.join(sitePath, 'server.js')) ? 'node server.js'
          : fs.existsSync(path.join(sitePath, 'app.js'))    ? 'node app.js'
          : fs.existsSync(path.join(sitePath, 'index.js'))  ? 'node index.js'
          : null

      if (!resolvedStartCmd) {
        send('⚠ No start command found. Provide one in "Build & Start Settings" or add a "start" script to package.json.')
        send('  Nginx proxy config will be written — start the app manually with PM2 once ready.')
        send(`  Example: pm2 start app.js --name "${domain}"`)
      } else {
        try {
          await execAsync(`pm2 delete ${shellQuote(domain)} 2>/dev/null || true`)
          const pm2Command = `cd ${shellQuote(sitePath)} && PORT=${parseInt(port) || 3000} ${prefix}${resolvedStartCmd}`
          send(`▶ Starting PM2: ${resolvedStartCmd} (port ${port})`)
          await execAsync(
            `pm2 start bash --name ${shellQuote(domain)} -- -lc ${shellQuote(pm2Command)} 2>&1`,
            { timeout: 60000 }
          )
          await execAsync('pm2 save 2>/dev/null || true')

          // ── Health check — give the process 2.5s to crash or stabilize ──────
          const health = await checkPm2Health(domain)
          if (health.ok) {
            send(`✓ PM2 is online: ${domain} → port ${port}`)
          } else {
            send(`⚠ PM2 status: "${health.status}" — app may have crashed at startup.`)
            send(`  Run: pm2 logs ${domain} --lines 50`)
            send(`  Common causes: wrong start command, missing .env, port conflict.`)
          }
        } catch (e) {
          send(`⚠ PM2 error: ${e.message.split('\n').slice(0, 3).join(' | ')}`)
          send(`  Nginx proxy config will still be written. Fix the issue and redeploy or start PM2 manually.`)
        }
      }
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
        let pkgJson = {}
        try {
          pkgJson = JSON.parse(fs.readFileSync(path.join(sitePath, 'package.json'), 'utf8'))
        } catch {}
        send('npm install…')
        await execAsync(`cd ${shellQuote(sitePath)} && npm install 2>&1`, { timeout: 180000, maxBuffer: 1024 * 1024 * 10 })
        if (pkgJson.scripts?.build) {
          send('npm run build…')
          await execAsync(`cd ${shellQuote(sitePath)} && npm run build 2>&1`, { timeout: 180000, maxBuffer: 1024 * 1024 * 10 })
          send('✓ Static build complete')
        } else {
          send('No build script detected in package.json, skipping build step')
        }
      } catch (e) {
        send(`⚠ Static build skipped/failed: ${e.message}`)
      }
    }

    // --- Nginx config ────────────────────────────────────────────────────────
    const isSpaForNginx = type === 'static' && detectIsSpa(pkgJson, nodeStartCommand, nodeSubtype)
    const phpRoot = phpPreset === 'laravel' && fs.existsSync(path.join(sitePath, 'public')) ? `${sitePath}/public` : sitePath
    const requestedNodeOutput = nodeOutputDir ? path.join(sitePath, nodeOutputDir) : ''

    // Detect SPA build output directory (dist > build > out > public > root)
    const detectBuildDir = (base) => {
      for (const d of ['dist', 'build', 'out', '.next/static']) {
        if (fs.existsSync(path.join(base, d))) return `${base}/${d}`
      }
      return base
    }

    // webRoot is only used for static/php file serving — node/python/proxy always use proxy_pass
    const webRoot = type === 'static'
      ? detectBuildDir(sitePath)
      : type === 'php'
        ? phpRoot
        : requestedNodeOutput && fs.existsSync(requestedNodeOutput)
          ? requestedNodeOutput
          : sitePath

    let nginxConf
    if (type === 'proxy' || type === 'node' || type === 'python' || type === 'flask') {
      nginxConf = `server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    client_max_body_size 512M;
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}`
    } else {
      // Static / SPA / PHP — file serving
      const spaNote = isSpaForNginx ? `# SPA (Vite/React) — served as static files from ${webRoot}\n    ` : ''
      nginxConf = `server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    client_max_body_size 512M;
    ${spaNote}root ${webRoot};
    index index.html${type==='php'?' index.php':''};
    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;
    ${staticCacheBlock()}
    location / { try_files $uri $uri/ ${type==='php' ? '/index.php?$query_string' : '/index.html'}; }
    ${type==='php'?phpLocationBlock(phpVersion):''}
}`
      if (isSpaForNginx) {
        send(`✓ SPA detected — serving static files from ${webRoot} (no PM2 needed)`)
      }
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
      send('▶ Requesting SSL certificate from Let\'s Encrypt (certbot)...')
      try {
        const certbotAccount = getCertbotAccount(domain)
        const accountFlag = certbotAccount ? ` --account ${certbotAccount}` : ''
        const certEmail = getCertbotEmail(domain)
        send(`  Using contact email: ${certEmail}`)
        const { stdout: certOut } = await execAsync(
          `certbot --nginx -d ${domain} --non-interactive --agree-tos -m ${certEmail}${accountFlag} 2>&1`,
          { timeout: 120000 }
        )
        certOut.split('\n').filter(Boolean).forEach(l => send(l))
        send('✓ SSL certificate installed')
      } catch (e) {
        const errLines = e.message.split('\n').filter(Boolean)
        errLines.slice(0, 5).forEach(l => send(`⚠ SSL: ${l}`))
        send('  ⚠ SSL failed. Ensure your domain DNS points to this server\'s IP and Cloudflare proxy is paused.')
      }
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
    const fs = require('fs')
    const virtualPath = '/etc/postfix/virtual'
    const mainCfPath = '/etc/postfix/main.cf'

    // 1. Read current virtual alias mappings
    let virtualLines = []
    if (fs.existsSync(virtualPath)) {
      const virtualContent = fs.readFileSync(virtualPath, 'utf8')
      // Filter out existing lines for this domain
      virtualLines = virtualContent.split('\n').filter(line => {
        const trim = line.trim()
        if (!trim || trim.startsWith('#')) return true
        return !trim.includes(`@${domain}`)
      })
    }

    // 2. Append current mailboxes mapped to system usernames
    mailboxes.forEach(m => {
      if (m.systemUsername) {
        virtualLines.push(`${m.username}@${domain}   ${m.systemUsername}`)
      }
    })

    // 3. Append current forwarders
    forwarders.forEach(f => {
      virtualLines.push(`${f.source}@${domain}   ${f.target}`)
    })

    // Write back /etc/postfix/virtual
    fs.writeFileSync(virtualPath, virtualLines.join('\n').trim() + '\n', 'utf8')

    // 4. Ensure virtual_alias_maps is in main.cf
    if (fs.existsSync(mainCfPath)) {
      let mainCf = fs.readFileSync(mainCfPath, 'utf8')
      let changed = false
      if (!mainCf.includes('virtual_alias_maps')) {
        mainCf += `\nvirtual_alias_maps = hash:/etc/postfix/virtual\n`
        changed = true
      }
      
      // Ensure domain is in mydestination so local delivery to system users is enabled
      const match = mainCf.match(/^mydestination\s*=\s*(.+)$/m)
      if (match) {
        const currentDest = match[1]
        if (!currentDest.includes(domain)) {
          logger.info(`Adding domain ${domain} to Postfix mydestination`)
          const newDest = `${currentDest.trim()}, ${domain}, mail.${domain}`
          mainCf = mainCf.replace(/^mydestination\s*=.+$/m, `mydestination = ${newDest}`)
          changed = true
        }
      }

      if (changed) {
        fs.writeFileSync(mainCfPath, mainCf, 'utf8')
      }
    }

    // 5. Compile virtual maps and reload services
    await execAsync('postmap /etc/postfix/virtual')
    await execAsync('systemctl reload postfix')
    await execAsync('systemctl reload dovecot')
    logger.info(`Mail configuration synced for domain ${domain}`)
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
      
      // Strip trailing slashes and normalize to git/project root if it points to a sub-folder like /dist
      let rootPath = site.root.replace(/\/+$/, '')
      const projectRoot = rootPath.replace(/\/(dist|public|html|build)$/i, '')
      if (fs.existsSync(projectRoot)) {
        site.root = projectRoot
      }

      if (!fs.existsSync(site.root)) {
        try { fs.mkdirSync(site.root, { recursive: true }) } catch (e) {}
      }
      return site
    }
  }
  if (id.startsWith('www-')) {
    const domain = id.slice(4)
    let root = `/var/www/${domain}`
    // Normalize www- templates too
    root = root.replace(/\/+$/, '')
    const projectRoot = root.replace(/\/(dist|public|html|build)$/i, '')
    if (fs.existsSync(projectRoot)) {
      root = projectRoot
    }
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

  const cleanDomain = site.domain.toLowerCase().replace(/[^a-z0-9]/g, '')
  const cleanUser = username.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  
  // Generate safe system username (max 32 chars)
  let systemUsername = `${cleanDomain.slice(0, 15)}_${cleanUser.slice(0, 15)}`
  if (systemUsername.length > 32) {
    systemUsername = systemUsername.slice(0, 32)
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

  try {
    // 1. Check if system user already exists
    let userExists = false
    try {
      await execAsync(`id ${systemUsername}`)
      userExists = true
    } catch {}

    // 2. Create system user if not exists
    if (!userExists) {
      logger.info(`Creating system user: ${systemUsername}`)
      await execAsync(`useradd -m -s /bin/bash ${systemUsername}`)
    }

    // 3. Set password
    logger.info(`Setting password for system user: ${systemUsername}`)
    await execAsync(`echo "${systemUsername}:${password}" | chpasswd`)

    // 4. Set up Maildir structure
    logger.info(`Setting up Maildir for user: ${systemUsername}`)
    const homeDir = `/home/${systemUsername}`
    await execAsync(`mkdir -p ${homeDir}/Maildir/{cur,new,tmp}`)
    await execAsync(`chown -R ${systemUsername}:${systemUsername} ${homeDir}/Maildir`)
    await execAsync(`chmod -R 700 ${homeDir}/Maildir`)

    // 5. Store metadata
    meta.mail.mailboxes.push({ 
      username, 
      systemUsername, 
      createdAt: new Date().toISOString() 
    })
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

    // 6. Sync Postfix configuration
    await syncPostfixMail(site.domain, meta.mail.mailboxes, meta.mail.forwarders || [])

    res.json({ 
      success: true, 
      message: `Virtual mailbox '${username}@${site.domain}' successfully created and mapped to system user '${systemUsername}'.`,
      systemUsername
    })
  } catch (err) {
    logger.error('Failed to create local site mailbox', { error: err.message })
    res.status(500).json({ error: err.message })
  }
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

  const mailbox = meta.mail.mailboxes.find(m => m.username.toLowerCase() === username.toLowerCase())
  if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' })

  try {
    // 1. Delete local system user and their home/Maildir directory
    if (mailbox.systemUsername) {
      logger.info(`Deleting system user: ${mailbox.systemUsername}`)
      await execAsync(`userdel -r ${mailbox.systemUsername}`).catch(e => {
        logger.error(`Error deleting system user ${mailbox.systemUsername}:`, e)
      })
    }

    // 2. Filter metadata
    meta.mail.mailboxes = meta.mail.mailboxes.filter(m => m.username.toLowerCase() !== username.toLowerCase())
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

    // 3. Sync Postfix
    await syncPostfixMail(site.domain, meta.mail.mailboxes, meta.mail.forwarders || [])

    res.json({ success: true, message: `Virtual mailbox '${username}' deleted successfully.` })
  } catch (err) {
    logger.error('Failed to delete site mailbox', { error: err.message })
    res.status(500).json({ error: err.message })
  }
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
      auth: smtpConfig.username ? { user: smtpConfig.username, pass: smtpConfig.password } : undefined,
      tls: { rejectUnauthorized: false },
    })

    await transporter.sendMail({
      from: smtpConfig.username || `noreplay@${site.domain}`,
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

// ── GET /api/sites/:id/mail/dns ────────────────────────────────────────────────
router.get('/:id/mail/dns', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })

  const os = require('os')
  let ip = '207.180.243.219' // Fallback to your VPS IP
  try {
    const nets = os.networkInterfaces()
    let found = false
    for (const name of Object.keys(nets)) {
      if (name.startsWith('docker') || name.startsWith('br-') || name.startsWith('veth') || name.startsWith('lo')) {
        continue
      }
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          ip = net.address
          found = true
          break
        }
      }
      if (found) break
    }
  } catch {}


  const spf = `v=spf1 ip4:${ip} -all`
  const dmarc = `v=DMARC1; p=none; rua=mailto:noreplay@${site.domain}`
  
  // Read DKIM from /etc/opendkim/keys/default.txt or similar if configured
  let dkim = null
  let dkimSelector = 'default'
  try {
    const dkimPath = '/etc/opendkim/keys/default.txt'
    if (fs.existsSync(dkimPath)) {
      const fileContent = fs.readFileSync(dkimPath, 'utf8')
      const match = fileContent.match(/p=([A-Za-z0-9+/=]+)/)
      if (match) {
        dkim = `v=DKIM1; k=rsa; p=${match[1]}`
      } else {
        const pMatch = fileContent.match(/"p=([^"]+)"/)
        if (pMatch) dkim = `v=DKIM1; k=rsa; p=${pMatch[1]}`
      }
    }
  } catch {}

  const runTest = req.query.test === 'true'
  let testResults = null

  if (runTest) {
    const dns = require('dns').promises
    testResults = {
      spf: { present: false, valid: false, found: null },
      dmarc: { present: false, valid: false, found: null },
      dkim: { present: false, valid: false, found: null }
    }
    
    // Test SPF
    try {
      const txts = await dns.resolveTxt(site.domain)
      const spfRecord = txts.flat().find(r => r.startsWith('v=spf1'))
      if (spfRecord) {
        testResults.spf.present = true
        testResults.spf.found = spfRecord
        testResults.spf.valid = spfRecord.includes(ip)
      }
    } catch {}

    // Test DMARC
    try {
      const txts = await dns.resolveTxt(`_dmarc.${site.domain}`)
      const dmarcRecord = txts.flat().find(r => r.startsWith('v=DMARC1'))
      if (dmarcRecord) {
        testResults.dmarc.present = true
        testResults.dmarc.found = dmarcRecord
        testResults.dmarc.valid = dmarcRecord.includes('v=DMARC1')
      }
    } catch {}

    // Test DKIM
    try {
      const txts = await dns.resolveTxt(`default._domainkey.${site.domain}`)
      const dkimRecord = txts.flat().find(r => r.startsWith('v=DKIM1'))
      if (dkimRecord) {
        testResults.dkim.present = true
        testResults.dkim.found = dkimRecord
        testResults.dkim.valid = dkimRecord.includes('v=DKIM1')
      }
    } catch {}
  }

  res.json({
    spf,
    dmarc,
    dkim,
    dkimSelector,
    ip,
    testResults
  })
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

    // 3. Copy website files (excluding heavy dependency directories)
    if (fs.existsSync(site.root)) {
      await execAsync(
        `rsync -a --exclude='node_modules' "${site.root}/" "${tmpBackupDir}/files/"`
      ).catch(() => {})
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
      await execAsync(`rsync -a "${sourceFiles}/" "${targetRoot}/"`)
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
      if (dbCreds && dbCreds.dbName) {
        // Create database if not exists
        await execAsync(`mysql -u root -e "CREATE DATABASE IF NOT EXISTS \`${dbCreds.dbName}\`;"`).catch(() => {})
        // Import SQL
        if (dbCreds.dbUser && dbCreds.dbPass) {
          await execAsync(`mysql -u "${dbCreds.dbUser}" -p"${dbCreds.dbPass}" "${dbCreds.dbName}" < "${sqlPath}"`).catch(() => {})
        } else {
          await execAsync(`mysql -u root "${dbCreds.dbName}" < "${sqlPath}"`).catch(() => {})
        }
      }
    }

    // 6. Test Nginx and reload
    try {
      await execAsync('nginx -t')
      await execAsync('systemctl reload nginx')
    } catch {}

    // 7. Revive / Restart background services (PM2) if specified in settings
    const sdConfigPath = path.join(targetRoot, '.serverdash.json')
    if (fs.existsSync(sdConfigPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(sdConfigPath, 'utf8'))
        let restartCmd = meta.restartCommand || `pm2 restart "${domain}"`
        const nodeVersion = meta.nodeVersion || 'system'
        const prefix = nodeShellPrefix(nodeVersion)
        
        logger.info('Restored site has start settings, executing restart', { domain, restartCmd })
        await execAsync(`cd "${targetRoot}" && ${prefix}${restartCmd} 2>&1`).catch(async () => {
          // If restart failed because it's not registered/running, try starting it
          if (restartCmd.includes('pm2 restart')) {
            const startCmd = restartCmd.replace('restart', 'start')
            await execAsync(`cd "${targetRoot}" && ${prefix}${startCmd} 2>&1`).catch(() => {})
          }
        })
      } catch (e) {
        logger.warn('Failed to auto-restart restored website application', { error: e.message })
      }
    }

    // Cleanup restore workspaces
    await execAsync(`rm -rf "${extractDir}"`)
    await execAsync(`rm -f "${localZip}"`)

    res.json({ success: true, message: `Website '${domain}' successfully restored from full backup zip!` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/sites/:id/scripts ────────────────────────────────────────────────
router.get('/:id/scripts', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).json({ error: 'Site not found' })

  const scripts = []
  
  // 1. Check for shell scripts
  try {
    const { stdout } = await execAsync(`find "${site.root}" -maxdepth 1 -name "*.sh" -type f`)
    const shFiles = stdout.split('\n').filter(Boolean)
    shFiles.forEach(f => {
      const name = path.basename(f)
      scripts.push({ name, command: `./${name}`, type: 'shell' })
    })
  } catch (e) {}

  // 2. Parse package.json scripts
  try {
    const pkgPath = path.join(site.root, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      if (pkg.scripts) {
        Object.keys(pkg.scripts).forEach(key => {
          scripts.push({ name: `npm run ${key}`, command: `npm run ${key}`, type: 'npm' })
        })
      }
    }
  } catch (e) {}

  res.json({ scripts })
})

// ── GET /api/sites/:id/exec-stream ─────────────────────────────────────────────
router.get('/:id/exec-stream', async (req, res) => {
  const site = resolveSiteRoot(req.params.id)
  if (!site || !site.root) return res.status(404).end()
  
  const { command } = req.query
  if (!command) return res.status(400).end()

  const blocked = [
    'rm -rf /', 'dd if=/dev/zero', 'mkfs', '> /dev/sda', 'format c:',
    'pm2 stop', 'pm2 delete', 'nginx', 'reboot', 'shutdown', 'systemctl', 'service', 'init 0', 'init 6'
  ]
  if (blocked.some(b => command.includes(b))) {
    const send = sseSetup(res)
    send(`✗ BLOCKED: Command contains prohibited keywords (${command})`)
    send(`Exit: 1`)
    return res.end()
  }

  const send = sseSetup(res)
  send(`$ ${command}`)
  
  const { spawn } = require('child_process')
  const child = spawn('/bin/bash', ['-c', `${command} 2>&1`], { cwd: site.root })
  
  child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
  child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
  child.on('close', code => { send(`Exit: ${code}`); res.end() })
  req.on('close', () => child.kill())
})

module.exports = router
