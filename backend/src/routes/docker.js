const express = require('express')
const router = express.Router()
const Docker = require('dockerode')
const { exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const logger = require('../logger')
const axios = require('axios')

const docker = new Docker({ socketPath: '/var/run/docker.sock' })

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()
  return (data) => res.write(`data: ${data}\n\n`)
}

// ── GET /api/docker/containers ──────────────────────────────────────────────────
router.get('/containers', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true })
    const withStats = await Promise.all(containers.map(async (c) => {
      let cpu = 0, memory = 0
      if (c.State === 'running') {
        try {
          const container = docker.getContainer(c.Id)
          const stats = await container.stats({ stream: false })
          const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
          const sysDelta = (stats.cpu_stats.system_cpu_usage || 1) - (stats.precpu_stats.system_cpu_usage || 0)
          const numCpu = stats.cpu_stats.online_cpus || 1
          cpu = sysDelta > 0 ? parseFloat(((cpuDelta / sysDelta) * numCpu * 100).toFixed(2)) : 0
          memory = parseFloat((stats.memory_stats.usage / 1024 / 1024).toFixed(1))
        } catch { }
      }

      // Extract compose project from labels
      const labels = c.Labels || {}
      const composeProject = labels['com.docker.compose.project'] || null
      const composeService = labels['com.docker.compose.service'] || null

      return {
        id: c.Id.substring(0, 12),
        fullId: c.Id,
        name: c.Names[0]?.replace(/^\//, '') || c.Id.substring(0, 12),
        image: c.Image,
        status: c.State,
        state: c.Status,
        ports: c.Ports?.filter(p => p.PublicPort)
          .map(p => `${p.IP || '0.0.0.0'}:${p.PublicPort}→${p.PrivatePort}/${p.Type}`)
          .filter((v, i, a) => a.indexOf(v) === i) || [],
        composeProject,
        composeService,
        cpu,
        memory,
        created: new Date(c.Created * 1000).toISOString(),
      }
    }))

    // Sort: running first, then by project
    withStats.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'running' ? -1 : 1
      return (a.composeProject || '').localeCompare(b.composeProject || '')
    })

    res.json(withStats)
  } catch (err) {
    logger.error('Docker list error', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/docker/deploy ─────────────────────────────────────────────────────
router.post('/deploy', async (req, res) => {
  const { name, image, ports = [], envVars = [], volumes = [], restartPolicy = 'unless-stopped' } = req.body
  if (!name || !image) return res.status(400).json({ error: 'name and image required' })

  try {
    logger.info('Pulling Docker image', { image })
    await new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => {
        if (err) return reject(err)
        docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve())
      })
    })

    const portBindings = {}
    const exposedPorts = {}
    for (const { key: hostPort, value: containerPort } of ports) {
      if (hostPort && containerPort) {
        exposedPorts[`${containerPort}/tcp`] = {}
        portBindings[`${containerPort}/tcp`] = [{ HostPort: String(hostPort) }]
      }
    }

    const container = await docker.createContainer({
      name,
      Image: image,
      Env: envVars.map(({ key, value }) => `${key}=${value}`).filter(e => e.includes('=')),
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        RestartPolicy: { Name: restartPolicy },
        Binds: volumes.map(({ key, value }) => `${key}:${value}`).filter(b => b.includes(':')),
      },
      Labels: { 'com.docker.compose.project': req.body.composeProject || 'serverdash' },
    })

    await container.start()
    logger.info('Container deployed', { name, image })
    res.json({ success: true, containerId: container.id.substring(0, 12) })
  } catch (err) {
    logger.error('Docker deploy error', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/docker/compose ────────────────────────────────────────────────────
router.post('/compose', async (req, res) => {
  const { name, yaml } = req.body
  if (!name || !yaml) return res.status(400).json({ error: 'name and yaml required' })
  const fs = require('fs')
  const path = require('path')
  try {
    const dir = `/opt/compose/${name}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), yaml)
    const { stdout } = await execAsync(`cd ${dir} && docker compose up -d 2>&1`)
    res.json({ success: true, output: stdout })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/docker/:id/:action ───────────────────────────────────────────────
router.post('/:id/:action', async (req, res) => {
  const { id, action } = req.params
  if (!['start', 'stop', 'restart', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' })
  }
  try {
    const containers = await docker.listContainers({ all: true })
    const found = containers.find(c =>
      c.Id.startsWith(id) || c.Names.some(n => n.replace(/^\//, '') === id)
    )
    if (!found) return res.status(404).json({ error: 'Container not found' })
    const container = docker.getContainer(found.Id)
    if (action === 'remove') {
      if (found.State === 'running') await container.stop()
      await container.remove()
    } else {
      await container[action]()
    }
    logger.info(`Container ${action}`, { id })
    res.json({ success: true })
  } catch (err) {
    logger.error(`Container ${action} error`, { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/docker/:id/logs (SSE) ─────────────────────────────────────────────
router.get('/:id/logs', async (req, res) => {
  const { id } = req.params
  const send = sseSetup(res)
  try {
    const containers = await docker.listContainers({ all: true })
    const found = containers.find(c =>
      c.Id.startsWith(id) || c.Names.some(n => n.replace(/^\//, '') === id)
    )
    if (!found) { send('Container not found'); return res.end() }
    const container = docker.getContainer(found.Id)

    // Last 200 lines
    const logBuf = await container.logs({ stdout: true, stderr: true, tail: 200, follow: false })
    const clean = (buf) => Buffer.isBuffer(buf)
      ? buf.toString('utf8').replace(/[\x00-\x08\x0e-\x1f]/g, '').trim()
      : String(buf)
    const lines = clean(logBuf).split('\n').filter(Boolean)
    lines.forEach(l => send(l))

    // Stream live
    const live = await container.logs({ stdout: true, stderr: true, tail: 0, follow: true })
    live.on?.('data', chunk => { const l = clean(chunk); if (l) send(l) })
    req.on('close', () => { try { live.destroy?.() } catch { } })
  } catch (err) {
    send(`Error: ${err.message}`)
    res.end()
  }
})

// ── GET /api/docker/search?q= ──────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const { q } = req.query
  if (!q) return res.json([])
  try {
    const response = await axios.get(
      `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&page_size=10`,
      { timeout: 8000 }
    )
    res.json(response.data.results.map(r => ({
      name: r.repo_name, description: r.short_description,
      stars: r.star_count, official: r.is_official,
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/docker/images ─────────────────────────────────────────────────────
router.get('/images', async (req, res) => {
  try {
    const images = await docker.listImages()
    res.json(images.map(img => ({
      id: img.Id.substring(7, 19),
      tags: img.RepoTags || ['<none>'],
      size: img.Size,
      created: new Date(img.Created * 1000).toISOString(),
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/docker/networks ───────────────────────────────────────────────────
router.get('/networks', async (req, res) => {
  try {
    const networks = await docker.listNetworks()
    res.json(networks.map(n => ({ id: n.Id.substring(0, 12), name: n.Name, driver: n.Driver, scope: n.Scope })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
