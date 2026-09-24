/**
 * AuthContext — Apple Passkey / WebAuthn cookie-based auth.
 * Replaces JWT localStorage token with httpOnly session cookie.
 * Works with /api/auth/status, /api/auth/webauthn/*, /api/auth/logout.
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react'

const AuthContext = createContext(null)

const API_BASE = import.meta.env.VITE_API_URL || ''

async function fetchAuthStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/status`, {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!res.ok) return { initialized: false, authenticated: false }
    return await res.json()
  } catch {
    return { initialized: false, authenticated: false }
  }
}

export function AuthProvider({ children }) {
  // BUG-19 FIX: use distinct `user` and `status` — no more `session: user` alias
  const [user, setUser] = useState(null)           // { role: 'admin' } when authenticated
  const [initialized, setInitialized] = useState(false) // has any passkey been registered?
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const status = await fetchAuthStatus()
    setInitialized(status.initialized)
    if (status.authenticated) {
      setUser({ role: 'admin' })
      // Apply body class for zero-flash CSS gate
      document.body.classList.add('authenticated')
    } else {
      setUser(null)
      document.body.classList.remove('authenticated')
    }
    return status
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const signOut = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {}
    setUser(null)
    document.body.classList.remove('authenticated')
    // Reload to show the passkey modal
    window.location.reload()
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      // BUG-19 FIX: session is now a proper object, not just an alias for user
      session: user ? { user } : null,
      loading,
      initialized,
      signOut,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
