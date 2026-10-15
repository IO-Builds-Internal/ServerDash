/**
 * Apple Passkey / WebAuthn Authentication Routes
 * Implements the apple-passkey-auth skill pattern.
 * Single-admin model: first registration locks permanently.
 * Sessions stored in SQLite. Token sent as httpOnly cookie.
 */
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const logger = require('../logger')

// ── SQLite DB setup ──────────────────────────────────────────────────────────
let Database
try {
  Database = require('better-sqlite3')
} catch {
  logger.error('[WebAuthn] better-sqlite3 not installed. Run: npm install better-sqlite3')
}

const DB_DIR = path.join(__dirname, '..', '..', 'data')
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

let db = null
function getDb() {
  if (!db && Database) {
    db = new Database(path.join(DB_DIR, 'auth.db'))
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_passkey (
        id           INTEGER PRIMARY KEY,
        credential_id TEXT UNIQUE NOT NULL,
        public_key   TEXT NOT NULL,
        sign_count   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS users (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        username         TEXT UNIQUE NOT NULL,
        display_name     TEXT,
        role             TEXT NOT NULL DEFAULT 'admin',
        status           TEXT NOT NULL DEFAULT 'pending',
        is_primary_admin INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT DEFAULT (datetime('now')),
        approved_at      TEXT,
        approved_by      TEXT
      );
      CREATE TABLE IF NOT EXISTS passkey_credentials (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        credential_id TEXT UNIQUE NOT NULL,
        public_key    TEXT NOT NULL,
        sign_count    INTEGER NOT NULL DEFAULT 0,
        device_name   TEXT,
        created_at    TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_invites (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_token TEXT UNIQUE NOT NULL,
        username     TEXT,
        role         TEXT NOT NULL DEFAULT 'view_only',
        created_by   INTEGER,
        expires_at   INTEGER NOT NULL,
        used         INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER,
        role       TEXT DEFAULT 'admin',
        expires_at INTEGER NOT NULL
      );
    `)

    try { db.exec('ALTER TABLE admin_sessions ADD COLUMN user_id INTEGER;') } catch {}
    try { db.exec("ALTER TABLE admin_sessions ADD COLUMN role TEXT DEFAULT 'admin';") } catch {}

    // Backwards compatibility migration: ensure existing primary admin is synced to users and passkey_credentials
    try {
      const existingAdmin = db.prepare('SELECT * FROM admin_passkey LIMIT 1').get()
      if (existingAdmin) {
        let primaryUser = db.prepare('SELECT * FROM users WHERE is_primary_admin = 1 LIMIT 1').get()
        if (!primaryUser) {
          const res = db.prepare(`
            INSERT INTO users (username, display_name, role, status, is_primary_admin, approved_at)
            VALUES ('admin', 'Primary Admin', 'admin', 'active', 1, datetime('now'))
          `).run()
          primaryUser = { id: res.lastInsertRowid }
        }
        const existingCred = db.prepare('SELECT * FROM passkey_credentials WHERE credential_id = ?').get(existingAdmin.credential_id)
        if (!existingCred) {
          db.prepare(`
            INSERT INTO passkey_credentials (user_id, credential_id, public_key, sign_count, device_name)
            VALUES (?, ?, ?, ?, 'Primary Device')
          `).run(primaryUser.id, existingAdmin.credential_id, existingAdmin.public_key, existingAdmin.sign_count)
        }
      }
    } catch (e) {
      logger.error('[WebAuthn] Migration error:', e.message)
    }

    // Clean up expired sessions on startup
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now())
  }
  return db
}

// ── @simplewebauthn/server lazy load ────────────────────────────────────────
let webauthn = null
async function getWebAuthn() {
  if (!webauthn) {
    try {
      webauthn = await import('@simplewebauthn/server')
    } catch {
      throw new Error('@simplewebauthn/server not installed. Run: npm install @simplewebauthn/server')
    }
  }
  return webauthn
}

// ── In-memory challenge store (ChallengeId-keyed, TTL 5 min) ──────────────────
const CHALLENGES = new Map()
function storeChallenge(challengeId, challenge) {
  CHALLENGES.set(challengeId, { challenge, time: Date.now() })
}
function popChallenge(challengeId) {
  if (!challengeId) return null
  const entry = CHALLENGES.get(challengeId)
  CHALLENGES.delete(challengeId)
  if (!entry || Date.now() - entry.time > 300000) return null
  return entry.challenge
}

// SD-12 / Problem L: Periodic cleanup of expired challenges (every 2 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of CHALLENGES.entries()) {
    if (now - entry.time > 300000) {
      CHALLENGES.delete(key)
    }
  }
}, 120000).unref()

// ── Helpers ──────────────────────────────────────────────────────────────────
function getRpIdAndOrigin(req) {
  const allowedList = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (process.env.VPS_HOST) {
    allowedList.push(`http://${process.env.VPS_HOST}`, `https://${process.env.VPS_HOST}`)
  }

  let configuredRpId = process.env.RP_ID
  if (!configuredRpId && process.env.VPS_HOST) {
    configuredRpId = process.env.VPS_HOST
  }
  if (!configuredRpId && allowedList.length > 0) {
    try { configuredRpId = new URL(allowedList[0]).hostname } catch {}
  }

  const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(':')[0]
  const rpId = configuredRpId || hostHeader

  // SD-24: Strictly validate allowed origins against configured origins (never blind req.headers.origin)
  const origins = new Set(allowedList)
  if (configuredRpId) {
    origins.add(`http://${configuredRpId}`)
    origins.add(`https://${configuredRpId}`)
  }

  // Include loopback for local development
  origins.add('http://localhost:5173')
  origins.add('http://127.0.0.1:5173')
  origins.add('http://localhost:4001')
  origins.add('http://127.0.0.1:4001')

  // If no allowed list at all is configured, allow current reverse-proxy host
  if (allowedList.length === 0 && !process.env.VPS_HOST) {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')
    const hostWithPort = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
    origins.add(`${proto}://${hostWithPort}`)
  }

  return { rpId, origin: Array.from(origins) }
}

function getAdminFromDb() {
  try {
    return getDb()?.prepare('SELECT * FROM admin_passkey LIMIT 1').get() || null
  } catch { return null }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function setSessionCookie(res, token) {
  const maxAge = 86400 * 7 // 7 days
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAge * 1000,
    path: '/',
  })
}

function createSession(userId = 1, role = 'admin') {
  const token = crypto.randomBytes(32).toString('hex')
  const hashed = hashToken(token)
  const expiresAt = Date.now() + 86400 * 7 * 1000
  getDb()?.prepare('INSERT INTO admin_sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)').run(hashed, userId, role, expiresAt)
  return token
}

function validateSession(token) {
  if (!token || typeof token !== 'string') return null
  try {
    const hashed = hashToken(token)
    let row = getDb()?.prepare(`
      SELECT s.token, s.expires_at, s.user_id, s.role, u.username, u.status, u.is_primary_admin
      FROM admin_sessions s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.token = ?
    `).get(hashed)
    if (!row) {
      row = getDb()?.prepare(`
        SELECT s.token, s.expires_at, s.user_id, s.role, u.username, u.status, u.is_primary_admin
        FROM admin_sessions s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.token = ?
      `).get(token)
      if (row) {
        // Upgrade legacy plaintext session to hashed
        getDb()?.prepare('UPDATE admin_sessions SET token = ? WHERE token = ?').run(hashed, token)
      }
    }
    if (!row) return null
    if (row.expires_at < Date.now()) {
      getDb()?.prepare('DELETE FROM admin_sessions WHERE token = ?').run(hashed)
      return null
    }
    if (row.status && row.status !== 'active') {
      getDb()?.prepare('DELETE FROM admin_sessions WHERE token = ?').run(hashed)
      return null
    }
    return {
      userId: row.user_id || 1,
      role: row.role || 'admin',
      username: row.username || 'admin',
      isPrimaryAdmin: row.is_primary_admin === 1,
    }
  } catch { return null }
}

// ── Setup Token Verification (SD-03) ─────────────────────────────────────────
function getRequiredSetupToken() {
  if (process.env.SETUP_TOKEN && process.env.SETUP_TOKEN.trim()) {
    return process.env.SETUP_TOKEN.trim()
  }
  const tokenFile = path.join(DB_DIR, '.setup_token')
  if (fs.existsSync(tokenFile)) {
    try {
      const content = fs.readFileSync(tokenFile, 'utf8').trim()
      if (content) return content
    } catch {}
  }
  return null
}

function verifySetupToken(req) {
  const required = getRequiredSetupToken()
  if (!required) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('Registration rejected: SETUP_TOKEN is required on fresh installs')
      return false
    }
    return true
  }
  const provided = req.headers['x-setup-token'] || req.body?.setupToken
  if (!provided || typeof provided !== 'string') return false
  const reqBuf = Buffer.from(required)
  const provBuf = Buffer.from(provided.trim())
  if (reqBuf.length !== provBuf.length) return false
  return crypto.timingSafeEqual(reqBuf, provBuf)
}

