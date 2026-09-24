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
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token      TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
    `)
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

// ── In-memory challenge store (IP-keyed, TTL 5 min) ─────────────────────────
const CHALLENGES = new Map()
function storeChallenge(key, challenge) {
  CHALLENGES.set(key, { challenge, time: Date.now() })
}
function popChallenge(key) {
  const entry = CHALLENGES.get(key)
  CHALLENGES.delete(key)
  if (!entry || Date.now() - entry.time > 300000) return null
  return entry.challenge
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getRpIdAndOrigin(req) {
  // Prefer X-Forwarded-Host (behind nginx) over Host header
  const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(':')[0]
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')
  const hostWithPort = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  const computedOrigin = `${proto}://${hostWithPort}`
  
  // Set of accepted origins to prevent reverse proxy/port mismatch rejections
  const origins = Array.from(new Set([
    computedOrigin,
    req.headers.origin,
    `http://${hostHeader}`,
    `https://${hostHeader}`,
    `http://${hostHeader}:5173`,
    `http://${hostHeader}:4001`,
  ].filter(Boolean)))
  
  return { rpId: hostHeader, origin: origins }
}

function getAdminFromDb() {
  try {
    return getDb()?.prepare('SELECT * FROM admin_passkey LIMIT 1').get() || null
  } catch { return null }
}

function setSessionCookie(res, token) {
  const maxAge = 86400 * 7 // 7 days
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAge * 1000,
    path: '/',
  })
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 86400 * 7 * 1000
  getDb()?.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt)
  return token
}

function validateSession(token) {
  if (!token) return false
  try {
    const row = getDb()?.prepare('SELECT expires_at FROM admin_sessions WHERE token = ?').get(token)
    if (!row) return false
    if (row.expires_at < Date.now()) {
      getDb()?.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
      return false
    }
    return true
  } catch { return false }
}

// ── GET /api/auth/status ─────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const token = req.cookies?.admin_session
  const authenticated = validateSession(token)
  const admin = getAdminFromDb()
  return res.json({
    initialized: !!admin,
    authenticated,
  })
})

// ── GET /api/auth/webauthn/register/options ──────────────────────────────────
router.get('/webauthn/register/options', async (req, res) => {
  try {
    if (getAdminFromDb()) {
      return res.status(403).json({ error: 'Registration permanently locked — admin already registered.' })
    }
    const wauthn = await getWebAuthn()
    const { rpId, origin } = getRpIdAndOrigin(req)
    const options = await wauthn.generateRegistrationOptions({
      rpName: 'ServerDash',
      rpID: rpId,
      userID: Buffer.from('admin_primary_01'),
      userName: 'admin@serverdash.internal',
      userDisplayName: 'Primary Admin',
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: [],
    })
    const clientIp = req.ip || req.connection.remoteAddress
    storeChallenge(`reg_${clientIp}`, options.challenge)
    logger.info('[WebAuthn] Registration options generated', { rpId, origin })
    return res.json(options)
  } catch (err) {
    logger.error('[WebAuthn] register/options error', { error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// ── POST /api/auth/webauthn/register/verify ──────────────────────────────────
router.post('/webauthn/register/verify', async (req, res) => {
  try {
    if (getAdminFromDb()) {
      return res.status(403).json({ error: 'Registration permanently locked.' })
    }
    const clientIp = req.ip || req.connection.remoteAddress
    const expectedChallenge = popChallenge(`reg_${clientIp}`)
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
    // Store credential — credential.id is Base64URL string; publicKey is Uint8Array
    const credentialId = typeof credential.id === 'string' ? credential.id : Buffer.from(credential.id).toString('base64url')
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64')
    getDb()?.prepare(
      'INSERT INTO admin_passkey (credential_id, public_key, sign_count) VALUES (?, ?, ?)'
    ).run(credentialId, publicKeyBase64, credential.counter || 0)

    // Auto-login after registration
    const token = createSession()
    setSessionCookie(res, token)
    logger.info('[WebAuthn] Admin passkey registered and session created', { rpId })
    return res.json({ status: 'ok', verified: true })
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
    const options = await wauthn.generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      allowCredentials: [{ id: admin.credential_id, type: 'public-key' }],
    })
    const clientIp = req.ip || req.connection.remoteAddress
    storeChallenge(`login_${clientIp}`, options.challenge)
    return res.json(options)
  } catch (err) {
    logger.error('[WebAuthn] login/options error', { error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// ── POST /api/auth/webauthn/login/verify ─────────────────────────────────────
router.post('/webauthn/login/verify', async (req, res) => {
  try {
    const admin = getAdminFromDb()
    if (!admin) return res.status(400).json({ error: 'Not initialized.' })
    const clientIp = req.ip || req.connection.remoteAddress
    const expectedChallenge = popChallenge(`login_${clientIp}`)
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found. Please retry.' })
    }
    const wauthn = await getWebAuthn()
    const { rpId, origin } = getRpIdAndOrigin(req)
    // Decode stored public key from base64 (or fallback from legacy hex if exists)
    let publicKeyBuffer
    try {
      publicKeyBuffer = Buffer.from(admin.public_key, admin.public_key.length % 2 === 0 && !admin.public_key.includes('+') && !admin.public_key.includes('/') && !admin.public_key.includes('=') ? 'hex' : 'base64')
    } catch {
      publicKeyBuffer = Buffer.from(admin.public_key, 'base64')
    }
    const verification = await wauthn.verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedRPID: rpId,
      expectedOrigin: origin,
      credential: {
        id: admin.credential_id,
        publicKey: new Uint8Array(publicKeyBuffer),
        counter: admin.sign_count,
      },
      requireUserVerification: true,
    })
    if (!verification.verified) {
      return res.status(401).json({ error: 'Authentication failed — passkey verification rejected.' })
    }
    // Update sign count (replay attack prevention)
    getDb()?.prepare('UPDATE admin_passkey SET sign_count = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, admin.id)
    const token = createSession()
    setSessionCookie(res, token)
    logger.info('[WebAuthn] Admin authenticated via passkey', { rpId })
    return res.json({ status: 'ok' })
  } catch (err) {
    logger.error('[WebAuthn] login/verify error', { error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.cookies?.admin_session
  if (token) {
    try { getDb()?.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token) } catch {}
  }
  res.clearCookie('admin_session', { path: '/' })
  return res.json({ status: 'logged_out' })
})

// ── POST /api/auth/reset-passkey (emergency reset — requires env flag) ───────
router.post('/reset-passkey', (req, res) => {
  if (process.env.ALLOW_PASSKEY_RESET !== 'true') {
    return res.status(403).json({ error: 'Passkey reset is disabled. Set ALLOW_PASSKEY_RESET=true in .env to enable.' })
  }
  try {
    getDb()?.exec('DELETE FROM admin_passkey; DELETE FROM admin_sessions;')
    res.clearCookie('admin_session', { path: '/' })
    logger.warn('[WebAuthn] Passkey and all sessions reset by ALLOW_PASSKEY_RESET env flag')
    return res.json({ status: 'reset', message: 'All passkeys and sessions cleared. Register a new passkey.' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.validateSession = validateSession
