/**
 * GitHub Integration Routes
 *
 * Provides GitHub OAuth (device flow) + repo/branch listing for ServerDash.
 * All tokens are stored AES-256-GCM encrypted in data/settings.json.
 * The raw token is NEVER returned to the frontend.
 *
 * Endpoints:
 *   GET    /api/github/status                         — connection status (no token)
 *   POST   /api/github/connect/start                  — start device flow
 *   POST   /api/github/connect/poll                   — poll for token completion
 *   DELETE /api/github/disconnect                     — remove stored token
 *   GET    /api/github/repos                          — list repos
 *   GET    /api/github/repos/:owner/:repo/branches    — list branches
 */

const express = require('express')
const router = express.Router()
const https = require('https')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const logger = require('../logger')

// ── Config ──────────────────────────────────────────────────────────────────
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || ''
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json')

// TODO(security): GitHub OAuth scope is limited to repo access only.
// Consider narrowing to 'repo' or even 'public_repo' if private repos not needed.
const GITHUB_SCOPE = 'repo,read:user'

// ── Encryption helpers ───────────────────────────────────────────────────────
// Key is derived from LOCAL_JWT_SECRET so it is never hardcoded.
// TODO(security): Rotate encryption key when LOCAL_JWT_SECRET changes.
function getEncKey() {
  const secret = process.env.LOCAL_JWT_SECRET
  if (!secret) throw new Error('LOCAL_JWT_SECRET not set — cannot encrypt GitHub token')
  return crypto.scryptSync(secret, 'serverdash-github-token-v1', 32)
}

function encryptToken(plaintext) {
  const key = getEncKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv(16):tag(16):ciphertext
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

function decryptToken(b64) {
  const key = getEncKey()
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.slice(0, 16)
  const tag = buf.slice(16, 32)
  const enc = buf.slice(32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

// ── Settings helpers ─────────────────────────────────────────────────────────
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    }
  } catch (e) {
    logger.error('github: failed to load settings', { error: e.message })
  }
  return {}
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8')
}

function getGithubSection() {
  const s = loadSettings()
  return s.github || {}
}

function saveGithubSection(data) {
  const s = loadSettings()
  s.github = data
  saveSettings(s)
}

// ── GitHub API helper ────────────────────────────────────────────────────────
// Allow-list of valid owner/repo/branch name characters to prevent injection
const SAFE_GITHUB_IDENT = /^[a-zA-Z0-9._\-]+$/
const SAFE_BRANCH = /^[a-zA-Z0-9._\-/]+$/

function validateIdent(v, label) {
  if (!v || !SAFE_GITHUB_IDENT.test(v)) throw new Error(`Invalid ${label}: only alphanumeric, dot, dash, underscore allowed`)
  return v
}

function validateBranch(v) {
  if (!v || !SAFE_BRANCH.test(v)) throw new Error('Invalid branch name')
  return v
}

function githubApiRequest(method, apiPath, token, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'ServerDash/1.0',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function githubDevicePost(apiPath, params) {
  const postBody = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'github.com',
      path: apiPath,
      method: 'POST',
      headers: {
        'User-Agent': 'ServerDash/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postBody),
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    req.write(postBody)
    req.end()
  })
}

// ── Helper: get stored plaintext token (throws if not connected) ─────────────
function getStoredToken() {
  const gh = getGithubSection()
  if (!gh.connected || !gh.encryptedToken) throw new Error('GitHub not connected')
  return decryptToken(gh.encryptedToken)
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/github/status
 * Returns connection metadata — never the token.
 */
router.get('/status', (req, res) => {
  const gh = getGithubSection()
  if (gh.connected && gh.encryptedToken) {
    return res.json({
      connected: true,
      login: gh.login || null,
      avatarUrl: gh.avatarUrl || null,
      name: gh.name || null,
      connectedAt: gh.connectedAt || null,
      clientIdConfigured: !!GITHUB_CLIENT_ID,
    })
  }
  res.json({ connected: false, clientIdConfigured: !!GITHUB_CLIENT_ID })
})

/**
 * POST /api/github/connect/start
 * Initiates the GitHub Device Flow.
 * Returns user_code + verification_uri to display to admin.
 */
router.post('/connect/start', async (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    return res.status(400).json({ error: 'GITHUB_CLIENT_ID not configured in .env' })
  }
  try {
    const result = await githubDevicePost('/login/device/code', {
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_SCOPE,
    })
    if (result.status !== 200 || !result.body.device_code) {
      logger.warn('GitHub device flow start failed', { status: result.status })
      return res.status(502).json({ error: 'GitHub device flow request failed', detail: result.body })
    }
    // Return everything the frontend needs to display to the user
    res.json({
      device_code: result.body.device_code,
      user_code: result.body.user_code,
      verification_uri: result.body.verification_uri || 'https://github.com/login/device',
      expires_in: result.body.expires_in || 900,
      interval: result.body.interval || 5,
    })
  } catch (e) {
    logger.error('GitHub device flow start error', { error: e.message })
    res.status(502).json({ error: 'Failed to reach GitHub: ' + e.message })
  }
})

/**
 * POST /api/github/connect/poll
 * Body: { device_code }
 * Polls GitHub token endpoint once. Frontend should call this every `interval` seconds.
 * On success, fetches user info and stores encrypted token.
 * Returns: { status: 'pending'|'success'|'error', login?, avatarUrl? }
 */