function clearSetupTokenFile() {
  const tokenFile = path.join(DB_DIR, '.setup_token')
  if (fs.existsSync(tokenFile)) {
    try { fs.unlinkSync(tokenFile) } catch {}
  }
}

// Admin-only middleware helper for internal routes
function ensureAdmin(req, res, next) {
  const token = req.cookies?.admin_session
  const session = validateSession(token)
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required.' })
  }
  req.adminSession = session
  next()
}

// ── GET /api/auth/status ─────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const token = req.cookies?.admin_session
  const session = validateSession(token)
  const admin = getAdminFromDb()
  const requiresSetupToken = !admin && !!getRequiredSetupToken()

  let pendingCount = 0
  if (session && session.role === 'admin') {
    try {
      const p = getDb()?.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'pending'").get()
      pendingCount = p?.count || 0
    } catch {}
  }

  return res.json({
    initialized: !!admin,
    authenticated: !!session,
    requiresSetupToken,
    user: session ? {
      userId: session.userId,
      username: session.username,
      role: session.role,
      isPrimaryAdmin: session.isPrimaryAdmin,
    } : null,
    pendingCount,
  })
})

// ── GET /api/auth/invite-info (public) ────────────────────────────────────────
router.get('/invite-info', (req, res) => {
  const token = req.query?.token
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ valid: false, error: 'Token missing.' })
  }
  const invite = getDb()?.prepare(`
    SELECT id, username, role, expires_at, used
    FROM user_invites
    WHERE invite_token = ?
  `).get(token.trim())

  if (!invite) {
    return res.json({ valid: false, error: 'Invite token not found.' })
  }
  if (invite.used === 1) {
    return res.json({ valid: false, error: 'This invitation has already been used.' })
  }
  if (invite.expires_at < Date.now()) {
    return res.json({ valid: false, error: 'This invitation has expired.' })
  }
  return res.json({
    valid: true,
    username: invite.username,
    role: invite.role,
    expiresAt: invite.expires_at,
  })
})

