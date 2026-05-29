import { useState, useEffect, useRef, Fragment } from 'react'
import api from '../lib/api'
import { 
  Cpu, RefreshCw, Trash2, Search, XCircle, Play, 
  Terminal, ShieldAlert, Award, Clock, ArrowUpDown, ChevronDown, ChevronRight
} from 'lucide-react'
import { Dialog } from '../components/Dialog'

export default function ProcessesPage() {
  const [processes, setProcesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('cpu') // 'cpu', 'mem', 'pid', 'name'
  const [sortDesc, setSortDesc] = useState(true)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(3) // seconds, 0 = disabled
  const [expandedPids, setExpandedPids] = useState({}) // track expanded command CLI detail view
  const [dialog, setDialog] = useState(null)

  const refreshTimer = useRef(null)

  const showSuccess = (title, message) => {
    setDialog({ title, message, type: 'success', onConfirm: () => setDialog(null) })
  }

  const showError = (title, message) => {
    setDialog({ title, message, type: 'warning', onConfirm: () => setDialog(null) })
  }

  const loadProcesses = async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/processes')
      setProcesses(data.processes || [])
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  // Handle auto-refresh effect
  useEffect(() => {
    loadProcesses()
    
    if (refreshTimer.current) clearInterval(refreshTimer.current)
    
    if (autoRefreshInterval > 0) {
      refreshTimer.current = setInterval(() => {
        loadProcesses(true)
      }, autoRefreshInterval * 1000)
    }

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current)
    }
  }, [autoRefreshInterval])

  const toggleExpand = (pid) => {
    setExpandedPids(prev => ({
      ...prev,
      [pid]: !prev[pid]
    }))
  }

  const terminateProcess = (pid, name) => {
    setDialog({
      title: 'Gracefully Terminate?',
      message: `Are you sure you want to send a graceful termination signal (SIGTERM -15) to process '${name}' (PID: ${pid})?`,
      type: 'confirm',
      onConfirm: async () => {
        setDialog(null)
        try {
          const { data } = await api.post(`/api/processes/${pid}/terminate`)
          setSuccess(data.message)
          setTimeout(() => setSuccess(null), 3000)
          loadProcesses(true)
        } catch (err) {
          showError('Signal Failed', err.response?.data?.error || err.message)
        }
      },
      onCancel: () => setDialog(null)
    })
  }

  const killProcess = (pid, name) => {
    setDialog({
      title: '⚠️ Force Kill Process?',
      message: `Warning: This will forcefully kill process '${name}' (PID: ${pid}) immediately using SIGKILL -9. This can cause unsaved data loss. Proceed?`,
      type: 'confirm',
      onConfirm: async () => {
        setDialog(null)
        try {
          const { data } = await api.post(`/api/processes/${pid}/kill`)
          setSuccess(data.message)
          setTimeout(() => setSuccess(null), 3000)
          loadProcesses(true)
        } catch (err) {
          showError('Signal Failed', err.response?.data?.error || err.message)
        }
      },
      onCancel: () => setDialog(null)
    })
  }

  // Sort and filter processes
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDesc(!sortDesc)
    } else {
      setSortBy(field)
      setSortDesc(true)
    }
  }

  const filtered = processes.filter(p => {
    const term = search.toLowerCase()
    return (
      p.command.toLowerCase().includes(term) ||
      p.args.toLowerCase().includes(term) ||
      p.pid.toString().includes(term) ||
      p.user.toLowerCase().includes(term)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    let fieldA, fieldB
    if (sortBy === 'cpu') {
      fieldA = a.cpu
      fieldB = b.cpu
    } else if (sortBy === 'mem') {
      fieldA = a.mem
      fieldB = b.mem
    } else if (sortBy === 'pid') {
      fieldA = a.pid
      fieldB = b.pid
    } else {
      fieldA = a.command.toLowerCase()
      fieldB = b.command.toLowerCase()
    }

    if (fieldA < fieldB) return sortDesc ? 1 : -1
    if (fieldA > fieldB) return sortDesc ? -1 : 1
    return 0
  })

  // Calculate totals
  const totalCpu = parseFloat(processes.reduce((sum, p) => sum + p.cpu, 0).toFixed(1))
  const totalMem = parseFloat(processes.reduce((sum, p) => sum + p.mem, 0).toFixed(1))

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Cpu size={28} color="var(--color-primary)" />
            VPS Task Manager
          </h1>
          <p style={{ margin: '6px 0 0 0', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            Real-time Ubuntu process monitoring. Filter, sort, inspect full paths, and safely terminate or kill active tasks.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Auto Refresh dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            <span>Update Speed:</span>
            <select 
              value={autoRefreshInterval}
              onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: '6px 12px',
                color: 'var(--color-text)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value={1} style={{ background: '#0a0a0a' }}>High (1s)</option>
              <option value={3} style={{ background: '#0a0a0a' }}>Normal (3s)</option>
              <option value={5} style={{ background: '#0a0a0a' }}>Slow (5s)</option>
              <option value={0} style={{ background: '#0a0a0a' }}>Paused (Off)</option>
            </select>
          </div>

          <button 
            className="btn btn-secondary" 
            onClick={() => loadProcesses()} 
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36 }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.15)', color: 'var(--color-danger)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldAlert size={18} />
          <span>Error: {error}</span>
        </div>
      )}

      {success && (
        <div style={{ padding: '12px 20px', borderRadius: 12, background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.15)', color: 'var(--color-success)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 10, animation: 'fade-in 0.3s' }}>
          <span>✓ {success}</span>
        </div>
      )}

      {/* System Resource Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
        
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255, 255, 255, 0.015)' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>
            Total Running Processes
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, display: 'flex', alignItems: 'baseline', gap: 6 }}>
            {processes.length}
            <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>active threads</span>
          </div>
        </div>

        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255, 255, 255, 0.015)' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 800, display: 'flex', justifyContent: 'space-between' }}>
            <span>Aggregate CPU Cost</span>
            <span style={{ color: totalCpu > 80 ? 'var(--color-danger)' : totalCpu > 50 ? '#f59e0b' : 'var(--color-success)' }}>{totalCpu}%</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900 }}>
            {totalCpu}%
          </div>
          <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.03)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, totalCpu)}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #10b981)', transition: 'width 0.3s ease' }} />
          </div>
        </div>

        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255, 255, 255, 0.015)' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 800, display: 'flex', justifyContent: 'space-between' }}>
            <span>Aggregate Memory Cost</span>
            <span>{totalMem}%</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900 }}>
            {totalMem}%
          </div>
          <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.03)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, totalMem)}%`, height: '100%', background: 'linear-gradient(90deg, #6366f1, #a855f7)', transition: 'width 0.3s ease' }} />
          </div>
        </div>

      </div>

      {/* Main Process Inventory */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        
        {/* Filters and Search toolbar */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', background: 'rgba(255,255,255,0.005)' }}>
          
          <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
            <input 
              type="text" 
              placeholder="Search by PID, user, process command name..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px 9px 40px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                color: 'var(--color-text)',
                fontSize: '0.85rem',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
            />
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', gap: 6 }}>
            Showing <strong>{sorted.length}</strong> of <strong>{processes.length}</strong> tasks
          </div>

        </div>

        {/* Process Table list */}
        {loading && processes.length === 0 ? (
          <div style={{ padding: 80, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
            Loading process table...
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 80, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <XCircle size={32} style={{ margin: '0 auto 12px auto', opacity: 0.3 }} />
            No running processes found matching your criteria.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '12px 16px', width: 24 }}></th>
                  <th 
                    style={{ padding: '12px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', cursor: 'pointer' }}
                    onClick={() => handleSort('pid')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      PID <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th 
                    style={{ padding: '12px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', cursor: 'pointer' }}
                    onClick={() => handleSort('name')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      Process Command <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th style={{ padding: '12px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>User</th>
                  <th 
                    style={{ padding: '12px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', cursor: 'pointer' }}
                    onClick={() => handleSort('cpu')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      CPU % <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th 
                    style={{ padding: '12px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', cursor: 'pointer' }}
                    onClick={() => handleSort('mem')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      RAM % <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th style={{ padding: '12px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>CPU Time</th>
                  <th style={{ padding: '12px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 220, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const isExpanded = !!expandedPids[p.pid]
                  const hasLongArgs = p.args.length > p.command.length + 3
                  
                  return (
                    <Fragment key={p.pid}>
                      <tr 
                        style={{ 
                          borderBottom: isExpanded ? 'none' : '1px solid var(--color-border)',
                          background: isExpanded ? 'rgba(255,255,255,0.01)' : 'transparent',
                          transition: 'background 0.2s',
                          cursor: hasLongArgs ? 'pointer' : 'default'
                        }}
                        onClick={() => hasLongArgs && toggleExpand(p.pid)}
                      >
                        <td style={{ padding: '14px 8px 14px 16px', textAlign: 'center' }}>
                          {hasLongArgs && (
                            <div style={{ display: 'inline-flex', color: 'var(--color-text-muted)', opacity: 0.5 }}>
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                          {p.pid}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
                            {p.command}
                          </div>
                          {!isExpanded && hasLongArgs && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                              {p.args}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                          {p.user}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 44, fontSize: '0.8rem', fontWeight: 700, color: p.cpu > 50 ? 'var(--color-danger)' : p.cpu > 10 ? '#f59e0b' : 'var(--color-text)' }}>
                              {p.cpu}%
                            </div>
                            <div style={{ flex: 1, minWidth: 50, height: 5, background: 'rgba(255,255,255,0.03)', borderRadius: 2.5, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(100, p.cpu)}%`, height: '100%', background: p.cpu > 50 ? 'var(--color-danger)' : p.cpu > 10 ? '#f59e0b' : '#3b82f6', transition: 'width 0.2s' }} />
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 44, fontSize: '0.8rem', fontWeight: 700 }}>
                              {p.mem}%
                            </div>
                            <div style={{ flex: 1, minWidth: 50, height: 5, background: 'rgba(255,255,255,0.03)', borderRadius: 2.5, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(100, p.mem)}%`, height: '100%', background: p.mem > 30 ? '#a855f7' : '#6366f1', transition: 'width 0.2s' }} />
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={12} style={{ opacity: 0.5 }} />
                            {p.time}
                          </div>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button 
                              className="btn btn-secondary btn-sm"
                              onClick={() => terminateProcess(p.pid, p.command)}
                              style={{ height: 28, padding: '0 10px', fontSize: '0.72rem', fontWeight: 700 }}
                            >
                              Terminate
                            </button>
                            <button 
                              className="btn btn-secondary btn-sm"
                              onClick={() => killProcess(p.pid, p.command)}
                              style={{ height: 28, padding: '0 10px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }}
                            >
                              Kill -9
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expand CLI Command Arguments Details Row */}
                      {isExpanded && (
                        <tr style={{ background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--color-border)' }}>
                          <td style={{ padding: 0 }}></td>
                          <td colSpan={7} style={{ padding: '0 24px 16px 24px' }}>
                            <div style={{
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid var(--color-border)',
                              borderRadius: 8,
                              padding: 12,
                              fontSize: '0.78rem',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--color-primary)',
                              wordBreak: 'break-all',
                              whiteSpace: 'pre-wrap',
                              lineHeight: 1.5,
                            }}>
                              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 800, marginBottom: 6 }}>
                                Full CLI Invocation Arguments
                              </div>
                              {p.args}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* Guide Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        
        <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Award size={18} color="var(--color-success)" />
            Graceful Termination (SIGTERM -15)
          </h3>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            SIGTERM is the default signal sent to a process requesting it to clean up and exit. It allows processes to save states, flush database buffers, release ports, and close open child threads cleanly. Use this as the first option.
          </p>
        </div>

        <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trash2 size={18} color="var(--color-danger)" />
            Immediate Force Kill (SIGKILL -9)
          </h3>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            SIGKILL cannot be caught, blocked, or ignored. The operating system kernel immediately halts process execution. This is extremely effective for hanging threads or zombie processes, but can result in files or logs corruption.
          </p>
        </div>

      </div>

      {dialog && <Dialog {...dialog} />}
    </div>
  )
}
