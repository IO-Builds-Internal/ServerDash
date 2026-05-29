import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Database, Settings, FileText, Code2, Terminal,
  Activity, Layers, Play, Square, RotateCcw, ArrowDown,
  RefreshCw, Upload, Globe, Server, Eye, EyeOff, Copy, Check,
  Cpu, HardDrive, Shield, AlertTriangle, Key, ExternalLink, Trash2,
  Calendar, CheckCircle, Info, Plus, Save
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
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        cursor: 'pointer',
        color: copied ? 'var(--color-success)' : failed ? 'var(--color-danger)' : 'var(--color-text-muted)',
        padding: '5px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        height: 28,
        width: 28
      }}
      title={failed ? 'Copy failed' : copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
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
  { id: 'sql', label: '⚡ SQL Editor', icon: Code2 },
  { id: 'migrations', label: 'Migrations', icon: Database },
  { id: 'env', label: '.env Secrets', icon: Settings },
  { id: 'compose', label: 'Compose Spec', icon: FileText },
  { id: 'functions', label: 'Edge Functions', icon: Code2 },
  { id: 'logs', label: 'Stack Logs', icon: Terminal },
  { id: 'controls', label: 'Stack Controls', icon: Activity },
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
  const [revealAnonKey, setRevealAnonKey] = useState(false)
  
  // Compose & env save state
  const [savingEnv, setSavingEnv] = useState(false)
  const [isEditingCompose, setIsEditingCompose] = useState(false)
  const [editedCompose, setEditedCompose] = useState('')
  const [savingCompose, setSavingCompose] = useState(false)
  const [composeError, setComposeError] = useState('')

  const [newFnName, setNewFnName]   = useState('')
  const [selectedFns, setSelectedFns] = useState(new Set())
  const [fnBusy, setFnBusy]         = useState(null)
  const [fnError, setFnError]       = useState('')
  const [zipFile, setZipFile]       = useState(null)
  const zipInputRef = useRef(null)
  
  const migRef  = useRef(null)
  const logsRef = useRef(null)

  const [sqlQuery, setSqlQuery] = useState("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';")
  const [queryResults, setQueryResults] = useState(null)
  const [queryError, setQueryError] = useState(null)
  const [queryBusy, setQueryBusy] = useState(false)
  const [tablesList, setTablesList] = useState([])

  const runQuery = async () => {
    setQueryBusy(true)
    setQueryError(null)
    setQueryResults(null)
    try {
      const { data } = await api.post(`/api/supabase/${id}/query`, { sql: sqlQuery })
      setQueryResults(data)
    } catch (e) {
      setQueryError(e.response?.data?.error || e.message)
    } finally {
      setQueryBusy(false)
    }
  }

  useEffect(() => {
    if (tab === 'sql') {
      api.post(`/api/supabase/${id}/query`, { sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;" })
        .then(r => {
          if (r.data?.rows) {
            setTablesList(r.data.rows.map(row => row.table_name))
          }
        })
        .catch(() => {})
    }
  }, [tab, id])

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
    if (detail?.composeContent) {
      setEditedCompose(detail.composeContent)
    }
  }, [detail])

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs])

  const fetchLogs = async () => {
    setLogsLoading(true); setLogs([])
    try {
      const token = localAuth.getToken() || ''
      const resp = await fetch(`${API_URL}/api/supabase/${id}/logs`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!resp.ok) throw new Error('Logs API unavailable')
      const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n'); buf = parts.pop()
        parts.forEach(l => { if (l.startsWith('data: ')) setLogs(p => [...p, l.slice(6)]) })
      }
    } catch (e) {
      setLogs([`✗ Error loading logs: ${e.message}`])
    } finally {
      setLogsLoading(false)
    }
  }

  const dockerAction = async (action) => {
    setActionBusy(action); setActionMsg('')
    try {
      if (action === 'down') await api.post(`/api/supabase/${id}/down`)
      else await api.post(`/api/supabase/${id}/${action}`)
      setActionMsg(`✓ ${action === 'start' ? 'Docker Compose started' : action === 'stop' ? 'Docker Compose stopped' : action === 'restart' ? 'Docker Compose restarted' : 'Docker stack brought down'} successfully`)
      
      // Refresh project status & details
      const [r, d] = await Promise.all([
        api.get('/api/supabase/projects'),
        api.get(`/api/supabase/${id}/detail`)
      ])
      const found = r.data.find(p => p.id === id)
      if (found) setProject(found)
      setDetail(d.data)
    } catch (e) {
      setActionMsg(`✗ Action failed: ${e.response?.data?.error || e.message}`)
    } finally {
      setActionBusy(null)
    }
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
      setActionMsg(runImmediately ? '✓ Migration uploaded and executed successfully' : '✓ Migration file stored inside stack')
      setMigFile(null)
      const r = await api.get(`/api/supabase/${id}/detail`)
      setDetail(r.data)
    } catch (e) { setActionMsg(`✗ Migration failed: ${e.message}`) }
    setActionBusy(null)
  }

  const runSelectedMigs = async () => {
    if (selectedMigs.size === 0) return
    setActionBusy('migrate'); setActionMsg('')
    try {
      // Sort migrations alphabetically/chronologically by their filenames
      const sortedFiles = Array.from(selectedMigs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      const { data } = await api.post(`/api/supabase/${id}/migrations/run`, {
        files: sortedFiles
      })
      const fails = data.results.filter(r => !r.success)
      if (fails.length) setActionMsg(`⚠ ${fails.length} migrations failed. Check console for outputs.`)
      else setActionMsg(`✓ Executed ${data.results.length} migrations successfully`)
      setSelectedMigs(new Set())
      const r = await api.get(`/api/supabase/${id}/detail`)
      setDetail(r.data)
    } catch (e) { setActionMsg(`✗ Execution failed: ${e.response?.data?.error || e.message}`) }
    setActionBusy(null)
  }

  const saveEnv = async () => {
    if (!revealedEnv) return
    setSavingEnv(true); setEnvError('')
    try {
      await api.put(`/api/supabase/${id}/env`, { content: revealedEnv })
      setActionMsg('✓ Environment saved. Stack recreation triggered in background.')
    } catch (e) {
      setEnvError(e.response?.data?.error || e.message)
    }
    setSavingEnv(false)
  }

  const saveCompose = async () => {
    if (!editedCompose) return
    setSavingCompose(true); setComposeError('')
    try {
      await api.put(`/api/supabase/${id}/compose`, { content: editedCompose })
      setActionMsg('✓ Compose blueprint saved. Stack rebuild triggered in background.')
      setIsEditingCompose(false)
      const r = await api.get(`/api/supabase/${id}/detail`)
      setDetail(r.data)
    } catch (e) {
      setComposeError(e.response?.data?.error || e.message)
    }
    setSavingCompose(false)
  }

  const createFunction = async () => {
    if (!newFnName) return
    setFnBusy('create'); setFnError('')
    try {
      await api.post(`/api/supabase/${id}/functions/create`, { name: newFnName })
      setNewFnName('')
      const r = await api.get(`/api/supabase/${id}/detail`)
      setDetail(r.data)
    } catch (e) {
      setFnError(e.response?.data?.error || e.message)
    } finally {
      setFnBusy(null)
    }
  }

  const deleteSelectedFunctions = async () => {
    if (selectedFns.size === 0) return
    if (!confirm(`Are you sure you want to permanently delete the ${selectedFns.size} selected edge functions?`)) return
    setFnBusy('delete'); setFnError('')
    try {
      await api.post(`/api/supabase/${id}/functions/delete`, { names: Array.from(selectedFns) })
      setSelectedFns(new Set())
      const r = await api.get(`/api/supabase/${id}/detail`)
      setDetail(r.data)
    } catch (e) {
      setFnError(e.response?.data?.error || e.message)
    } finally {
      setFnBusy(null)
    }
  }

  const uploadFunctionsZip = async (file) => {
    if (!file) return
    setFnBusy('upload'); setFnError('')
    try {
      const token = localAuth.getToken() || ''
      const body = new FormData()
      body.append('zipFile', file)
      const resp = await fetch(`${API_URL}/api/supabase/${id}/functions/upload-zip`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error || 'Failed to upload zip')
      setZipFile(null)
      const r = await api.get(`/api/supabase/${id}/detail`)
      setDetail(r.data)
    } catch (e) {
      setFnError(e.message)
    } finally {
      setFnBusy(null)
    }
  }

  const deployFunctions = async () => {
    setFnBusy('deploy'); setFnError(''); setActionMsg('')
    try {
      await api.post(`/api/supabase/${id}/functions/deploy`)
      setActionMsg('✓ Edge Functions reloaded and container restarted successfully')
    } catch (e) {
      setFnError(e.response?.data?.error || e.message)
    } finally {
      setFnBusy(null)
    }
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

  const getContainerServiceClass = (serviceName) => {
    const s = String(serviceName).toLowerCase()
    if (s.includes('db') || s.includes('postgres')) return { label: 'Database Service', color: '#10b981', bg: 'rgba(16, 185, 129, 0.08)' }
    if (s.includes('studio')) return { label: 'Web Console', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)' }
    if (s.includes('kong')) return { label: 'API Gateway', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)' }
    if (s.includes('auth') || s.includes('gotrue')) return { label: 'Identity Auth', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.08)' }
    if (s.includes('rest')) return { label: 'REST API Engine', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.08)' }
    if (s.includes('realtime')) return { label: 'Realtime Server', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.08)' }
    if (s.includes('storage')) return { label: 'Asset Storage', color: '#14b8a6', bg: 'rgba(20, 184, 166, 0.08)' }
    return { label: 'Stack Component', color: 'var(--color-text-muted)', bg: 'rgba(255,255,255,0.02)' }
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
      <RefreshCw size={28} className="animate-spin" color="var(--color-primary)" />
      <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Fetching Supabase container orchestrator details...</div>
    </div>
  )

  if (!project) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div className="glass-card" style={{ padding: 40, textAlign: 'center', maxWidth: 420 }}>
        <AlertTriangle size={36} color="var(--color-danger)" style={{ margin: '0 auto 16px' }} />
        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Project Not Found</h3>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 8, lineHeight: 1.5 }}>
          The requested Supabase stack configuration could not be loaded from active directories.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/supabase')} style={{ marginTop: 20 }}>
          ← Back to Projects
        </button>
      </div>
    </div>
  )

  const isRunning = project.status === 'running'

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>

      {/* ── Dynamic Page Header ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={() => navigate('/supabase')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.8125rem', padding: 0, width: 'fit-content' }}
        >
          <ArrowLeft size={14} /> Back to Projects list
        </button>

        <div className="glass-card" style={{ padding: '24px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20, background: 'linear-gradient(135deg, rgba(59,130,246,0.03) 0%, rgba(99,102,241,0.03) 100%)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', boxShadow: '0 8px 16px rgba(16,185,129,0.15)' }}>
              <Database size={24} color="white" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ margin: 0, fontSize: '1.65rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>{project.name}</h1>
                <span className={`badge ${isRunning ? 'badge-green' : 'badge-red'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', padding: '3px 10px', fontWeight: 700 }}>
                  <span className={`status-dot ${isRunning ? 'active' : ''}`} style={{ width: 6, height: 6, borderRadius: '50%', background: isRunning ? 'var(--color-success)' : 'var(--color-danger)' }}></span>
                  {project.status.toUpperCase()}
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{project.composePath}</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {project.apiUrl && (
              <a href={project.apiUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: '0.82rem', height: 36 }}>
                <Globe size={14}/> API Gateway <ExternalLink size={12} style={{ opacity: 0.7 }}/>
              </a>
            )}
            {project.studioUrl && (
              <a href={project.studioUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: '0.82rem', height: 36 }}>
                <Server size={14}/> Supabase Studio <ExternalLink size={12} style={{ opacity: 0.7 }}/>
              </a>
            )}
            <div style={{ width: 1, height: 24, background: 'var(--color-border)', margin: '0 8px', alignSelf: 'center' }}></div>
            
            <button className="btn btn-primary" onClick={() => dockerAction('start')} disabled={!!actionBusy || isRunning} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: '0.82rem', height: 36 }}>
              {actionBusy === 'start' ? <RefreshCw size={14} className="animate-spin"/> : <Play size={14}/>}
              Start Stack
            </button>
            <button className="btn btn-secondary" onClick={() => dockerAction('stop')} disabled={!!actionBusy || !isRunning} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: '0.82rem', height: 36 }}>
              {actionBusy === 'stop' ? <RefreshCw size={14} className="animate-spin"/> : <Square size={14}/>}
              Stop Stack
            </button>
          </div>
        </div>

        {actionMsg && (
          <div style={{
            padding: '12px 18px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 500, fontFamily: 'var(--font-mono)',
            background: actionMsg.startsWith('✓') ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
            color: actionMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-danger)',
            border: `1px solid ${actionMsg.startsWith('✓') ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
            display: 'flex', alignItems: 'center', gap: 8
          }}>
            <Info size={16} />
            <span>{actionMsg}</span>
          </div>
        )}
      </div>

      {/* ── Connection Spec Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        
        {/* PostgreSQL Connection */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Database connection URI</span>
              <CopyButton text={project.dbConn} />
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: 12 }}>Direct connection parameters for standard drivers and IDEs.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.15)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 12px', minHeight: 38 }}>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{project.dbConn}</code>
          </div>
        </div>

        {/* Anon / Public API Key */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Anon Public Service Key</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setRevealAnonKey(!revealAnonKey)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', color: 'var(--color-text-muted)', padding: '5px 8px', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {revealAnonKey ? <EyeOff size={12}/> : <Eye size={12}/>}
                </button>
                <CopyButton text={project.anonKey} />
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: 12 }}>Use in browser apps to interact directly with PostgreSQL using RLS.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.15)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 12px', minHeight: 38 }}>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--color-text-dim)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {revealAnonKey ? project.anonKey : '••••••••••••••••••••••••••••••••••••••••••••••••'}
            </code>
          </div>
        </div>

        {/* Port allocations specs */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(59, 130, 246, 0.06)', border: '1px solid rgba(59,130,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Cpu size={16} color="#3b82f6" />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Network Ports Info</span>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>Gateway:</span>
                <span style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 700, marginLeft: 4 }}>{project.kongPort || '—'}</span>
              </div>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>Postgres:</span>
                <span style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 700, marginLeft: 4 }}>{project.dbPort || '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dashboard credentials specs */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(236, 72, 153, 0.06)', border: '1px solid rgba(236,72,153,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Key size={16} color="#ec4899" />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Studio Console Auth</span>
            <div style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 4, color: 'var(--color-text)' }}>
              {project.dashboardUser} / {project.dashboardPass}
            </div>
          </div>
        </div>

      </div>

      {/* ── Navigation Tabs ── */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-border)', marginBottom: 6, overflowX: 'auto', paddingBottom: 1 }}>
        {TABS.map(t => {
          const Icon = t.icon
          const isActive = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); if (t.id === 'logs') fetchLogs() }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                fontSize: '0.82rem',
                fontWeight: isActive ? 700 : 500,
                background: 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                border: 'none',
                borderBottom: `2px solid ${isActive ? 'var(--color-primary)' : 'transparent'}`,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
                marginBottom: -1
              }}
            >
              <Icon size={14} color={isActive ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── Interactive Tab Panes ── */}
      <div style={{ flex: 1 }}>

        {/* CONTAINER ORCHESTRATION CARD LIST */}
        {tab === 'containers' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {(detail?.containers || []).length === 0 ? (
                <div className="glass-card" style={{ padding: 36, textAlign: 'center', gridColumn: '1/-1', color: 'var(--color-text-muted)' }}>
                  <Layers size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                  <div>No stack containers currently reporting status. Start the project to spin them up.</div>
                </div>
              ) : detail.containers.map((c, i) => {
                const running = (c.State || '').toLowerCase() === 'running'
                const healthy = (c.Health || '').toLowerCase() === 'healthy'
                const meta = getContainerServiceClass(c.Service || c.Name)
                
                return (
                  <div key={i} className="glass-card hover-glow" style={{ padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, background: meta.bg, color: meta.color, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          {meta.label}
                        </span>
                        
                        <span style={{
                          fontSize: '0.7rem', padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                          background: running ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                          color: running ? 'var(--color-success)' : 'var(--color-danger)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: running ? 'var(--color-success)' : 'var(--color-danger)' }}></span>
                          {c.State}
                        </span>
                      </div>
                      
                      <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-text)' }}>{c.Service || c.Name}</h4>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.Name}
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Ports Routing</div>
                      {(c.Publishers || []).filter(p => p.PublishedPort > 0).length === 0 ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Internal network only</div>
                      ) : (
                        (c.Publishers || []).filter(p => p.PublishedPort > 0).map((p, j) => (
                          <div key={j} style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>:{p.PublishedPort}</span>
                            <span style={{ opacity: 0.5 }}>→</span>
                            <span>:{p.TargetPort}/{p.Protocol}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Ports inspection subgrid */}
            {(detail?.ports || []).length > 0 && (
              <div className="glass-card" style={{ padding: 24, marginTop: 10 }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Globe size={18} color="var(--color-primary)" /> Exposed Orchestrator Network Mapping
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {['Service Container', 'Published Port', 'Target Container Port', 'Network Protocol'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '12px 14px', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.ports.map((p, i) => (
                        <tr key={i} style={{ borderBottom: i < detail.ports.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                          <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{p.container}</td>
                          <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', color: 'var(--color-primary)', fontWeight: 700 }}>:{p.published}</td>
                          <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)' }}>:{p.target}</td>
                          <td style={{ padding: '12px 14px' }}>
                            <span className="badge badge-green" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>{String(p.protocol).toUpperCase()}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SQL EDITOR TAB */}
        {tab === 'sql' && (
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, minHeight: 480 }}>
            {/* Left Column - Schema Tables Explorer */}
            <div style={{ background: 'var(--color-surface-2)', borderRadius: 10, padding: 16, border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
                <Database size={15} color="var(--color-primary)" />
                <span style={{ fontSize: '0.82rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text)' }}>Tables Explorer</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420 }}>
                {tablesList.length === 0 ? (
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '10px 0' }}>No tables found / loading…</span>
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
                        api.post(`/api/supabase/${id}/query`, { sql: q })
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
                      <FileText size={12} color="var(--color-text-muted)" />
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
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>⚡ SQL Query Console</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Execute custom SQL statements directly on your PostgreSQL database.</p>
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
                      style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                    >
                      {helper.name}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea 
                  className="input" 
                  value={sqlQuery} 
                  onChange={e => setSqlQuery(e.target.value)} 
                  style={{ 
                    width: '100%', 
                    height: 140, 
                    fontFamily: 'var(--font-mono)', 
                    fontSize: '0.82rem', 
                    lineHeight: 1.5,
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 10,
                    padding: 14,
                    color: 'var(--color-text)',
                    resize: 'vertical'
                  }}
                  placeholder="Enter your PostgreSQL query here..."
                />
                
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={runQuery} 
                    disabled={queryBusy || !sqlQuery.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', fontSize: '0.82rem' }}
                  >
                    <Play size={13} className={queryBusy ? 'animate-spin' : ''} />
                    {queryBusy ? 'Running Query...' : '⚡ Execute Query'}
                  </button>
                </div>
              </div>

              {queryError && (
                <div style={{ padding: '14px 18px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, color: 'var(--color-danger)', fontSize: '0.84rem', fontFamily: 'var(--font-mono)' }}>
                  ❌ Query Execution Failed: {queryError}
                </div>
              )}

              {queryResults && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-success)' }}>
                      ✓ Success: {queryResults.command} completed ({queryResults.rowCount !== null ? `${queryResults.rowCount} rows affected` : 'done'})
                    </span>
                  </div>

                  {queryResults.rows && queryResults.rows.length > 0 ? (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface-1)', maxHeight: 300 }}>
                      <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                          <tr style={{ background: 'var(--color-surface-3)', borderBottom: '1px solid var(--color-border)' }}>
                            {queryResults.fields.map(field => (
                              <th key={field} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                                {field}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResults.rows.map((row, idx) => (
                            <tr key={idx} style={{ borderBottom: idx < queryResults.rows.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                              {queryResults.fields.map(field => (
                                <td key={field} style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
                                  {row[field] === null ? <em style={{ color: 'var(--color-text-muted)' }}>null</em> : String(row[field])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ padding: '20px', background: 'var(--color-surface-2)', borderRadius: 10, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                      Query returned 0 rows.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* DATABASE MIGRATIONS TAB */}
        {tab === 'migrations' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            <div className="glass-card" style={{ padding: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>PostgreSQL Schema Migration Panel</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Upload `.sql` migrations or package `.zip` files to run structural updates directly against your isolated Database.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                {selectedMigs.size > 0 && (
                  <button className="btn btn-primary" onClick={runSelectedMigs} disabled={!!actionBusy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Play size={14}/> Run Selected ({selectedMigs.size})
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => migRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Upload size={14}/> Upload .sql Migration
                </button>
                <input ref={migRef} type="file" accept=".sql,.zip" hidden onChange={e => setMigFile(e.target.files[0])}/>
              </div>
            </div>

            {/* Active file uploader area */}
            {migFile && (
              <div className="glass-card animate-fade-in" style={{ padding: 18, background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(59,130,246,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileText size={16} color="var(--color-primary)" />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700 }}>{migFile.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{(migFile.size / 1024).toFixed(2)} KB · Ready to apply</div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setMigFile(null)} disabled={!!actionBusy}>
                    Cancel
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => uploadMigration(false)} disabled={!!actionBusy}>
                    Store Inside Stack
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => uploadMigration(true)} disabled={!!actionBusy}>
                    Apply Schema Now
                  </button>
                </div>
              </div>
            )}

            {/* Migrations list */}
            {(detail?.migrations || []).length === 0 ? (
              <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <Database size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>No migrations discovered</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                  No active backup files located under path <code style={{ fontFamily: 'var(--font-mono)' }}>{project.composePath}/migrations/</code>
                </p>
              </div>
            ) : (
              <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={detail.migrations.length > 0 && selectedMigs.size === detail.migrations.length}
                      onChange={() => {
                        if (selectedMigs.size === detail.migrations.length) {
                          setSelectedMigs(new Set())
                        } else {
                          setSelectedMigs(new Set(detail.migrations.map(m => m.name)))
                        }
                      }}
                      style={{ cursor: 'pointer', width: 14, height: 14 }}
                    />
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', fontWeight: 700 }}>Select All ({detail.migrations.length})</span>
                  </div>
                  {selectedMigs.size > 0 && <span style={{ fontSize: '0.82rem', color: 'var(--color-primary)', fontWeight: 700 }}>{selectedMigs.size} selected</span>}
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {detail.migrations.map((m, i) => {
                    const isSelected = selectedMigs.has(m.name)
                    return (
                      <div key={i} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '12px 20px',
                        borderBottom: i < detail.migrations.length - 1 ? '1px solid var(--color-border)' : 'none',
                        background: isSelected ? 'rgba(59,130,246,0.01)' : 'transparent',
                        transition: 'background 0.2s'
                      }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const s = new Set(selectedMigs)
                            if (s.has(m.name)) s.delete(m.name)
                            else s.add(m.name)
                            setSelectedMigs(s)
                          }}
                          style={{ cursor: 'pointer', width: 15, height: 15 }}
                        />
                        <FileText size={15} color="var(--color-text-muted)" />
                        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{m.name}</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{(m.size / 1024).toFixed(1)} KB</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ENV VARIABLES & SECRETS PANEL */}
        {tab === 'env' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            <div className="glass-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, borderBottom: '1px solid var(--color-border)', paddingBottom: 16, marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Dynamic Environment Configuration (.env)</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    Admin auth credentials are required to decrypt stack variables and secret keys.
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {revealedEnv && (
                    <button className="btn btn-primary btn-sm" onClick={saveEnv} disabled={savingEnv} style={{ height: 32, gap: 6 }}>
                      <Save size={14}/> {savingEnv ? 'Saving...' : 'Save & Recreate Stack'}
                    </button>
                  )}
                  {!revealedEnv ? (
                    <>
                      <input
                        type="password"
                        placeholder="Admin Password"
                        value={envPass}
                        onChange={e => setEnvPass(e.target.value)}
                        className="input"
                        style={{ width: 160, padding: '7px 12px', fontSize: '0.82rem', height: 32 }}
                        onKeyDown={e => { if (e.key === 'Enter') revealEnv() }}
                      />
                      <button className="btn btn-secondary btn-sm" onClick={revealEnv} style={{ height: 32 }}>
                        <Eye size={14}/> Decrypt Keys
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => { setRevealedEnv(null); setEnvPass('') }} style={{ height: 32 }}>
                      <EyeOff size={14}/> Hide Secrets
                    </button>
                  )}
                </div>
              </div>

              {envError && (
                <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: '0.8rem', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', color: 'var(--color-danger)', marginBottom: 16 }}>
                  {envError}
                </div>
              )}

              <div style={{ position: 'relative' }}>
                {revealedEnv ? (
                  <textarea
                    value={revealedEnv}
                    onChange={e => setRevealedEnv(e.target.value)}
                    disabled={savingEnv}
                    style={{
                      width: '100%',
                      height: 380,
                      margin: 0,
                      padding: 20,
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 10,
                      fontSize: '0.78rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text)',
                      lineHeight: 1.7,
                      resize: 'vertical'
                    }}
                  />
                ) : (
                  <pre style={{
                    margin: 0,
                    padding: 20,
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 10,
                    fontSize: '0.78rem',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    color: 'var(--color-text-dim)',
                    lineHeight: 1.7,
                    maxHeight: 500,
                    overflowY: 'auto'
                  }}>
                    {detail?.envContent || 'Decryption credentials needed to render .env variables.'}
                  </pre>
                )}
                
                {revealedEnv && (
                  <div style={{ position: 'absolute', top: 12, right: 12 }}>
                    <CopyButton text={revealedEnv} />
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* DOCKER COMPOSE SPEC TAB */}
        {tab === 'compose' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="glass-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Stack Orchestration Blueprint</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    {isEditingCompose ? 'Modify stack services, configuration, and ports safely.' : 'Configuration blueprint generated dynamically from the compose template.'}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>docker-compose.yml</span>
                  
                  {isEditingCompose ? (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setIsEditingCompose(false); setEditedCompose(detail?.composeContent || '') }} disabled={savingCompose}>
                        Cancel
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={saveCompose} disabled={savingCompose || !editedCompose.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Save size={14}/> {savingCompose ? 'Rebuilding Stack...' : 'Save & Rebuild Stack'}
                      </button>
                    </>
                  ) : (
                    detail?.composeContent && (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => setIsEditingCompose(true)}>
                          Edit Spec
                        </button>
                        <CopyButton text={detail.composeContent} />
                      </>
                    )
                  )}
                </div>
              </div>

              {composeError && (
                <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: '0.8rem', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', color: 'var(--color-danger)', marginBottom: 16 }}>
                  {composeError}
                </div>
              )}

              <div style={{ position: 'relative' }}>
                {isEditingCompose ? (
                  <textarea
                    value={editedCompose}
                    onChange={e => setEditedCompose(e.target.value)}
                    disabled={savingCompose}
                    style={{
                      width: '100%',
                      height: 480,
                      margin: 0,
                      padding: 20,
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 10,
                      fontSize: '0.78rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text)',
                      lineHeight: 1.6,
                      resize: 'vertical'
                    }}
                  />
                ) : (
                  <pre style={{
                    margin: 0,
                    padding: 20,
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 10,
                    fontSize: '0.78rem',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    color: '#22c55e',
                    lineHeight: 1.6,
                    maxHeight: 520,
                    overflowY: 'auto'
                  }}>
                    {detail?.composeContent || 'docker-compose.yml spec file is missing or not readable.'}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        {/* EDGE FUNCTIONS TAB */}
        {tab === 'functions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Control Bar Card */}
            <div className="glass-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800 }}>Supabase Edge Functions Console</h3>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    Create Deno functions, import zip bundles, redeploy edge services, and manage live API routes.
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="btn btn-secondary" onClick={() => zipInputRef.current?.click()} disabled={fnBusy === 'upload'} style={{ height: 36, fontSize: '0.8rem', gap: 6 }}>
                    {fnBusy === 'upload' ? <RefreshCw size={13} className="animate-spin"/> : <Upload size={13}/>}
                    Upload ZIP
                  </button>
                  <input type="file" ref={zipInputRef} accept=".zip" hidden onChange={e => { if (e.target.files?.[0]) uploadFunctionsZip(e.target.files[0]) }}/>

                  <button className="btn btn-secondary" onClick={deployFunctions} disabled={fnBusy === 'deploy'} style={{ height: 36, fontSize: '0.8rem', gap: 6 }}>
                    {fnBusy === 'deploy' ? <RefreshCw size={13} className="animate-spin"/> : <RotateCcw size={13}/>}
                    Restart Engine
                  </button>
                </div>
              </div>

              {/* Create Inline Form */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '16px 20px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--color-border)', borderRadius: 10, marginBottom: 20 }}>
                <Code2 size={16} color="var(--color-primary)"/>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-dim)', marginRight: 6 }}>Create Blank Function:</span>
                <input
                  type="text"
                  placeholder="e.g. hello-world"
                  value={newFnName}
                  onChange={e => setNewFnName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  className="input"
                  style={{ width: 220, height: 34, fontSize: '0.8rem', padding: '0 12px' }}
                />
                <button className="btn btn-primary" onClick={createFunction} disabled={!newFnName || fnBusy === 'create'} style={{ height: 34, fontSize: '0.8rem', gap: 6 }}>
                  {fnBusy === 'create' ? <RefreshCw size={13} className="animate-spin"/> : <Plus size={13}/>}
                  Create
                </button>
              </div>

              {/* Errors Panel */}
              {fnError && (
                <div className="glass-card" style={{ padding: '12px 18px', background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--color-danger)', marginBottom: 20 }}>
                  ✗ Error: {fnError}
                </div>
              )}

              {/* Selected Bulks Card */}
              {selectedFns.size > 0 && (
                <div className="glass-card animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, marginBottom: 20 }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-danger)' }}>{selectedFns.size} functions selected for deletion</span>
                  <button className="btn btn-danger btn-sm" onClick={deleteSelectedFunctions} disabled={fnBusy === 'delete'} style={{ marginLeft: 'auto', gap: 6, padding: '0 12px', height: 30, fontSize: '0.78rem' }}>
                    {fnBusy === 'delete' ? <RefreshCw size={12} className="animate-spin"/> : <Trash2 size={12}/>}
                    Bulk Delete
                  </button>
                </div>
              )}

              {/* Functions Table / List */}
              {(detail?.functions || []).length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--color-border)', borderRadius: 10 }}>
                  <Code2 size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                    No edge functions currently deployed. Upload a ZIP or create a blank function above!
                  </div>
                </div>
              ) : (
                <div className="glass-card" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                  <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.01)' }}>
                    <input
                      type="checkbox"
                      checked={selectedFns.size === detail.functions.length && detail.functions.length > 0}
                      onChange={() => {
                        if (selectedFns.size === detail.functions.length) {
                          setSelectedFns(new Set())
                        } else {
                          setSelectedFns(new Set(detail.functions))
                        }
                      }}
                      style={{ cursor: 'pointer', width: 14, height: 14 }}
                    />
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>Select All Deployed Functions</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {detail.functions.map((fn, i) => {
                      const isSelected = selectedFns.has(fn)
                      const endpointUrl = `${project?.apiUrl || 'https://db.example.com'}/functions/v1/${fn}`
                      
                      return (
                        <div key={fn} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          padding: '14px 18px',
                          borderBottom: i < detail.functions.length - 1 ? '1px solid var(--color-border)' : 'none',
                          background: isSelected ? 'rgba(59,130,246,0.02)' : 'transparent',
                          transition: 'background 0.2s',
                          flexWrap: 'wrap'
                        }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const s = new Set(selectedFns)
                              if (s.has(fn)) s.delete(fn)
                              else s.add(fn)
                              setSelectedFns(s)
                            }}
                            style={{ cursor: 'pointer', width: 14, height: 14 }}
                          />

                          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Code2 size={15} color="#a855f7" />
                          </div>

                          <div style={{ minWidth: 160 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>{fn}</span>
                            <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', marginTop: 2 }}>Deno Runtime edge function</div>
                          </div>

                          {/* Endpoint link with Copy */}
                          <div style={{ flex: 1, minWidth: 280, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--color-surface-2)', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                            <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>POST</span>
                            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--color-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {endpointUrl}
                            </code>
                            <CopyButton text={endpointUrl} />
                          </div>

                          <span className="badge badge-green" style={{ fontSize: '0.7rem', padding: '3px 8px', fontWeight: 700 }}>
                            ACTIVE
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Structure Instructions Card */}
            <div className="glass-card" style={{ padding: 24 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Info size={15} color="var(--color-primary)"/> ZIP Import Structure Instructions
              </h4>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                Create a `.zip` archive containing your edge functions. Each function must reside in its own subdirectory containing an `index.ts` entry handler file:
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 20 }}>
                <div>
                  <pre style={{
                    margin: 0,
                    padding: '14px 18px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.76rem',
                    color: 'var(--color-text-dim)',
                    lineHeight: 1.6
                  }}>{`📦 main.zip
└── 📁 send-otp
    ├── 📄 index.ts (Deno handler file)
    └── 📄 ... (helpers/configs)
└── 📁 db-dump
    ├── 📄 index.ts
    └── 📄 ...`}</pre>
                </div>
                
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, lineHeight: 1.4 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--color-primary)', fontWeight: 800 }}>1.</span>
                    <span><strong>Naming Constraint:</strong> Subdirectory names will determine the endpoint route (e.g. <code>/functions/v1/send-otp</code>).</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--color-primary)', fontWeight: 800 }}>2.</span>
                    <span><strong>Entry File:</strong> An <code>index.ts</code> is required as the core execution endpoint handler for the Deno engine.</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--color-primary)', fontWeight: 800 }}>3.</span>
                    <span><strong>Automatic Hot-Reload:</strong> Unzipping places files instantly into the directory. Press "Restart Engine" to recycle the container immediately.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CONTAINER LIVE SHELL LOGS */}
        {tab === 'logs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="glass-card" style={{ padding: 24 }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Stack Runtime Stream</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    Aggregated real-time output streams from all Docker Compose services.
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={fetchLogs} disabled={logsLoading} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', fontSize: '0.8rem' }}>
                  <RefreshCw size={13} className={logsLoading ? 'animate-spin' : ''}/> {logsLoading ? 'Loading stream...' : 'Refresh Logs'}
                </button>
              </div>

              <div ref={logsRef} style={{
                background: '#070708',
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                padding: 16,
                height: 480,
                overflowY: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                lineHeight: 1.6,
                color: '#a1a1aa'
              }}>
                {logs.length === 0 ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: '0.82rem' }}>
                    {logsLoading ? 'Reading live Docker buffer streams...' : 'Click "Refresh Logs" to stream active process details.'}
                  </div>
                ) : logs.map((l, i) => {
                  let logColor = '#a1a1aa'
                  if (l.toLowerCase().includes('error') || l.toLowerCase().includes('fail')) logColor = '#f87171'
                  else if (l.toLowerCase().includes('warn')) logColor = '#fbbf24'
                  else if (l.toLowerCase().includes('success') || l.toLowerCase().includes('healthy')) logColor = '#34d399'
                  else if (l.toLowerCase().includes('connect') || l.toLowerCase().includes('http')) logColor = '#60a5fa'
                  
                  return (
                    <div key={i} style={{ color: logColor, borderBottom: '1px solid rgba(255,255,255,0.01)', paddingBottom: 4, marginBottom: 4 }}>
                      <span style={{ opacity: 0.3, marginRight: 8, fontSize: '0.7rem' }}>[{String(i+1).padStart(3, '0')}]</span>
                      {l}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* REVOLUTIONARY SYSTEM CONTROLS */}
        {tab === 'controls' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Orchestration stack panel */}
            <div className="glass-card" style={{ padding: 24 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800 }}>Docker Compose Actions</h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                System-level actions targeting the entire project stack configuration.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>Soft Power Actions</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                      Control the container services state without discarding stack volumes or configurations.
                    </p>
                  </div>
                  
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => dockerAction('start')} disabled={!!actionBusy || isRunning} style={{ flex: 1, height: 34, fontSize: '0.8rem', gap: 6 }}>
                      <Play size={13}/> Start
                    </button>
                    <button className="btn btn-secondary" onClick={() => dockerAction('stop')} disabled={!!actionBusy || !isRunning} style={{ flex: 1, height: 34, fontSize: '0.8rem', gap: 6 }}>
                      <Square size={13}/> Stop
                    </button>
                    <button className="btn btn-secondary" onClick={() => dockerAction('restart')} disabled={!!actionBusy || !isRunning} style={{ flex: 1, height: 34, fontSize: '0.8rem', gap: 6 }}>
                      <RotateCcw size={13}/> Restart
                    </button>
                  </div>
                </div>

                <div style={{ border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14, background: 'rgba(239,68,68,0.01)' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-danger)' }}>Destructive Stack Down</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                      Runs <code style={{ fontFamily: 'var(--font-mono)' }}>docker compose down</code> to stop and safely remove all stack containers.
                    </p>
                  </div>
                  
                  <button className="btn btn-secondary" onClick={() => dockerAction('down')} disabled={!!actionBusy} style={{ borderColor: 'rgba(239,68,68,0.25)', color: 'var(--color-danger)', height: 34, fontSize: '0.8rem', gap: 6 }}>
                    <ArrowDown size={13}/> Discard Containers
                  </button>
                </div>

              </div>
            </div>

            {/* General Specs widget */}
            <div className="glass-card" style={{ padding: 24 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 800 }}>Stack Environment Variables Summary</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 30px' }}>
                {[
                  ['Compose Directory', project.composePath],
                  ['Kong Proxy Target', project.apiUrl || `http://127.0.0.1:${project.kongPort}`],
                  ['Postgres Port', project.dbPort || '5432'],
                  ['Studio Interface', project.studioUrl || `http://127.0.0.1:${project.studioPort}`],
                  ['Project Registry', project.builtin ? 'Auto-detected System' : 'Custom Wizard Project'],
                  ['Stack Init Date', new Date(project.created).toLocaleString()]
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{label}</span>
                    <span style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text)' }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
