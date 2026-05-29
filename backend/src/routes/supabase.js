const express = require('express')
const router = express.Router()
const ssh = require('../sshPool')
const logger = require('../logger')
const { v4: uuidv4 } = require('uuid')
const multer = require('multer')
const upload = multer({ dest: '/tmp/supabase-uploads/' })
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Helper function to cleanly sanitize SQL dump contents natively in Javascript
const cleanSqlContent = (content) => {
  const systemSchemas = ['auth', 'storage', 'vault', 'extensions', '_realtime', 'realtime', 'graphql', 'graphql_public', 'pgbouncer', 'supabase_functions']
  const lines = content.split('\n')
  const outLines = []
  let inCopy = false
  let copyTargetPublic = false
  let stmtLines = []

  const createAlterSystem = new RegExp('\\b(create|alter|drop|comment on)\\s+(schema|table|column|function|trigger|type|view|index|policy|sequence)\\s+\\b(' + systemSchemas.join('|') + ')\\b', 'i')
  const excludeTypes = new RegExp('\\b(create|alter|drop|grant|revoke)\\s+(role|user|extension|default privileges)\\b', 'i')
  const createSchemaSystem = new RegExp('\\bcreate\\s+schema\\s+\\b(' + systemSchemas.join('|') + ')\\b', 'i')

  for (const line of lines) {
    const stripped = line.trim()

    if (inCopy) {
      if (stripped === '\\.') {
        inCopy = false
        if (copyTargetPublic) {
          stmtLines.push(line)
          outLines.push(...stmtLines)
        }
        stmtLines = []
      } else {
        if (copyTargetPublic) {
          stmtLines.push(line)
        }
      }
      continue
    }

    if (stripped.toLowerCase().startsWith('copy ')) {
      const isPublic = stripped.toLowerCase().includes('public.') || !systemSchemas.some(s => stripped.toLowerCase().includes(`${s}.`))
      if (isPublic) {
        inCopy = true
        copyTargetPublic = true
        stmtLines = [line]
      } else {
        inCopy = true
        copyTargetPublic = false
      }
      continue
    }

    stmtLines.push(line)

    if (stripped.endsWith(';')) {
      const stmtText = stmtLines.join('\n').trim()
      let keep = true

      if (createAlterSystem.test(stmtText)) {
        keep = false
      } else if (excludeTypes.test(stmtText)) {
        keep = false
      } else if (createSchemaSystem.test(stmtText)) {
        keep = false
      } else if (stmtText.toLowerCase().includes('search_path') && !stmtText.toLowerCase().includes('public') && systemSchemas.some(s => stmtText.toLowerCase().includes(s))) {
        keep = false
      } else if (stmtText.toLowerCase().includes('on auth.') || stmtText.toLowerCase().includes('on storage.')) {
        keep = false
      }

      if (keep) {
        outLines.push(...stmtLines)
      }
      stmtLines = []
    }
  }

  if (stmtLines.length > 0) {
    outLines.push(...stmtLines)
  }

  return outLines.join('\n')
}

// ── Constants ──────────────────────────────────────────────────────────────────
const REPO_PATH = '/opt/supabase-repo'           // Official Supabase git clone
const PROJECTS_DIR = '/opt/supabase-projects'    // Where user projects live
const PROJECTS_FILE = `${PROJECTS_DIR}/.projects.json` // Persistent project list

// ── SSE helper ─────────────────────────────────────────────────────────────────
const sseSetup = (res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  return (msg) => { 
    res.write(`data: ${msg}\n\n`);
    if (res.flush) res.flush();
  }
}

// ── Get server's primary IP ────────────────────────────────────────────────────
const getServerIP = () => {
  try {
    const nets = require('os').networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) return net.address
      }
    }
  } catch {}
  return '127.0.0.1'
}

// ── Persistence ────────────────────────────────────────────────────────────────
const loadProjects = () => {
  try {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true })
    if (fs.existsSync(PROJECTS_FILE)) {
      return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'))
    }
  } catch {}
  return []
}

const saveProjects = (projects) => {
  try {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true })
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2))
  } catch (e) { logger.warn('Could not save projects', { error: e.message }) }
}

// ── Auto-detect the existing running Supabase instance ─────────────────────────
// IMPORTANT: This function must NEVER throw or hang — it is called on every
// GET /api/supabase/projects request. Every execSync call is wrapped individually
// with a short timeout and its own try/catch.
const detectBuiltinProject = () => {
  try {
    const serverIP = getServerIP()
    const candidates = [
      { envPath: '/root/print_lankaDB/.env',   composePath: '/root/print_lankaDB',   name: 'print-lanka' },
      { envPath: '/root/supabase/docker/.env', composePath: '/root/supabase/docker', name: 'supabase-main' },
    ]

    for (const { envPath, composePath, name } of candidates) {
      // Safe file existence check
      let envContent = null
      try {
        if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8')
      } catch { continue }
      if (!envContent) continue

      const getVal = (key) => {
        try {
          const m = envContent.match(new RegExp(`^${key}=(.+)`, 'm'))
          return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
        } catch { return null }
      }

      const kongPort  = getVal('KONG_HTTP_PORT') || '8000'
      const rawUrl    = getVal('SUPABASE_PUBLIC_URL')
      const publicUrl = rawUrl || `http://${serverIP}:${kongPort}`
      const dbPass    = getVal('POSTGRES_PASSWORD') || '****'
      const dbPort    = getVal('POSTGRES_PORT') || '5432'
      const dashUser  = getVal('DASHBOARD_USERNAME') || 'supabase'
      const dashPass  = getVal('DASHBOARD_PASSWORD') || '****'
      const anonKey   = getVal('ANON_KEY') || ''
      const serviceKey = getVal('SERVICE_ROLE_KEY') || ''

      // Studio URL — safe docker ps with 2s timeout
      let studioUrl = `http://${serverIP}:3000`
      try {
        const psOut = execSync(
          `docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -i studio`,
          { timeout: 2000, stdio: ['pipe','pipe','pipe'] }
        ).toString()
        const m = psOut.match(/0\.0\.0\.0:(\d+)->3000/)
        if (m) studioUrl = `http://${serverIP}:${m[1]}`
      } catch { /* docker not running or timed out — that's fine */ }

      // Compose status — safe check with 2s timeout
      let status = 'stopped'
      try {
        const psOut = execSync(
          `docker compose -f ${composePath}/docker-compose.yml ps --format json 2>/dev/null`,
          { timeout: 2000, stdio: ['pipe','pipe','pipe'] }
        ).toString().trim()
        // If any JSON lines returned, at least one container exists
        if (psOut && psOut.length > 2) status = 'running'
      } catch { /* timed out or error — leave as stopped */ }

      return {
        id: 'builtin-main',
        name,
        apiUrl: publicUrl,
        studioUrl,
        kongPort: parseInt(kongPort) || 8000,
        dbConn: `postgresql://postgres:${dbPass}@${serverIP}:${dbPort}/postgres`,
        dashboardUser: dashUser,
        dashboardPass: dashPass,
        dbPort: parseInt(dbPort) || 5432,
        anonKey,
        serviceKey,
        status,
        created: new Date('2026-05-14').toISOString(),
        composePath,
        builtin: true,
      }
    }
  } catch { /* total fallback */ }
  return null
}


