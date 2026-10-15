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

  // Read session token strictly from httpOnly cookie (no query-param token leakage)
  const token = req.cookies?.admin_session

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated. Please sign in with your passkey.' })
  }

  const session = validateSession(token)
  if (!session) {
    // Clear the stale cookie
    res.clearCookie('admin_session', { path: '/' })
    return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'session_expired' })
  }

  req.user = session

  // RBAC enforcement: View-only users are forbidden from mutating system state
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH']
  if (session.role === 'view_only' && mutatingMethods.includes(req.method)) {
    // Exempt logout so view-only users can cleanly sign out
    if (!req.path.includes('/logout')) {
      return res.status(403).json({
        error: 'Permission denied: View-only users cannot perform modifications or command executions.',
        code: 'VIEW_ONLY_RESTRICTED',
      })
    }
  }

  return next()
}

module.exports = { authMiddleware }
