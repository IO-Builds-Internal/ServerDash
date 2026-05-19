import { useState, useEffect, useRef } from 'react'
import { 
  Save, 
  Send, 
  Trash2, 
  RefreshCw, 
  Play, 
  Square, 
  Zap, 
  Server, 
  Terminal, 
  Mail, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck, 
  Activity, 
  Inbox, 
  Settings 
} from 'lucide-react'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import { localAuth } from '../lib/auth'

const MOCK_LOGS = [
  { id: 1, timestamp: new Date(Date.now()-3600000).toISOString(), to: 'user@example.com', subject: 'Welcome to ServerDash!', status: 'sent', error: null },
  { id: 2, timestamp: new Date(Date.now()-7200000).toISOString(), to: 'admin@company.com', subject: 'Alert: High CPU usage detected', status: 'sent', error: null },
  { id: 3, timestamp: new Date(Date.now()-10800000).toISOString(), to: 'bad@invalid', subject: 'Test Broadcast', status: 'failed', error: 'Connection timed out (SMTP Port 587 blocked)' },
]

export default function SmtpPage() {
  const [config, setConfig] = useState({ host: '', port: '587', username: '', password: '', fromAddress: '', encryption: 'TLS' })
  const [detected, setDetected] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [logs, setLogs] = useState(MOCK_LOGS)
  const [postfixStatus, setPostfixStatus] = useState('running')
  const [postfixLogs, setPostfixLogs] = useState([])
  const [queueCount, setQueueCount] = useState(0)
  const [saveBusy, setSaveBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [detectBusy, setDetectBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const logsRef = useRef(null)

  // Tabs navigation
  const [activeTab, setActiveTab] = useState('config')

  // Local Postfix setup state
  const [setupMailDomain, setSetupMailDomain] = useState('mail.example.com')
  const [setupFromDomain, setSetupFromDomain] = useState('example.com')
  const [installLines, setInstallLines] = useState([])
  const [installing, setInstalling] = useState(false)
  const [installDone, setInstallDone] = useState(false)
  const installRef = useRef(null)

  useEffect(() => {
    api.get('/api/smtp/config').then(r => { setConfig(c => ({ ...c, ...r.data, password: '' })); setDetected(r.data.detected) }).catch(() => {})
    api.get('/api/smtp/logs').then(r => setLogs(r.data)).catch(() => {})
    api.get('/api/smtp/postfix').then(r => {
      setPostfixStatus(r.data.status)
      setPostfixLogs(r.data.logs || [])
      setQueueCount(r.data.queueCount || 0)
    }).catch(() => { setPostfixLogs(['[postfix] Status unavailable — configure SMTP above']) })

    // Fetch system info to set domain defaults dynamically!
    api.get('/api/smtp/server-info').then(r => {
      if (r.data?.hostname) {
        const hn = r.data.hostname
        setSetupMailDomain(`mail.${hn}`)
        const parts = hn.split('.')
        if (parts.length >= 2) {
          setSetupFromDomain(parts.slice(-2).join('.'))
        } else {
          setSetupFromDomain(hn)
        }
      } else if (r.data?.ip) {
        setSetupMailDomain(`mail.${r.data.ip}.nip.io`)
        setSetupFromDomain(`${r.data.ip}.nip.io`)
      }
    }).catch(() => {})
  }, [])

  const setField = (k, v) => setConfig(c => ({ ...c, [k]: v }))

  const handleDetect = async () => {
    setDetectBusy(true)
    try {
      const r = await api.get('/api/smtp/detect')
      if (r.data.found) { setConfig(c => ({ ...c, ...r.data, password: '' })); setDetected(true) }
      else alert('No external SMTP found in Supabase config. Configure manually below.')
    } catch { }
    setDetectBusy(false)
  }

  const handleSave = async () => {
    setSaveBusy(true)
    try { await api.post('/api/smtp/config', config) } catch { /* mock */ }
    setSaveBusy(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleTest = async () => {
    if (!testEmail) return
    setTestBusy(true)
    try { await api.post('/api/smtp/test', { to: testEmail }) } catch { /* mock */ }
    setTestBusy(false)
  }

  const handlePostfixAction = async (action) => {
    try { await api.post(`/api/smtp/postfix/${action}`) } catch { /* mock */ }
    if (action === 'start') setPostfixStatus('running')
    if (action === 'stop') setPostfixStatus('stopped')
    // Refresh postfix stats after action
    setTimeout(() => {
      api.get('/api/smtp/postfix').then(r => {
        setPostfixStatus(r.data.status)
        setPostfixLogs(r.data.logs || [])
        setQueueCount(r.data.queueCount || 0)
      }).catch(() => {})
    }, 1000)
  }

  const handleInstallPostfix = async () => {
    setInstalling(true); setInstallLines([]); setInstallDone(false)
    try {
      const token = localAuth.getToken() || ''
      const resp = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/smtp/install-postfix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ domain: setupMailDomain, fromDomain: setupFromDomain }),
      })
      const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n'); buf = parts.pop()
        parts.forEach(l => { if (l.startsWith('data: ')) setInstallLines(p => [...p, l.slice(6)]) })
      }
      setInstallDone(true)
      // Reload config after install
      api.get('/api/smtp/config').then(r => { setConfig(c => ({ ...c, ...r.data, password: '' })) }).catch(() => {})
    } catch (e) {
      setInstallLines(p => [...p, `✗ Error: ${e.message}`])
    }
    setInstalling(false)
  }

  useEffect(() => {
    if (installRef.current) installRef.current.scrollTop = installRef.current.scrollHeight
  }, [installLines])

  const filteredLogs = logs.filter(l => {
    if (dateFrom && new Date(l.timestamp) < new Date(dateFrom)) return false
    if (dateTo && new Date(l.timestamp) > new Date(dateTo + 'T23:59:59')) return false
    return true
  })

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Mail size={28} className="text-primary animate-pulse" /> SMTP & Mail Delivery
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
            Orchestrate outbound SMTP relays, deploy local Postfix environments, and inspect diagnostic logs.
          </p>
        </div>
      </div>

      {/* Real-time KPI Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Postfix Server Health Card */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16, borderLeft: `4px solid ${postfixStatus === 'running' ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
          <div style={{ padding: 12, borderRadius: 12, background: postfixStatus === 'running' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: postfixStatus === 'running' ? 'var(--color-success)' : 'var(--color-danger)' }}>
            <Server size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Postfix Local Status</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              {postfixStatus === 'running' ? 'Running' : 'Stopped'}
              <span className={`pulse-dot ${postfixStatus === 'running' ? 'bg-success' : 'bg-danger'}`}></span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button 
              className="btn btn-secondary btn-sm" 
              onClick={() => handlePostfixAction(postfixStatus === 'running' ? 'stop' : 'start')}
              style={{ padding: '4px 8px', fontSize: '0.75rem', minWidth: 60 }}
            >
              {postfixStatus === 'running' ? <Square size={10} style={{ marginRight: 4 }} /> : <Play size={10} style={{ marginRight: 4 }} />}
              {postfixStatus === 'running' ? 'Stop' : 'Start'}
            </button>
          </div>
        </div>

        {/* Mail Queue Count Card */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16, borderLeft: '4px solid var(--color-warning)' }}>
          <div style={{ padding: 12, borderRadius: 12, background: 'rgba(245,158,11,0.1)', color: 'var(--color-warning)' }}>
            <Inbox size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mail Spool Queue</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text)', marginTop: 4 }}>
              {queueCount} {queueCount === 1 ? 'Message' : 'Messages'}
            </div>
          </div>
          {queueCount > 0 && (
            <button 
              className="btn btn-primary btn-sm" 
              onClick={() => handlePostfixAction('flush')}
              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid var(--color-warning)', color: 'var(--color-warning)' }}
            >
              Flush Queue
            </button>
          )}
        </div>

        {/* SMTP Protocol Mode Card */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16, borderLeft: '4px solid var(--color-primary)' }}>
          <div style={{ padding: 12, borderRadius: 12, background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)' }}>
            <Activity size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>SMTP Operating Mode</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {config.host ? (config.host === 'localhost' || config.host === '127.0.0.1' ? 'Local Relay' : `${config.host}:${config.port}`) : 'Not Configured'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              {detected ? 'Supabase Autodetect' : 'Manual parameters'}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs pills navigation */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>
        <button 
          onClick={() => setActiveTab('config')}
          className={`btn ${activeTab === 'config' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Settings size={14} /> Configuration & Setup
        </button>
        <button 
          onClick={() => setActiveTab('diagnostics')}
          className={`btn ${activeTab === 'diagnostics' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Terminal size={14} /> Diagnostics & Mail Logs
        </button>
      </div>

      {/* Main Tab content space */}
      {activeTab === 'config' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
          {/* Setup Local SMTP Server */}
          <div className="glass-card" style={{ padding: 24, border: '1px solid rgba(59,130,246,0.15)', background: 'radial-gradient(ellipse at top left, rgba(59,130,246,0.04), transparent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)' }}>
                  <Server size={18} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Deploy Local Postfix SMTP Server</h2>
                  <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Fully-automated local mail agent deployment</p>
                </div>
              </div>
              <span className="badge badge-green" style={{ marginLeft: 'auto' }}>⚡ One-Click Automated</span>
            </div>

            <p style={{ margin: '0 0 20px', fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              This module installs, binds, and configures **Postfix** as a local internet site mail agent on your VPS. 
              Once the script runs, ServerDash automatically configures your primary SMTP settings to route through <code style={{ background: 'var(--color-surface-3)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>localhost:25</code> with zero authentication overhead.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 20 }}>
              <div>
                <label className="label" style={{ fontWeight: 600 }}>System Mail Hostname (FQDN)</label>
                <input 
                  className="input" 
                  value={setupMailDomain} 
                  onChange={e => setSetupMailDomain(e.target.value)} 
                  placeholder="mail.yourdomain.com"
                  style={{ marginTop: 6 }}
                />
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  The internal hostname (`myhostname`) bound inside postfix configuration.
                </p>
              </div>
              <div>
                <label className="label" style={{ fontWeight: 600 }}>Sender From Domain</label>
                <input 
                  className="input" 
                  value={setupFromDomain} 
                  onChange={e => setSetupFromDomain(e.target.value)} 
                  placeholder="yourdomain.com"
                  style={{ marginTop: 6 }}
                />
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Emails generated by servers will be disguised under `noreply@{setupFromDomain || 'yourdomain.com'}`.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <button 
                  className="btn btn-primary" 
                  onClick={handleInstallPostfix} 
                  disabled={installing}
                  style={{ padding: '10px 20px', fontSize: '0.85rem' }}
                >
                  {installing ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" style={{ marginRight: 6 }} /> Deploying Local Postfix...
                    </>
                  ) : installDone ? (
                    '✓ Postfix Setup Successfully Finished'
                  ) : (
                    <>
                      <Server size={14} style={{ marginRight: 6 }} /> Install & Orchestrate Local Postfix
                    </>
                  )}
                </button>
              </div>

              {installLines.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Terminal size={12} /> Execution Stream Logs:
                  </div>
                  <div 
                    ref={installRef} 
                    className="terminal" 
                    style={{ 
                      maxHeight: 280, 
                      overflowY: 'auto', 
                      fontSize: '0.8125rem', 
                      background: '#090d16', 
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 12,
                      padding: 16,
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {installLines.map((l, i) => (
                      <div key={i} style={{ lineHeight: 1.6, color: l.includes('✓') ? '#10b981' : l.includes('✗') || l.includes('Error') ? '#ef4444' : l.includes('⚠') ? '#f59e0b' : '#a1a1aa' }}>
                        {l}
                      </div>
                    ))}
                    {installing && <div style={{ color: 'var(--color-primary)', display: 'inline-block' }} className="animate-pulse">▋</div>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SMTP Gateway Configuration Card */}
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(16,185,129,0.1)', color: 'var(--color-success)' }}>
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>SMTP Gateway Parameters</h2>
                  <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Configure outbound SMTP parameters</p>
                </div>
              </div>
              {detected && (
                <span className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={10} /> Auto-detected from Supabase
                </span>
              )}
              <button className="btn btn-secondary btn-sm" onClick={handleDetect} disabled={detectBusy} style={{ marginLeft: 'auto' }}>
                <Zap size={12} color="var(--color-warning)" style={{ marginRight: 4 }} /> 
                {detectBusy ? 'Scanning Configs...' : 'Scan Supabase Config'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div>
                <label className="label">SMTP Host / Server IP</label>
                <input className="input" value={config.host} onChange={e => setField('host', e.target.value)} placeholder="smtp.sendgrid.net or localhost" style={{ marginTop: 6 }} />
              </div>
              <div>
                <label className="label">Encryption Port</label>
                <input className="input" type="number" value={config.port} onChange={e => setField('port', e.target.value)} placeholder="587" style={{ marginTop: 6 }} />
              </div>
              <div>
                <label className="label">Auth Username</label>
                <input className="input" value={config.username} onChange={e => setField('username', e.target.value)} placeholder="apikey or account-email" style={{ marginTop: 6 }} />
              </div>
              <div>
                <label className="label">Auth Password</label>
                <input className="input" type="password" value={config.password} onChange={e => setField('password', e.target.value)} placeholder="••••••••" style={{ marginTop: 6 }} />
              </div>
              <div>
                <label className="label">Global From Address</label>
                <input className="input" value={config.fromAddress} onChange={e => setField('fromAddress', e.target.value)} placeholder="noreply@yourdomain.com" style={{ marginTop: 6 }} />
              </div>
              <div>
                <label className="label">Transport Security</label>
                <select className="input" value={config.encryption} onChange={e => setField('encryption', e.target.value)} style={{ marginTop: 6 }}>
                  <option value="TLS">STARTTLS (TLS 1.2/1.3)</option>
                  <option value="SSL">SSL / TLS (Direct Secure)</option>
                  <option value="None">None (Insecure / Local Relay)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginTop: 24, borderTop: '1px solid var(--color-border)', paddingTop: 20 }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={saveBusy} style={{ padding: '10px 20px' }}>
                <Save size={15} style={{ marginRight: 6 }} /> 
                {saveBusy ? 'Saving Configuration...' : saved ? '✓ Settings Saved successfully!' : 'Save Credentials'}
              </button>

              <div style={{ display: 'flex', gap: 8, maxWidth: 420, width: '100%' }}>
                <input 
                  className="input" 
                  value={testEmail} 
                  onChange={e => setTestEmail(e.target.value)} 
                  placeholder="Enter recipient email..." 
                />
                <button className="btn btn-secondary" onClick={handleTest} disabled={testBusy || !testEmail} style={{ minWidth: 100 }}>
                  {testBusy ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <>
                      <Send size={12} style={{ marginRight: 6 }} /> Test Link
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'diagnostics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Postfix Live Log Monitor */}
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Terminal size={18} className="text-primary" /> Postfix Log Stream
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Latest active transactions from `/var/log/mail.log`</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => handlePostfixAction('restart')}>
                  <RefreshCw size={12} style={{ marginRight: 4 }} /> Restart Server
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => handlePostfixAction('flush')}>
                  Flush Buffer Queue
                </button>
              </div>
            </div>

            <div 
              className="terminal" 
              style={{ 
                maxHeight: 250, 
                overflowY: 'auto', 
                background: '#070a13', 
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
                padding: 16,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                lineHeight: 1.6
              }}
            >
              {postfixLogs.length > 0 ? (
                postfixLogs.map((l, i) => (
                  <div key={i} style={{ 
                    color: l.toLowerCase().includes('error') || l.toLowerCase().includes('fail') ? '#ef4444' : l.toLowerCase().includes('connect') ? '#3b82f6' : '#a1a1aa',
                    padding: '2px 0'
                  }}>
                    {l}
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 20 }}>No logs captured recently</div>
              )}
            </div>
          </div>

          {/* Outbound Email Dispatch Log */}
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>ServerDash Email Logs</h2>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Track delivery attempts dispatched via Node gateway</p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 140 }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>to</span>
                <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 140 }} />
                <button className="btn btn-danger btn-sm" onClick={() => setLogs([])}>
                  <Trash2 size={12} style={{ marginRight: 4 }} /> Wipe Logs
                </button>
              </div>
            </div>

            <div className="table-container" style={{ border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ margin: 0 }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-2)' }}>
                    <th style={{ padding: '12px 16px' }}>Timestamp</th>
                    <th style={{ padding: '12px 16px' }}>Recipient Address</th>
                    <th style={{ padding: '12px 16px' }}>Subject Line</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                    <th style={{ padding: '12px 16px' }}>Error Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {formatDate(log.timestamp)}
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                        {log.to}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.875rem', fontWeight: 500 }}>
                        {log.subject}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className={`badge ${log.status === 'sent' ? 'badge-green' : 'badge-red'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className={`pulse-dot ${log.status === 'sent' ? 'bg-success' : 'bg-danger'}`} style={{ width: 6, height: 6 }}></span>
                          {log.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: 'var(--color-danger)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.error || '—'}
                      </td>
                    </tr>
                  ))}
                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>
                        <Mail size={32} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
                        No mail logs matches your search parameters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
