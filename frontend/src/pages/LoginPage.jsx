import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Server, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useBranding } from '../contexts/BrandingContext'

export default function LoginPage() {
  const { user, loading, signIn } = useAuth()
  const { branding } = useBranding()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Navigate to /overview as soon as session is confirmed (covers post-login too)
  useEffect(() => {
    if (!loading && user) navigate('/overview', { replace: true })
  }, [user, loading, navigate])

  // While auth is resolving OR already authenticated — render nothing.
  // ProtectedRoute handles the loading UI for protected pages.
  // Rendering null here prevents any flash of the login form.
  if (loading || user) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error: err } = await signIn(email, password)
    setBusy(false)
    if (err) setError(err.message)
  }

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      background: 'var(--color-background)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, position: 'relative', overflow: 'hidden',
    }}>
      {/* Background glow */}
      <div style={{ position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)', width: '700px', height: '700px', background: 'radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-10%', right: '-5%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: '400px', animation: 'fadeIn 0.4s ease' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 60, height: 60,
            background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
            borderRadius: 18, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', marginBottom: 16,
            boxShadow: '0 0 40px rgba(59,130,246,0.35)',
            overflow: 'hidden'
          }}>
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Server size={26} color="white" />
            )}
          </div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 800, color: 'var(--color-text)', margin: 0, letterSpacing: '-0.03em' }}>
            {branding.appName}
          </h1>
          <p style={{ color: 'var(--color-text-muted)', marginTop: 6, fontSize: '0.9rem' }}>
            VPS Management Dashboard
          </p>
        </div>

        {/* Card */}
        <div className="glass-card" style={{ padding: 28 }}>
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8,
                marginBottom: 20, color: 'var(--color-danger)', fontSize: '0.875rem',
              }}>
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label className="label" htmlFor="email">Email address</label>
              <input
                id="email" type="email" className="input"
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="admin@serverdash.local"
                required autoComplete="email"
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label className="label" htmlFor="password">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password" type={showPw ? 'text' : 'password'} className="input"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--color-text-muted)',
                  cursor: 'pointer', padding: 0, display: 'flex',
                }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit" className="btn btn-primary" disabled={busy}
              style={{ width: '100%', justifyContent: 'center', padding: '11px 20px', fontSize: '0.9375rem' }}
            >
              {busy ? (
                <>
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Signing in…
                </>
              ) : 'Sign In →'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
          {branding.appName} — standalone VPS management
        </p>
      </div>
    </div>
  )
}
