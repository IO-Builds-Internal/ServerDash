import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Database, Settings, FileText, Code2, Terminal,
  Activity, Layers, Play, Square, RotateCcw, ArrowDown,
  RefreshCw, Upload, Globe, Server, Eye, EyeOff, Copy, Check
} from 'lucide-react'
import { localAuth } from '../lib/auth'
import api from '../lib/api'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4001'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const copy = async () => {
    setFailed(false)
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
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('copy failed')
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setFailed(true)
      setTimeout(() => setFailed(false), 2000)
    }
  }

  return (
    <button
      onClick={copy}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--color-success)' : failed ? 'var(--color-danger)' : 'var(--color-text-muted)', padding: '2px 4px' }}
      title={failed ? 'Copy failed' : copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function proxyConfigFor(project) {
  const apiTarget = project.apiUrl || `http://127.0.0.1:${project.kongPort || 8000}`
  const studioTarget = project.studioUrl || `http://127.0.0.1:${project.studioPort || 3000}`
  return `# ${project.name} Supabase proxy
server {
    listen 80;
    server_name ${project.name}.example.com;

    location / {
        proxy_pass ${apiTarget};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name ${project.name}-studio.example.com;

    location / {
        proxy_pass ${studioTarget};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`
}

const TABS = [
  { id: 'containers', label: 'Containers', icon: Layers },
  { id: 'migrations', label: 'Migrations', icon: Database },
  { id: 'env', label: '.env', icon: Settings },
  { id: 'compose', label: 'docker-compose.yml', icon: FileText },
  { id: 'functions', label: 'Functions', icon: Code2 },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'controls', label: 'Controls', icon: Activity },
]

