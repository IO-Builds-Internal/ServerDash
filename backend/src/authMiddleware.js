/**
 * ServerDash authentication middleware — cookie-based session (Apple Passkey / WebAuthn).
 * Reads the `admin_session` httpOnly cookie set by /api/auth/webauthn/login/verify.
 * No JWT, no localStorage, no Supabase dependency.
 */
const logger = require('./logger')
const { validateSession } = require('./routes/auth-webauthn')

async function authMiddleware(req, res, next) {
  // Allow unauthenticated access for GitHub/GitLab webhooks
  if (req.path.match(/^\/sites\/[^/]+\/webhook$/)) {
    return next()
  }

  const token = req.cookies?.admin_session || req.query?.token

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated. Please sign in with your passkey.' })
  }

  if (!validateSession(token)) {
    // Clear the stale cookie
    res.clearCookie('admin_session', { path: '/' })
    return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'session_expired' })
  }

  req.user = { role: 'admin' }
  return next()
}

module.exports = { authMiddleware }
