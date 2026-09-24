/**
 * ServerDash Passkey & Cookie Auth Client
 * Implements Apple Passkey (iCloud Keychain WebAuthn) helpers and cookie-based session checks.
 */
const API_URL = import.meta.env.VITE_API_URL || ''

// ── Base64URL helpers (WebAuthn uses ArrayBuffers) ───────────────────────────
export function bufferToBase64URL(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function base64URLToBuffer(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export async function checkAuthStatus() {
  try {
    const res = await fetch(`${API_URL}/api/auth/status`, {
      credentials: 'include',
      cache: 'no-store'
    })
    if (!res.ok) return { initialized: false, authenticated: false }
    return await res.json()
  } catch (err) {
    console.error('Auth status check error:', err)
    return { initialized: false, authenticated: false }
  }
}

export const localAuth = {
  getToken() {
    // Cookie is sent automatically by the browser via credentials: 'include'
    return ''
  },
  setToken() {},
  async signIn() {
    return { user: { role: 'admin' } }
  },
  async signOut() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      })
    } catch {}
    document.body.classList.remove('authenticated')
    window.location.reload()
  },
  async getSession() {
    const status = await checkAuthStatus()
    return status.authenticated ? { user: { role: 'admin' } } : null
  }
}
