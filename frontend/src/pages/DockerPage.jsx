import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Play, Square, RotateCcw, Trash2, Plus, RefreshCw, Terminal,
  Cpu, ChevronDown, ChevronRight, X, Search,
  Container, Layers, Network, Image, AlertCircle, ShieldAlert,
  Sliders, FileText, Check, Copy, HelpCircle, HardDrive
} from 'lucide-react'
import api from '../lib/api'
import { localAuth } from '../lib/auth'

const STATUS_COLOR = {
  running: '#10b981',
  exited: '#f43f5e',
  stopped: '#f43f5e',
  paused: '#fbbf24',
  created: '#9ca3af',
}

function LogDrawer({ container, onClose }) {
  const [lines, setLines] = useState([])
  const ref = useRef()

  useEffect(() => {
    // FIXING DOCKER CONTAINER LOGS AUTH BUG: 
    // Retrieve correct standalone local JWT token
    const token = localAuth.getToken() || ''
    const ctrl = new AbortController()
    
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4001'}/api/docker/${container.id}/logs`, {
      headers: { Authorization: `Bearer ${token}` }, 
      signal: ctrl.signal
    }).then(async resp => {
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value)
        const parts = buf.split('\n')
        buf = parts.pop()
        parts.forEach(line => { 
          if (line.startsWith('data: ')) {
            setLines(l => [...l.slice(-300), line.slice(6)]) 
          }
        })
      }
    }).catch(() => {})
    
    return () => ctrl.abort()
  }, [container.id])

  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight) }, [lines])

  const copyLogs = () => {
    navigator.clipboard.writeText(lines.join('\n'))
    alert('✓ Logs copied to clipboard!')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end', backdropFilter: 'blur(4px)' }}>
      <div style={{ width: '100%', height: '55vh', background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }} className="animate-slide-up">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Terminal size={16} color="var(--color-primary)" />
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Container Log Output Stream — {container.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={copyLogs} disabled={lines.length === 0}>
              <Copy size={12}/> Copy Logs
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={13} /></button>
          </div>
        </div>
        
        <div 
          ref={ref} 
          className="terminal" 
          style={{ 
            flex: 1, 
            overflowY: 'auto', 
            borderRadius: 0, 
            fontSize: '0.78rem', 
            lineHeight: 1.6, 
            padding: 20, 
            background: '#010409' 
          }}
        >
          {lines.length === 0 ? (
            <span style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
              Connecting to docker daemon container stream...
            </span>
          ) : (
            lines.map((l, i) => (
              <div key={i} style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', color: '#e6edf3', marginTop: 1 }}>{l}</div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function DeployModal({ onClose, onDeployed }) {
  const [form, setForm] = useState({ name: '', image: '', composeProject: 'standalone' })
  const [ports, setPorts] = useState([{ key: '', value: '' }])
  const [envVars, setEnvVars] = useState([{ key: '', value: '' }])
  const [volumes, setVolumes] = useState([{ key: '', value: '' }])
  const [tab, setTab] = useState('simple') // 'simple' | 'compose'
  const [yaml, setYaml] = useState(`version: '3.8'\nservices:\n  app:\n    image: nginx:alpine\n    ports:\n      - "8888:80"\n    restart: unless-stopped\n`)
  const [composeName, setComposeName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [portCheck, setPortCheck] = useState({})

  const checkPort = async (port) => {
    if (!port || isNaN(port)) return
    try {
      const r = await api.get('/api/ports/check', { params: { port } })
      setPortCheck(p => ({ ...p, [port]: r.data.available ? '✓ free' : '✗ occupied' }))
    } catch { }
  }

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      if (tab === 'compose') {
        if (!composeName.trim()) throw new Error('Docker Compose Project Name is required.')
        await api.post('/api/docker/compose', { name: composeName, yaml })
      } else {
        await api.post('/api/docker/deploy', { ...form, ports, envVars, volumes })
      }
      onDeployed()
    } catch (e) { 
      setError(e.response?.data?.error || e.message) 
    }
    setBusy(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(3px)' }}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 640, padding: 28, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom:'1px solid var(--color-border)', paddingBottom:12 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize:'1.2rem', letterSpacing:'-0.02em' }}>Deploy Container Application</h3>
            <p style={{ margin:'4px 0 0 0', fontSize:'0.8rem', color:'var(--color-text-muted)' }}>
              Orchestrate new Docker containers instantly with custom volumes and parameters.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14} /></button>
        </div>

        {/* Dynamic tabs */}
        <div className="tabs" style={{ marginBottom: 20 }}>
          <button type="button" className={`tab ${tab === 'simple' ? 'active' : ''}`} onClick={() => setTab('simple')} style={{ flex:1 }}>
            🐳 Single Container Builder
          </button>
          <button type="button" className={`tab ${tab === 'compose' ? 'active' : ''}`} onClick={() => setTab('compose')} style={{ flex:1 }}>
            🐙 Docker Compose Stack
          </button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', color: 'var(--color-danger)', borderRadius: 8, marginBottom: 16, fontSize: '0.82rem', display:'flex', gap:8, alignItems:'center' }}>
            <ShieldAlert size={16}/> {error}
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {tab === 'simple' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label className="label">Container Name</label>
                  <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. my-redis-db" required />
                </div>
                <div>
                  <label className="label">Docker Image Source</label>
                  <input className="input" value={form.image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))} placeholder="e.g. redis:alpine" required />
                </div>
              </div>

              <div>
                <label className="label">Compose Project Group (Optional)</label>
                <input className="input" value={form.composeProject} onChange={e => setForm(f => ({ ...f, composeProject: e.target.value }))} placeholder="standalone" />
              </div>

              {/* Ports */}
              <div>
                <label className="label" style={{ marginBottom: 8, display: 'block' }}>Port Allocations (host_port:container_port)</label>
                {ports.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                    <input className="input" placeholder="Host Port" value={p.key} onChange={e => { const n = [...ports]; n[i].key = e.target.value; setPorts(n) }} style={{ width: 120 }} onBlur={() => checkPort(p.key)} />
                    <span style={{ color: 'var(--color-text-muted)', fontWeight:700 }}>:</span>
                    <input className="input" placeholder="Container Port" value={p.value} onChange={e => { const n = [...ports]; n[i].value = e.target.value; setPorts(n) }} style={{ width: 120 }} />
                    
                    {p.key && portCheck[p.key] && (
                      <span style={{ fontSize: '0.75rem', fontWeight:600, color: portCheck[p.key].includes('free') ? 'var(--color-success)' : 'var(--color-danger)', background: portCheck[p.key].includes('free') ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)', padding:'4px 8px', borderRadius:6 }}>
                        {portCheck[p.key]}
                      </span>
                    )}
                    <button type="button" onClick={() => setPorts(ports.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', marginLeft:'auto' }}><X size={15} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPorts([...ports, { key: '', value: '' }])}>
                  <Plus size={12} /> Add Port Mapping
                </button>
              </div>

              {/* Env Vars */}
              <div>
                <label className="label" style={{ marginBottom: 8, display: 'block' }}>Environment Variables</label>
                {envVars.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                    <input className="input" placeholder="VARIABLE_NAME" value={e.key} onChange={ev => { const n = [...envVars]; n[i].key = ev.target.value; setEnvVars(n) }} style={{ flex: 1, fontFamily:'var(--font-mono)', fontSize:'0.82rem' }} />
                    <input className="input" placeholder="value" value={e.value} onChange={ev => { const n = [...envVars]; n[i].value = ev.target.value; setEnvVars(n) }} style={{ flex: 1.5 }} />
                    <button type="button" onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}><X size={15} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEnvVars([...envVars, { key: '', value: '' }])}>
                  <Plus size={12} /> Add Variable
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">Docker Compose Project Name</label>
                <input className="input" value={composeName} onChange={e => setComposeName(e.target.value)} placeholder="e.g. mail-stack" required />
              </div>
              <div>
                <label className="label">Compose Configuration File (docker-compose.yml)</label>
                <textarea 
                  value={yaml} 
                  onChange={e => setYaml(e.target.value)} 
                  style={{ 
                    width: '100%', 
                    height: 250, 
                    background: '#010409', 
                    color: '#e6edf3', 
                    border: '1px solid var(--color-border)', 
                    borderRadius: 8, 
                    padding: '14px 18px', 
                    fontFamily: 'var(--font-mono)', 
                    fontSize: '0.82rem', 
                    lineHeight: 1.6, 
                    outline: 'none', 
                    resize: 'vertical' 
                  }} 
                />
              </div>
            </>
          )}

          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop: 12, borderTop:'1px solid var(--color-border)', paddingTop:16 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <RefreshCw size={14} className="animate-spin"/> : <Sliders size={14}/>}
              {busy ? 'Orchestrating...' : 'Trigger Deployment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ContainerCard({ c, onAction, onLogs }) {
  const [loading, setLoading] = useState(false)
  const isRunning = c.status === 'running'

  const run = async (act) => {
    setLoading(true)
    await onAction(c, act)
    setLoading(false)
  }

  // Parse CPU/RAM safely
  const cpuPercent = parseFloat(c.cpu) || 0
  const ramMb = parseFloat(c.memory) || 0

  return (
    <div className="glass-card animate-fade-in" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, transition:'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      {/* Header and Branding */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLOR[c.status] || '#6b7280', flexShrink: 0, boxShadow: isRunning ? '0 0 8px #10b981' : 'none' }} />
            <span style={{ fontWeight: 800, fontSize: '0.93rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color:'var(--color-text)' }}>{c.name}</span>
          </div>
          <code style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', display: 'block', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.image}>
            {c.image}
          </code>
        </div>
        <span style={{ fontSize: '0.7rem', textTransform:'uppercase', fontWeight:800, letterSpacing:'0.05em', color: isRunning ? 'var(--color-success)' : 'var(--color-text-muted)', padding:'3px 8px', borderRadius:6, background: isRunning ? 'rgba(16,185,129,0.06)' : 'rgba(255,255,255,0.03)' }}>
          {c.status}
        </span>
      </div>

      {/* Network Ports Info */}
      {c.ports.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
          {c.ports.slice(0, 3).map((port, idx) => (
            <span key={idx} style={{ fontSize:'0.7rem', color:'var(--color-text-dim)', background:'rgba(255,255,255,0.02)', border:'1px solid var(--color-border)', padding:'2px 6px', borderRadius:4, fontFamily:'var(--font-mono)' }}>
              {port}
            </span>
          ))}
        </div>
      )}

      {/* Dynamic Resource Meters */}
      {isRunning && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding:'10px 12px', background:'rgba(255,255,255,0.01)', borderRadius:8, border:'1px solid var(--color-border)' }}>
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.72rem', color:'var(--color-text-muted)', marginBottom:4 }}>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><Cpu size={11}/> CPU Load</span>
              <span style={{ fontWeight:700, color:'var(--color-text)' }}>{cpuPercent.toFixed(1)}%</span>
            </div>
            <div style={{ height: 4, width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(cpuPercent, 100)}%`, background: cpuPercent > 80 ? 'var(--color-danger)' : cpuPercent > 50 ? 'var(--color-warning)' : 'var(--color-primary)', transition: 'width 0.4s' }} />
            </div>
          </div>

          <div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.72rem', color:'var(--color-text-muted)', marginBottom:4 }}>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><HardDrive size={11}/> Memory Footprint</span>
              <span style={{ fontWeight:700, color:'var(--color-text)' }}>{ramMb.toFixed(0)} MB</span>
            </div>
            <div style={{ height: 4, width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min((ramMb / 1024) * 100, 100)}%`, background: ramMb > 800 ? 'var(--color-danger)' : 'var(--color-primary)', transition: 'width 0.4s' }} />
            </div>
          </div>
        </div>
      )}

      {/* Modern Controls Bar */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto', borderTop:'1px solid var(--color-border)', paddingTop:12 }}>
        {!isRunning ? (
          <button className="btn btn-success btn-sm" style={{ padding: '6px 10px', fontSize: '0.75rem' }} onClick={() => run('start')} disabled={loading}>
            <Play size={12} /> Start
          </button>
        ) : (
          <button className="btn btn-secondary btn-sm" style={{ padding: '6px 10px', fontSize: '0.75rem' }} onClick={() => run('stop')} disabled={loading}>
            <Square size={12} /> Stop
          </button>
        )}
        <button className="btn btn-secondary btn-sm" style={{ padding: '6px 10px', fontSize: '0.75rem' }} onClick={() => run('restart')} disabled={loading} title="Restart container">
          <RotateCcw size={12} />
        </button>
        <button className="btn btn-secondary btn-sm" style={{ padding: '6px 10px', fontSize: '0.75rem', gap:4 }} onClick={() => onLogs(c)} disabled={loading}>
          <Terminal size={12} /> Stream Logs
        </button>
        <button className="btn btn-danger btn-sm" style={{ padding: '6px 10px', fontSize: '0.75rem', marginLeft:'auto' }} onClick={() => run('remove')} disabled={loading}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

export default function DockerPage() {
  const [containers, setContainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [logsFor, setLogsFor] = useState(null)
  const [showDeploy, setShowDeploy] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/docker/containers')
      setContainers(r.data)
    } catch { } finally { setLoading(false) }
  }, [])

  useEffect(() => { 
    load(); 
    const t = setInterval(load, 5000)
    return () => clearInterval(t) 
  }, [load])

  const action = async (c, act) => {
    if (act === 'remove' && !confirm(`Are you absolutely sure you want to delete container: ${c.name}?`)) return
    try { 
      await api.post(`/api/docker/${c.id}/${act}`)
      load() 
    } catch (e) { 
      alert(e.response?.data?.error || e.message) 
    }
  }

  const filtered = containers.filter(c => 
    !search || 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.image.toLowerCase().includes(search.toLowerCase())
  )

  const groups = {}
  for (const c of filtered) {
    const g = c.composeProject || 'standalone'
    groups[g] = groups[g] || []
    groups[g].push(c)
  }

  const totalRunning = containers.filter(c => c.status === 'running').length

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {logsFor && <LogDrawer container={logsFor} onClose={() => setLogsFor(null)} />}
      {showDeploy && <DeployModal onClose={() => setShowDeploy(false)} onDeployed={() => { setShowDeploy(false); load() }} />}

      {/* Header and controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em' }}>Docker Service Orchestrator</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
            Monitor processes, review isolated virtualization networks, and spin up microservices in container sandboxes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input 
              className="input" 
              placeholder="Filter container name or image..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              style={{ paddingLeft: 34, height: 38, fontSize: '0.85rem', width: 240 }} 
            />
          </div>
          <button className="btn btn-secondary" onClick={load} title="Refresh containers list">
            <RefreshCw size={15} />
          </button>
          <button className="btn btn-primary" onClick={() => setShowDeploy(true)}>
            <Plus size={16} /> Deploy Container
          </button>
        </div>
      </div>

      {/* Overview Stat Widgets */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <div className="glass-card" style={{ padding: '16px 20px', display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ background:'rgba(16,185,129,0.08)', padding:12, borderRadius:12 }}>
            <Container size={22} color="#10b981"/>
          </div>
          <div>
            <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', textTransform:'uppercase', fontWeight:700 }}>Running Apps</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, marginTop:2 }}>{totalRunning} Services</div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px 20px', display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ background:'rgba(99,102,241,0.08)', padding:12, borderRadius:12 }}>
            <Layers size={22} color="var(--color-primary)"/>
          </div>
          <div>
            <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', textTransform:'uppercase', fontWeight:700 }}>Active Projects</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, marginTop:2 }}>{Object.keys(groups).length} Docker Stacks</div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px 20px', display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ background:'rgba(6,182,212,0.08)', padding:12, borderRadius:12 }}>
            <Network size={22} color="#06b6d4"/>
          </div>
          <div>
            <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', textTransform:'uppercase', fontWeight:700 }}>Total Virtual Containers</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, marginTop:2 }}>{containers.length} Registered</div>
          </div>
        </div>
      </div>

      {/* Docker Projects / Groups Accordion list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 10 }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <RefreshCw size={24} className="animate-spin" style={{ display:'block', margin:'0 auto 10px' }}/>
            Polling Docker engine daemon sockets...
          </div>
        ) : Object.keys(groups).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, border: '1px dashed var(--color-border)', borderRadius: 16 }}>
            <AlertCircle size={32} style={{ display:'block', margin:'0 auto 12px', color:'var(--color-text-muted)' }}/>
            <p style={{ margin:0, fontWeight:700 }}>No Docker containers found</p>
            <p style={{ margin:'4px 0 0 0', fontSize:'0.82rem', color:'var(--color-text-muted)' }}>Get started by spinning up a new container image above.</p>
          </div>
        ) : (
          Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([project, ctrs]) => {
            const isCollapsed = collapsed[project]
            const runningCount = ctrs.filter(c => c.status === 'running').length
            
            return (
              <div key={project} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Custom Stack Header card */}
                <div
                  onClick={() => setCollapsed(c => ({ ...c, [project]: !c[project] }))}
                  className="glass-card"
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 12, 
                    padding: '12px 18px', 
                    cursor: 'pointer', 
                    userSelect: 'none',
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid var(--color-border)'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
                >
                  {isCollapsed ? <ChevronRight size={16} color="var(--color-text-muted)"/> : <ChevronDown size={16} color="var(--color-text-muted)"/>}
                  <Layers size={16} color="var(--color-primary)" />
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing:'-0.02em', textTransform: 'capitalize' }}>
                    {project === 'standalone' ? 'Standalone Containers' : `${project} stack`}
                  </span>
                  
                  <span style={{ 
                    fontSize: '0.75rem', 
                    fontWeight: 700,
                    color: runningCount === ctrs.length ? 'var(--color-success)' : 'var(--color-warning)',
                    background: runningCount === ctrs.length ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)',
                    padding: '3px 10px', 
                    borderRadius: 6,
                    marginLeft: 10
                  }}>
                    {runningCount}/{ctrs.length} Active Services
                  </span>
                </div>

                {!isCollapsed && (
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
                    gap: 16,
                    paddingLeft: 12,
                    marginBottom: 10
                  }}>
                    {ctrs.map(c => (
                      <ContainerCard key={c.id} c={c} onAction={action} onLogs={setLogsFor} />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
