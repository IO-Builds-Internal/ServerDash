import { useState, useEffect, useRef } from 'react'
import { Save, Send, Trash2, RefreshCw, Play, Square, Zap, Server, Terminal } from 'lucide-react'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import { localAuth } from '../lib/auth'

const MOCK_LOGS = [
  { id: 1, timestamp: new Date(Date.now()-3600000).toISOString(), to: 'user@example.com', subject: 'Welcome!', status: 'sent', error: null },
  { id: 2, timestamp: new Date(Date.now()-7200000).toISOString(), to: 'admin@company.com', subject: 'Alert: High CPU', status: 'sent', error: null },
  { id: 3, timestamp: new Date(Date.now()-10800000).toISOString(), to: 'bad@invalid', subject: 'Test', status: 'failed', error: 'Connection refused' },
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

  // Local Postfix setup state
  const [setupMailDomain, setSetupMailDomain] = useState('mail.3dprint.iobuilds.com')
  const [setupFromDomain, setSetupFromDomain] = useState('3dprint.iobuilds.com')
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
  }

  const handleInstallPostfix = async () => {
    setInstalling(true); setInstallLines([]); setInstallDone(false)
    try {
      const _token_helper = localAuth.getToken
      const token = session?.access_token || ''
      const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/smtp/install-postfix`, {
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
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>SMTP & Mail</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>Configure email delivery and monitor mail activity</p>
      </div>

      {/* Setup Local Postfix */}
      <div className="glass-card" style={{ padding: 24, border: '1px solid rgba(59,130,246,0.15)', background: 'rgba(59,130,246,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Server size={18} color="var(--color-primary)" />
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Setup Local SMTP Server (Postfix)</h2>
          <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)', fontWeight: 600 }}>One-Click Install</span>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Install and configure Postfix as a local mail server on this VPS. After setup, ServerDash will auto-configure SMTP to use <code style={{ background: 'var(--color-surface-3)', padding: '1px 4px', borderRadius: 3 }}>localhost:25</code>.
          Note: For sending external email reliably, you'll also need reverse DNS (PTR record) and SPF/DKIM configured.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label className="label">Mail Hostname (FQDN)</label>
            <input className="input" value={setupMailDomain} onChange={e => setSetupMailDomain(e.target.value)} placeholder="mail.yourdomain.com" />
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Used as myhostname in Postfix</p>
          </div>
          <div>
            <label className="label">Mail Domain (From domain)</label>
            <input className="input" value={setupFromDomain} onChange={e => setSetupFromDomain(e.target.value)} placeholder="yourdomain.com" />
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Emails will appear as noreply@{setupFromDomain || 'yourdomain.com'}</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleInstallPostfix} disabled={installing} style={{ marginBottom: installLines.length ? 16 : 0 }}>
          <Server size={14} /> {installing ? 'Installing…' : installDone ? '✓ Postfix Installed' : 'Install & Configure Postfix'}
        </button>
        {installLines.length > 0 && (
          <div ref={installRef} className="terminal" style={{ maxHeight: 280, overflowY: 'auto', fontSize: '0.8125rem' }}>
            {installLines.map((l, i) => (
              <div key={i} style={{ lineHeight: 1.6, color: l.includes('✓') ? 'var(--color-success)' : l.includes('✗') || l.includes('Error') ? 'var(--color-danger)' : l.includes('⚠') ? 'var(--color-warning)' : 'var(--color-text)' }}>
                {l}
              </div>
            ))}
            {installing && <div style={{ color: 'var(--color-primary)' }}>▋</div>}
          </div>
        )}
      </div>


      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>SMTP Configuration</h2>
            {detected && <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.1)', color: 'var(--color-success)', fontWeight: 600 }}>✓ Auto-detected from Supabase</span>}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleDetect} disabled={detectBusy}>
            <Zap size={13} color="var(--color-warning)" /> {detectBusy ? 'Detecting…' : 'Auto-Detect from Supabase'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label className="label">SMTP Host</label><input className="input" value={config.host} onChange={e => setField('host', e.target.value)} placeholder="smtp.gmail.com" /></div>
          <div><label className="label">Port</label><input className="input" type="number" value={config.port} onChange={e => setField('port', e.target.value)} placeholder="587" /></div>
          <div><label className="label">Username</label><input className="input" value={config.username} onChange={e => setField('username', e.target.value)} placeholder="user@example.com" /></div>
          <div><label className="label">Password</label><input className="input" type="password" value={config.password} onChange={e => setField('password', e.target.value)} placeholder="••••••••" /></div>
          <div><label className="label">From Address</label><input className="input" value={config.fromAddress} onChange={e => setField('fromAddress', e.target.value)} placeholder="noreply@example.com" /></div>
          <div>
            <label className="label">Encryption</label>
            <select className="input" value={config.encryption} onChange={e => setField('encryption', e.target.value)}>
              <option>TLS</option><option>SSL</option><option>None</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 18, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saveBusy}>
            <Save size={15} /> {saveBusy ? 'Saving…' : saved ? '✓ Saved!' : 'Save Config'}
          </button>
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input className="input" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="Test recipient email…" />
            <button className="btn btn-secondary" onClick={handleTest} disabled={testBusy || !testEmail}>
              <Send size={14} /> {testBusy ? 'Sending…' : 'Test'}
            </button>
          </div>
        </div>
      </div>

      {/* Email Logs */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Email Logs</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 140 }} />
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>to</span>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 140 }} />
            <button className="btn btn-danger btn-sm" onClick={() => setLogs([])}>
              <Trash2 size={13} /> Clear Logs
            </button>
          </div>
        </div>
        <div className="table-container">
          <table>
            <thead><tr><th>Timestamp</th><th>To</th><th>Subject</th><th>Status</th><th>Error</th></tr></thead>
            <tbody>
              {filteredLogs.map(log => (
                <tr key={log.id}>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{formatDate(log.timestamp)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{log.to}</td>
                  <td style={{ fontSize: '0.875rem' }}>{log.subject}</td>
                  <td><span className={`badge ${log.status === 'sent' ? 'badge-green' : 'badge-red'}`}>● {log.status}</span></td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>{log.error || '—'}</td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)' }}>No email logs</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Postfix Status */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Postfix Status</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              Queue: {queueCount} messages · Status: <span style={{ color: postfixStatus === 'running' ? 'var(--color-success)' : 'var(--color-danger)' }}>{postfixStatus}</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-success btn-sm" onClick={() => handlePostfixAction('start')}><Play size={12} /> Start</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handlePostfixAction('stop')}><Square size={12} /> Stop</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handlePostfixAction('restart')}><RefreshCw size={12} /> Restart</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handlePostfixAction('flush')}>Flush Queue</button>
          </div>
        </div>
        <div className="terminal" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {postfixLogs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  )
}
