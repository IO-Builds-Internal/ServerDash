/**
 * ServerDash local authentication — zero dependency on any Supabase instance.
 * The dashboard issues its own JWTs signed with LOCAL_JWT_SECRET.
 */
const jwt = require('jsonwebtoken')
const logger = require('./logger')

const LOCAL_JWT_SECRET = process.env.LOCAL_JWT_SECRET
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@serverdash.local'

if (!LOCAL_JWT_SECRET) {
  logger.warn('LOCAL_JWT_SECRET not set — all API requests will be rejected')
}

async function authMiddleware(req, res, next) {
  let token = ''

  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '').trim()
  } else if (req.query.token) {
    token = req.query.token.trim()
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  if (!LOCAL_JWT_SECRET) {
    return res.status(503).json({ error: 'Auth not configured (LOCAL_JWT_SECRET missing)' })
  }

  try {
    const payload = jwt.verify(token, LOCAL_JWT_SECRET, { algorithms: ['HS256'] })
    req.user = { id: payload.sub, email: payload.email, role: 'admin' }
    return next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      logger.info('Token expired', { email: ADMIN_EMAIL })
      return res.status(401).json({ error: 'Token expired', code: 'token_expired' })
    }
    logger.warn('Auth failed', { error: err.message })
    return res.status(401).json({ error: 'Invalid token' })
  }
}

module.exports = { authMiddleware }