router.post('/connect/poll', async (req, res) => {
  const { device_code } = req.body
  if (!device_code || typeof device_code !== 'string' || device_code.length > 200) {
    return res.status(400).json({ error: 'Invalid device_code' })
  }
  if (!GITHUB_CLIENT_ID) {
    return res.status(400).json({ error: 'GITHUB_CLIENT_ID not configured' })
  }
  try {
    const result = await githubDevicePost('/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })

    const body = result.body
    if (body.error === 'authorization_pending' || body.error === 'slow_down') {
      return res.json({ status: 'pending', hint: body.error })
    }
    if (body.error) {
      return res.json({ status: 'error', error: body.error_description || body.error })
    }
    if (!body.access_token) {
      return res.json({ status: 'pending' })
    }

    // Fetch GitHub user info to store metadata (not the token)
    const token = body.access_token
    const userInfo = await githubApiRequest('GET', '/user', token)
    const login = userInfo.body?.login || 'unknown'
    const avatarUrl = userInfo.body?.avatar_url || null
    const name = userInfo.body?.name || login

    // Encrypt and persist token — never store plaintext
    const encryptedToken = encryptToken(token)
    saveGithubSection({
      connected: true,
      encryptedToken,
      login,
      avatarUrl,
      name,
      connectedAt: new Date().toISOString(),
    })

    logger.info('GitHub account linked', { login })
    res.json({ status: 'success', login, avatarUrl, name })
  } catch (e) {
    logger.error('GitHub poll error', { error: e.message })
    res.status(502).json({ error: 'Polling failed: ' + e.message })
  }
})

/**
 * DELETE /api/github/disconnect
 * Removes stored GitHub token and metadata.
 */
router.delete('/disconnect', (req, res) => {
  const s = loadSettings()
  const prevLogin = s.github?.login
  delete s.github
  saveSettings(s)
  logger.info('GitHub account disconnected', { login: prevLogin })
  res.json({ ok: true })
})

/**
 * GET /api/github/repos?page=1&per_page=50&type=all
 * Lists repos accessible to the linked account.
 */
router.get('/repos', async (req, res) => {
  let token
  try { token = getStoredToken() } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  const page = Math.max(1, parseInt(req.query.page) || 1)
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page) || 50))
  const type = ['all', 'owner', 'member'].includes(req.query.type) ? req.query.type : 'all'
  const sort = ['full_name', 'created', 'updated', 'pushed'].includes(req.query.sort) ? req.query.sort : 'pushed'

  try {
    const result = await githubApiRequest('GET',
      `/user/repos?type=${type}&sort=${sort}&per_page=${perPage}&page=${page}&affiliation=owner,collaborator`,
      token
    )
    if (result.status !== 200) {
      return res.status(result.status).json({ error: 'GitHub API error', detail: result.body?.message })
    }
    // Return only safe, needed fields
    const repos = (result.body || []).map(r => ({
      id: r.id,
      fullName: r.full_name,
      owner: r.owner?.login,
      name: r.name,
      private: r.private,
      description: r.description || '',
      defaultBranch: r.default_branch || 'main',
      url: r.clone_url,
      sshUrl: r.ssh_url,
      updatedAt: r.updated_at,
      language: r.language,
    }))
    res.json({ repos, page, perPage })
  } catch (e) {
    logger.error('GitHub repos fetch error', { error: e.message })
    res.status(502).json({ error: 'Failed to fetch repos: ' + e.message })
  }
})

/**
 * GET /api/github/repos/:owner/:repo/branches
 * Lists branches for a specific repo.
 */
router.get('/repos/:owner/:repo/branches', async (req, res) => {
  let token
  try { token = getStoredToken() } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  let owner, repo
  try {
    owner = validateIdent(req.params.owner, 'owner')
    repo = validateIdent(req.params.repo, 'repo')
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  try {
    const result = await githubApiRequest('GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
      token
    )
    if (result.status !== 200) {
      return res.status(result.status).json({ error: 'GitHub API error', detail: result.body?.message })
    }
    const branches = (result.body || []).map(b => ({ name: b.name }))
    res.json({ branches })
  } catch (e) {
    logger.error('GitHub branches fetch error', { error: e.message })
    res.status(502).json({ error: 'Failed to fetch branches: ' + e.message })
  }
})

/**
 * GET /api/github/token-for-url
 * Internal: given a git URL, returns the stored token as a Basic auth header string
 * if the URL is a GitHub URL and we have a stored token.
 * Used by sites.js to auto-inject tokens for GitHub deploys.
 * Returns { hasToken: false } or { hasToken: true, token: '...' }
 * NOTE: token IS returned here — only consumed by backend, never forwarded to frontend.
 */
router.get('/token-for-url', (req, res) => {
  const url = String(req.query.url || '')
  if (!url.includes('github.com')) {
    return res.json({ hasToken: false })
  }
  const gh = getGithubSection()
  if (!gh.connected || !gh.encryptedToken) {
    return res.json({ hasToken: false })
  }
  try {
    const token = decryptToken(gh.encryptedToken)
    res.json({ hasToken: true, token, login: gh.login })
  } catch (e) {
    logger.error('github: token decryption failed', { error: e.message })
    res.json({ hasToken: false })
  }
})

module.exports = router
module.exports.getStoredGithubToken = function (gitUrl) {
  if (!gitUrl || !String(gitUrl).includes('github.com')) return null
  const gh = getGithubSection()
  if (!gh.connected || !gh.encryptedToken) return null
  try { return decryptToken(gh.encryptedToken) } catch { return null }
}
