/**
 * AuthContext — local auth, zero Supabase dependency.
 * Uses /api/auth/login, /api/auth/logout, /api/auth/me on the ServerDash backend.
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { localAuth } from '../lib/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)  // true while verifying stored token

  // On mount: verify any stored token with the backend
  useEffect(() => {
    localAuth.getSession()
      .then(session => {
        if (session) setUser({ email: session.email, role: session.role })
        else setUser(null)
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const signIn = useCallback(async (email, password) => {
    try {
      await localAuth.signIn(email, password)
      // Immediately verify and populate user
      const session = await localAuth.getSession()
      if (session) setUser({ email: session.email, role: session.role })
      return { error: null }
    } catch (err) {
      return { error: { message: err.message } }
    }
  }, [])

  const signOut = useCallback(async () => {
    await localAuth.signOut()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, session: user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
