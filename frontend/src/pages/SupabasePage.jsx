import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  Database, Plus, Trash2, RefreshCw, Download, Eye, EyeOff,
  Play, Square, RotateCcw, Globe, Server, Network, AlertCircle, X, Copy, Check,
  Terminal, Upload, FolderOpen, FileText, Settings, ChevronRight, Layers,
  Activity, ArrowDown, ArrowUp, Code2
} from 'lucide-react'
import { localAuth } from '../lib/auth'
import api from '../lib/api'

import { Dialog, Overlay } from '../components/Dialog'

function SupabaseWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ name: '', dbPassword: '', dashPassword: '', publicUrl: '' })
  const [sqlFile, setSqlFile] = useState(null)
  const [lines, setLines] = useState([])
  const [deploying, setDeploying] = useState(false)
  const [done, setDone] = useState(false)
  const sqlInputRef = useRef(null)
  const terminalRef = useRef(null)

  const genPw = (len = 24, safe = false) => {
    const chars = safe
      ? 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      : 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
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
        throw new Error(errText || `Server returned ${resp.status}`)
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
      setLines(p => [...p, `✗ Upload/Network Error: ${e.message}`])
    } finally {
      setDeploying(false)
    }
  }

  return (
    <Overlay onClose={!deploying ? onClose : undefined}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto', padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>

        
        {step === 1 ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>New Supabase Project</h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Deploys the full official Supabase stack (Studio, Auth, Storage, REST, Realtime)</p>
              </div>
              <button className="btn btn-secondary" onClick={onClose}><X size={16}/></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label">Project Name *</label>
                <input className="input" value={form.name} onChange={e => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="my-project" autoFocus />
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Lowercase letters, numbers, dashes only. Used as the folder name.</p>
              </div>

              <div>
                <label className="label">Database Password *</label>
                <div style={{ position: 'relative' }}>
                  <input className="input" value={form.dbPassword} onChange={e => set('dbPassword', e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', paddingRight: 72 }} />
                  <button onClick={() => set('dbPassword', genPw(32))} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }}>Regen</button>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Auto-generated. Save this — it's your Postgres password.</p>
              </div>

              <div>
                <label className="label">Studio Dashboard Password *</label>
                <div style={{ position: 'relative' }}>
                  <input className="input" value={form.dashPassword} onChange={e => set('dashPassword', e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', paddingRight: 72 }} />
                  <button onClick={() => set('dashPassword', genPw(20))} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }}>Regen</button>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Login to Studio with user: <strong>supabase</strong></p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label">Public URL (Optional)</label>
                <input className="input" value={form.publicUrl} onChange={e => set('publicUrl', e.target.value)} placeholder="http://your-vps-ip:8100  (auto-detected if blank)" />
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Leave blank to use your server IP with auto-allocated port. Use a domain if you have one set up.</p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label">SQL Backup / Migrations (Optional)</label>
                <input type="file" ref={sqlInputRef} accept=".sql,.zip" style={{ display: 'none' }} onChange={e => setSqlFile(e.target.files?.[0] || null)} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--color-surface-2)', padding: '12px 16px', borderRadius: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => sqlInputRef.current?.click()}><Upload size={14}/> Select .sql or .zip</button>
                  <span style={{ fontSize: '0.875rem', color: sqlFile ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    {sqlFile ? sqlFile.name : 'No file — start with a fresh database'}
                  </span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Upload a pg_dump `.sql` or a `.zip` with migration files to restore into the new DB on creation.</p>
              </div>
            </div>

            <div style={{ padding: '12px 16px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              <strong style={{ color: 'var(--color-primary)' }}>What gets deployed:</strong> Full Supabase stack — PostgreSQL, PostgREST, GoTrue Auth, Storage, Realtime, Edge Functions, Supabase Studio. This uses the official Supabase Docker Compose template and takes 3–5 minutes.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={deploy} disabled={!form.name || !form.dbPassword}>🚀 Deploy Full Stack</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {deploying ? <RefreshCw size={20} className="animate-spin" color="var(--color-primary)" /> : done ? <Check size={20} color="var(--color-success)"/> : <AlertCircle size={20} color="var(--color-danger)"/>}
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                {deploying ? 'Deploying Supabase Stack...' : done ? 'Deployment Complete!' : 'Deployment Failed'}
              </h2>
            </div>
            
            <div ref={terminalRef} className="terminal" style={{ height: 340, overflowY: 'auto', fontSize: '0.8125rem' }}>
              {lines.map((l, i) => (
                <div key={i} style={{ 
                  lineHeight: 1.6,
                  color: l.includes('✓') ? 'var(--color-success)' : 
                         l.includes('✗') || l.includes('Error') ? 'var(--color-danger)' : 
                         l.includes('⚠') ? 'var(--color-warning)' :
                         l.includes('▶') ? 'var(--color-primary)' : 'var(--color-text)' 
                }}>{l}</div>
              ))}
              {deploying && <div style={{ color: 'var(--color-primary)', marginTop: 4 }}>▋</div>}
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

// ── Full Manage Modal — tabbed project management panel ──────────────────────
function ManageModal({ project, onClose, onRefresh }) {
  const [tab, setTab] = useState('overview')
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(null)
  const [actionMsg, setActionMsg] = useState('')
  const [migFile, setMigFile] = useState(null)
  const [selectedMigs, setSelectedMigs] = useState(new Set())
  const [envPass, setEnvPass] = useState('')
  const [revealedEnv, setRevealedEnv] = useState(null)
  const [envError, setEnvError] = useState('')
  const migRef = useRef(null)
  const logsRef = useRef(null)

  const [sqlQuery, setSqlQuery] = useState("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';")
  const [queryResults, setQueryResults] = useState(null)
  const [queryError, setQueryError] = useState(null)
  const [queryBusy, setQueryBusy] = useState(false)

  const runQuery = async () => {
    setQueryBusy(true)
    setQueryError(null)
    setQueryResults(null)
    try {
      const { data } = await api.post(`/api/supabase/${project.id}/query`, { sql: sqlQuery })
      setQueryResults(data)
    } catch (e) {
      setQueryError(e.response?.data?.error || e.message)
    } finally {
      setQueryBusy(false)
    }
  }

  const [tablesList, setTablesList] = useState([])

  useEffect(() => {
    if (tab === 'sql') {
      api.post(`/api/supabase/${project.id}/query`, { sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;" })
        .then(r => {
          if (r.data?.rows) {
            setTablesList(r.data.rows.map(row => row.table_name))
          }
        })
        .catch(() => {})
    }
  }, [tab, project.id])

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    setLoading(true)
    api.get(`/api/supabase/${project.id}/detail`)
      .then(r => setDetail(r.data))
      .catch(() => setDetail({}))
      .finally(() => setLoading(false))
  }, [project.id])

  const fetchLogs = async () => {
    setLogsLoading(true); setLogs([])
    const token = localAuth.getToken() || ''
    const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/supabase/${project.id}/logs`, {
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
      if (action === 'down') {
        const { data } = await api.post(`/api/supabase/${project.id}/down`)
        setActionMsg('✓ Stack brought down')
      } else {
        const { data } = await api.post(`/api/supabase/${project.id}/${action}`)
        setActionMsg(`✓ ${action} done`)
      }
      onRefresh()
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
      const url = runImmediately ? `/api/supabase/${project.id}/migrate` : `/api/supabase/${project.id}/migrations/upload`
      const resp = await fetch(`${import.meta.env.VITE_API_URL}${url}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error)
      setActionMsg(runImmediately ? '✓ Migration executed' : '✓ Migration uploaded')
      setMigFile(null)
      api.get(`/api/supabase/${project.id}/detail`).then(r => setDetail(r.data))
    } catch (e) { setActionMsg(`✗ ${e.message}`) }
    setActionBusy(null)
  }

  const runSelectedMigs = async () => {
    if (selectedMigs.size === 0) return
    setActionBusy('migrate'); setActionMsg('')
    try {
      const { data } = await api.post(`/api/supabase/${project.id}/migrations/run`, {
        files: Array.from(selectedMigs)
      })
      const fails = data.results.filter(r => !r.success)
      if (fails.length) setActionMsg(`⚠ ${fails.length} failed. Check console.`)
      else setActionMsg(`✓ Ran ${data.results.length} files successfully`)
      setSelectedMigs(new Set())
    } catch (e) { setActionMsg(`✗ ${e.response?.data?.error || e.message}`) }
    setActionBusy(null)
  }

  const revealEnv = async () => {
    setEnvError('')
    try {
      const { data } = await api.post(`/api/supabase/${project.id}/env-reveal`, { password: envPass })
      setRevealedEnv(data.content)
    } catch (e) {
      setEnvError(e.response?.data?.error || e.message)
    }
  }

  const TABS = [
    { id: 'overview', label: 'Containers', icon: Layers },
    { id: 'sql', label: 'SQL Editor', icon: Database },
    { id: 'migrations', label: 'Migrations', icon: FolderOpen },
    { id: 'env', label: '.env', icon: Settings },
    { id: 'compose', label: 'docker-compose.yml', icon: FileText },
    { id: 'functions', label: 'Functions', icon: Code2 },
    { id: 'logs', label: 'Logs', icon: Terminal },
    { id: 'controls', label: 'Controls', icon: Activity },
  ]

  return (
    <Overlay onClose={onClose}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 900, maxHeight: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>⚙ {project.name}</h2>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{project.composePath}</p>
          </div>
          <button className="btn btn-secondary" onClick={onClose}><X size={16}/></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '12px 24px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, overflowX: 'auto', background: 'var(--color-surface-2)' }}>
          {TABS.map(t => {
            const isActive = tab === t.id
            return (
              <button key={t.id} onClick={() => { setTab(t.id); if (t.id === 'logs') fetchLogs() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: '0.8rem', fontWeight: isActive ? 600 : 500,
                  background: isActive ? 'var(--color-surface-3)' : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-dim)',
                  border: 'none', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                  borderBottom: isActive ? '2px solid var(--color-primary)' : 'none',
                }}>
                <t.icon size={13}/>{t.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 40 }}>Loading…</div>
          ) : (
            <>
              {/* CONTAINERS TAB */}
              {tab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  
                  {/* Summary Grid Widgets */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                    <div style={{ background: 'var(--color-surface-2)', padding: 16, borderRadius: 10, border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Layers size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Total Services</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{(detail?.containers || []).length}</div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--color-surface-2)', padding: 16, borderRadius: 10, border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ 
                        width: 36, height: 36, borderRadius: 8, 
                        background: (detail?.containers || []).some(c => c.Service === 'db' && c.State.toLowerCase() === 'running') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', 
                        color: (detail?.containers || []).some(c => c.Service === 'db' && c.State.toLowerCase() === 'running') ? 'var(--color-success)' : 'var(--color-danger)', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center' 
                      }}>
                        <Database size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Database Status</div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: (detail?.containers || []).some(c => c.Service === 'db' && c.State.toLowerCase() === 'running') ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {(detail?.containers || []).some(c => c.Service === 'db' && c.State.toLowerCase() === 'running') ? 'Online' : 'Offline'}
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--color-surface-2)', padding: 16, borderRadius: 10, border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ 
                        width: 36, height: 36, borderRadius: 8, 
                        background: (detail?.containers || []).some(c => c.Service === 'kong' && c.State.toLowerCase() === 'running') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', 
                        color: (detail?.containers || []).some(c => c.Service === 'kong' && c.State.toLowerCase() === 'running') ? 'var(--color-success)' : 'var(--color-danger)', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center' 
                      }}>
                        <Globe size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>API Gateway (Kong)</div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: (detail?.containers || []).some(c => c.Service === 'kong' && c.State.toLowerCase() === 'running') ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {(detail?.containers || []).some(c => c.Service === 'kong' && c.State.toLowerCase() === 'running') ? 'Online' : 'Offline'}
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--color-surface-2)', padding: 16, borderRadius: 10, border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ 
                        width: 36, height: 36, borderRadius: 8, 
                        background: (detail?.containers || []).some(c => c.Service === 'studio' && c.State.toLowerCase() === 'running') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', 
                        color: (detail?.containers || []).some(c => c.Service === 'studio' && c.State.toLowerCase() === 'running') ? 'var(--color-success)' : 'var(--color-danger)', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center' 
                      }}>
                        <Cpu size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Studio Console</div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: (detail?.containers || []).some(c => c.Service === 'studio' && c.State.toLowerCase() === 'running') ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {(detail?.containers || []).some(c => c.Service === 'studio' && c.State.toLowerCase() === 'running') ? 'Online' : 'Offline'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Active Services Grid */}
                  <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: 12 }}>Services & Containers</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                      {(detail?.containers || []).length === 0 ? (
                        <p style={{ color: 'var(--color-text-muted)', gridColumn: '1/-1' }}>No running containers. Start the project first.</p>
                      ) : detail.containers.map((c, i) => {
                        const running = (c.State || '').toLowerCase() === 'running'
                        const healthy = (c.Health || '').toLowerCase() === 'healthy'
                        return (
                          <div key={i} className="glass-card" style={{ padding: 16, border: '1px solid var(--color-border)', background: 'var(--color-surface-1)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-text)' }}>{c.Service || c.Name}</span>
                              <span style={{
                                fontSize: '0.68rem', padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                                background: running ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                                color: running ? 'var(--color-success)' : 'var(--color-danger)',
                                border: running ? '1px solid rgba(16,185,129,0.15)' : '1px solid rgba(239,68,68,0.15)'
                              }}>{c.State}{healthy ? ' · healthy' : ''}</span>
                            </div>
                            {(c.Publishers || []).filter(p => p.PublishedPort > 0).map((p, j) => (
                              <div key={j} style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', background: 'var(--color-surface-2)', padding: '4px 8px', borderRadius: 4, width: 'fit-content' }}>
                                port :{p.PublishedPort} → :{p.TargetPort}/{p.Protocol}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {(detail?.ports || []).length > 0 && (
                    <>
                      <h4 style={{ marginTop: 24, marginBottom: 12, fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Published Ports Map</h4>
                      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface-2)' }}>
                        <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: 'var(--color-surface-3)', borderBottom: '1px solid var(--color-border)' }}>
                              {['Service Container','Host Port Mapping','Target Container Port','Protocol'].map(h => <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {detail.ports.map((p, i) => (
                              <tr key={i} style={{ borderBottom: i < detail.ports.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{p.container}</td>
                                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--color-primary)', fontWeight: 600 }}>{p.published}</td>
                                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)' }}>{p.target}</td>
                                <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{p.protocol}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* MIGRATIONS TAB */}
              {tab === 'migrations' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>Migration Files ({detail?.migrations?.length || 0})</h4>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: 'rgba(59,130,246,0.08)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)' }}>
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
                  {(detail?.migrations?.length === 0) ? (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No migration files found in {project.composePath}/migrations/</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {detail.migrations.map((m, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--color-surface-2)', borderRadius: 6 }}>
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

              {/* SQL EDITOR TAB */}
              {tab === 'sql' && (
                <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, minHeight: 480 }}>
                  {/* Left Column - Schema Tables Explorer */}
                  <div style={{ background: 'var(--color-surface-2)', borderRadius: 10, padding: 14, border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>
                      <Database size={13} color="var(--color-primary)" />
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text)' }}>Tables Explorer</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420 }}>
                      {tablesList.length === 0 ? (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '10px 0' }}>No tables found / loading…</span>
                      ) : (
                        tablesList.map(table => (
                          <button
                            key={table}
                            onClick={() => {
                              const q = `SELECT * FROM "${table}" LIMIT 50;`
                              setSqlQuery(q)
                              // Run query automatically on click!
                              setQueryBusy(true)
                              setQueryError(null)
                              setQueryResults(null)
                              api.post(`/api/supabase/${project.id}/query`, { sql: q })
                                .then(r => setQueryResults(r.data))
                                .catch(e => setQueryError(e.response?.data?.error || e.message))
                                .finally(() => setQueryBusy(false))
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '6px 10px',
                              borderRadius: 6,
                              fontSize: '0.76rem',
                              fontFamily: 'var(--font-mono)',
                              textAlign: 'left',
                              width: '100%',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--color-text-dim)',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = 'var(--color-surface-3)'
                              e.currentTarget.style.color = 'var(--color-text)'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'transparent'
                              e.currentTarget.style.color = 'var(--color-text-dim)'
                            }}
                          >
                            <FileCode size={11} color="var(--color-text-muted)" />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{table}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Right Column - Editor and Results */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>⚡ SQL Editor</h4>
                        <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Execute custom SQL commands directly on your Supabase PostgreSQL instance.</p>
                      </div>
                      
                      {/* Pre-made helpers */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        {[
                          { name: '📋 List Tables', query: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';" },
                          { name: '👥 List Users', query: "SELECT id, email, created_at FROM auth.users LIMIT 10;" },
                          { name: '🛡️ Show RLS', query: "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';" }
                        ].map(helper => (
                          <button 
                            key={helper.name} 
                            className="btn btn-secondary btn-sm" 
                            onClick={() => setSqlQuery(helper.query)}
                            style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                          >
                            {helper.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <textarea 
                        className="input" 
                        value={sqlQuery} 
                        onChange={e => setSqlQuery(e.target.value)} 
                        style={{ 
                          width: '100%', 
                          height: 120, 
                          fontFamily: 'var(--font-mono)', 
                          fontSize: '0.8rem', 
                          lineHeight: 1.5,
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 8,
                          padding: 12,
                          color: 'var(--color-text)',
                          resize: 'vertical'
                        }}
                        placeholder="Enter your SQL query here..."
                      />
                      
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button 
                          className="btn btn-primary btn-sm" 
                          onClick={runQuery} 
                          disabled={queryBusy || !sqlQuery.trim()}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px' }}
                        >
                          <Play size={12} className={queryBusy ? 'animate-spin' : ''} />
                          {queryBusy ? 'Running Query...' : '⚡ Execute Query'}
                        </button>
                      </div>
                    </div>

                    {queryError && (
                      <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: 'var(--color-danger)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>
                        ❌ Error: {queryError}
                      </div>
                    )}

                    {queryResults && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-success)' }}>
                            ✓ Success: {queryResults.command} completed ({queryResults.rowCount !== null ? `${queryResults.rowCount} rows affected` : 'done'})
                          </span>
                        </div>

                        {queryResults.rows && queryResults.rows.length > 0 ? (
                          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface-1)', maxHeight: 260 }}>
                            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                              <thead>
                                <tr style={{ background: 'var(--color-surface-3)', borderBottom: '1px solid var(--color-border)' }}>
                                  {queryResults.fields.map(field => (
                                    <th key={field} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                                      {field}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {queryResults.rows.map((row, idx) => (
                                  <tr key={idx} style={{ borderBottom: idx < queryResults.rows.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                                    {queryResults.fields.map(field => (
                                      <td key={field} style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
                                        {row[field] === null ? <em style={{ color: 'var(--color-text-muted)' }}>null</em> : String(row[field])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={{ padding: '16px', background: 'var(--color-surface-2)', borderRadius: 8, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                            Query returned 0 rows.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ENV TAB */}
              {tab === 'env' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>.env {!revealedEnv && <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>(sensitive values redacted)</span>}</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {!revealedEnv && (
                        <>
                          <input type="password" placeholder="Admin Password" value={envPass} onChange={e => setEnvPass(e.target.value)} className="input" style={{ width: 140, padding: '4px 8px', fontSize: '0.75rem' }} />
                          <button className="btn btn-secondary btn-sm" onClick={revealEnv}><Eye size={13}/> Reveal</button>
                        </>
                      )}
                      {revealedEnv && <button className="btn btn-secondary btn-sm" onClick={() => { setRevealedEnv(null); setEnvPass('') }}><EyeOff size={13}/> Hide</button>}
                    </div>
                  </div>
                  {envError && <div style={{ marginBottom: 12, color: 'var(--color-danger)', fontSize: '0.8rem' }}>{envError}</div>}
                  <pre style={{ margin: 0, padding: 16, background: 'var(--color-surface-2)', borderRadius: 8, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowY: 'auto', maxHeight: 500, color: 'var(--color-text)' }}>
                    {revealedEnv || detail?.envContent || 'No .env found'}
                  </pre>
                </div>
              )}

              {/* COMPOSE TAB */}
              {tab === 'compose' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>docker-compose.yml</h4>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{project.composePath}/docker-compose.yml</span>
                  </div>
                  <pre style={{ margin: 0, padding: 16, background: 'var(--color-surface-2)', borderRadius: 8, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowY: 'auto', maxHeight: 520, color: 'var(--color-text)' }}>
                    {detail?.composeContent || 'docker-compose.yml not found'}
                  </pre>
                </div>
              )}

              {/* FUNCTIONS TAB */}
              {tab === 'functions' && (
                <div>
                  <h4 style={{ margin: '0 0 12px', fontSize: '0.875rem', fontWeight: 600 }}>Edge Functions</h4>
                  {(detail?.functions?.length === 0) ? (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No edge functions found in {project.composePath}/functions/</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {detail.functions.map((fn, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--color-surface-2)', borderRadius: 8 }}>
                          <Code2 size={14} color="var(--color-primary)"/>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{fn}</span>
                          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Edge Function</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* LOGS TAB */}
              {tab === 'logs' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>Container Logs</h4>
                    <button className="btn btn-secondary btn-sm" onClick={fetchLogs} disabled={logsLoading}>
                      <RefreshCw size={13}/> {logsLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                  <div ref={logsRef} style={{ background: '#0d0d0d', borderRadius: 8, padding: 12, height: 450, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', lineHeight: 1.5 }}>
                    {logs.length === 0 ? (
                      <span style={{ color: '#666' }}>{logsLoading ? 'Loading logs…' : 'No logs. Click Refresh.'}</span>
                    ) : logs.map((l, i) => (
                      <div key={i} style={{ color: l.includes('error') || l.includes('Error') ? '#f87171' : l.includes('warn') ? '#fbbf24' : '#d1d5db' }}>{l}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* CONTROLS TAB */}
              {tab === 'controls' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="glass-card" style={{ padding: 20 }}>
                    <h4 style={{ margin: '0 0 16px', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Docker Stack Controls</h4>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={() => dockerAction('start')} disabled={!!actionBusy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Play size={14}/>{actionBusy === 'start' ? 'Starting…' : 'docker compose up -d'}
                      </button>
                      <button className="btn btn-secondary" onClick={() => dockerAction('stop')} disabled={!!actionBusy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Square size={14}/>{actionBusy === 'stop' ? 'Stopping…' : 'docker compose stop'}
                      </button>
                      <button className="btn btn-secondary" onClick={() => dockerAction('restart')} disabled={!!actionBusy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <RotateCcw size={14}/>{actionBusy === 'restart' ? 'Restarting…' : 'docker compose restart'}
                      </button>
                      <button className="btn btn-secondary" onClick={() => dockerAction('down')} disabled={!!actionBusy}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'rgba(239,68,68,0.3)', color: 'var(--color-danger)' }}>
                        <ArrowDown size={14}/>{actionBusy === 'down' ? 'Bringing down…' : 'docker compose down'}
                      </button>
                    </div>
                    {actionMsg && (
                      <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'var(--font-mono)',
                        background: actionMsg.startsWith('✓') ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                        color: actionMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-danger)',
                        border: `1px solid ${actionMsg.startsWith('✓') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                      }}>{actionMsg}</div>
                    )}
                  </div>

                  <div className="glass-card" style={{ padding: 20 }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Project Info</h4>
                    {[['Path', project.composePath], ['API URL', project.apiUrl], ['Studio', project.studioUrl], ['DB Port', project.dbPort], ['Status', project.status]]
                      .map(([label, val]) => (
                        <div key={label} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.8125rem' }}>
                          <span style={{ width: 90, color: 'var(--color-text-muted)', flexShrink: 0 }}>{label}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{val}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}
            </>
          )}
        </div>
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
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--color-success)' : failed ? 'var(--color-danger)' : 'var(--color-text-muted)', padding: '2px 4px' }}
      title={failed ? 'Copy failed' : copied ? 'Copied' : 'Copy'}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
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

function ProxyModal({ project, onClose, onRefresh }) {
  const getDomainFromUrl = (url, fallback) => {
    if (!url) return fallback
    if (url.includes('127.0.0.1') || url.includes('localhost') || /:\d+$/.test(url.replace('http://', '').replace('https://', ''))) {
      return fallback
    }
    return url.replace('http://', '').replace('https://', '').trim()
  }

  const [apiDomain, setApiDomain] = useState(() => getDomainFromUrl(project.apiUrl, `${project.name}.example.com`))
  const [studioDomain, setStudioDomain] = useState(() => getDomainFromUrl(project.studioUrl, `${project.name}-studio.example.com`))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)

  const config = proxyConfigFor(project, apiDomain, studioDomain)
  const clientEnv = `VITE_SUPABASE_URL=https://${apiDomain}
VITE_SUPABASE_ANON_KEY=${project.anonKey || ''}
`

  const applyProxy = async () => {
    setError(null)
    setSuccessMsg(null)
    setBusy(true)
    try {
      const { data } = await api.post(`/api/supabase/${project.id}/proxy`, {
        apiDomain: apiDomain.trim() || null,
        studioDomain: studioDomain.trim() || null
      })
      setSuccessMsg('✓ Reverse Proxy configured successfully! Nginx blocks are loaded and reloaded.')
      if (onRefresh) onRefresh()
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>🔗 {project.name} Domain & Proxy</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Configure domains and bind nginx reverse-proxy directly to your Supabase services.</p>
          </div>
          <button className="btn btn-secondary" onClick={onClose}><X size={16}/></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">API Gateway Domain</label>
            <input className="input" value={apiDomain} onChange={e => setApiDomain(e.target.value.trim())} placeholder="supabase.example.com" />
            <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>Maps to Kong API Port (<code>:{project.kongPort || 8000}</code>)</p>
          </div>
          <div>
            <label className="label">Studio Dashboard Domain</label>
            <input className="input" value={studioDomain} onChange={e => setStudioDomain(e.target.value.trim())} placeholder="supabase-studio.example.com" />
            <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>Maps to Studio Web Port (<code>:{project.studioPort || 3000}</code>)</p>
          </div>
        </div>

        {/* Bind action button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 4 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button 
            className="btn btn-primary" 
            onClick={applyProxy} 
            disabled={busy || (!apiDomain && !studioDomain)}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Globe size={14} className={busy ? 'animate-spin' : ''} />
            {busy ? 'Configuring Proxy...' : '🚀 Automate Nginx Proxy Binding'}
          </button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: 'var(--color-danger)', fontSize: '0.82rem' }}>
            {error}
          </div>
        )}

        {successMsg && (
          <div style={{ padding: '10px 14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 6, color: 'var(--color-success)', fontSize: '0.82rem' }}>
            {successMsg}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Preview generated nginx blocks</h3>
            <CopyButton text={config} />
          </div>
          <pre style={{ margin: 0, padding: 14, background: 'var(--color-surface-2)', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', color: 'var(--color-text)', lineHeight: 1.5 }}>{config}</pre>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Frontend client env settings</h3>
            <CopyButton text={clientEnv} />
          </div>
          <pre style={{ margin: 0, padding: 14, background: 'var(--color-surface-2)', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', color: 'var(--color-text)', lineHeight: 1.5 }}>{clientEnv}</pre>
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
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 520, padding: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Register Existing Project</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Import an existing Supabase install into the managed list</p>
          </div>
          <button className="btn btn-secondary" onClick={onClose}><X size={16}/></button>
        </div>

        <div>
          <label className="label">Project Name *</label>
          <input className="input" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="print-lanka" />
        </div>

        <div>
          <label className="label">Docker Compose Directory *</label>
          <input className="input" value={composePath} onChange={e => setComposePath(e.target.value)} placeholder="/root/print_lankaDB" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }} />
          <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Must contain a <code>.env</code> and <code>docker-compose.yml</code>. Credentials will be read from <code>.env</code>.</p>
        </div>

        {error && <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={register} disabled={!composePath || !name || busy}>
            <FolderOpen size={14} />{busy ? 'Registering…' : 'Register Project'}
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
  const [actionLoading, setActionLoading] = useState(false)
  const [actionTitle, setActionTitle] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [dialog, setDialog] = useState(null)
  const [deleteProgress, setDeleteProgress] = useState(null) // null or { title: '', lines: [], active: true }
  const [projectToDelete, setProjectToDelete] = useState(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const showSuccess = (title, message) => {
    setDialog({ title, message, type: 'success', onConfirm: () => setDialog(null) })
  }
  const showError = (title, message) => {
    setDialog({ title, message, type: 'warning', onConfirm: () => setDialog(null) })
  }

  const load = useCallback(async () => {
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
    if (action === 'remove') {
      const proj = projects.find(p => p.id === id)
      if (!proj) return
      setProjectToDelete(proj)
      setDeleteConfirmText('')
      return
    }
    
    try {
      await api.post(`/api/supabase/${id}/${action}`)
      load()
    } catch (e) {
      showError('Action Failed', e.response?.data?.error || e.message)
    }
  }

  const executeTeardown = async (proj) => {
    const id = proj.id
    const pName = proj.name
    setProjectToDelete(null)
    setDeleteProgress({ title: `Deleting ${pName}`, lines: ['▶ Requesting project teardown...'], active: true })
    try {
      const token = localAuth.getToken() || ''
      const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/supabase/${id}/delete-stream`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!resp.ok) {
        let errText = await resp.text()
        try { errText = JSON.parse(errText).error || errText } catch {}
        throw new Error(errText || `Teardown returned status ${resp.status}`)
      }

      const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done: d, value } = await reader.read(); if (d) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop()
        parts.forEach(l => {
          if (l.startsWith('data: ')) {
            const content = l.slice(6)
            setDeleteProgress(prev => prev ? { ...prev, lines: [...prev.lines, content] } : null)
          }
        })
      }
      setDeleteProgress(prev => prev ? { ...prev, active: false } : null)
      load()
    } catch (e) {
      setDeleteProgress(prev => prev ? { ...prev, active: false, lines: [...prev.lines, `✗ Deletion Failed: ${e.message}`] } : null)
    }
  }

  const doBulkAction = async (action) => {
    if (selectedProjects.size === 0) return
    if (action === 'remove') {
      setDialog({
        title: `Delete ${selectedProjects.size} Supabase Projects?`,
        message: `Are you sure you want to permanently delete these ${selectedProjects.size} projects and all associated databases? This cannot be undone.`,
        type: 'confirm',
        onConfirm: async () => {
          setDialog(null)
          try {
            const promises = Array.from(selectedProjects).map(id => api.delete(`/api/supabase/${id}`))
            await Promise.all(promises)
            setSelectedProjects(new Set())
            load()
          } catch (e) {
            showError('Bulk Action Failed', e.message)
          }
        },
        onCancel: () => setDialog(null)
      })
      return
    }
    
    try {
      const promises = Array.from(selectedProjects).map(id => api.post(`/api/supabase/${id}/${action}`))
      await Promise.all(promises)
      setSelectedProjects(new Set())
      load()
    } catch (e) {
      showError('Bulk Action Failed', e.message)
    }
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
    setActionTitle('Generating Database Backup...')
    setActionMessage('Dumping database schema, tables, records, and relationships. Please wait.')
    setActionLoading(true)
    try {
      const token = localAuth.getToken() || ''
      const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/supabase/${id}/backup`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!resp.ok) throw new Error('Backup failed')
      const blob = await resp.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}-backup-${Date.now()}.sql`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      showError('Backup Failed', e.message)
    } finally {
      setActionLoading(false)
    }
  }

  const restore = async (id) => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.sql'
    fileInput.onchange = async () => {
      const file = fileInput.files[0]
      if (!file) return
      
      setDialog({
        title: '⚠️ CRITICAL WARNING',
        message: `Restoring this backup SQL file will completely overwrite your Supabase database schema and all existing data inside project. Are you sure you want to proceed?`,
        type: 'confirm',
        onConfirm: async () => {
          setDialog(null)
          const formData = new FormData()
          formData.append('restoreFile', file)
          
          setActionTitle('Restoring Database Backup...')
          setActionMessage('Uploading SQL file, re-provisioning schema, and importing all tables and records. Please wait.')
          setActionLoading(true)
          try {
            const { data } = await api.post(`/api/supabase/${id}/restore`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            })
            showSuccess('Database Restored', data.message || '✓ Database successfully restored!')
          } catch (err) {
            showError('Restoration Error', err.response?.data?.error || err.message)
          } finally {
            setActionLoading(false)
          }
        },
        onCancel: () => setDialog(null)
      })
    }
    fileInput.click()
  }

  const dbPorts = ports.filter(p => p.process?.includes('docker') || p.process?.includes('postgres') || [5432, 55432, 65432, 6543].includes(p.port))
  const webPorts = ports.filter(p => p.process?.includes('nginx') || p.process?.includes('node') || p.process?.includes('docker-proxy'))

  const navigate = useNavigate()
  const [manageProject, setManageProject] = useState(null) // kept for backward compat but unused

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {showNew && <SupabaseWizard onClose={() => setShowNew(false)} onCreated={() => { load() }} />}
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} onRegistered={() => { load() }} />}
      {proxyProject && <ProxyModal project={proxyProject} onClose={() => setProxyProject(null)} onRefresh={load} />}


      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Supabase & Databases</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>Manage self-hosted Supabase instances and monitor ports</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={13} /></button>
          <button className="btn btn-secondary" onClick={() => setShowRegister(true)}><FolderOpen size={15} /> Register Existing</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={15} /> New Project</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--color-surface-3)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {['projects', 'ports'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', background: tab === t ? 'var(--color-surface-2)' : 'transparent', color: tab === t ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: tab === t ? 600 : 400, fontSize: '0.875rem', textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'projects' && selectedProjects.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--color-surface-2)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{selectedProjects.size} selected</span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="btn btn-success btn-sm" onClick={() => doBulkAction('start')}><Play size={12} /> Start</button>
            <button className="btn btn-secondary btn-sm" onClick={() => doBulkAction('stop')}><Square size={12} /> Stop</button>
            <button className="btn btn-secondary btn-sm" onClick={() => doBulkAction('restart')}><RotateCcw size={12} /> Restart</button>
            <button className="btn btn-danger btn-sm" onClick={() => doBulkAction('remove')}><Trash2 size={12} /> Delete</button>
          </div>
        </div>
      )}

      {tab === 'projects' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading…</div> :
            projects.length === 0 ? (
              <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <Database size={36} style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                <p style={{ marginBottom: 16 }}>No Supabase projects found</p>
                <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={14} /> Create First Project</button>
              </div>
            ) :
            projects.map(p => {
              const isRunning = p.status === 'running'
              return (
              <div key={p.id} className="glass-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <input type="checkbox" checked={selectedProjects.has(p.id)} onChange={() => toggleSelect(p.id)} style={{ cursor: 'pointer' }} />
                      <Database size={18} color="var(--color-primary)" />
                      <span style={{ fontWeight: 700, fontSize: '1.0625rem' }}>{p.name}</span>
                      <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: p.status === 'running' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: p.status === 'running' ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
                        ● {p.status}
                      </span>
                      {p.builtin && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', background: 'var(--color-surface-3)', padding: '2px 8px', borderRadius: 4 }}>auto-detected</span>}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '0.8125rem', maxWidth: 600 }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>API URL</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <a href={p.apiUrl} target="_blank" rel="noopener" style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{p.apiUrl}</a>
                        <CopyButton text={p.apiUrl} />
                        {(() => {
                          const isBound = !(p.apiUrl.includes('127.0.0.1') || p.apiUrl.includes('localhost') || /:\d+$/.test(p.apiUrl.replace('http://', '').replace('https://', '')))
                          return (
                            <button 
                              className="btn btn-secondary btn-sm" 
                              onClick={() => setProxyProject(p)} 
                              style={{ 
                                padding: '3px 10px', 
                                fontSize: '0.72rem', 
                                border: isBound ? '1px solid rgba(16,185,129,0.3)' : '1px dashed var(--color-primary)',
                                background: isBound ? 'rgba(16,185,129,0.05)' : 'rgba(99,102,241,0.03)',
                                color: isBound ? 'var(--color-success)' : 'var(--color-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                            >
                              {isBound ? (
                                <>
                                  <Check size={11} /> Bound (Modify)
                                </>
                              ) : (
                                <>
                                  <Globe size={11} /> Bind Domain / Proxy
                                </>
                              )}
                            </button>
                          )
                        })()}
                      </div>

                      <span style={{ color: 'var(--color-text-muted)' }}>Anon Key</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--color-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.anonKey ? `${p.anonKey.slice(0, 24)}…${p.anonKey.slice(-10)}` : '—'}
                        </code>
                        {p.anonKey && <CopyButton text={p.anonKey} />}
                      </div>

                      {(p.builtin || p.studioUrl) && (
                        <>
                          <span style={{ color: 'var(--color-text-muted)' }}>Studio</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <a href={p.studioUrl || p.apiUrl} target="_blank" rel="noopener" style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{p.studioUrl || p.apiUrl}</a>
                            <CopyButton text={p.studioUrl || p.apiUrl} />
                          </div>
                        </>
                      )}

                      <span style={{ color: 'var(--color-text-muted)' }}>DB Connection</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--color-text-dim)', filter: showConn[p.id] ? 'none' : 'blur(5px)', cursor: 'pointer', transition: 'filter 0.2s' }}
                          onClick={() => setShowConn(s => ({ ...s, [p.id]: !s[p.id] }))}>
                          {p.dbConn}
                        </code>
                        <button onClick={() => setShowConn(s => ({ ...s, [p.id]: !s[p.id] }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '2px 4px' }}>
                          {showConn[p.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        {showConn[p.id] && <CopyButton text={p.dbConn} />}
                      </div>

                      <span style={{ color: 'var(--color-text-muted)' }}>Dash Auth</span>
                      <span style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)' }}>{p.dashboardUser} / {p.dashboardPass}</span>

                      <span style={{ color: 'var(--color-text-muted)' }}>Created</span>
                      <span style={{ color: 'var(--color-text-dim)' }}>{new Date(p.created).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {!p.builtin && (
                      <>
                        <button className="btn btn-success btn-sm" onClick={() => doAction(p.id, 'start')} disabled={isRunning}><Play size={12} /> Start</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => doAction(p.id, 'stop')} disabled={!isRunning}><Square size={12} /> Stop</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => doAction(p.id, 'restart')} disabled={!isRunning}><RotateCcw size={12} /> Restart</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/supabase/project/${p.id}`)}><Server size={12} /> Manage</button>
                        <button className="btn btn-danger btn-sm" onClick={() => doAction(p.id, 'remove')}><Trash2 size={12} /> Delete</button>
                      </>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={() => backup(p.id, p.name)}><Download size={12} /> Backup</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => restore(p.id)} style={{ borderColor: 'rgba(59,130,246,0.3)', color: 'var(--color-primary)' }}><Upload size={12} /> Restore</button>
                  </div>
                </div>
              </div>
              )
            })
          }
        </div>
      )}

      {tab === 'ports' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {[
              { label: 'Total Listening', value: ports.length, color: 'var(--color-primary)' },
              { label: 'Publicly Exposed', value: ports.filter(p => p.public).length, color: 'var(--color-warning)' },
              { label: 'Localhost Only', value: ports.filter(p => !p.public).length, color: 'var(--color-success)' },
              { label: 'Docker Ports', value: ports.filter(p => p.process?.includes('docker')).length, color: '#06b6d4' },
            ].map(c => (
              <div key={c.label} className="glass-card" style={{ padding: '16px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: c.color }}>{c.value}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{c.label}</div>
              </div>
            ))}
          </div>

          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', fontSize: '0.875rem', fontWeight: 600 }}>All Listening Ports</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Port', 'Process', 'PID', 'Address', 'Visibility'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ports.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-primary)' }}>{p.port}</td>
                      <td style={{ padding: '8px 16px', fontSize: '0.875rem' }}>{p.process}</td>
                      <td style={{ padding: '8px 16px', fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{p.pid}</td>
                      <td style={{ padding: '8px 16px', fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{p.address}</td>
                      <td style={{ padding: '8px 16px' }}>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: p.public ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', color: p.public ? 'var(--color-warning)' : 'var(--color-success)', fontWeight: 600 }}>
                          {p.public ? '🌐 Public' : '🔒 Local'}
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
      {actionLoading && (
        <Overlay onClose={() => {}}>
          <div className="glass-card animate-fade-in" style={{ padding: '32px 48px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, maxWidth: 420 }}>
            <RefreshCw size={40} className="animate-spin" color="var(--color-primary)" />
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900 }}>{actionTitle || 'Processing Action...'}</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              {actionMessage || 'This operation may take several seconds. Please do not close or refresh this page.'}
            </p>
            <div className="progress-bar-indeterminate" style={{ marginTop: 8 }} />
          </div>
        </Overlay>
      )}
      {deleteProgress && (
        <Overlay onClose={!deleteProgress.active ? () => setDeleteProgress(null) : undefined}>
          <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 640, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {deleteProgress.active && <RefreshCw size={22} className="animate-spin" color="var(--color-danger)" />}
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: 'var(--color-danger)' }}>{deleteProgress.title}</h3>
            </div>
            
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              Stack tearing down and volume pruning execution logs in real-time:
            </p>

            <div style={{ 
              background: '#070708', 
              border: '1px solid var(--color-border)', 
              borderRadius: 10, 
              padding: 16, 
              height: 280, 
              overflowY: 'auto', 
              fontFamily: 'var(--font-mono)', 
              fontSize: '0.74rem', 
              lineHeight: 1.5,
              color: '#a1a1aa'
            }}>
              {deleteProgress.lines.map((l, i) => {
                let logColor = '#a1a1aa'
                if (l.toLowerCase().includes('error') || l.toLowerCase().includes('fail') || l.startsWith('✗')) logColor = '#f87171'
                else if (l.toLowerCase().includes('warn') || l.startsWith('⚠')) logColor = '#fbbf24'
                else if (l.startsWith('✓') || l.toLowerCase().includes('success')) logColor = '#34d399'
                else if (l.startsWith('▶')) logColor = '#60a5fa'
                
                return (
                  <div key={i} style={{ color: logColor, marginBottom: 4 }}>
                    {l}
                  </div>
                )
              })}
            </div>

            {!deleteProgress.active && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-primary" onClick={() => setDeleteProgress(null)}>
                  Close Logs
                </button>
              </div>
            )}
          </div>
        </Overlay>
      )}
      {projectToDelete && (
        <Overlay onClose={() => setProjectToDelete(null)}>
          <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 460, padding: 32, display: 'flex', flexDirection: 'column', gap: 18, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AlertCircle size={24} color="var(--color-danger)" />
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900 }}>⚠️ Critical Destruction Action</h3>
            </div>
            
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              You are about to permanently delete the Supabase project <strong>"{projectToDelete.name}"</strong>, including all its database volumes, historical migrations, backups, edge functions, and proxy domain configurations. <strong>This action cannot be undone.</strong>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <label className="label" style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)' }}>
                To confirm deletion, type the word <strong style={{ color: 'var(--color-text)' }}>DELETE</strong> below:
              </label>
              <input 
                type="text" 
                className="input" 
                value={deleteConfirmText} 
                onChange={e => setDeleteConfirmText(e.target.value)} 
                placeholder="Type 'DELETE' to confirm" 
                style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', letterSpacing: '0.05em' }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && deleteConfirmText === 'DELETE') {
                    executeTeardown(projectToDelete)
                  }
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button className="btn btn-secondary" onClick={() => setProjectToDelete(null)} style={{ height: 38, padding: '0 20px' }}>
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => executeTeardown(projectToDelete)} 
                disabled={deleteConfirmText !== 'DELETE'}
                style={{ 
                  height: 38, 
                  padding: '0 20px', 
                  background: 'var(--color-danger)'
                }}
              >
                💥 Permanently Destroy Stack
              </button>
            </div>
          </div>
        </Overlay>
      )}
      {dialog && <Dialog {...dialog} />}
    </div>
  )
}
