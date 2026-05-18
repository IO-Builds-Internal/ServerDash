import { useState, useEffect } from 'react'
import {
  HardDrive, Shield, RefreshCw, Trash2, Key, Info, Check, Copy,
  Plus, Server, AlertTriangle, Play, Square, RotateCw, ExternalLink, FolderOpen
} from 'lucide-react'
import api from '../lib/api'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text || ''
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        ta.style.top = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <button
      onClick={copy}
      style={{
        background: 'var(--color-surface-3)',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: copied ? 'var(--color-success)' : 'var(--color-text-muted)',
        transition: 'all 0.15s'
      }}
      title="Copy value"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

export default function FtpPage() {
  const [status, setStatus] = useState({ installed: false, running: false, status: 'unknown' })
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Create Form State
  const [form, setForm] = useState({ username: '', password: '', directory: '/var/www' })
  // Password Edit State
  const [editingUser, setEditingUser] = useState(null)
  const [newPassword, setNewPassword] = useState('')

  const fetchStatus = async () => {
    try {
      const { data } = await api.get('/api/ftp/status')
      setStatus(data)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    }
  }

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/api/ftp/users')
      setUsers(data)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    }
  }

  const init = async () => {
    setLoading(true)
    setError('')
    setSuccess('')
    await Promise.all([fetchStatus(), fetchUsers()])
    setLoading(false)
  }

  useEffect(() => {
    init()
  }, [])

  const installService = async () => {
    if (!confirm('Are you sure you want to install and configure vsftpd FTP server? This requires system apt privileges.')) {
      return
    }
    setActionBusy(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await api.post('/api/ftp/install')
      setSuccess(data.message || 'vsftpd installed and configured successfully.')
      await init()
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setActionBusy(false)
    }
  }

  const handleServiceAction = async (action) => {
    setActionBusy(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await api.post('/api/ftp/service', { action })
      setSuccess(data.message)
      await fetchStatus()
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setActionBusy(false)
    }
  }

  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let pass = ''
    for (let i = 0; i < 14; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setForm(prev => ({ ...prev, password: pass }))
  }

  const createUser = async (e) => {
    e.preventDefault()
    if (!form.username || !form.password || !form.directory) {
      setError('Please fill out all FTP account form fields.')
      return
    }

    setActionBusy(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await api.post('/api/ftp/users', form)
      setSuccess(data.message)
      setForm({ username: '', password: '', directory: '/var/www' })
      await fetchUsers()
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setActionBusy(false)
    }
  }

  const deleteUser = async (username) => {
    if (!confirm(`Are you absolutely sure you want to delete FTP account '${username}'? The website directory and files will remain fully untouched.`)) {
      return
    }

    setActionBusy(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await api.delete(`/api/ftp/users/${username}`)
      setSuccess(data.message)
      await fetchUsers()
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setActionBusy(false)
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (!newPassword) return

    setActionBusy(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await api.post('/api/ftp/users/password', { username: editingUser, password: newPassword })
      setSuccess(data.message)
      setEditingUser(null)
      setNewPassword('')
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1400, margin: '0 auto', width: '100%' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
            <HardDrive size={26} color="var(--color-primary)" />
            Secure FTP Accounts
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            Provision and manage isolated FTP credentials bound to specific directory scopes with absolute root safety.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={init} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh Manager
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="glass-card" style={{ padding: '14px 20px', background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.15)', color: 'var(--color-danger)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} />
          <span>Error: {error}</span>
        </div>
      )}
      {success && (
        <div className="glass-card" style={{ padding: '14px 20px', background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.15)', color: 'var(--color-success)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Check size={16} />
          <span>{success}</span>
        </div>
      )}

      {/* FTP Daemon Service Control */}
      <div className="glass-card" style={{ padding: 24, display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: status.installed 
              ? (status.running ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)')
              : 'rgba(100,116,139,0.08)',
            border: `1px solid ${status.installed 
              ? (status.running ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)')
              : 'rgba(100,116,139,0.15)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Server size={20} color={status.installed ? (status.running ? 'var(--color-success)' : 'var(--color-warning)') : 'var(--color-text-muted)'} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>FTP Daemon Service Status</h3>
              <span className={`badge ${status.installed ? (status.running ? 'badge-green' : 'badge-orange') : 'badge-red'}`} style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
                {status.installed ? (status.running ? 'Running' : 'Stopped') : 'Not Installed'}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              {status.installed 
                ? `Active vsftpd service listening on port 21 (Secure TLS enabled).`
                : `Install Very Secure FTP Daemon (vsftpd) directly to provision local server FTP users.`
              }
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {!status.installed ? (
            <button className="btn btn-primary" onClick={installService} disabled={actionBusy} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={14} />
              Install FTP Daemon (vsftpd)
            </button>
          ) : (
            <>
              {status.running ? (
                <button className="btn btn-secondary" onClick={() => handleServiceAction('stop')} disabled={actionBusy} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}>
                  <Square size={12} />
                  Stop FTP Service
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => handleServiceAction('start')} disabled={actionBusy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Play size={12} />
                  Start FTP Service
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => handleServiceAction('restart')} disabled={actionBusy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <RotateCw size={12} className={actionBusy ? 'animate-spin' : ''} />
                Restart Service
              </button>
            </>
          )}
        </div>
      </div>

      {status.installed && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 24, alignItems: 'start' }}>
          
          {/* Create FTP User Side */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', fontWeight: 800 }}>Create FTP Account</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Add a secure VPS local FTP account restricted completely to the specified directory.
            </p>

            <form onSubmit={createUser} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="label">FTP Username</label>
                <input
                  type="text"
                  placeholder="ftp_user"
                  value={form.username}
                  onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Password</span>
                  <button type="button" onClick={generatePassword} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                    Generate Secure
                  </button>
                </label>
                <input
                  type="text"
                  placeholder="Click generate or type strong password..."
                  value={form.password}
                  onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="label">Root Directory Bind (Chroot)</label>
                <input
                  type="text"
                  placeholder="e.g. /var/www/html or /root/apps/my-app"
                  value={form.directory}
                  onChange={e => setForm(prev => ({ ...prev, directory: e.target.value }))}
                  className="input"
                  required
                />
                <p style={{ margin: '6px 0 0 0', fontSize: '0.7rem', color: 'var(--color-text-muted)', lineHeight: 1.3 }}>
                  ⚠️ User will be completely locked (chrooted) inside this directory path and cannot escape upwards in the Linux system.
                </p>
              </div>

              <button type="submit" className="btn btn-primary" disabled={actionBusy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}>
                <Plus size={16} />
                Create Account
              </button>
            </form>

            <div style={{ marginTop: 24, borderTop: '1px solid var(--color-border)', paddingTop: 18 }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={13} color="var(--color-primary)" />
                Client Connection details
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.76rem', color: 'var(--color-text-dim)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--color-surface-2)', borderRadius: 6 }}>
                  <span>FTP Host/IP:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{window.location.hostname}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--color-surface-2)', borderRadius: 6 }}>
                  <span>FTP Port:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>21</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--color-surface-2)', borderRadius: 6 }}>
                  <span>FTP Mode:</span>
                  <strong>Passive Mode (Recommended)</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Accounts List Side */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Password edit dialog */}
            {editingUser && (
              <div className="glass-card" style={{ padding: 20, border: '1px solid var(--color-primary)' }}>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Key size={14} color="var(--color-primary)" />
                  Reset Password for '{editingUser}'
                </h3>
                <form onSubmit={changePassword} style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <input
                    type="password"
                    placeholder="Type new secure password..."
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="input"
                    style={{ flex: 1, height: 36, fontSize: '0.8rem' }}
                    required
                  />
                  <button type="submit" className="btn btn-primary" disabled={actionBusy} style={{ height: 36, fontSize: '0.8rem', padding: '0 16px' }}>
                    Save
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingUser(null)} style={{ height: 36, fontSize: '0.8rem', padding: '0 12px' }}>
                    Cancel
                  </button>
                </form>
              </div>
            )}

            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: 20, borderBottom: '1px solid var(--color-border)' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Configured FTP Accounts</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  Isolated FTP boundaries mapped to local Linux accounts.
                </p>
              </div>

              {loading ? (
                <div style={{ padding: 60, textAlign: 'center' }}>
                  <RefreshCw size={24} className="animate-spin" style={{ opacity: 0.3, marginBottom: 8 }} />
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>Querying FTP users lists...</div>
                </div>
              ) : users.length === 0 ? (
                <div style={{ padding: 60, textAlign: 'center' }}>
                  <HardDrive size={30} style={{ opacity: 0.15, marginBottom: 8 }} />
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>No FTP accounts created yet. Use the left form to provision one.</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--color-border)' }}>
                      <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>FTP Username</th>
                      <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Scope Path</th>
                      <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 160 }}>Created</th>
                      <th style={{ padding: '12px 18px', fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 140, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((acc, i) => (
                      <tr key={acc.username} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                        
                        {/* Username with Copy */}
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <strong style={{ fontSize: '0.85rem', color: 'var(--color-text)' }}>{acc.username}</strong>
                            <CopyButton text={acc.username} />
                          </div>
                        </td>

                        {/* Directory Path */}
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--color-primary)', background: 'rgba(99,102,241,0.05)', padding: '2px 6px', borderRadius: 4 }}>
                              {acc.directory}
                            </code>
                            <CopyButton text={acc.directory} />
                          </div>
                        </td>

                        {/* Created Date */}
                        <td style={{ padding: '14px 18px', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
                          {new Date(acc.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => { setEditingUser(acc.username); setNewPassword('') }}
                              style={{ display: 'flex', alignItems: 'center', gap: 4, height: 26, fontSize: '0.7rem', padding: '0 8px' }}
                            >
                              <Key size={11} />
                              Pass
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => deleteUser(acc.username)}
                              style={{ display: 'flex', alignItems: 'center', gap: 4, height: 26, fontSize: '0.7rem', color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)', padding: '0 8px' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                            >
                              <Trash2 size={11} />
                              Delete
                            </button>
                          </div>
                        </td>

                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

          </div>

        </div>
      )}

    </div>
  )
}