// ── Port allocation ─────────────────────────────────────────────────────────────
const { exec: execCb, spawn: spawnLocal } = require('child_process')
const { promisify } = require('util')
const execAsync2 = promisify(execCb)

const getUsedPorts = async () => {
  try {
    // Print both $4 and $5 to be robust against `ss` format differences,
    // and remove `grep LISTEN` so we also catch UNCONN UDP ports.
    const { stdout } = await execAsync2("ss -tlunp 2>/dev/null | awk '{print $4 \"\\n\" $5}' | grep -oP ':\\K[0-9]+'")
    return new Set(stdout.split('\n').filter(Boolean).map(Number))
  } catch { return new Set() }
}

const getFreePort = async (startPort, reserved = new Set()) => {
  const used = await getUsedPorts()
  let port = startPort
  while (port < 65000) {
    if (!used.has(port) && !reserved.has(port)) return port
    port++
  }
  throw new Error('No free ports available')
}

// Collect all ports already claimed by any managed project
const getAllProjectPorts = () => {
  const projects = loadProjects()
  const ports = new Set()
  for (const p of projects) {
    ;[p.kongPort, p.kongHttpsPort, p.studioPort, p.dbPort, p.poolerPort, p.analyticsPort]
      .forEach(port => { if (port) ports.add(port) })
  }
  return ports
}

// ── GET /api/supabase/projects ─────────────────────────────────────────────────
router.get('/projects', (req, res) => {
  try {
    const userProjects = loadProjects()
    // NOTE: We intentionally do NOT auto-register builtin projects here.
    // Auto-registering caused newly created projects to appear linked to the
    // first detected project (print_lankaDB). Use the "Register Existing"
    // button in the UI to manually add pre-existing installs.
    res.json(userProjects)
  } catch (err) {
    logger.error('Failed to list projects', { error: err.message })
    res.json([])  // never crash — return empty list
  }
})


