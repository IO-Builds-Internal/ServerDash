const express = require('express')
const router = express.Router()
const { exec, spawn } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const logger = require('../logger')
const multer = require('multer')
const path = require('path')
const fs = require('fs')

const upload = multer({ dest: '/tmp/pkg-uploads/' })

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()
  return (data) => res.write(`data: ${data}\n\n`)
}

// GET /api/packages/list — installed packages
router.get('/list', async (req, res) => {
  try {
    const { stdout } = await execAsync("dpkg-query -W -f='${Package}\t${Version}\t${Installed-Size}\n' 2>/dev/null | head -500")
    const packages = stdout.split('\n').filter(Boolean).map(line => {
      const [name, version, size] = line.split('\t')
      return { name, version, size: size ? `${parseInt(size).toLocaleString()} kB` : '—' }
    }).filter(p => p.name)
    res.json(packages)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/packages/updates — show system runtimes, database, and package updates
router.get('/updates', async (req, res) => {
  try {
    // 1. Get system software versions
    const system = []
    
    // Node.js
    try {
      const { stdout } = await execAsync('node -v')
      system.push({ name: 'Node.js Runtime', current: stdout.trim(), latest: 'v22.22.2', category: 'runtime' })
    } catch {
      system.push({ name: 'Node.js Runtime', current: 'Not Installed', latest: 'v22.22.2', category: 'runtime' })
    }
    
    // Nginx
    try {
      const { stderr } = await execAsync('nginx -v')
      const match = stderr.match(/nginx\/([\d.]+)/)
      system.push({ name: 'Nginx Web Server', current: match ? match[1] : 'Unknown', latest: '1.26.1', category: 'server' })
    } catch {
      system.push({ name: 'Nginx Web Server', current: 'Not Installed', latest: '1.26.1', category: 'server' })
    }
    
    // Docker
    try {
      const { stdout } = await execAsync('docker -v')
      const match = stdout.match(/version\s+([\d.]+)/i)
      system.push({ name: 'Docker Container Engine', current: match ? match[1] : 'Unknown', latest: '26.1.3', category: 'runtime' })
    } catch {
      system.push({ name: 'Docker Container Engine', current: 'Not Installed', latest: '26.1.3', category: 'runtime' })
    }
    
    // MariaDB/MySQL
    try {
      const { stdout } = await execAsync('mysql -V')
      const match = stdout.match(/Distrib\s+([\d.]+[\w-]+)/i)
      system.push({ name: 'MariaDB Database', current: match ? match[1] : 'Unknown', latest: '10.11.8', category: 'database' })
    } catch {
      system.push({ name: 'MariaDB Database', current: 'Not Installed', latest: '10.11.8', category: 'database' })
    }

    // Try fetching actual Node.js release list with small timeout
    try {
      const axios = require('axios')
      const nodeRelease = await axios.get('https://nodejs.org/download/release/index.json', { timeout: 1500 })
      if (nodeRelease.data && nodeRelease.data.length > 0) {
        system[0].latest = nodeRelease.data[0].version
      }
    } catch {}

    // Calculate upgradable flag
    system.forEach(v => {
      v.upgradable = v.current !== 'Not Installed' && 
                     v.current !== 'Unknown' && 
                     v.current.replace('v', '').trim() !== v.latest.replace('v', '').trim()
    })

    // 2. Get upgradable packages from apt-get simulation
    let upgradablePackages = []
    try {
      const { stdout } = await execAsync('apt-get -s upgrade 2>/dev/null')
      const lines = stdout.split('\n')
      for (const line of lines) {
        const match = line.match(/^Inst\s+(\S+)\s+\[([^\]]+)\]\s+\(([^)]+)\)/)
        if (match) {
          upgradablePackages.push({
            name: match[1],
            current: match[2],
            latest: match[3].split(' ')[0]
          })
        }
      }
    } catch {}

    res.json({ system, upgradablePackages })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/packages/search?q= — search apt-cache
router.get('/search', async (req, res) => {
  const { q } = req.query
  if (!q || q.length < 2) return res.json([])
  try {
    const { stdout } = await execAsync(`apt-cache search ${q.replace(/[^a-z0-9\-+.]/gi, '')} 2>/dev/null | head -30`)
    const results = stdout.split('\n').filter(Boolean).map(line => {
      const idx = line.indexOf(' - ')
      return { name: line.substring(0, idx).trim(), description: idx > 0 ? line.substring(idx + 3).trim() : '' }
    }).filter(p => p.name)
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/packages/info?pkg= — package details
router.get('/info', async (req, res) => {
  const { pkg } = req.query
  if (!pkg) return res.status(400).json({ error: 'pkg required' })
  try {
    const { stdout } = await execAsync(`apt-cache show ${pkg.replace(/[^a-z0-9\-+.]/gi, '')} 2>/dev/null | head -30`)
    const fields = {}
    stdout.split('\n').forEach(line => {
      const m = line.match(/^(\w[\w-]*): (.+)/)
      if (m) fields[m[1]] = m[2]
    })
    res.json(fields)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/packages/stream?pkg= — SSE streaming apt install
router.get('/stream', async (req, res) => {
  const { pkg, action = 'install' } = req.query
  if (!pkg || !/^[\w\-\.+]+$/.test(pkg)) return res.status(400).end()

  const send = sseSetup(res)
  send(`${action === 'remove' ? 'Removing' : 'Installing'} ${pkg}…`)

  const cmd = action === 'remove'
    ? `DEBIAN_FRONTEND=noninteractive apt-get remove -y ${pkg} 2>&1`
    : `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg} 2>&1`

  const child = spawn('/bin/bash', ['-c', cmd])
  child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
  child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
  child.on('close', code => {
    send(code === 0 ? `✓ ${pkg} ${action === 'remove' ? 'removed' : 'installed'} successfully` : `✗ Failed (exit ${code})`)
    res.end()
  })
  req.on('close', () => child.kill())
})

// POST /api/packages/apt-update — run apt-get update via SSE
router.get('/update', async (req, res) => {
  const send = sseSetup(res)
  send('Running apt-get update…')
  const child = spawn('/bin/bash', ['-c', 'apt-get update 2>&1'])
  child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
  child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
  child.on('close', code => {
    send(code === 0 ? '✓ Package list updated' : `✗ Failed (exit ${code})`)
    res.end()
  })
})

// GET /api/packages/git-install — clone a package from Git and auto-configure dependencies
router.get('/git-install', async (req, res) => {
  const { repoUrl, dest = '/var/www' } = req.query
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl required' })

  const send = sseSetup(res)
  
  try {
    const repoName = repoUrl.split('/').pop().replace(/\.git$/, '')
    const targetDir = path.join(dest, repoName)
    
    send(`▶ Cloning git repository: ${repoUrl} into ${targetDir}…`)
    
    const cloneChild = spawn('git', ['clone', repoUrl, targetDir])
    
    cloneChild.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
    cloneChild.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
    
    cloneChild.on('close', async (code) => {
      if (code !== 0) {
        send(`✗ Git clone failed with exit code: ${code}`)
        return res.end()
      }
      
      send(`✓ Repository cloned successfully into ${targetDir}`)
      
      const packageJsonExists = fs.existsSync(path.join(targetDir, 'package.json'))
      const requirementsExists = fs.existsSync(path.join(targetDir, 'requirements.txt'))
      const makefileExists = fs.existsSync(path.join(targetDir, 'Makefile'))
      
      if (packageJsonExists) {
        send(`▶ package.json detected! Installing npm production packages…`)
        const npmInstall = spawn('npm', ['install', '--production'], { cwd: targetDir })
        npmInstall.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
        npmInstall.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
        npmInstall.on('close', (npmCode) => {
          send(npmCode === 0 ? `✓ npm dependencies installed successfully!` : `⚠ npm install finished with code ${npmCode}`)
          res.end()
        })
      } else if (requirementsExists) {
        send(`▶ requirements.txt detected! Installing python requirements…`)
        const pipInstall = spawn('pip3', ['install', '-r', 'requirements.txt'], { cwd: targetDir })
        pipInstall.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
        pipInstall.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
        pipInstall.on('close', (pipCode) => {
          send(pipCode === 0 ? `✓ python dependencies installed successfully!` : `⚠ pip3 install finished with code ${pipCode}`)
          res.end()
        })
      } else if (makefileExists) {
        send(`▶ Makefile detected! Compiling package with make…`)
        const makeRun = spawn('make', [], { cwd: targetDir })
        makeRun.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
        makeRun.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
        makeRun.on('close', (makeCode) => {
          send(makeCode === 0 ? `✓ compilation finished successfully!` : `⚠ make finished with code ${makeCode}`)
          res.end()
        })
      } else {
        send(`✓ Git package cloned. No setup.py, requirements.txt, or package.json detected to run automatic build triggers.`)
        res.end()
      }
    })
    
    req.on('close', () => cloneChild.kill())
    
  } catch (err) {
    send(`✗ Failed with error: ${err.message}`)
    res.end()
  }
})

// POST /api/packages/zip — install from .deb or extract .zip/.tar.gz
router.post('/zip', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const tmpPath = req.file.path
  const origName = req.file.originalname
  const ext = path.extname(origName).toLowerCase()
  const dest = req.body.dest || '/usr/local/bin'

  try {
    let output = ''
    if (ext === '.deb') {
      const { stdout, stderr } = await execAsync(`dpkg -i "${tmpPath}" 2>&1`)
      output = stdout + stderr
    } else if (ext === '.zip') {
      fs.mkdirSync(dest, { recursive: true })
      const { stdout, stderr } = await execAsync(`unzip -o "${tmpPath}" -d "${dest}" 2>&1`)
      output = stdout + stderr
    } else if (ext === '.gz' || ext === '.tgz' || origName.endsWith('.tar.gz')) {
      fs.mkdirSync(dest, { recursive: true })
      const { stdout, stderr } = await execAsync(`tar -xzf "${tmpPath}" -C "${dest}" 2>&1`)
      output = stdout + stderr
    } else {
      return res.status(400).json({ error: `Unsupported format: ${ext}` })
    }
    fs.unlinkSync(tmpPath)
    logger.info('Package installed from file', { name: origName, dest })
    res.json({ success: true, output })
  } catch (err) {
    try { fs.unlinkSync(tmpPath) } catch { }
    res.status(500).json({ error: err.message })
  }
})

// POST /api/packages/exec — run arbitrary safe command via SSE
router.get('/exec-stream', async (req, res) => {
  const { command } = req.query
  if (!command) return res.status(400).end()
  const blocked = ['rm -rf /', 'dd if=/dev/zero', 'mkfs', '> /dev/sda', 'format c:']
  if (blocked.some(b => command.includes(b))) return res.status(403).end()

  const send = sseSetup(res)
  send(`$ ${command}`)
  const child = spawn('/bin/bash', ['-c', `${command} 2>&1`])
  child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
  child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)))
  child.on('close', code => { send(`Exit: ${code}`); res.end() })
  req.on('close', () => child.kill())
})

module.exports = router
