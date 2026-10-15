/**
 * PasskeyAuthModal — Apple Passkey / WebAuthn authentication overlay.
 * Implements the apple-passkey-auth skill pattern:
 * - Zero-flash: modal is visible by default via CSS; hidden once body.authenticated is set
 * - Setup view: first admin registers a passkey (locked after first use)
 * - Login view: subsequent visits authenticate with existing passkey
 * - Enforces platform authenticator (Touch ID / Face ID) for iCloud Keychain sync
 */
import { useState, useEffect } from 'react'
import { Shield, Fingerprint, Lock, AlertCircle, CheckCircle, UserPlus, ArrowRight, Clock } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || ''

// ── Base64URL helpers (WebAuthn uses ArrayBuffers) ───────────────────────────
function bufferToBase64URL(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64URLToBuffer(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export default function PasskeyAuthModal({ initialized, onAuthenticated }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [inviteToken, setInviteToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('invite') || ''
    } catch {
      return ''
    }
  })
  const [inviteInfo, setInviteInfo] = useState(null)
  const [mode, setMode] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get('invite')) return 'invite'
    } catch {}
    return initialized ? 'login' : 'setup'
  })
  const [setupToken, setSetupToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('setupToken') || ''
    } catch {
      return ''
    }
  })
  const [registeredPendingUser, setRegisteredPendingUser] = useState(null)

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const inv = urlParams.get('invite')
    if (inv) {
      setInviteToken(inv)
      setMode('invite')
      fetchInviteInfo(inv)
    } else {
      setMode(initialized ? 'login' : 'setup')
    }
    setError(null)
  }, [initialized])

  const fetchInviteInfo = async (token) => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/auth/invite-info?token=${encodeURIComponent(token.trim())}`)
      const data = await res.json()
      if (data.valid) {
        setInviteInfo(data)
      } else {
        setError(data.error || 'Invalid or expired invitation token.')
      }
    } catch {
      // ignore network errors on info check
    }
  }

  // ── Register new passkey (setup mode or invite mode) ──────────────────────
  async function handleRegister() {
    setError(null)
    setBusy(true)
    try {
      if (!window.PublicKeyCredential) {
        setError('WebAuthn / Passkeys are not supported in this browser. Please use Safari, Chrome, Edge, or a platform supporting biometrics.')
        return
      }

      const isInviteMode = mode === 'invite'
      const tokenVal = isInviteMode ? inviteToken.trim() : setupToken.trim()
      const optHeaders = {}
      if (isInviteMode) {
        if (!tokenVal) {
          setError('Please enter your invitation token.')
          return
        }
        optHeaders['x-invite-token'] = tokenVal
      } else if (tokenVal) {
        optHeaders['x-setup-token'] = tokenVal
      }

      const optUrl = `${API_BASE}/api/auth/webauthn/register/options`
      const optRes = await fetch(optUrl, { 
        headers: optHeaders,
        credentials: 'include',
      })
      if (!optRes.ok) {
        const d = await optRes.json()
        setError(d.error || 'Failed to get registration options.')
        return
      }
      const options = await optRes.json()

      // Convert binary fields
      options.challenge = base64URLToBuffer(options.challenge)
      options.user.id = base64URLToBuffer(options.user.id)
      if (options.excludeCredentials) {
        options.excludeCredentials.forEach(c => { c.id = base64URLToBuffer(c.id) })
      }

      // Enforce platform authenticator (iCloud Keychain / Touch ID / Face ID / Windows Hello)
      options.authenticatorSelection = {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      }

      const credential = await navigator.credentials.create({ publicKey: options })
      const payload = {
        id: credential.id,
        rawId: bufferToBase64URL(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64URL(credential.response.clientDataJSON),
          attestationObject: bufferToBase64URL(credential.response.attestationObject),
        },
        deviceName: `${navigator.platform || 'Device'} (${navigator.userAgent.includes('Mac') ? 'Mac/Apple' : 'PC'})`,
      }

      const verifyHeaders = { 'Content-Type': 'application/json' }
      if (isInviteMode) {
        payload.inviteToken = tokenVal
        verifyHeaders['x-invite-token'] = tokenVal
      } else if (tokenVal) {
        payload.setupToken = tokenVal
        verifyHeaders['x-setup-token'] = tokenVal
      }

      const verifyRes = await fetch(`${API_BASE}/api/auth/webauthn/register/verify`, {
        method: 'POST',
        headers: verifyHeaders,
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const verifyData = await verifyRes.json()
      if (!verifyRes.ok) {
        setError(verifyData.error || 'Passkey registration failed.')
        return
      }

      if (verifyData.status === 'pending') {
        // Invited user is now registered and pending admin approval!
        setRegisteredPendingUser(options.userName || inviteInfo?.username || 'user')
        setMode('pending_success')
        // Clean invite from URL
        try {
          const url = new URL(window.location)
          url.searchParams.delete('invite')
          window.history.replaceState({}, '', url)
        } catch {}
      } else {
        // Primary admin registered & logged in
        onAuthenticated()
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey prompt was dismissed. Please try again and approve the Touch ID / biometric prompt.')
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  // ── Authenticate with existing passkey (login mode) ───────────────────────
  async function handleLogin() {
    setError(null)
    setBusy(true)
    try {
      if (!window.PublicKeyCredential) {
        setError('WebAuthn / Passkeys are not supported in this browser.')
        return
      }
      const optRes = await fetch(`${API_BASE}/api/auth/webauthn/login/options`, { credentials: 'include' })
      if (!optRes.ok) {
        const d = await optRes.json()
        setError(d.error || 'Failed to get authentication options.')
        return
      }
      const options = await optRes.json()

      options.challenge = base64URLToBuffer(options.challenge)
      if (options.allowCredentials) {
        options.allowCredentials.forEach(c => { c.id = base64URLToBuffer(c.id) })
      }

      const assertion = await navigator.credentials.get({ publicKey: options })
      const payload = {
        id: assertion.id,
        rawId: bufferToBase64URL(assertion.rawId),
        type: assertion.type,
        response: {
          clientDataJSON: bufferToBase64URL(assertion.response.clientDataJSON),
          authenticatorData: bufferToBase64URL(assertion.response.authenticatorData),
          signature: bufferToBase64URL(assertion.response.signature),
          userHandle: assertion.response.userHandle ? bufferToBase64URL(assertion.response.userHandle) : null,
        },
      }

      const verifyRes = await fetch(`${API_BASE}/api/auth/webauthn/login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const verifyData = await verifyRes.json()
      if (!verifyRes.ok) {
        setError(verifyData.error || 'Authentication failed.')
        return
      }
      onAuthenticated()
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Authentication was dismissed. Please try again.')
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="auth-modal" style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(2, 6, 23, 0.96)',
      backdropFilter: 'blur(16px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 20,
    }}>
      {/* Ambient glows */}
      <div style={{ position: 'absolute', top: '10%', left: '30%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(124,110,245,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '10%', right: '25%', width: 400, height: 400, background: 'radial-gradient(circle, rgba(56,217,169,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{
        width: '100%',
        maxWidth: 440,
        background: 'rgba(12, 12, 28, 0.90)',
        border: '1px solid rgba(124,110,245,0.2)',
        borderRadius: 20,
        padding: '36px 32px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,110,245,0.1)',
        animation: 'fadeIn 0.4s ease',
      }}>
        {/* Icon & Title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 64, height: 64,
            background: mode === 'pending_success'
              ? 'linear-gradient(135deg, rgba(56,217,169,0.2), rgba(124,110,245,0.15))'
              : 'linear-gradient(135deg, rgba(124,110,245,0.2), rgba(56,217,169,0.15))',
            border: `1px solid ${mode === 'pending_success' ? 'rgba(56,217,169,0.3)' : 'rgba(124,110,245,0.3)'}`,
            borderRadius: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
            boxShadow: '0 0 32px rgba(124,110,245,0.2)',
          }}>
            {mode === 'setup' && <Shield size={28} color="#7c6ef5" />}
            {mode === 'login' && <Fingerprint size={28} color="#7c6ef5" />}
            {mode === 'invite' && <UserPlus size={28} color="#38d9a9" />}
            {mode === 'pending_success' && <CheckCircle size={28} color="#38d9a9" />}
          </div>

          <h1 style={{ margin: 0, fontSize: '1.375rem', fontWeight: 700, color: '#e8e8f5', letterSpacing: '-0.02em' }}>
            {mode === 'setup' && 'Initialize Primary Passkey'}
            {mode === 'login' && 'Passkey Authentication'}
            {mode === 'invite' && 'Register User Passkey'}
            {mode === 'pending_success' && 'Registration Received!'}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: '0.875rem', color: '#7878a0', lineHeight: 1.5 }}>
            {mode === 'setup' && 'Register your primary Apple / biometric Passkey to secure ServerDash. Stored in iCloud Keychain with Touch ID / Face ID.'}
            {mode === 'login' && 'Authenticate seamlessly using Touch ID, Face ID, Windows Hello, or iCloud Keychain.'}
            {mode === 'invite' && 'Create your personal device passkey. Your account will be placed in pending approval by the administrator.'}
            {mode === 'pending_success' && 'Your passkey was recorded. The administrator must approve your access before you can sign in.'}
          </p>
        </div>

        {/* Error / Alert */}
        {error && (
          <div style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '12px 14px',
            background: 'rgba(248, 113, 113, 0.08)',
            border: '1px solid rgba(248, 113, 113, 0.25)',
            borderRadius: 10,
            marginBottom: 20,
          }}>
            <AlertCircle size={16} color="#f87171" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: '0.8125rem', color: '#f87171', lineHeight: 1.5 }}>{error}</span>
          </div>
        )}

        {/* 1. Setup view (Primary admin initialization) */}
        {mode === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a0a0c0', marginBottom: 6, fontWeight: 500 }}>
                Installation Setup Token
              </label>
              <input
                type="text"
                value={setupToken}
                onChange={e => setSetupToken(e.target.value)}
                placeholder="Enter token from install.sh"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(124, 110, 245, 0.3)',
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: '0.875rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#666688', marginTop: 4 }}>
                Generated during install or saved in backend/data/.setup_token
              </span>
            </div>

            <button
              onClick={handleRegister}
              disabled={busy}
              style={{
                width: '100%',
                padding: '13px 20px',
                background: busy ? 'rgba(124,110,245,0.5)' : 'linear-gradient(135deg, #7c6ef5, #6366f1)',
                border: 'none',
                borderRadius: 12,
                color: 'white',
                fontSize: '0.9375rem',
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                transition: 'all 0.2s',
                boxShadow: busy ? 'none' : '0 4px 24px rgba(124,110,245,0.35)',
              }}
            >
              {busy ? (
                <>
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Waiting for Touch ID…
                </>
              ) : (
                <>
                  <Shield size={17} />
                  Save Passkey to iCloud Keychain
                </>
              )}
            </button>
          </div>
        )}

        {/* 2. Login view */}
        {mode === 'login' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <button
              onClick={handleLogin}
              disabled={busy}
              style={{
                width: '100%',
                padding: '13px 20px',
                background: busy ? 'rgba(124,110,245,0.5)' : 'linear-gradient(135deg, #7c6ef5, #6366f1)',
                border: 'none',
                borderRadius: 12,
                color: 'white',
                fontSize: '0.9375rem',
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                transition: 'all 0.2s',
                boxShadow: busy ? 'none' : '0 4px 24px rgba(124,110,245,0.35)',
              }}
            >
              {busy ? (
                <>
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Waiting for Passkey…
                </>
              ) : (
                <>
                  <Fingerprint size={17} />
                  Sign In with Passkey (Touch ID)
                </>
              )}
            </button>

            <button
              onClick={() => { setMode('invite'); setError(null) }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8b8bb8',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                textAlign: 'center',
                padding: '6px 0',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.target.style.color = '#c0c0e8'}
              onMouseLeave={e => e.target.style.color = '#8b8bb8'}
            >
              Received an invitation code? Register Passkey →
            </button>
          </div>
        )}

        {/* 3. Invite registration view */}
        {mode === 'invite' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {inviteInfo && (
              <div style={{
                background: 'rgba(56, 217, 169, 0.08)',
                border: '1px solid rgba(56, 217, 169, 0.25)',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8125rem', color: '#a0d8c0' }}>Invitation for:</span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e8f5f0' }}>{inviteInfo.username || 'New User'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8125rem', color: '#a0d8c0' }}>Assigned Access:</span>
                  <span style={{ 
                    fontSize: '0.75rem', 
                    fontWeight: 600, 
                    color: inviteInfo.role === 'admin' ? '#7c6ef5' : '#38d9a9',
                    background: 'rgba(255,255,255,0.06)',
                    padding: '2px 8px',
                    borderRadius: 6,
                  }}>
                    {inviteInfo.role === 'admin' ? 'Full Administrator' : 'View Only'}
                  </span>
                </div>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a0a0c0', marginBottom: 6, fontWeight: 500 }}>
                Invitation Token / Code
              </label>
              <input
                type="text"
                value={inviteToken}
                onChange={e => {
                  setInviteToken(e.target.value)
                  if (e.target.value.length > 10) fetchInviteInfo(e.target.value)
                }}
                placeholder="Enter invitation token"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(56, 217, 169, 0.3)',
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: '0.875rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              onClick={handleRegister}
              disabled={busy || !inviteToken.trim()}
              style={{
                width: '100%',
                padding: '13px 20px',
                background: busy ? 'rgba(56,217,169,0.5)' : 'linear-gradient(135deg, #10b981, #059669)',
                border: 'none',
                borderRadius: 12,
                color: 'white',
                fontSize: '0.9375rem',
                fontWeight: 600,
                cursor: (busy || !inviteToken.trim()) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                transition: 'all 0.2s',
                boxShadow: busy ? 'none' : '0 4px 24px rgba(16,185,129,0.3)',
              }}
            >
              {busy ? (
                <>
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Saving Passkey on Device…
                </>
              ) : (
                <>
                  <UserPlus size={17} />
                  Register Device Passkey
                </>
              )}
            </button>

            <button
              onClick={() => { setMode('login'); setError(null) }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8b8bb8',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                textAlign: 'center',
                padding: '4px 0',
              }}
            >
              ← Back to Sign In
            </button>
          </div>
        )}

        {/* 4. Pending Approval Success View */}
        {mode === 'pending_success' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
            <div style={{
              background: 'rgba(56, 217, 169, 0.08)',
              border: '1px solid rgba(56, 217, 169, 0.25)',
              borderRadius: 14,
              padding: '18px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#38d9a9', fontWeight: 600, marginBottom: 8 }}>
                <Clock size={18} />
                Status: Pending Admin Approval
              </div>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: '#a0a0c0', lineHeight: 1.5 }}>
                Your passkey has been linked to <strong>{registeredPendingUser}</strong>. The administrator has been notified to review and approve your account.
              </p>
            </div>

            <button
              onClick={() => { setMode('login'); setError(null) }}
              style={{
                width: '100%',
                padding: '12px 18px',
                background: 'linear-gradient(135deg, #7c6ef5, #6366f1)',
                border: 'none',
                borderRadius: 12,
                color: 'white',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Return to Sign In
            </button>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <span style={{ fontSize: '0.75rem', color: '#4a4a6a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Lock size={11} />
            ServerDash — Hardware-bound biometric security
          </span>
        </div>
      </div>
    </div>
  )
}