// ── POST /api/supabase/create-stream ──────────────────────────────────────────
// Uses the official Supabase docker template (git repo) for a production-grade instance
router.post('/create-stream', upload.single('sqlBackup'), async (req, res) => {
  const send = sseSetup(res)
  const { name, dbPassword, dashPassword, publicUrl } = req.body

  if (!name || !dbPassword) { send('✗ name and dbPassword required'); return res.end() }

  const projectId = name.toLowerCase().replace(/[^a-z0-9]/g, '-')
  const projectPath = `${PROJECTS_DIR}/${projectId}`

  try {
    // ── Step 1: Ensure official Supabase repo is available ─────────────────────
    send('▶ Checking Supabase repository...')
    const repoExists = fs.existsSync(`${REPO_PATH}/docker/docker-compose.yml`)
    if (!repoExists) {
      send('  Repository not found. Cloning official Supabase repo (one-time ~600MB)...')
      const clone = await ssh.exec(
        `git clone --depth 1 https://github.com/supabase/supabase ${REPO_PATH} 2>&1`,
        { timeout: 300000 }
      )
      const cloneOutput = (clone.stdout || '') + (clone.stderr || '')
      cloneOutput.split('\n').filter(Boolean).slice(-10).forEach(l => send(`  ${l}`))
      if (clone.code !== 0) throw new Error('Failed to clone Supabase repo: ' + (clone.stderr || clone.stdout || 'unknown error'))
    } else {
      send(`✓ Repository ready at ${REPO_PATH}`)
    }

    // ── Step 2: Check project doesn't already exist ────────────────────────────
    if (fs.existsSync(projectPath)) {
      throw new Error(`Project "${projectId}" already exists at ${projectPath}`)
    }

    // ── Step 3: Copy official docker template to new project ───────────────────
    send(`▶ Creating project at ${projectPath}...`)
    await ssh.exec(`cp -r ${REPO_PATH}/docker ${projectPath} 2>&1`)
    send('✓ Project directory created')

    // ── Step 3.5: Apply Memory Limits & Healthcheck Optimizations to docker-compose.yml ──
    send('▶ Applying Memory Limits & CPU Optimizations to docker-compose...')
    try {
      const yaml = require('yaml')
      const composePath = `${projectPath}/docker-compose.yml`
      const composeTxt = fs.readFileSync(composePath, 'utf8')
      const doc = yaml.parseDocument(composeTxt)
      
      const services = doc.get('services')
      
      for (const item of services.items) {
        const serviceName = item.key.value
        const service = item.value
        
        let memoryLimit = '256M'
        if (serviceName === 'db') memoryLimit = '1024M'
        else if (serviceName === 'analytics') memoryLimit = '1024M'
        else if (serviceName === 'studio') memoryLimit = '1024M'
        else if (serviceName === 'kong') memoryLimit = '1024M'
        else if (serviceName === 'vector') memoryLimit = '128M'
        else if (serviceName === 'logflare') memoryLimit = '1024M'
        else if (serviceName === 'meta') memoryLimit = '256M'
        else if (serviceName === 'storage') memoryLimit = '256M'
        
        service.set('deploy', doc.createNode({
          resources: {
            limits: {
              memory: memoryLimit
            }
          }
        }))

        // Optimize healthcheck to reduce CPU overhead
        const healthcheck = service.get('healthcheck')
        if (healthcheck) {
          healthcheck.set('interval', '30s')
          healthcheck.set('timeout', '10s')
          healthcheck.set('retries', 3)
          healthcheck.set('start_period', '60s')
        }

        // Optional: Also add Postgres optimizations for db container
        if (serviceName === 'db') {
          const commandList = [
            "postgres",
            "-c", "config_file=/etc/postgresql/postgresql.conf",
            "-c", "log_min_messages=fatal",
            "-c", "shared_buffers=128MB",
            "-c", "work_mem=4MB",
            "-c", "effective_cache_size=512MB",
            "-c", "max_connections=60",
            "-c", "maintenance_work_mem=64MB"
          ]
          service.set('command', doc.createNode(commandList))
        }
      }
      
      fs.writeFileSync(composePath, doc.toString())
      send('✓ Memory limits & CPU optimizations applied')
    } catch (e) {
      console.error("Failed to apply limits & CPU optimizations:", e)
      send('⚠ Failed to apply limits & CPU optimizations')
    }

    // ── Step 4: Allocate ports ─────────────────────────────────────────────────
    send('▶ Allocating ports...')
    const reserved = getAllProjectPorts()

    // Find sequential free ports, each one reserved so they don't clash with each other
    const kongPort      = await getFreePort(8100, reserved); reserved.add(kongPort); reserved.add(kongPort + 1)
    const studioPort    = await getFreePort(3001, reserved); reserved.add(studioPort)
    const dbPort        = await getFreePort(55433, reserved); reserved.add(dbPort)
    const poolerPort    = await getFreePort(dbPort + 100, reserved); reserved.add(poolerPort)
    const analyticsPort = await getFreePort(14001, reserved); reserved.add(analyticsPort)
    send(`✓ Ports: Kong=${kongPort}, Studio=${studioPort}, DB=${dbPort}, Pooler=${poolerPort}, Analytics=${analyticsPort}`)

    // ── Step 5: Generate secure JWT secrets ────────────────────────────────────
    send('▶ Generating secure JWT secrets...')
    let jwtSecret, anonKey, serviceKey
    try {
      jwtSecret = execSync('openssl rand -hex 40').toString().trim()
      
      // Build JWT payload and sign inline using node
      const now = Math.floor(Date.now() / 1000)
      const exp = now + (5 * 365 * 24 * 3600) // 5 years
      const buildJwt = (role) => {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({ role, iss: 'supabase', iat: now, exp })).toString('base64url')
        const crypto = require('crypto')
        const sig = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')
        return `${header}.${payload}.${sig}`
      }
      anonKey = buildJwt('anon')
      serviceKey = buildJwt('service_role')
      send('✓ JWT secrets generated')
    } catch (e) {
      throw new Error('Failed to generate secrets: ' + e.message)
    }

    // ── Step 6: Patch the .env file with all settings ──────────────────────────
    send('▶ Configuring .env...')
    const serverIP = getServerIP()
    const resolvedUrl = publicUrl || `http://${serverIP}:${kongPort}`
    const finalDashPassword = dashPassword || dbPassword
    
    let env = fs.readFileSync(`${projectPath}/.env.example`, 'utf8')
    const setEnv = (key, val) => {
      const re = new RegExp(`^${key}=.*`, 'm')
      if (re.test(env)) {
        env = env.replace(re, `${key}=${val}`)
      } else {
        env += `\n${key}=${val}`
      }
    }

    setEnv('POSTGRES_PASSWORD', dbPassword)
    setEnv('JWT_SECRET', jwtSecret)
    setEnv('ANON_KEY', anonKey)
    setEnv('SERVICE_ROLE_KEY', serviceKey)
    setEnv('DASHBOARD_USERNAME', 'supabase')
    setEnv('DASHBOARD_PASSWORD', finalDashPassword)
    setEnv('SUPABASE_PUBLIC_URL', resolvedUrl)
    setEnv('API_EXTERNAL_URL', resolvedUrl)
    setEnv('SITE_URL', resolvedUrl)
    setEnv('KONG_HTTP_PORT', kongPort)
    setEnv('KONG_HTTPS_PORT', kongPort + 1)
    setEnv('POSTGRES_PORT', dbPort)
    setEnv('POOLER_PROXY_PORT_TRANSACTION', poolerPort)
    setEnv('STUDIO_PORT', studioPort)
    setEnv('ANALYTICS_PORT', analyticsPort)
    // Critical: unique compose project name → unique container names
    setEnv('COMPOSE_PROJECT_NAME', projectId)

    fs.writeFileSync(`${projectPath}/.env`, env)
    send(`✓ .env configured (URL: ${resolvedUrl})`)

    // ── Step 6b: Patch docker-compose.yml for project isolation ───────────────
    send('▶ Patching docker-compose.yml for isolation...')
    let composeTxt = fs.readFileSync(`${projectPath}/docker-compose.yml`, 'utf8')
    
    // ── CRITICAL: Replace the top-level `name:` field so Docker Compose treats
    // this as a completely separate project from any other Supabase instance.
    // Using a broad regex that handles any whitespace / quoting variation.
    composeTxt = composeTxt.replace(/^(name:\s*)(["']?)[\w-]+\2\s*$/m, `name: "${projectId}"`)
    // If no `name:` line exists at all, prepend one after the comment block
    if (!/^name:/m.test(composeTxt)) {
      composeTxt = `name: "${projectId}"\n` + composeTxt
    }

    // ── Make every container_name unique so they can't clash with print_lankaDB
    // or any other running Supabase instance.
    composeTxt = composeTxt.replace(/container_name:\s*supabase-/g, `container_name: ${projectId}-`)
    composeTxt = composeTxt.replace(/container_name:\s*supabase(\s|$)/gm, `container_name: ${projectId}$1`)
    // Realtime has a non-standard naming pattern
    composeTxt = composeTxt.replace(
      /container_name:\s*realtime-dev\.supabase-realtime/g,
      `container_name: realtime-dev.${projectId}-realtime`
    )

    // ── Add studio port mapping (the template doesn't expose it by default) ──
    composeTxt = composeTxt.replace(
      new RegExp(`container_name: ${projectId}-studio(\\s+[\\s\\S]*?)(\\n  [a-z])`, 'i'),
      (match, inner, next) => {
        if (inner.includes('ports:')) return match
        return `container_name: ${projectId}-studio${inner}    ports:\n      - \${STUDIO_PORT:-3000}:3000\n${next}`
      }
    )
    // Enable analytics port (it's commented out in the template)
    composeTxt = composeTxt.replace(
      /# ports:\s*\n\s*#\s*- 4000:4000/,
      `ports:\n      - \${ANALYTICS_PORT:-4000}:4000`
    )
    fs.writeFileSync(`${projectPath}/docker-compose.yml`, composeTxt)

    // ── Verify the name was actually replaced (critical sanity check) ─────────
    const verifyCompose = fs.readFileSync(`${projectPath}/docker-compose.yml`, 'utf8')
    const nameMatch = verifyCompose.match(/^name:\s*["']?([\w-]+)["']?/m)
    const actualName = nameMatch ? nameMatch[1] : '(not found)'
    if (actualName !== projectId) {
      send(`⚠ WARNING: docker-compose name is "${actualName}" instead of "${projectId}" — forcing with sed`)
      // Force it with sed as a fallback
      await ssh.exec(`sed -i 's/^name:.*$/name: "${projectId}"/' "${projectPath}/docker-compose.yml"`, { ignoreErrors: true })
    }
    send(`✓ docker-compose.yml patched (project name: ${projectId})`)

    // ── Step 7: Pull images and start ─────────────────────────────────────────
    send('▶ Pulling Docker images (this takes a few minutes on first run)...')
    const pull = await ssh.exec(`cd ${projectPath} && docker compose pull 2>&1`, { timeout: 600000 })
    pull.stdout.split('\n').filter(Boolean).slice(-5).forEach(l => send(`  ${l}`))

    send('▶ Starting all Supabase services...')
    const up = await ssh.exec(`cd ${projectPath} && docker compose up -d 2>&1`, { timeout: 300000 })
    const upOut = ((up.stdout || '') + (up.stderr || '')).split('\n').filter(Boolean)
    upOut.forEach(l => send(`  ${l}`))
    // Verify critical services started
    const psCheck = await ssh.exec(`cd ${projectPath} && docker compose ps --format json 2>/dev/null`, { timeout: 10000 })
    const runningContainers = (psCheck.stdout || '').split('\n').filter(Boolean).length
    if (runningContainers < 3) throw new Error('docker compose up failed — fewer than 3 containers started. ' + (up.stderr || '').substring(0, 300))
    send('✓ Services started successfully')

    // ── Step 8: Wait for health check ──────────────────────────────────────────
    send('▶ Waiting for services to become healthy (up to 60s)...')
    let healthy = false
    for (let i = 0; i < 12; i++) {
      await ssh.exec('sleep 5')
      const { stdout } = await ssh.exec(`cd ${projectPath} && docker compose ps 2>&1`)
      const unhealthy = stdout.includes('starting') || stdout.includes('unhealthy')
      if (!unhealthy && stdout.includes('healthy')) { healthy = true; break }
      send(`  Waiting... (${(i + 1) * 5}s)`)
    }
    send(healthy ? '✓ All services healthy' : '⚠ Services started (health check timeout, they may still be initializing)')

    // ── Step 9: Restore SQL backup if provided ────────────────────────────────
    if (req.file) {
      send('▶ Restoring SQL backup...')
      const dbContainer = `${projectId}-db-1`
      let sqlPath = req.file.path
      
      if (req.file.originalname.endsWith('.zip')) {
        send('  Extracting ZIP...')
        const tmpSql = `/tmp/supabase-uploads/${uuidv4()}.sql`
        await ssh.exec(`unzip -p "${req.file.path}" "*.sql" > ${tmpSql}`)
        sqlPath = tmpSql
      }

      const restore = await ssh.exec(
        `cat ${sqlPath} | docker exec -i $(cd ${projectPath} && docker compose ps -q db) psql -U postgres`,
        { timeout: 300000 }
      )
      try { fs.unlinkSync(req.file.path); if (sqlPath !== req.file.path) fs.unlinkSync(sqlPath) } catch {}
      
      if (restore.code === 0) send('✓ SQL backup restored')
      else send(`⚠ SQL restore had warnings: ${restore.stderr.substring(0, 200)}`)
    }

    // ── Step 10: Save project ─────────────────────────────────────────────────
    const studioPublicUrl = `http://${serverIP}:${studioPort}`
    const project = {
      id: uuidv4(),
      name,
      apiUrl: resolvedUrl,
      studioUrl: studioPublicUrl,
      dbConn: `postgresql://postgres:${dbPassword}@${serverIP}:${dbPort}/postgres`,
      kongPort,
      kongHttpsPort: kongPort + 1,
      studioPort,
      dbPort,
      poolerPort,
      analyticsPort,
      anonKey,
      serviceKey,
      dashboardUser: 'supabase',
      dashboardPass: finalDashPassword,
      status: 'running',
      created: new Date().toISOString(),
      composePath: projectPath,
      builtin: false,
    }

    const projects = loadProjects()
    projects.push(project)
    saveProjects(projects)

    logger.info('Supabase project created', { name, projectId, kongPort, studioPort, dbPort })
    send(`✓ Project "${name}" created successfully!`)
    send(`  API URL: ${resolvedUrl}`)
    send(`  Studio: ${studioPublicUrl}`)
    send(`  Login: supabase / ${finalDashPassword}`)
    send(`  DB: postgresql://postgres:***@${serverIP}:${dbPort}/postgres`)
    send(`  Ports: Kong=${kongPort}, Studio=${studioPort}, DB=${dbPort}, Pooler=${poolerPort}`)

  } catch (err) {
    send(`✗ Error: ${err.message}`)
    logger.error('Supabase create error', { error: err.message })
    // Cleanup on failure
    send('  Cleaning up failed project...')
    try {
      // Force tear down using project name to ensure no orphaned docker objects remain
      await ssh.exec(`docker compose -p ${projectId} down -v 2>&1`, { ignoreErrors: true, timeout: 60000 })
    } catch {}
    if (fs.existsSync(projectPath)) {
      await ssh.exec(`rm -rf ${projectPath}`, { ignoreErrors: true })
    }
    send('  Cleanup done')
  }
  res.end()
})

// ── GET /api/supabase/projects/:id/keys ───────────────────────────────────────
router.get('/:id/keys', (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  res.json({
    anonKey: project.anonKey || null,
    serviceKey: project.serviceKey || null,
    dashboardUser: project.dashboardUser,
    dashboardPass: project.dashboardPass,
    dbConn: project.dbConn,
  })
})



// ── GET /api/supabase/:id/backup ──────────────────────────────────────────────
router.get('/:id/backup', async (req, res) => {
  const { id } = req.params
  const builtin = detectBuiltinProject()
  const allProjects = [...(builtin ? [builtin] : []), ...loadProjects()]
  const project = allProjects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  try {
    const filename = `${project.name}-backup-${Date.now()}.sql`
    const result = await ssh.exec(
      `cd ${project.composePath} && docker compose exec -T db pg_dump -U postgres postgres 2>&1`,
      { timeout: 300000 }
    )

    if (!result.stdout || result.stdout.length < 100) {
      return res.status(500).json({ error: 'pg_dump returned empty output: ' + result.stderr })
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'application/sql')
    res.send(result.stdout)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/supabase/:id/migrate ────────────────────────────────────────────
router.post('/:id/migrate', upload.single('migration'), async (req, res) => {
  const { id } = req.params
  const builtin = detectBuiltinProject()
  const allProjects = [...(builtin ? [builtin] : []), ...loadProjects()]
  const project = allProjects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  if (!req.file) return res.status(400).json({ error: 'No SQL file uploaded' })

  try {
    let sqlPath = req.file.path
    if (req.file.originalname.endsWith('.zip')) {
      const tmpSql = `/tmp/supabase-uploads/${uuidv4()}.sql`
      await ssh.exec(`unzip -p "${req.file.path}" "*.sql" > ${tmpSql}`)
      sqlPath = tmpSql
    }

    // Sanitize the SQL dump natively using pure JS before executing it
    const rawSql = fs.readFileSync(sqlPath, 'utf8')
    const sanitizedSql = cleanSqlContent(rawSql)
    fs.writeFileSync(sqlPath, sanitizedSql, 'utf8')

    const result = await ssh.exec(
      `cat ${sqlPath} | docker exec -i $(cd ${project.composePath} && docker compose ps -q db) psql -U postgres`,
      { timeout: 300000 }
    )
    
    // Save copy of executed migration file in the project's migrations directory
    try {
      const migDir = `${project.composePath}/migrations`
      fs.mkdirSync(migDir, { recursive: true })
      let targetName = req.file.originalname || `migration-${Date.now()}.sql`
      if (targetName.endsWith('.zip')) {
        targetName = targetName.replace(/\.zip$/, '.sql')
      }
      fs.copyFileSync(sqlPath, path.join(migDir, targetName))
    } catch (e) {
      logger.warn('Could not copy migration to project migrations folder', { error: e.message })
    }

    try { fs.unlinkSync(req.file.path); if (sqlPath !== req.file.path) fs.unlinkSync(sqlPath) } catch {}

    if (result.code === 0) res.json({ success: true, output: result.stdout || 'Migration executed successfully' })
    else res.status(500).json({ error: result.stderr })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/supabase/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const projects = loadProjects()
  const project = projects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found (cannot delete builtin)' })

  try {
    // 1. Terminate stack services and remove volumes
    await ssh.exec(`cd ${project.composePath} && docker compose down -v 2>&1`, { ignoreErrors: true, timeout: 60000 })
    
    // 2. Safely clean up any associated Nginx reverse proxy configurations
    const cleanNginxProxy = (urlStr) => {
      try {
        if (!urlStr) return
        const parsed = new URL(urlStr)
        const domain = parsed.hostname
        const isIP = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(domain)
        if (domain && domain !== 'localhost' && !isIP) {
          const availablePath = `/etc/nginx/sites-available/${domain}`
          const enabledPath = `/etc/nginx/sites-enabled/${domain}`
          
          if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath)
          if (fs.existsSync(availablePath)) fs.unlinkSync(availablePath)
          logger.info(`Automatically deleted Nginx configurations for domain proxy: ${domain}`)
        }
      } catch (e) {
        logger.warn(`Failed to cleanup Nginx proxy for domain url ${urlStr}: ${e.message}`)
      }
    }

    cleanNginxProxy(project.apiUrl)
    cleanNginxProxy(project.studioUrl)

    try {
      execSync('nginx -t')
      execSync('systemctl reload nginx')
    } catch {}

    // 3. Remove physical files and project settings registry record
    await ssh.exec(`rm -rf ${project.composePath}`, { ignoreErrors: true })
    saveProjects(projects.filter(p => p.id !== id))
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/supabase/:id/delete-stream ─────────────────────────────────────
router.post('/:id/delete-stream', async (req, res) => {
  const { id } = req.params
  const projects = loadProjects()
  const project = projects.find(p => p.id === id)
  
  const send = sseSetup(res)
  if (!project) {
    send('✗ Project not found')
    return res.end()
  }

  try {
    send('▶ Initiating stack deletion...')
    
    // 1. Terminate stack services and remove volumes
    send('  Stopping active Docker containers and cleaning volumes...')
    const downCmd = `cd ${project.composePath} && docker compose down -v 2>&1`
    
    const downResult = await ssh.exec(downCmd, { ignoreErrors: true, timeout: 60000 })
    if (downResult.stdout) {
      downResult.stdout.split('\n').filter(Boolean).slice(-10).forEach(l => send(`  ${l}`))
    }
    if (downResult.stderr) {
      downResult.stderr.split('\n').filter(Boolean).slice(-10).forEach(l => send(`  ${l}`))
    }
    send('✓ Docker containers stopped and volumes removed')

    // 2. Safely clean up any associated Nginx reverse proxy configurations
    send('▶ Searching for associated Nginx reverse proxy configurations...')
    const cleanNginxProxy = (urlStr) => {
      try {
        if (!urlStr) return
        const parsed = new URL(urlStr)
        const domain = parsed.hostname
        const isIP = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(domain)
        if (domain && domain !== 'localhost' && !isIP) {
          send(`  Purging Nginx block files for domain: ${domain}`)
          const availablePath = `/etc/nginx/sites-available/${domain}`
          const enabledPath = `/etc/nginx/sites-enabled/${domain}`
          
          if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath)
          if (fs.existsSync(availablePath)) fs.unlinkSync(availablePath)
          send(`✓ Deleted proxy configuration: ${domain}`)
        }
      } catch (e) {
        send(`⚠ Failed to cleanup Nginx domain ${urlStr}: ${e.message}`)
      }
    }

    cleanNginxProxy(project.apiUrl)
    cleanNginxProxy(project.studioUrl)

    send('  Validating Nginx configuration and reloading service...')
    try {
      execSync('nginx -t')
      execSync('systemctl reload nginx')
      send('✓ Nginx configuration successfully reloaded')
    } catch (e) {
      send(`⚠ Nginx reload warning: ${e.message}`)
    }

    // 3. Remove physical files and project settings registry record
    send('▶ Cleaning up stack configuration files...')
    await ssh.exec(`rm -rf ${project.composePath}`, { ignoreErrors: true })
    send('✓ Project files deleted')

    saveProjects(projects.filter(p => p.id !== id))
    send('✓ Project registry record removed')
    send('✓ Project deleted successfully!')
  } catch (err) {
    send(`✗ Deletion Error: ${err.message}`)
  }
  res.end()
})


// ── POST /api/supabase/register ───────────────────────────────────────────────
// Register an existing Supabase install (e.g. /root/print_lankaDB) as a managed project
router.post('/register', async (req, res) => {
  const { composePath, name } = req.body
  if (!composePath || !name) return res.status(400).json({ error: 'composePath and name required' })

  const envPath = `${composePath}/.env`
  if (!fs.existsSync(envPath)) return res.status(400).json({ error: `.env not found at ${envPath}` })

  try {
    const serverIP = getServerIP()
    const env = fs.readFileSync(envPath, 'utf8')
    const getVal = (key) => {
      const m = env.match(new RegExp(`^${key}=(.+)`, 'm'))
      return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
    }

    const kongPort  = parseInt(getVal('KONG_HTTP_PORT')  || '8000')
    const dbPort    = parseInt(getVal('POSTGRES_PORT')   || '5432')
    const dbPass    = getVal('POSTGRES_PASSWORD') || '****'
    const rawUrl    = getVal('SUPABASE_PUBLIC_URL') || getVal('API_EXTERNAL_URL')
    const apiUrl    = rawUrl || `http://${serverIP}:${kongPort}`
    const dashUser  = getVal('DASHBOARD_USERNAME') || 'supabase'
    const dashPass  = getVal('DASHBOARD_PASSWORD') || ''
    const anonKey   = getVal('ANON_KEY') || ''
    const serviceKey = getVal('SERVICE_ROLE_KEY') || ''

    // Detect studio URL from running containers
    let studioUrl = `http://${serverIP}:3000`
    try {
      const ports = execSync(`docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -i studio`, { timeout: 3000 }).toString()
      const m = ports.match(/0\.0\.0\.0:(\d+)->3000/)
      if (m) studioUrl = `http://${serverIP}:${m[1]}`
    } catch {}

    const projects = loadProjects()
    const existing = projects.find(p => p.composePath === composePath)
    if (existing) return res.status(409).json({ error: 'Project already registered', id: existing.id })

    const project = {
      id: uuidv4(),
      name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      apiUrl,
      studioUrl,
      dbConn: `postgresql://postgres:${dbPass}@${serverIP}:${dbPort}/postgres`,
      kongPort,
      dbPort,
      anonKey,
      serviceKey,
      dashboardUser: dashUser,
      dashboardPass: dashPass,
      status: 'running',
      created: new Date().toISOString(),
      composePath,
      builtin: false,
    }

    projects.push(project)
    saveProjects(projects)
    logger.info('Supabase project registered', { name, composePath })
    res.json({ success: true, project })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/supabase/:id/detail ─────────────────────────────────────────────
// Returns full project details: migrations list, .env content, compose content, ports, functions
router.get('/:id/detail', async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const composePath = project.composePath
  const detail = { migrations: [], envContent: '', composeContent: '', ports: [], functions: [], containers: [] }

  // Migrations
  try {
    const migDir = `${composePath}/migrations`
    if (fs.existsSync(migDir)) {
      detail.migrations = fs.readdirSync(migDir)
        .filter(f => f.endsWith('.sql') || f.endsWith('.ts'))
        .map(f => {
          const stat = fs.statSync(`${migDir}/${f}`)
          return { name: f, size: stat.size, mtime: stat.mtime }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  } catch {}

  // .env content (mask sensitive values)
  try {
    let env = fs.readFileSync(`${composePath}/.env`, 'utf8')
    const MASK = ['POSTGRES_PASSWORD','JWT_SECRET','ANON_KEY','SERVICE_ROLE_KEY',
      'DASHBOARD_PASSWORD','S3_PROTOCOL_ACCESS_KEY_SECRET','VAULT_ENC_KEY',
      'SECRET_KEY_BASE','LOGFLARE_PRIVATE_ACCESS_TOKEN','JWT_KEYS','JWT_JWKS']
    MASK.forEach(k => {
      env = env.replace(new RegExp(`^(${k}=).+`, 'gm'), (_, prefix) => `${prefix}[REDACTED]`)
    })
    detail.envContent = env
  } catch {}

  // docker-compose.yml
  try {
    detail.composeContent = fs.readFileSync(`${composePath}/docker-compose.yml`, 'utf8')
  } catch {}

  // Running containers & ports
  try {
    const psOut = await ssh.exec(
      `docker compose -f ${composePath}/docker-compose.yml ps --format json 2>/dev/null`,
      { timeout: 5000, ignoreErrors: true }
    )
    detail.containers = (psOut.stdout || '').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)

    // Extract ports — deduplicate IPv4 vs IPv6 (Docker reports both separately)
    const portSeen = new Set()
    detail.ports = detail.containers.flatMap(c => {
      const raw = c.Publishers || []
      return raw
        .filter(p => p.PublishedPort > 0)
        .map(p => ({ container: c.Service || c.Name, published: p.PublishedPort, target: p.TargetPort, protocol: p.Protocol }))
        .filter(p => {
          const key = `${p.container}:${p.published}:${p.target}:${p.protocol}`
          if (portSeen.has(key)) return false
          portSeen.add(key); return true
        })
    })
  } catch {}

  // Edge functions folder
  try {
    const candidates = [
      `${composePath}/volumes/functions`,
      `${composePath}/functions`,
      `${composePath}/supabase/functions`
    ]
    const foundFns = new Set()
    for (const fnDir of candidates) {
      if (fs.existsSync(fnDir)) {
        const files = fs.readdirSync(fnDir, { withFileTypes: true })
        for (const file of files) {
          if (file.isDirectory()) {
            foundFns.add(file.name)
          }
        }
      }
    }
    detail.functions = Array.from(foundFns)
  } catch {}

  res.json(detail)
})

// ── GET /api/supabase/:id/logs (SSE) ─────────────────────────────────────────
router.get('/:id/logs', async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const send = sseSetup(res)
  try {
    const { stdout } = await ssh.exec(
      `docker compose -f ${project.composePath}/docker-compose.yml logs --tail=100 --no-color 2>&1`,
      { timeout: 15000, ignoreErrors: true }
    )
    ;(stdout || '').split('\n').forEach(l => send(l))
  } catch (err) {
    send(`Error: ${err.message}`)
  }
  res.end()
})

// ── POST /api/supabase/:id/down ───────────────────────────────────────────────
router.post('/:id/down', async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  try {
    const result = await ssh.exec(
      `docker compose -f ${project.composePath}/docker-compose.yml down 2>&1`,
      { timeout: 60000, ignoreErrors: true }
    )
    saveProjects(projects.map(p => p.id === req.params.id ? { ...p, status: 'stopped' } : p))
    res.json({ success: true, output: result.stdout })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /api/supabase/:id/env ─────────────────────────────────────────────────
router.put('/:id/env', async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const { content } = req.body
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' })

  try {
    // Backup current .env
    const envPath = `${project.composePath}/.env`
    fs.copyFileSync(envPath, `${envPath}.backup`)
    fs.writeFileSync(envPath, content, 'utf8')

    // Trigger rebuild/restart in background to pick up the new env variables
    const composeFile = `${project.composePath}/docker-compose.yml`
    ssh.exec(`docker compose -f ${composeFile} up -d --no-wait 2>&1`, { ignoreErrors: true, timeout: 300000 })
      .then(result => {
        logger.info('Supabase stack auto-recreated after env edit', { id: project.id, output: result.stdout || result.stderr })
      })
      .catch(err => {
        logger.error('Supabase stack auto-recreation failed after env edit', { id: project.id, error: err.message })
      })

    res.json({ success: true, message: 'Environment saved. Stack recreation triggered in background.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /api/supabase/:id/compose ─────────────────────────────────────────────
router.put('/:id/compose', async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const { content } = req.body
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' })

  try {
    const composeFile = `${project.composePath}/docker-compose.yml`
    // Backup current compose file
    fs.copyFileSync(composeFile, `${composeFile}.backup`)
    fs.writeFileSync(composeFile, content, 'utf8')

    // Trigger rebuild/restart in background
    ssh.exec(`docker compose -f ${composeFile} up -d --remove-orphans --no-wait 2>&1`, { ignoreErrors: true, timeout: 300000 })
      .then(result => {
        logger.info('Supabase stack auto-rebuilt after compose edit', { id: project.id, output: result.stdout || result.stderr })
      })
      .catch(err => {
        logger.error('Supabase stack auto-rebuild failed after compose edit', { id: project.id, error: err.message })
      })

    res.json({ success: true, message: 'Compose file saved. Stack rebuild triggered in background.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/supabase/:id/env-reveal  (unredacted — admin only) ─────────────
router.post('/:id/env-reveal', (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  
  const { password } = req.body
  const adminPass = process.env.ADMIN_PASSWORD || 'admin'
  if (password !== adminPass) {
    return res.status(401).json({ error: 'Invalid admin password' })
  }

  try {
    const content = fs.readFileSync(`${project.composePath}/.env`, 'utf8')
    res.json({ content })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/supabase/:id/migrations  (list with metadata) ───────────────────
router.get('/:id/migrations', (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  const migDir = `${project.composePath}/migrations`
  try {
    if (!fs.existsSync(migDir)) { fs.mkdirSync(migDir, { recursive: true }); return res.json([]) }
    const files = fs.readdirSync(migDir)
      .filter(f => f.endsWith('.sql') || f.endsWith('.zip'))
      .map(f => {
        const st = fs.statSync(path.join(migDir, f))
        return { name: f, size: st.size, modifiedAt: st.mtime.toISOString() }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json(files)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── POST /api/supabase/:id/migrations/upload (store migration) ───────────────
router.post('/:id/migrations/upload', upload.single('migration'), async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  if (!req.file) return res.status(400).json({ error: 'No SQL file uploaded' })

  const migDir = `${project.composePath}/migrations`
  try {
    fs.mkdirSync(migDir, { recursive: true })
    const targetPath = path.join(migDir, req.file.originalname)
    fs.copyFileSync(req.file.path, targetPath)
    fs.unlinkSync(req.file.path)
    res.json({ success: true, message: 'Migration uploaded' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/supabase/:id/migrations/run  (run selected files) ──────────────
router.post('/:id/migrations/run', async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const { files } = req.body  // array of filenames to run
  if (!files || !files.length) return res.status(400).json({ error: 'files array required' })

  const migDir = `${project.composePath}/migrations`
  const results = []
  for (const fname of files) {
    const fpath = path.join(migDir, path.basename(fname))  // prevent path traversal
    if (!fs.existsSync(fpath)) { results.push({ file: fname, success: false, error: 'File not found' }); continue }
    try {
      const { stdout, stderr, code } = await ssh.exec(
        `cat "${fpath}" | docker compose -f ${project.composePath}/docker-compose.yml exec -T db psql -U postgres`,
        { timeout: 60000, ignoreErrors: true }
      )
      results.push({ file: fname, success: code === 0, output: stdout || stderr })
    } catch (e) {
      results.push({ file: fname, success: false, error: e.message })
    }
  }
  res.json({ results })
})

// ── GET /api/supabase/:id/backups ──────────────────────────────────────────────
router.get('/:id/backups', (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const backupsDir = `${project.composePath}/backups`
  try {
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true })
      return res.json([])
    }
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.endsWith('.sql'))
      .map(f => {
        const st = fs.statSync(path.join(backupsDir, f))
        return { name: f, size: st.size, modifiedAt: st.mtime.toISOString() }
      })
      .sort((a, b) => b.name.localeCompare(a.name)) // newest first
    res.json(files)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/supabase/:id/backups/create ──────────────────────────────────────
router.post('/:id/backups/create', async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const backupsDir = `${project.composePath}/backups`
  fs.mkdirSync(backupsDir, { recursive: true })
  
  const filename = `backup-${Date.now()}.sql`
  const targetPath = path.join(backupsDir, filename)

  try {
    // pg_dump with explicit exclusions for internal Supabase schemas to avoid conflicts
    const cmd = `docker compose -f ${project.composePath}/docker-compose.yml exec -T db pg_dump -U postgres --quote-all-identifiers --exclude-schema=auth --exclude-schema=storage --exclude-schema=extensions --exclude-schema=graphql --exclude-schema=graphql_public --exclude-schema=realtime --exclude-schema=_realtime --exclude-schema=supabase_functions --exclude-schema=vault --exclude-schema=pgbouncer postgres > "${targetPath}" 2>&1`
    
    const result = await ssh.exec(cmd, { timeout: 300000 })
    
    // Verify file was written and is not empty
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
      res.json({ success: true, message: 'Backup created successfully', filename })
    } else {
      // Clean up empty file if any
      try { fs.unlinkSync(targetPath) } catch {}
      res.status(500).json({ error: 'pg_dump failed to write backup file', details: result.stdout || result.stderr })
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/supabase/:id/backups/:filename/restore ──────────────────────────
router.post('/:id/backups/:filename/restore', async (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const { filename } = req.params
  const backupsDir = `${project.composePath}/backups`
  const targetPath = path.join(backupsDir, path.basename(filename))

  if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Backup file not found' })

  try {
    // Sanitize the backup SQL natively using cleanSqlContent to guarantee no conflict
    const rawSql = fs.readFileSync(targetPath, 'utf8')
    const sanitizedSql = cleanSqlContent(rawSql)
    
    const tempSanitized = `/tmp/supabase-restore-${uuidv4()}.sql`
    fs.writeFileSync(tempSanitized, sanitizedSql, 'utf8')

    // Execute the sanitized SQL restore against the database container
    const cmd = `cat "${tempSanitized}" | docker compose -f ${project.composePath}/docker-compose.yml exec -T db psql -U postgres`
    const result = await ssh.exec(cmd, { timeout: 300000 })
    
    // Cleanup temp sanitized file
    try { fs.unlinkSync(tempSanitized) } catch {}

    if (result.code === 0) {
      res.json({ success: true, message: 'Database restored successfully' })
    } else {
      res.status(500).json({ error: 'Restore execution failed', details: result.stderr })
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/supabase/:id/backups/:filename (Download Backup) ──────────────────
router.get('/:id/backups/:filename', (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const { filename } = req.params
  const backupsDir = `${project.composePath}/backups`
  const targetPath = path.join(backupsDir, path.basename(filename))

  if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Backup file not found' })

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Type', 'application/sql')
  res.sendFile(targetPath)
})

// ── DELETE /api/supabase/:id/backups/:filename ────────────────────────────────
router.delete('/:id/backups/:filename', (req, res) => {
  const projects = loadProjects()
  const project = projects.find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const { filename } = req.params
  const backupsDir = `${project.composePath}/backups`
  const targetPath = path.join(backupsDir, path.basename(filename))

  if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Backup file not found' })

  try {
    fs.unlinkSync(targetPath)
    res.json({ success: true, message: 'Backup file deleted' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// ── POST /api/supabase/:id/proxy ──────────────────────────────────────────────
router.post('/:id/proxy', async (req, res) => {
  const { id } = req.params
  const { apiDomain, studioDomain } = req.body

  if (!apiDomain && !studioDomain) {
    return res.status(400).json({ error: 'At least one domain must be provided' })
  }

  const projects = loadProjects()
  const projectIndex = projects.findIndex(p => p.id === id)
  const builtin = detectBuiltinProject()
  
  let project
  if (projectIndex !== -1) {
    project = projects[projectIndex]
  } else if (builtin && builtin.id === id) {
    project = builtin
  }

  if (!project) return res.status(404).json({ error: 'Project not found' })

  const results = []
  
  const setupNginxProxy = async (domain, port, typeLabel) => {
    const nginxConf = `server {
    listen 80;
    server_name ${domain};
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}`
    
    const availablePath = `/etc/nginx/sites-available/${domain}`
    const enabledPath = `/etc/nginx/sites-enabled/${domain}`
    
    fs.writeFileSync(availablePath, nginxConf, 'utf8')
    try {
      execSync(`ln -sf ${availablePath} ${enabledPath}`)
      execSync('nginx -t')
      execSync('systemctl reload nginx')
      results.push(`✓ Nginx reverse proxy configured for ${typeLabel} (${domain} -> :${port})`)
      return true
    } catch (e) {
      // Rollback symlink if Nginx config validation failed
      try { fs.unlinkSync(enabledPath) } catch {}
      try { fs.unlinkSync(availablePath) } catch {}
      throw new Error(`Failed to configure ${typeLabel} proxy: ${e.message}`)
    }
  }

  try {
    if (apiDomain) {
      const port = project.kongPort || 8000
      await setupNginxProxy(apiDomain.trim(), port, 'API Gateway')
      project.apiUrl = `http://${apiDomain.trim()}`
    }

    if (studioDomain) {
      const port = project.studioPort || 3000
      await setupNginxProxy(studioDomain.trim(), port, 'Studio Dashboard')
      project.studioUrl = `http://${studioDomain.trim()}`
    }

    // Save project if it's a persistent project
    if (projectIndex !== -1) {
      projects[projectIndex] = project
      saveProjects(projects)
    }

    res.json({ success: true, results, apiUrl: project.apiUrl, studioUrl: project.studioUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Helper to dynamically resolve database container IP to bypass pooler (Supavisor) connection restrictions on the host
const getDatabaseHost = (project) => {
  try {
    const containerName = `${project.name}-db`
    const ip = execSync(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${containerName} 2>/dev/null`)
      .toString()
      .trim()
    if (ip) {
      logger.info(`Resolved DB container IP for project ${project.name}: ${ip}`)
      return ip
    }
  } catch (e) {
    logger.warn(`Could not resolve DB container IP for project ${project.name}: ${e.message}`)
  }
  return '127.0.0.1' // fallback
}

// ── POST /api/supabase/:id/query ──────────────────────────────────────────────
router.post('/:id/query', async (req, res) => {
  const { id } = req.params
  const { sql } = req.body

  if (!sql || !sql.trim()) {
    return res.status(400).json({ error: 'SQL query required' })
  }

  const projects = loadProjects()
  const projectIndex = projects.findIndex(p => p.id === id)
  const builtin = detectBuiltinProject()
  
  let project
  if (projectIndex !== -1) {
    project = projects[projectIndex]
  } else if (builtin && builtin.id === id) {
    project = builtin
  }

  if (!project) return res.status(404).json({ error: 'Project not found' })

  let connStr = project.dbConn
  if (connStr && project.dbPort) {
    const dbHost = getDatabaseHost(project)
    connStr = connStr.replace(/@[\d\.]+(:\d+)?\//, `@${dbHost}:${project.dbPort}/`)
  }

  const { Client } = require('pg')
  const client = new Client({ connectionString: connStr })

  try {
    await client.connect()
    const result = await client.query(sql)
    
    res.json({
      success: true,
      command: result.command,
      rowCount: result.rowCount,
      fields: result.fields ? result.fields.map(f => f.name) : [],
      rows: result.rows || []
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    try { await client.end() } catch {}
  }
})


// Helper to determine functions directory
const getFunctionsDir = (composePath) => {
  const candidates = [
    `${composePath}/volumes/functions`,
    `${composePath}/functions`,
    `${composePath}/supabase/functions`
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  if (fs.existsSync(`${composePath}/volumes`)) {
    return `${composePath}/volumes/functions`
  }
  return `${composePath}/functions`
}

// ── POST /api/supabase/:id/functions/create ────────────────────────────────────
router.post('/:id/functions/create', async (req, res) => {
  const { id } = req.params
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'Function name required' })

  const builtin = detectBuiltinProject()
  const allProjects = [...(builtin ? [builtin] : []), ...loadProjects()]
  const project = allProjects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  try {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const fnBaseDir = getFunctionsDir(project.composePath)
    const newFnDir = path.join(fnBaseDir, cleanName)

    if (fs.existsSync(newFnDir)) {
      return res.status(409).json({ error: `Function "${cleanName}" already exists` })
    }

    fs.mkdirSync(newFnDir, { recursive: true })
    const boilerplate = `// Deno Edge Function: ${cleanName}
Deno.serve(async (req) => {
  const { name } = await req.json().catch(() => ({ name: "World" }));
  const payload = {
    message: \`Hello \${name}! Welcome to Deno Edge Runtime!\`,
    timestamp: new Date().toISOString()
  };
  
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" }
  });
});
`
    fs.writeFileSync(path.join(newFnDir, 'index.ts'), boilerplate, 'utf8')
    res.json({ success: true, name: cleanName })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/supabase/:id/functions/delete ────────────────────────────────────
router.post('/:id/functions/delete', async (req, res) => {
  const { id } = req.params
  const { names } = req.body
  if (!names || !names.length) return res.status(400).json({ error: 'names array required' })

  const builtin = detectBuiltinProject()
  const allProjects = [...(builtin ? [builtin] : []), ...loadProjects()]
  const project = allProjects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  try {
    const fnBaseDir = getFunctionsDir(project.composePath)
    for (const name of names) {
      const targetDir = path.join(fnBaseDir, path.basename(name))
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true })
      }
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/supabase/:id/functions/upload-zip ────────────────────────────────
router.post('/:id/functions/upload-zip', upload.single('zipFile'), async (req, res) => {
  const { id } = req.params
  const builtin = detectBuiltinProject()
  const allProjects = [...(builtin ? [builtin] : []), ...loadProjects()]
  const project = allProjects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  if (!req.file) return res.status(400).json({ error: 'No zip file uploaded' })

  try {
    const fnBaseDir = getFunctionsDir(project.composePath)
    fs.mkdirSync(fnBaseDir, { recursive: true })

    const zipPath = req.file.path
    const { stdout, stderr, code } = await ssh.exec(
      `unzip -o "${zipPath}" -d "${fnBaseDir}" 2>&1`,
      { timeout: 120000, ignoreErrors: true }
    )

    try { fs.unlinkSync(zipPath) } catch {}

    if (code !== 0) {
      throw new Error(`Unzip failed: ${stderr || stdout}`)
    }

    res.json({ success: true, output: stdout || 'Functions unzipped successfully' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/supabase/:id/functions/deploy ────────────────────────────────────
router.post('/:id/functions/deploy', async (req, res) => {
  const { id } = req.params
  const builtin = detectBuiltinProject()
  const allProjects = [...(builtin ? [builtin] : []), ...loadProjects()]
  const project = allProjects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  try {
    const composeFile = `${project.composePath}/docker-compose.yml`
    const { stdout, stderr } = await ssh.exec(
      `docker compose -f ${composeFile} restart edge-runtime 2>&1`,
      { timeout: 60000, ignoreErrors: true }
    )
    res.json({ success: true, output: stdout || stderr })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/supabase/:id/restore ────────────────────────────────────────────
router.post('/:id/restore', upload.single('restoreFile'), async (req, res) => {
  const { id } = req.params
  const builtin = detectBuiltinProject()
  const allProjects = [...(builtin ? [builtin] : []), ...loadProjects()]
  const project = allProjects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  if (!req.file) return res.status(400).json({ error: 'No backup SQL file provided' })

  try {
    const localPath = req.file.path
    const containerSqlPath = '/tmp/restore.sql'

    // Find active database container name/id
    const { stdout: containerId } = await ssh.exec(
      `docker ps -qf "name=${project.id}-db" | head -1`,
      { timeout: 10000 }
    )

    const dbContainer = containerId.trim()
    if (!dbContainer) {
      return res.status(400).json({ error: 'Supabase database container is not running.' })
    }

    // 1. Copy the sql script into the running DB docker container
    await ssh.exec(`docker cp "${localPath}" "${dbContainer}:${containerSqlPath}"`)

    // 2. Drop public schema to ensure fresh restore and no key/relationship collisions
    await ssh.exec(
      `docker exec -i "${dbContainer}" psql -U postgres -d postgres -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"`
    )

    // 3. Execute the sql restore inside the container
    const restoreExec = await ssh.exec(
      `docker exec -i "${dbContainer}" psql -U postgres -d postgres -f "${containerSqlPath}"`,
      { timeout: 300000 }
    )

    // Cleanup local tmp upload and container tmp file
    await ssh.exec(`rm -f "${localPath}"`)
    await ssh.exec(`docker exec -i "${dbContainer}" rm -f "${containerSqlPath}"`, { ignoreErrors: true })

    if (restoreExec.stderr && restoreExec.stderr.includes('FATAL')) {
      return res.status(500).json({ error: restoreExec.stderr })
    }

    res.json({ success: true, message: 'Database schema and contents successfully restored!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/supabase/:id/start|stop|restart ─────────────────────────────────
router.post('/:id/:action', async (req, res) => {
  const { id, action } = req.params
  const allProjects = loadProjects()
  const project = allProjects.find(p => p.id === id)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  try {
    const composePath = project.composePath
    const composeFile = `${composePath}/docker-compose.yml`
    let cmd
    if (action === 'start') {
      // --no-wait: don't fail if analytics/logflare health check is slow
      cmd = `docker compose -f ${composeFile} up -d --no-wait 2>&1`
    } else if (action === 'stop') {
      cmd = `docker compose -f ${composeFile} stop 2>&1`
    } else if (action === 'restart') {
      cmd = `docker compose -f ${composeFile} restart 2>&1`
    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` })
    }

    const result = await ssh.exec(cmd, { ignoreErrors: true, timeout: 180000 })
    const newStatus = action === 'start' ? 'running' : action === 'stop' ? 'stopped' : 'running'
    saveProjects(allProjects.map(p => p.id === id ? { ...p, status: newStatus } : p))
    res.json({ success: true, output: (result.stdout || '') + (result.stderr || '') })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