export default function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject]       = useState(null)
  const [detail, setDetail]         = useState(null)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState('containers')
  const [logs, setLogs]             = useState([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(null)
  const [actionMsg, setActionMsg]   = useState('')
  const [migFile, setMigFile]       = useState(null)
  const [selectedMigs, setSelectedMigs] = useState(new Set())
  const [envPass, setEnvPass]       = useState('')
  const [revealedEnv, setRevealedEnv] = useState(null)
  const [envError, setEnvError]     = useState('')
  const migRef  = useRef(null)
  const logsRef = useRef(null)

  // Load project info + detail
  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/api/supabase/projects'),
      api.get(`/api/supabase/${id}/detail`),
    ])
      .then(([pRes, dRes]) => {
        const found = pRes.data.find(p => p.id === id)
        setProject(found || null)
        setDetail(dRes.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs])

  const fetchLogs = async () => {
    setLogsLoading(true); setLogs([])
    const token = localAuth.getToken() || ''
    const resp = await fetch(`${API_URL}/api/supabase/${id}/logs`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = ''
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n'); buf = parts.pop()
      parts.forEach(l => { if (l.startsWith('data: ')) setLogs(p => [...p, l.slice(6)]) })
    }
    setLogsLoading(false)
  }

  const dockerAction = async (action) => {
    setActionBusy(action); setActionMsg('')
    try {
      if (action === 'down') await api.post(`/api/supabase/${id}/down`)
      else await api.post(`/api/supabase/${id}/${action}`)
      setActionMsg(`✓ ${action === 'start' ? 'docker compose up -d' : action === 'stop' ? 'docker compose stop' : action === 'restart' ? 'docker compose restart' : 'docker compose down'} completed`)
      // Refresh project status
      api.get('/api/supabase/projects').then(r => {
        const found = r.data.find(p => p.id === id)
        if (found) setProject(found)
      })
    } catch (e) {
      setActionMsg(`✗ ${e.response?.data?.error || e.message}`)
    }
    setActionBusy(null)
  }

  const uploadMigration = async (runImmediately = false) => {
    if (!migFile) return
    setActionBusy('migrate'); setActionMsg('')
    try {
      const token = localAuth.getToken() || ''
      const body = new FormData(); body.append('migration', migFile)
      const url = runImmediately ? `/api/supabase/${id}/migrate` : `/api/supabase/${id}/migrations/upload`
      const resp = await fetch(`${API_URL}${url}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error)
      setActionMsg(runImmediately ? '✓ Migration executed' : '✓ Migration uploaded')
      setMigFile(null)
      api.get(`/api/supabase/${id}/detail`).then(r => setDetail(r.data))
    } catch (e) { setActionMsg(`✗ ${e.message}`) }
    setActionBusy(null)
  }

  const runSelectedMigs = async () => {
    if (selectedMigs.size === 0) return
    setActionBusy('migrate'); setActionMsg('')
    try {
      const { data } = await api.post(`/api/supabase/${id}/migrations/run`, {
        files: Array.from(selectedMigs)
      })
      const fails = data.results.filter(r => !r.success)
      if (fails.length) setActionMsg(`⚠ ${fails.length} failed. Check console.`)
      else setActionMsg(`✓ Ran ${data.results.length} files successfully`)
      console.log('Migration results:', data.results)
      setSelectedMigs(new Set())
    } catch (e) { setActionMsg(`✗ ${e.response?.data?.error || e.message}`) }
    setActionBusy(null)
  }

  const revealEnv = async () => {
    setEnvError('')
    try {
      const { data } = await api.post(`/api/supabase/${id}/env-reveal`, { password: envPass })
      setRevealedEnv(data.content)
    } catch (e) {
      setEnvError(e.response?.data?.error || e.message)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading project…</div>
    </div>
  )

  if (!project) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>Project not found</p>
        <button className="btn btn-secondary" onClick={() => navigate('/supabase')}>← Back to Projects</button>
      </div>
    </div>
  )

  const statusColor = project.status === 'running' ? 'var(--color-success)' : 'var(--color-danger)'

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate('/supabase')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.8125rem', padding: 0, marginBottom: 16 }}
        >
          <ArrowLeft size={14} /> Back to Supabase Projects
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Database size={18} color="white" />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{project.name}</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 20, background: project.status === 'running' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: statusColor }}>
                    ● {project.status}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{project.composePath}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {project.apiUrl && (
              <a href={project.apiUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Globe size={13}/> API
              </a>
            )}
            {project.studioUrl && (
              <a href={project.studioUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Server size={13}/> Studio
              </a>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => dockerAction('start')} disabled={!!actionBusy || project.status === 'running'} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Play size={13}/>{actionBusy === 'start' ? 'Starting…' : 'Start'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => dockerAction('stop')} disabled={!!actionBusy || project.status !== 'running'} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Square size={13}/>{actionBusy === 'stop' ? 'Stopping…' : 'Stop'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => dockerAction('restart')} disabled={!!actionBusy || project.status !== 'running'} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <RotateCcw size={13}/>{actionBusy === 'restart' ? '…' : 'Restart'}
            </button>
          </div>
        </div>

        {actionMsg && (
          <div style={{ marginTop: 12, padding: '8px 14px', borderRadius: 8, fontSize: '0.8125rem', fontFamily: 'var(--font-mono)',
            background: actionMsg.startsWith('✓') ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            color: actionMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-danger)',
            border: `1px solid ${actionMsg.startsWith('✓') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
          }}>{actionMsg}</div>
        )}
      </div>

      {/* ── Project meta cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12, marginBottom: 24 }}>
        {[
          ['API URL', project.apiUrl],
          ['Studio', project.studioUrl],
          ['Anon Key', project.anonKey],
          ['Proxy Config', proxyConfigFor(project)],
          ['Kong Port', project.kongPort],
          ['DB Port', project.dbPort],
          ['Dash User', project.dashboardUser],
          ['Dash Pass', project.dashboardPass],
        ].map(([label, val]) => (
          <div key={label} className="glass-card" style={{ padding: '12px 16px', overflow: 'hidden' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{label}</span>
              {val && val !== '—' && <CopyButton text={val} />}
            </div>
            <div style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text)' }} title={val}>{val || '—'}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-border)', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id}
            onClick={() => { setTab(t.id); if (t.id === 'logs') fetchLogs() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: '0.8125rem', fontWeight: 500,
              background: tab === t.id ? 'var(--color-primary)' : 'transparent',
              color: tab === t.id ? 'white' : 'var(--color-text-muted)',
              border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: tab === t.id ? 'none' : 'none',
            }}>
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1 }}>

        {/* CONTAINERS */}
        {tab === 'containers' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12, marginBottom: 24 }}>
              {(detail?.containers || []).length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', gridColumn: '1/-1' }}>No running containers. Start the project first.</p>
              ) : detail.containers.map((c, i) => {
                const running = (c.State || '').toLowerCase() === 'running'
                const healthy = (c.Health || '').toLowerCase() === 'healthy'
                return (
                  <div key={i} className="glass-card" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.Service || c.Name}</span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 20,
                        background: running ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)',
                        color: running ? 'var(--color-success)' : 'var(--color-danger)',
                      }}>{c.State}{healthy ? ' · healthy' : ''}</span>
                    </div>
                    {(c.Publishers || []).filter(p => p.PublishedPort > 0).map((p, j) => (
                      <div key={j} style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                        :{p.PublishedPort} → :{p.TargetPort}/{p.Protocol}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            {(detail?.ports || []).length > 0 && (
              <>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Published Ports</h3>
                <div className="glass-card" style={{ overflow: 'hidden' }}>
                  <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>{['Service', 'Published', 'Target', 'Protocol'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {detail.ports.map((p, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)' }}>{p.container}</td>
                          <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', color: 'var(--color-primary)', fontWeight: 600 }}>{p.published}</td>
                          <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)' }}>{p.target}</td>
                          <td style={{ padding: '8px 14px', color: 'var(--color-text-muted)' }}>{p.protocol}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* MIGRATIONS */}
        {tab === 'migrations' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Migration Files ({detail?.migrations?.length || 0})</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedMigs.size > 0 && (
                  <button className="btn btn-primary btn-sm" onClick={runSelectedMigs} disabled={!!actionBusy}>
                    <Play size={13}/> Run Selected ({selectedMigs.size})
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => migRef.current?.click()}>
                  <Upload size={13}/> Upload .sql
                </button>
              </div>
              <input ref={migRef} type="file" accept=".sql,.zip" hidden onChange={e => setMigFile(e.target.files[0])}/>
            </div>
            {migFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 14px', background: 'rgba(59,130,246,0.08)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)' }}>
                <FileText size={14} color="var(--color-primary)"/>
                <span style={{ flex: 1, fontSize: '0.8rem' }}>{migFile.name}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => uploadMigration(false)} disabled={!!actionBusy}>
                  Store
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => uploadMigration(true)} disabled={!!actionBusy}>
                  Run Now
                </button>
              </div>
            )}
            {(detail?.migrations || []).length === 0 ? (
              <div className="glass-card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No migration files found in <code style={{ fontFamily: 'var(--font-mono)' }}>{project.composePath}/migrations/</code>
              </div>
            ) : (
              <div className="glass-card" style={{ overflow: 'hidden' }}>
                {detail.migrations.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < detail.migrations.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                    <input type="checkbox" checked={selectedMigs.has(m.name)} 
                      onChange={() => {
                        const s = new Set(selectedMigs)
                        if (s.has(m.name)) s.delete(m.name)
                        else s.add(m.name)
                        setSelectedMigs(s)
                      }} />
                    <FileText size={14} color="var(--color-text-muted)"/>
                    <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{m.name}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{(m.size / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'env' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>.env {!revealedEnv && <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>(sensitive values redacted)</span>}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!revealedEnv && (
                  <>
                    <input type="password" placeholder="Admin Password" value={envPass} onChange={e => setEnvPass(e.target.value)} className="input" style={{ width: 140, padding: '4px 8px', fontSize: '0.75rem' }} />
                    <button className="btn btn-secondary btn-sm" onClick={revealEnv}><Eye size={13}/> Reveal Secrets</button>
                  </>
                )}
                {revealedEnv && <button className="btn btn-secondary btn-sm" onClick={() => { setRevealedEnv(null); setEnvPass('') }}><EyeOff size={13}/> Hide</button>}
              </div>
            </div>
            {envError && <div style={{ marginBottom: 12, color: 'var(--color-danger)', fontSize: '0.8rem' }}>{envError}</div>}
            <pre style={{ margin: 0, padding: 20, background: 'var(--color-surface-2)', borderRadius: 10, fontSize: '0.78rem', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-text)', lineHeight: 1.7 }}>
              {revealedEnv || detail?.envContent || 'No .env found'}
            </pre>
          </div>
        )}

        {/* COMPOSE */}
        {tab === 'compose' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>docker-compose.yml</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{project.composePath}/docker-compose.yml</span>
            </div>
            <pre style={{ margin: 0, padding: 20, background: 'var(--color-surface-2)', borderRadius: 10, fontSize: '0.78rem', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-text)', lineHeight: 1.7 }}>
              {detail?.composeContent || 'docker-compose.yml not found'}
            </pre>
          </div>
        )}

        {/* FUNCTIONS */}
        {tab === 'functions' && (
          <div>
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 600 }}>Edge Functions</h3>
            {(detail?.functions || []).length === 0 ? (
              <div className="glass-card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No edge functions in <code style={{ fontFamily: 'var(--font-mono)' }}>{project.composePath}/functions/</code>
              </div>
            ) : (
              <div className="glass-card" style={{ overflow: 'hidden' }}>
                {detail.functions.map((fn, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < detail.functions.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                    <Code2 size={15} color="var(--color-primary)"/>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{fn}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Edge Function</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LOGS */}
        {tab === 'logs' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Container Logs</h3>
              <button className="btn btn-secondary btn-sm" onClick={fetchLogs} disabled={logsLoading}>
                <RefreshCw size={13}/> {logsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div ref={logsRef} style={{ background: '#0a0a0a', borderRadius: 10, padding: 16, height: 500, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', lineHeight: 1.6 }}>
              {logs.length === 0 ? (
                <span style={{ color: '#555' }}>{logsLoading ? 'Loading logs…' : 'No logs yet. Click Refresh to load.'}</span>
              ) : logs.map((l, i) => (
                <div key={i} style={{ color: l.includes('error') || l.includes('Error') ? '#f87171' : l.includes('warn') ? '#fbbf24' : '#9ca3af' }}>{l}</div>
              ))}
            </div>
          </div>
        )}

        {/* CONTROLS */}
        {tab === 'controls' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="glass-card" style={{ padding: 24 }}>
              <h3 style={{ margin: '0 0 20px', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>Docker Stack Controls</h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => dockerAction('start')} disabled={!!actionBusy || project.status === 'running'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Play size={14}/>{actionBusy === 'start' ? 'Starting…' : 'docker compose up -d'}
                </button>
                <button className="btn btn-secondary" onClick={() => dockerAction('stop')} disabled={!!actionBusy || project.status !== 'running'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Square size={14}/>{actionBusy === 'stop' ? 'Stopping…' : 'docker compose stop'}
                </button>
                <button className="btn btn-secondary" onClick={() => dockerAction('restart')} disabled={!!actionBusy || project.status !== 'running'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RotateCcw size={14}/>{actionBusy === 'restart' ? 'Restarting…' : 'docker compose restart'}
                </button>
                <button className="btn btn-secondary" onClick={() => dockerAction('down')} disabled={!!actionBusy}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'rgba(239,68,68,0.3)', color: 'var(--color-danger)' }}>
                  <ArrowDown size={14}/>{actionBusy === 'down' ? 'Bringing down…' : 'docker compose down'}
                </button>
              </div>
              {actionMsg && (
                <div style={{ marginTop: 14, padding: '9px 14px', borderRadius: 8, fontSize: '0.8rem', fontFamily: 'var(--font-mono)',
                  background: actionMsg.startsWith('✓') ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                  color: actionMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-danger)',
                  border: `1px solid ${actionMsg.startsWith('✓') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}>{actionMsg}</div>
              )}
            </div>

            <div className="glass-card" style={{ padding: 24 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>Project Info</h3>
              {[['Path', project.composePath], ['API URL', project.apiUrl], ['Studio', project.studioUrl], ['Kong Port', project.kongPort], ['DB Port', project.dbPort], ['Status', project.status], ['Created', new Date(project.created).toLocaleDateString()]]
                .map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.8125rem' }}>
                    <span style={{ width: 100, color: 'var(--color-text-muted)', flexShrink: 0 }}>{label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{String(val || '—')}</span>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
