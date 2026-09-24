/**
 * PasskeyAuthModal — Apple Passkey / WebAuthn authentication overlay.
 * Implements the apple-passkey-auth skill pattern:
 * - Zero-flash: modal is visible by default via CSS; hidden once body.authenticated is set
 * - Setup view: first admin registers a passkey (locked after first use)
 * - Login view: subsequent visits authenticate with existing passkey
 * - Enforces platform authenticator (Touch ID / Face ID) for iCloud Keychain sync
 */
import { useState, useEffect } from 'react'
import { Shield, Fingerprint, Lock, AlertCircle } from 'lucide-react'

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
  const [mode, setMode] = useState(initialized ? 'login' : 'setup')

  useEffect(() => {
    setMode(initialized ? 'login' : 'setup')
    setError(null)
  }, [initialized])

  // ── Register new passkey (setup mode) ────────────────────────────────────
  async function handleRegister() {
    setError(null)
    setBusy(true)
    try {
      if (!window.PublicKeyCredential) {
        setError('WebAuthn / Passkeys are not supported in this browser. Please use Safari on macOS or iOS.')
        return
      }
      const optRes = await fetch(`${API_BASE}/api/auth/webauthn/register/options`, { credentials: 'include' })
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

      // Enforce platform authenticator (iCloud Keychain / Touch ID / Face ID)
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
      }

      const verifyRes = await fetch(`${API_BASE}/api/auth/webauthn/register/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!verifyRes.ok) {
        const d = await verifyRes.json()
        setError(d.error || 'Passkey registration failed.')
        return
      }
      onAuthenticated()
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey prompt was dismissed. Please try again and approve the Touch ID / Face ID prompt.')
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
      if (!verifyRes.ok) {
        const d = await verifyRes.json()
        setError(d.error || 'Authentication failed.')
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
        maxWidth: 420,
        background: 'rgba(12, 12, 28, 0.90)',
        border: '1px solid rgba(124,110,245,0.2)',
        borderRadius: 20,
        padding: '36px 32px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,110,245,0.1)',
        animation: 'fadeIn 0.4s ease',
      }}>
        {/* Icon */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 64, height: 64,
            background: 'linear-gradient(135deg, rgba(124,110,245,0.2), rgba(56,217,169,0.15))',
            border: '1px solid rgba(124,110,245,0.3)',
            borderRadius: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
            boxShadow: '0 0 32px rgba(124,110,245,0.2)',
          }}>
            {mode === 'setup'
              ? <Shield size={28} color="#7c6ef5" />
              : <Fingerprint size={28} color="#7c6ef5" />
            }
          </div>

          <h1 style={{ margin: 0, fontSize: '1.375rem', fontWeight: 700, color: '#e8e8f5', letterSpacing: '-0.02em' }}>
            {mode === 'setup' ? 'Initialize Admin Passkey' : 'Admin Authentication'}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: '0.875rem', color: '#7878a0', lineHeight: 1.5 }}>
            {mode === 'setup'
              ? 'Register your Apple Passkey to store it in iCloud Keychain via Touch ID or Face ID. Use Safari for best results.'
              : 'Access is restricted. Authenticate with your registered iCloud Keychain passkey.'
            }
          </p>
        </div>

        {/* Error */}
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

        {/* Setup view */}
        {mode === 'setup' && (
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
        )}

        {/* Login view */}
        {mode === 'login' && (
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
                Waiting for passkey…
              </>
            ) : (
              <>
                <Fingerprint size={17} />
                Authenticate with iCloud Keychain
              </>
            )}
          </button>
        )}

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <span style={{ fontSize: '0.75rem', color: '#4a4a6a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Lock size={11} />
            ServerDash — secured by Apple Passkey
          </span>
        </div>
      </div>
    </div>
  )
}