// ── GET /api/auth/webauthn/register/options ──────────────────────────────────
router.get('/webauthn/register/options', async (req, res) => {
  try {
    const admin = getAdminFromDb()
    const inviteToken = req.headers['x-invite-token'] || req.query.invite || req.body?.inviteToken

    let isInvite = false
    let invite = null

    if (admin) {
      // Admin is already initialized: an invite token is mandatory to register another user
      if (!inviteToken || typeof inviteToken !== 'string') {
        return res.status(403).json({ 
          error: 'Registration is locked. An invitation token from the administrator is required to add a passkey.',
          requiresInvite: true,
        })
      }
      invite = getDb()?.prepare(`
        SELECT * FROM user_invites 
        WHERE invite_token = ? AND used = 0 AND expires_at > ?
      `).get(inviteToken.trim(), Date.now())

      if (!invite) {
        return res.status(400).json({ error: 'Invite token is invalid, expired, or already used.' })
      }
      isInvite = true
    } else {
      // First admin initialization: require setup token
      if (!verifySetupToken(req)) {
        return res.status(403).json({ error: 'Valid setup token is required to initialize ServerDash passkey.', needsSetupToken: true })
      }
    }

    const wauthn = await getWebAuthn()
    const { rpId, origin } = getRpIdAndOrigin(req)

    const regUserId = isInvite 
      ? Buffer.from(`user_${invite.id}_${Date.now()}`)
      : Buffer.from('admin_primary_01')
    const regUserName = isInvite
      ? (invite.username || `user_${invite.id}`)
      : 'admin@serverdash.internal'
    const regDisplayName = isInvite
      ? (invite.username || `User #${invite.id}`)
      : 'Primary Admin'

    const options = await wauthn.generateRegistrationOptions({
      rpName: 'ServerDash',
      rpID: rpId,
      userID: regUserId,
      userName: regUserName,
      userDisplayName: regDisplayName,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: [],
    })

    const challengeId = crypto.randomBytes(24).toString('hex')
    storeChallenge(challengeId, options.challenge)
    res.cookie('webauthn_challenge_id', challengeId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || process.env.NODE_ENV === 'production',
      maxAge: 300000,
      path: '/',
    })

    logger.info('[WebAuthn] Registration options generated', { rpId, origin, isInvite })
    return res.json({ 
      ...options, 
      isInvite, 
      targetUsername: isInvite ? invite.username : null, 
      targetRole: isInvite ? invite.role : 'admin',
    })
  } catch (err) {
    logger.error('[WebAuthn] register/options error', { error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// ── POST /api/auth/webauthn/register/verify ──────────────────────────────────
router.post('/webauthn/register/verify', async (req, res) => {
  try {
    const admin = getAdminFromDb()
    const inviteToken = req.headers['x-invite-token'] || req.body?.inviteToken
    let isInvite = false
    let invite = null

    if (admin) {
      if (!inviteToken || typeof inviteToken !== 'string') {
        return res.status(403).json({ error: 'Registration is locked. An invitation is required.' })
      }
      invite = getDb()?.prepare(`
        SELECT * FROM user_invites 
        WHERE invite_token = ? AND used = 0 AND expires_at > ?
      `).get(inviteToken.trim(), Date.now())

      if (!invite) {
        return res.status(400).json({ error: 'Invite token is invalid, expired, or already used.' })
      }
      isInvite = true
    } else {
      if (!verifySetupToken(req)) {
        return res.status(403).json({ error: 'Valid setup token is required to initialize ServerDash passkey.', needsSetupToken: true })
      }
    }

    const challengeId = req.cookies?.webauthn_challenge_id
    const expectedChallenge = popChallenge(challengeId)
    res.clearCookie('webauthn_challenge_id', { path: '/' })
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found. Please retry.' })
    }

    const wauthn = await getWebAuthn()
    const { rpId, origin } = getRpIdAndOrigin(req)
    const verification = await wauthn.verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedRPID: rpId,
      expectedOrigin: origin,
      requireUserVerification: true,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration verification failed.' })
    }

    const { credential } = verification.registrationInfo
    const credentialId = typeof credential.id === 'string' ? credential.id : Buffer.from(credential.id).toString('base64url')
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64')
    const counter = credential.counter || 0

    if (!isInvite) {
      // Primary Admin registration
      getDb()?.prepare(
        'INSERT INTO admin_passkey (credential_id, public_key, sign_count) VALUES (?, ?, ?)'
      ).run(credentialId, publicKeyBase64, counter)

      const userRes = getDb()?.prepare(`
        INSERT INTO users (username, display_name, role, status, is_primary_admin, approved_at)
        VALUES ('admin', 'Primary Admin', 'admin', 'active', 1, datetime('now'))
      `).run()
      const userId = userRes.lastInsertRowid

      getDb()?.prepare(`
        INSERT INTO passkey_credentials (user_id, credential_id, public_key, sign_count, device_name)
        VALUES (?, ?, ?, ?, 'Primary Device')
      `).run(userId, credentialId, publicKeyBase64, counter)

      clearSetupTokenFile()

      // Primary admin auto-login
      const token = createSession(userId, 'admin')
      setSessionCookie(res, token)
      logger.info('[WebAuthn] Primary admin passkey registered and session created', { rpId })
      return res.json({ status: 'ok', verified: true, role: 'admin' })
    } else {
      // Invited user registration -> Saved with status 'pending'
      const deviceName = req.body?.deviceName || 'Passkey Device'
      const assignedUsername = invite.username && invite.username.trim() 
        ? invite.username.trim() 
        : `user_${invite.id}`

      // Ensure unique username
      let finalUsername = assignedUsername
      const existingUser = getDb()?.prepare('SELECT id FROM users WHERE username = ?').get(finalUsername)
      if (existingUser) {
        finalUsername = `${assignedUsername}_${Math.floor(1000 + Math.random() * 9000)}`
      }

      const userRes = getDb()?.prepare(`
        INSERT INTO users (username, display_name, role, status, is_primary_admin, created_at)
        VALUES (?, ?, ?, 'pending', 0, datetime('now'))
      `).run(finalUsername, finalUsername, invite.role || 'view_only')
      const userId = userRes.lastInsertRowid

      getDb()?.prepare(`
        INSERT INTO passkey_credentials (user_id, credential_id, public_key, sign_count, device_name)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, credentialId, publicKeyBase64, counter, deviceName)

      // Mark invite as used
      getDb()?.prepare('UPDATE user_invites SET used = 1 WHERE id = ?').run(invite.id)

      logger.info('[WebAuthn] New passkey registered under invite with PENDING status', { 
        userId, 
        username: finalUsername, 
        role: invite.role, 
      })

      // Status is pending — do NOT set session cookie!
      return res.json({ 
        status: 'pending', 
        verified: true, 
        message: 'Passkey registered successfully! Your account is pending administrator approval before you can access the dashboard.',
      })
    }
  } catch (err) {
    logger.error('[WebAuthn] register/verify error', { error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /api/auth/webauthn/login/options ─────────────────────────────────────
router.get('/webauthn/login/options', async (req, res) => {
  try {
    const admin = getAdminFromDb()
    if (!admin) {
      return res.status(400).json({ error: 'No admin registered yet.' })
    }
    const wauthn = await getWebAuthn()
    const { rpId } = getRpIdAndOrigin(req)

    // Collect all passkey credentials registered in the system
    const allCreds = getDb()?.prepare(`
      SELECT credential_id FROM passkey_credentials
    `).all() || []

    const allowList = allCreds.length > 0 
      ? allCreds.map(c => ({ id: c.credential_id, type: 'public-key' }))
      : [{ id: admin.credential_id, type: 'public-key' }]

    const options = await wauthn.generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      allowCredentials: allowList,
    })
    const challengeId = crypto.randomBytes(24).toString('hex')
    storeChallenge(challengeId, options.challenge)
    res.cookie('webauthn_challenge_id', challengeId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || process.env.NODE_ENV === 'production',
      maxAge: 300000,
      path: '/',
    })
    return res.json(options)
  } catch (err) {
    logger.error('[WebAuthn] login/options error', { error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// ── POST /api/auth/webauthn/login/verify ─────────────────────────────────────
router.post('/webauthn/login/verify', async (req, res) => {
  try {
    const challengeId = req.cookies?.webauthn_challenge_id
    const expectedChallenge = popChallenge(challengeId)
    res.clearCookie('webauthn_challenge_id', { path: '/' })
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found. Please retry.' })
    }

    const credentialId = req.body?.id
    if (!credentialId) {
      return res.status(400).json({ error: 'Missing credential ID.' })
    }

    // Look up credential in passkey_credentials joined with users
    let cred = getDb()?.prepare(`
      SELECT c.*, u.id as user_id, u.username, u.role, u.status, u.is_primary_admin
      FROM passkey_credentials c
      JOIN users u ON c.user_id = u.id
      WHERE c.credential_id = ?
    `).get(credentialId)

    // Legacy fallback
    if (!cred) {
      const legacyAdmin = getAdminFromDb()
      if (legacyAdmin && legacyAdmin.credential_id === credentialId) {
        cred = {
          id: legacyAdmin.id,
          user_id: 1,
          credential_id: legacyAdmin.credential_id,
          public_key: legacyAdmin.public_key,
          sign_count: legacyAdmin.sign_count,
          username: 'admin',
          role: 'admin',
          status: 'active',
          is_primary_admin: 1,
        }
      }
    }

    if (!cred) {
      return res.status(404).json({ error: 'Passkey credential not recognized on this server.' })
    }

    // Enforce approval status before verifying cryptographic response
    if (cred.status === 'pending') {
      return res.status(403).json({
        error: 'Your account is pending administrator approval. Please contact the administrator to activate your access.',
        status: 'pending',
      })
    }
    if (cred.status === 'disabled') {
      return res.status(403).json({
        error: 'Your account access has been disabled by the administrator.',
        status: 'disabled',
      })
    }
    if (cred.status === 'rejected') {
      return res.status(403).json({
        error: 'Your registration request was rejected by the administrator.',
        status: 'rejected',
      })
    }

    const wauthn = await getWebAuthn()
    const { rpId, origin } = getRpIdAndOrigin(req)
    let publicKeyBuffer
    try {
      publicKeyBuffer = Buffer.from(cred.public_key, cred.public_key.length % 2 === 0 && !cred.public_key.includes('+') && !cred.public_key.includes('/') && !cred.public_key.includes('=') ? 'hex' : 'base64')
    } catch {
      publicKeyBuffer = Buffer.from(cred.public_key, 'base64')
    }

    const verification = await wauthn.verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedRPID: rpId,
      expectedOrigin: origin,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(publicKeyBuffer),
        counter: cred.sign_count,
      },
      requireUserVerification: true,
    })

    if (!verification.verified) {
      return res.status(401).json({ error: 'Authentication failed — passkey verification rejected.' })
    }

    // Update sign count
    getDb()?.prepare('UPDATE passkey_credentials SET sign_count = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, cred.id)
    if (cred.is_primary_admin === 1) {
      getDb()?.prepare('UPDATE admin_passkey SET sign_count = ? WHERE credential_id = ?')
        .run(verification.authenticationInfo.newCounter, cred.credential_id)
    }

    const token = createSession(cred.user_id, cred.role)
    setSessionCookie(res, token)
    logger.info('[WebAuthn] User authenticated via passkey', { 
      userId: cred.user_id, 
      username: cred.username, 
      role: cred.role, 
    })

    return res.json({ 
      status: 'ok', 
      user: { 
        id: cred.user_id, 
        username: cred.username, 
        role: cred.role, 
        isPrimaryAdmin: cred.is_primary_admin === 1,
      },
    })
  } catch (err) {
    logger.error('[WebAuthn] login/verify error', { error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// ── User Management API Endpoints (Admin Only) ───────────────────────────────

// GET /api/auth/users — list all users
router.get('/users', ensureAdmin, (req, res) => {
  try {
    const users = getDb()?.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.display_name, 
        u.role, 
        u.status, 
        u.is_primary_admin, 
        u.created_at, 
        u.approved_at, 
        u.approved_by,
        COUNT(c.id) as passkey_count
      FROM users u
      LEFT JOIN passkey_credentials c ON u.id = c.user_id
      GROUP BY u.id
      ORDER BY u.is_primary_admin DESC, u.created_at DESC
    `).all() || []
    return res.json(users)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/users/invite — create registration invite
router.post('/users/invite', ensureAdmin, (req, res) => {
  try {
    const { username, role = 'view_only', expiresInHours = 24 } = req.body || {}
    const cleanRole = role === 'admin' ? 'admin' : 'view_only'
    const cleanUsername = (username || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '')
    const hours = Math.max(1, Math.min(168, Number(expiresInHours) || 24))
    const expiresAt = Date.now() + (hours * 3600 * 1000)
    const inviteToken = crypto.randomBytes(24).toString('hex')

    getDb()?.prepare(`
      INSERT INTO user_invites (invite_token, username, role, created_by, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(inviteToken, cleanUsername || null, cleanRole, req.adminSession.userId, expiresAt)

    logger.info('[WebAuthn] User invite generated', { 
      username: cleanUsername, 
      role: cleanRole, 
      createdBy: req.adminSession.username, 
    })

    return res.json({
      status: 'ok',
      inviteToken,
      username: cleanUsername,
      role: cleanRole,
      expiresAt,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// GET /api/auth/invites — list active invites
router.get('/invites', ensureAdmin, (req, res) => {
  try {
    const invites = getDb()?.prepare(`
      SELECT id, invite_token, username, role, expires_at, created_at, used
      FROM user_invites
      WHERE used = 0 AND expires_at > ?
      ORDER BY created_at DESC
    `).all(Date.now()) || []
    return res.json(invites)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// DELETE /api/auth/invites/:id — revoke invite
router.delete('/invites/:id', ensureAdmin, (req, res) => {
  try {
    getDb()?.prepare('DELETE FROM user_invites WHERE id = ?').run(req.params.id)
    return res.json({ status: 'ok' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/users/:id/approve — approve pending user
router.post('/users/:id/approve', ensureAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id)
    const user = getDb()?.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    if (user.status !== 'pending') {
      return res.status(400).json({ error: `User is already ${user.status}.` })
    }

    const newRole = req.body?.role === 'admin' ? 'admin' : (req.body?.role === 'view_only' ? 'view_only' : user.role)

    getDb()?.prepare(`
      UPDATE users 
      SET status = 'active', role = ?, approved_at = datetime('now'), approved_by = ?
      WHERE id = ?
    `).run(newRole, req.adminSession.username, userId)

    logger.info('[WebAuthn] User approved', { 
      userId, 
      username: user.username, 
      role: newRole, 
      approvedBy: req.adminSession.username, 
    })

    return res.json({ status: 'ok', message: `User ${user.username} approved with role ${newRole}.` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/users/:id/reject — reject pending user
router.post('/users/:id/reject', ensureAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id)
    const user = getDb()?.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    if (user.is_primary_admin === 1) {
      return res.status(403).json({ error: 'Cannot reject primary administrator.' })
    }

    getDb()?.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(userId)
    getDb()?.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId)

    logger.info('[WebAuthn] User rejected', { userId, username: user.username })
    return res.json({ status: 'ok', message: `User ${user.username} rejected.` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/users/:id/role — change role
router.post('/users/:id/role', ensureAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id)
    const user = getDb()?.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    if (user.is_primary_admin === 1) {
      return res.status(403).json({ error: 'Cannot change role of primary administrator.' })
    }

    const role = req.body?.role === 'admin' ? 'admin' : 'view_only'
    getDb()?.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId)
    getDb()?.prepare('UPDATE admin_sessions SET role = ? WHERE user_id = ?').run(role, userId)

    logger.info('[WebAuthn] User role updated', { userId, username: user.username, role })
    return res.json({ status: 'ok', role })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/users/:id/toggle-status — active / disabled
router.post('/users/:id/toggle-status', ensureAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id)
    const user = getDb()?.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    if (user.is_primary_admin === 1) {
      return res.status(403).json({ error: 'Cannot disable primary administrator.' })
    }

    const newStatus = user.status === 'active' ? 'disabled' : 'active'
    getDb()?.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, userId)
    if (newStatus === 'disabled') {
      getDb()?.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId)
    }

    logger.info('[WebAuthn] User status toggled', { userId, username: user.username, newStatus })
    return res.json({ status: 'ok', userStatus: newStatus })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// DELETE /api/auth/users/:id — remove user
router.delete('/users/:id', ensureAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id)
    const user = getDb()?.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    if (user.is_primary_admin === 1) {
      return res.status(403).json({ error: 'Cannot delete primary administrator.' })
    }

    getDb()?.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId)
    getDb()?.prepare('DELETE FROM passkey_credentials WHERE user_id = ?').run(userId)
    getDb()?.prepare('DELETE FROM users WHERE id = ?').run(userId)

    logger.info('[WebAuthn] User deleted', { userId, username: user.username })
    return res.json({ status: 'ok', message: `User ${user.username} deleted.` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.cookies?.admin_session
  if (token) {
    try {
      const hashed = hashToken(token)
      getDb()?.prepare('DELETE FROM admin_sessions WHERE token = ? OR token = ?').run(hashed, token)
    } catch {}
  }
  res.clearCookie('admin_session', { path: '/' })
  return res.json({ status: 'logged_out' })
})

// ── POST /api/auth/reset-passkey (emergency reset — requires loopback & secret) ──
router.post('/reset-passkey', (req, res) => {
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)
  if (!isLoopback) {
    return res.status(403).json({ error: 'Reset endpoint only accessible locally via loopback or CLI.' })
  }
  if (process.env.ALLOW_PASSKEY_RESET !== 'true') {
    return res.status(403).json({ error: 'Passkey reset is disabled. Set ALLOW_PASSKEY_RESET=true in .env to enable.' })
  }
  const expectedSecret = process.env.RESET_SECRET || process.env.COOKIE_SECRET
  if (!expectedSecret) {
    return res.status(403).json({ error: 'Passkey reset cannot proceed: RESET_SECRET or COOKIE_SECRET must be configured.' })
  }
  const provided = req.body?.secret || req.headers['x-reset-secret']
  if (!provided || typeof provided !== 'string') {
    return res.status(401).json({ error: 'Reset secret required.' })
  }
  const expBuf = Buffer.from(expectedSecret)
  const provBuf = Buffer.from(provided)
  if (expBuf.length !== provBuf.length || !crypto.timingSafeEqual(expBuf, provBuf)) {
    return res.status(401).json({ error: 'Invalid reset secret.' })
  }
  try {
    getDb()?.exec(`
      DELETE FROM admin_passkey;
      DELETE FROM passkey_credentials;
      DELETE FROM users;
      DELETE FROM user_invites;
      DELETE FROM admin_sessions;
    `)
    res.clearCookie('admin_session', { path: '/' })
    logger.warn('[WebAuthn] All passkeys, users, and sessions reset by authorized reset request')
    return res.json({ status: 'reset', message: 'All passkeys, users, and sessions cleared. Register a new primary passkey.' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.validateSession = validateSession

