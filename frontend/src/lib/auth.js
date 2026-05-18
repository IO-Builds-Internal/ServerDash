/**
 * ServerDash local auth client — completely standalone, no Supabase dependency.
 * Token is stored in localStorage and attached to every API request.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4001'
const TOKEN_KEY = 'serverdash_token'

export const localAuth = {
  // ── Persist token ──────────────────────────────────────────────────────────
  getToken() {
    return localStorage.getItem(TOKEN_KEY)
  },
  setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  },

  // ── Sign in ────────────────────────────────────────────────────────────────
  async signIn(email, password) {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Login failed')
    this.setToken(data.token)
    return data
  },

  // ── Sign out ───────────────────────────────────────────────────────────────
  async signOut() {
    const token = this.getToken()
    if (token) {
      try {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {}
    }
    this.setToken(null)
  },

  // ── Verify current token ───────────────────────────────────────────────────
  async getSession() {
    const token = this.getToken()
    if (!token) return null
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const d = await res.json()
        if (d.code === 'token_expired') this.setToken(null)
        return null
      }
      return await res.json()
    } catch {
      return null   // network error — don't log out, session may still be valid
    }
  },
}
