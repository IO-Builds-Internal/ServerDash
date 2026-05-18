import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  Database, Plus, Trash2, RefreshCw, Download, Eye, EyeOff,
  Play, Square, RotateCcw, Globe, Server, Network, AlertCircle, X, Copy, Check,
  Terminal, Upload, FolderOpen, FileText, Settings, ChevronRight, Layers,
  Activity, ArrowDown, ArrowUp, Code2, ExternalLink, Shield, Info, Lock
} from 'lucide-react'
import { localAuth } from '../lib/auth'
import api from '../lib/api'

// ── Portal overlay — renders into document.body to escape overflow:auto clipping ──
function Overlay({ children, onClose }) {
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(7, 7, 9, 0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        backdropFilter: 'blur(8px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      {children}
    </div>,
    document.body
  )
}

function SupabaseWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ name: '', dbPassword: '', dashPassword: '', publicUrl: '' })
  const [sqlFile, setSqlFile] = useState(null)
  const [lines, setLines] = useState([])
  const [deploying, setDeploying] = useState(false)
  const [done, setDone] = useState(false)
  const sqlInputRef = useRef(null)
  const terminalRef = useRef(null)

  const genPw = (len = 24) => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    return Array.from(crypto.getRandomValues(new Uint32Array(len))).map(x => chars[x % chars.length]).join('')
  }

  useEffect(() => {
    setForm(f => ({ ...f, dbPassword: genPw(32), dashPassword: genPw(20) }))
  }, [])

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight
  }, [lines])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const deploy = async () => {
    setDeploying(true); setStep(2); setLines([])
    try {
      const token = localAuth.getToken() || ''
      const body = new FormData()
      body.append('name', form.name)
      body.append('dbPassword', form.dbPassword)
      body.append('dashPassword', form.dashPassword)
      if (form.publicUrl) body.append('publicUrl', form.publicUrl)
      if (sqlFile) body.append('sqlBackup', sqlFile)

      const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/supabase/create-stream`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body
      })

      if (!resp.ok) {
        let errText = await resp.text()
        try { errText = JSON.parse(errText).error || errText } catch {}
        throw new Error(errText || `Server returned status code ${resp.status}`)
      }

      const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done: d, value } = await reader.read(); if (d) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop()
        parts.forEach(l => { if (l.startsWith('data: ')) setLines(p => [...p, l.slice(6)]) })
      }
      setDone(true)
      onCreated()  // refresh parent list
    } catch (e) {
      setLines(p => [...p, `✗ Installation Aborted: ${e.message}`])
    } finally {
      setDeploying(false)
    }
  }

  return (
    <Overlay onClose={!deploying ? onClose : undefined}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 700, maxHeight: '92vh', overflowY: 'auto', padding: '32px 36px', display: 'flex', flexDirection: 'column', gap: 24, border: '1px solid rgba(255,255,255,0.06)' }}>

        {step === 1 ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Database size={22} color="var(--color-primary)"/> Deploy Supabase Stack
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Sets up isolated PostgreSQL, GoTrue, Studio, REST API, Storage, and Realtime engines.</p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: 6, height: 28, width: 28 }}><X size={15}/></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label" style={{ fontWeight: 600 }}>Project Name *</label>
                <input className="input" value={form.name} onChange={e => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="production-db" autoFocus />
                <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>Letters, numbers, and dashes only. Determines directory name inside server.</p>
              </div>

              <div>
                <label className="label" style={{ fontWeight: 600 }}>Database Secret Key *</label>
                <div style={{ position: 'relative' }}>
                  <input className="input" value={form.dbPassword} onChange={e => set('dbPassword', e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', paddingRight: 64 }} />
                  <button onClick={() => set('dbPassword', genPw(32))} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>Regen</button>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>Master key credentials used by PostgREST and Auth.</p>
              </div>

              <div>
                <label className="label" style={{ fontWeight: 600 }}>Studio Console Password *</label>
                <div style={{ position: 'relative' }}>
                  <input className="input" value={form.dashPassword} onChange={e => set('dashPassword', e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', paddingRight: 64 }} />
                  <button onClick={() => set('dashPassword', genPw(20))} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>Regen</button>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>Access console with user: <strong>supabase</strong></p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label" style={{ fontWeight: 600 }}>External Hostname / IP (Optional)</label>
                <input className="input" value={form.publicUrl} onChange={e => set('publicUrl', e.target.value)} placeholder="http://213.199.34.74:8000" />
                <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>Leave empty to automatically allocate host server IP. Specify domain if applicable.</p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label" style={{ fontWeight: 600 }}>SQL Seed Schema (Optional)</label>
                <input type="file" ref={sqlInputRef} accept=".sql,.zip" style={{ display: 'none' }} onChange={e => setSqlFile(e.target.files?.[0] || null)} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '10px 14px', borderRadius: 8, border: '1px dashed var(--color-border)' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => sqlInputRef.current?.click()} style={{ gap: 6 }}><Upload size={14}/> Browse .sql</button>
                  <span style={{ fontSize: '0.82rem', color: sqlFile ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    {sqlFile ? sqlFile.name : 'Start with a completely empty database'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid var(--color-border)', paddingTop: 20 }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={deploy} disabled={!form.name || !form.dbPassword}>🚀 Deploy Supabase Stack</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {deploying ? <RefreshCw size={20} className="animate-spin" color="var(--color-primary)" /> : done ? <Check size={20} color="var(--color-success)"/> : <AlertCircle size={20} color="var(--color-danger)"/>}
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                {deploying ? 'Deploying Supabase stack container...' : done ? 'Deployment Finished!' : 'Deployment Failed'}
              </h2>
            </div>
            
            <div ref={terminalRef} style={{ background: '#070708', border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, height: 360, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', lineHeight: 1.6, color: '#e4e4e7' }}>
              {lines.map((l, i) => (
                <div key={i} style={{ 
                  color: l.includes('✓') ? 'var(--color-success)' : 
                         l.includes('✗') || l.includes('Error') ? 'var(--color-danger)' : 
                         l.includes('⚠') ? 'var(--color-warning)' :
                         l.includes('▶') ? 'var(--color-primary)' : '#e4e4e7' 
                }}>{l}</div>
              ))}
              {deploying && <span className="terminal-cursor" style={{ background: 'var(--color-primary)', display: 'inline-block', width: 6, height: 14, marginLeft: 4 }}></span>}
            </div>

            {!deploying && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                {!done && <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>}
                <button className="btn btn-primary" onClick={() => { if (done) onCreated(); onClose() }}>
                  {done ? '✓ Done' : 'Close'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Overlay>
  )
}

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
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: copied ? 'var(--color-success)' : failed ? 'var(--color-danger)' : 'var(--color-text-muted)',
        padding: '2px 4px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 2
      }}
      title={failed ? 'Copy failed' : copied ? 'Copied' : 'Copy'}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function proxyConfigFor(project, apiDomain, studioDomain) {
  const apiTarget = project.apiUrl || `http://127.0.0.1:${project.kongPort || 8000}`
  const studioTarget = project.studioUrl || `http://127.0.0.1:${project.studioPort || 3000}`
  return `# ${project.name} Supabase API proxy
server {
    listen 80;
    server_name ${apiDomain};

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

# ${project.name} Supabase Studio proxy
server {
    listen 80;
    server_name ${studioDomain};

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

function ProxyModal({ project, onClose }) {
  const [apiDomain, setApiDomain] = useState(`${project.name}.example.com`)
  const [studioDomain, setStudioDomain] = useState(`${project.name}-studio.example.com`)
  const config = proxyConfigFor(project, apiDomain, studioDomain)
  const clientEnv = `VITE_SUPABASE_URL=https://${apiDomain}
VITE_SUPABASE_ANON_KEY=${project.anonKey || ''}
`

  return (
    <Overlay onClose={onClose}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', padding: 32, display: 'flex', flexDirection: 'column', gap: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Proxy Parameters Setup</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Configure reverse proxies and public variables for client integration.</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: 6, height: 28, width: 28 }}><X size={15}/></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label className="label" style={{ fontWeight: 600 }}>Gateway API Domain</label>
            <input className="input" value={apiDomain} onChange={e => setApiDomain(e.target.value.trim())} />
          </div>
          <div>
            <label className="label" style={{ fontWeight: 600 }}>Dashboard Studio Domain</label>
            <input className="input" value={studioDomain} onChange={e => setStudioDomain(e.target.value.trim())} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: '0.86rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Nginx config lines</h3>
            <CopyButton text={config} />
          </div>
          <pre style={{ margin: 0, padding: 16, background: '#070708', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', color: '#22c55e', lineHeight: 1.55 }}>{config}</pre>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: '0.86rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Client config environment</h3>
            <CopyButton text={clientEnv} />
          </div>
          <pre style={{ margin: 0, padding: 16, background: '#070708', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', color: '#a855f7', lineHeight: 1.55 }}>{clientEnv}</pre>
        </div>
      </div>
    </Overlay>
  )
}

function RegisterModal({ onClose, onRegistered }) {
  const [composePath, setComposePath] = useState('/root/print_lankaDB')
  const [name, setName] = useState('print-lanka')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const register = async () => {
    setBusy(true); setError(null)
    try {
      await api.post('/api/supabase/register', { composePath, name })
      onRegistered()
      onClose()
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    }
    setBusy(false)
  }

  return (
    <Overlay onClose={onClose}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 540, padding: '32px 36px', display: 'flex', flexDirection: 'column', gap: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Import Existing Stack</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Integrate a pre-existing Dockerized Supabase stack into your control panel.</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: 6, height: 28, width: 28 }}><X size={15}/></button>
        </div>

        <div>
          <label className="label" style={{ fontWeight: 600 }}>Project Name *</label>
          <input className="input" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="print-lanka" />
        </div>

        <div>
          <label className="label" style={{ fontWeight: 600 }}>Absolute Compose Path *</label>
          <input className="input" value={composePath} onChange={e => setComposePath(e.target.value)} placeholder="/root/print_lankaDB" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }} />
          <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>Must contain compose blueprint `docker-compose.yml` and environment parameters.</p>
        </div>

        {error && <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, color: 'var(--color-danger)', fontSize: '0.82rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={register} disabled={!composePath || !name || busy} style={{ gap: 6 }}>
            {busy ? <RefreshCw size={14} className="animate-spin"/> : <FolderOpen size={14} />}
            Import Project
          </button>
        </div>
      </div>
    </Overlay>
  )
}

export default function SupabasePage() {
  const [projects, setProjects] = useState([])
  const [ports, setPorts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showConn, setShowConn] = useState({})
  const [tab, setTab] = useState('projects') // projects | ports
  const [selectedProjects, setSelectedProjects] = useState(new Set())
  const [proxyProject, setProxyProject] = useState(null)
  
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    const [pr, po] = await Promise.allSettled([
      api.get('/api/supabase/projects'),
      api.get('/api/ports'),
    ])
    if (pr.status === 'fulfilled') setProjects(pr.value.data)
    if (po.status === 'fulfilled') setPorts(po.value.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const doAction = async (id, action) => {
    if (action === 'remove' && !confirm('Are you absolutely sure you want to delete this Supabase project stack? All stored databases and volumes will be permanently wiped.')) return
    try {
      if (action === 'remove') await api.delete(`/api/supabase/${id}`)
      else await api.post(`/api/supabase/${id}/${action}`)
      load()
    } catch (e) { alert(e.response?.data?.error || e.message) }
  }

  const doBulkAction = async (action) => {
    if (selectedProjects.size === 0) return
    if (action === 'remove' && !confirm(`Are you absolutely sure you want to delete the ${selectedProjects.size} selected projects? This action cannot be reversed.`)) return
    try {
      const promises = Array.from(selectedProjects).map(id => {
        if (action === 'remove') return api.delete(`/api/supabase/${id}`)
        return api.post(`/api/supabase/${id}/${action}`)
      })
      await Promise.all(promises)
      setSelectedProjects(new Set())
      load()
    } catch (e) { alert(e.message) }
  }

  const toggleSelect = (id) => {
    const newSet = new Set(selectedProjects)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedProjects(newSet)
  }

  const toggleSelectAll = () => {
    if (selectedProjects.size === projects.length) {
      setSelectedProjects(new Set())
    } else {
      setSelectedProjects(new Set(projects.map(p => p.id)))
    }
  }

  const backup = async (id, name) => {
    try {
      const token = localAuth.getToken() || ''
      const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/supabase/${id}/backup`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!resp.ok) throw new Error('Dump script executed with errors')
      const blob = await resp.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}-postgres-backup-${Date.now()}.sql`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Backup failed: ${e.message}`)
    }
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {showNew && <SupabaseWizard onClose={() => setShowNew(false)} onCreated={() => { load() }} />}
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} onRegistered={() => { load() }} />}
      {proxyProject && <ProxyModal project={proxyProject} onClose={() => setProxyProject(null)} />}

      {/* Title Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Supabase & Databases</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>Monitor system ports and coordinate self-hosted Supabase containers stack.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={load} disabled={loading} style={{ padding: '0 12px', height: 36 }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="btn btn-secondary" onClick={() => setShowRegister(true)} style={{ height: 36, gap: 6 }}>
            <FolderOpen size={14} /> Import Existing
          </button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)} style={{ height: 36, gap: 6 }}>
            <Plus size={15} /> Create Supabase Project
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--color-surface-3)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {['projects', 'ports'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 18px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: tab === t ? 'var(--color-surface-2)' : 'transparent',
              color: tab === t ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontWeight: tab === t ? 700 : 400,
              fontSize: '0.84rem',
              textTransform: 'capitalize',
              transition: 'all 0.15s'
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Bulk Action Controls */}
      {tab === 'projects' && selectedProjects.size > 0 && (
        <div className="glass-card animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.15)' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-primary)' }}>{selectedProjects.size} stacks selected</span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="btn btn-primary btn-sm" onClick={() => doBulkAction('start')} style={{ gap: 4 }}><Play size={12} /> Start</button>
            <button className="btn btn-secondary btn-sm" onClick={() => doBulkAction('stop')} style={{ gap: 4 }}><Square size={12} /> Stop</button>
            <button className="btn btn-secondary btn-sm" onClick={() => doBulkAction('restart')} style={{ gap: 4 }}><RotateCcw size={12} /> Restart</button>
            <button className="btn btn-danger btn-sm" onClick={() => doBulkAction('remove')} style={{ gap: 4 }}><Trash2 size={12} /> Delete</button>
          </div>
        </div>
      )}

      {/* Projects Grid Dashboard */}
      {tab === 'projects' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px' }} />
              <div>Fetching stack registries...</div>
            </div>
          ) : projects.length === 0 ? (
            <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <Database size={40} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text)' }}>No Database Stacks Found</h3>
              <p style={{ fontSize: '0.875rem', marginTop: 6, marginBottom: 20 }}>
                Deploy your first self-hosted Supabase stack or connect existing Compose files.
              </p>
              <button className="btn btn-primary" onClick={() => setShowNew(true)} style={{ gap: 6 }}><Plus size={15} /> Deploy First Project</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))', gap: 16 }}>
              {projects.map(p => {
                const isRunning = p.status === 'running'
                const showConnField = showConn[p.id]
                
                return (
                  <div key={p.id} className="glass-card hover-glow" style={{ padding: 22, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16 }}>
                    
                    <div>
                      {/* Card Header Row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={selectedProjects.has(p.id)}
                            onChange={() => toggleSelect(p.id)}
                            style={{ cursor: 'pointer', width: 15, height: 15 }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Database size={14} color="#10b981" />
                            </div>
                            <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--color-text)' }}>{p.name}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {p.builtin && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-muted)', background: 'var(--color-surface-3)', padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Imported
                            </span>
                          )}
                          <span className={`badge ${isRunning ? 'badge-green' : 'badge-red'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: '0.68rem', fontWeight: 700 }}>
                            <span className={`status-dot ${isRunning ? 'active' : ''}`} style={{ width: 5, height: 5, borderRadius: '50%', background: isRunning ? 'var(--color-success)' : 'var(--color-danger)' }}></span>
                            {p.status}
                          </span>
                        </div>
                      </div>

                      {/* Info Spec Grid */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8rem', background: 'rgba(0,0,0,0.12)', borderRadius: 8, padding: '12px 14px', border: '1px solid var(--color-border)' }}>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center' }}>
                          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>API Endpoint</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <a href={p.apiUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                              {p.apiUrl}
                            </a>
                            <CopyButton text={p.apiUrl} />
                            <button className="btn btn-secondary btn-sm" onClick={() => setProxyProject(p)} style={{ height: 20, padding: '0 6px', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Network size={10} /> Proxy
                            </button>
                          </div>
                        </div>

                        {(p.builtin || p.studioUrl) && (
                          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center' }}>
                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Studio URL</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <a href={p.studioUrl || p.apiUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', textDecoration: 'none' }}>
                                {p.studioUrl || p.apiUrl}
                              </a>
                              <CopyButton text={p.studioUrl || p.apiUrl} />
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center' }}>
                          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Postgres DB</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-dim)', filter: showConnField ? 'none' : 'blur(5px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {p.dbConn}
                            </code>
                            <button onClick={() => setShowConn(s => ({ ...s, [p.id]: !s[p.id] }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'inline-flex' }}>
                              {showConnField ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                            {showConnField && <CopyButton text={p.dbConn} />}
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center' }}>
                          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Studio Auth</span>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-dim)' }}>
                            {p.dashboardUser} / {p.dashboardPass}
                          </span>
                        </div>
                      </div>

                    </div>

                    {/* Quick Row Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 4 }}>
                      <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
                        Created {new Date(p.created).toLocaleDateString()}
                      </span>
                      
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!p.builtin && (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => doAction(p.id, 'start')} disabled={isRunning} title="Start compose container" style={{ padding: 6, width: 28, height: 28 }}><Play size={12}/></button>
                            <button className="btn btn-secondary btn-sm" onClick={() => doAction(p.id, 'stop')} disabled={!isRunning} title="Stop container services" style={{ padding: 6, width: 28, height: 28 }}><Square size={12}/></button>
                            <button className="btn btn-secondary btn-sm" onClick={() => doAction(p.id, 'restart')} disabled={!isRunning} title="Restart services" style={{ padding: 6, width: 28, height: 28 }}><RotateCcw size={12}/></button>
                          </>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => backup(p.id, p.name)} title="Execute DB dump SQL download" style={{ padding: 6, width: 28, height: 28 }}><Download size={12}/></button>
                        
                        <button className="btn btn-primary btn-sm" onClick={() => navigate(`/supabase/project/${p.id}`)} style={{ gap: 4, padding: '0 10px', height: 28, fontSize: '0.76rem' }}>
                          <Settings size={12} /> Manage
                        </button>
                        
                        {!p.builtin && (
                          <button className="btn btn-secondary btn-sm" onClick={() => doAction(p.id, 'remove')} title="Wipe stack configurations" style={{ padding: 6, width: 28, height: 28, color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.1)' }}><Trash2 size={12}/></button>
                        )}
                      </div>
                    </div>

                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Network Ports Tab */}
      {tab === 'ports' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Summary Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {[
              { label: 'Total active ports', value: ports.length, color: 'var(--color-primary)' },
              { label: 'Public IP binds', value: ports.filter(p => p.public).length, color: 'var(--color-warning)' },
              { label: 'Secure localhost binds', value: ports.filter(p => !p.public).length, color: 'var(--color-success)' },
              { label: 'Docker networks', value: ports.filter(p => String(p.process || '').toLowerCase().includes('docker')).length, color: '#06b6d4' },
            ].map(c => (
              <div key={c.label} className="glass-card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: c.color, lineHeight: 1.1 }}>{c.value}</div>
                <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', marginTop: 4, fontWeight: 500 }}>{c.label}</div>
              </div>
            ))}
          </div>

          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '0.88rem', fontWeight: 800 }}>Listening Port Allocations</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.01)' }}>
                    {['Exposed Port', 'Service/Process', 'Process ID', 'Bind Address', 'Exposed Status'].map(h => (
                      <th key={h} style={{ padding: '12px 18px', textAlign: 'left', fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ports.map((p, i) => (
                    <tr key={i} style={{ borderBottom: i < ports.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                      <td style={{ padding: '12px 18px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.86rem' }}>:{p.port}</td>
                      <td style={{ padding: '12px 18px', fontWeight: 600 }}>{p.process}</td>
                      <td style={{ padding: '12px 18px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{p.pid}</td>
                      <td style={{ padding: '12px 18px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{p.address}</td>
                      <td style={{ padding: '12px 18px' }}>
                        <span className={`badge ${p.public ? 'badge-yellow' : 'badge-green'}`} style={{ fontSize: '0.7rem', padding: '2px 8px', fontWeight: 700 }}>
                          {p.public ? '🌐 PUBLIC ACCESS' : '🔒 PRIVATE LOCAL'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
