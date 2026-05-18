import { useState, useEffect } from 'react'
import {
  Activity, Search, RefreshCw, Trash2, Shield, Info, Copy, Check,
  ExternalLink, Network, AlertTriangle, ArrowRight, Zap, Code
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
        background: 'rgba(255,255,255,0.05)',
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
      title="Copy address"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

export default function PortsPage() {
  const [ports, setPorts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [protocolFilter, setProtocolFilter] = useState('All')
  const [systemFilter, setSystemFilter] = useState('All') // All, User, System (<1024)
  const [error, setError] = useState('')
  const [busyPid, setBusyPid] = useState(null)
  const [successMsg, setSuccessMsg] = useState('')
  const [expandedPids, setExpandedPids] = useState(new Set())

  const toggleExpand = (pid) => {
    const next = new Set(expandedPids)
    if (next.has(pid)) next.delete(pid)
    else next.add(pid)
    setExpandedPids(next)
  }

  const fetchPorts = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/ports')
      setPorts(data)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPorts()
  }, [])

  const killProcess = async (pid, port) => {
    if (!confirm(`Are you absolutely sure you want to force terminate process PID ${pid} holding port ${port}? This will crash any associated services immediately.`)) {
      return
    }

    setBusyPid(pid)
    setError('')
    setSuccessMsg('')
    try {
      await api.delete(`/api/ports/kill/${pid}`)
      setSuccessMsg(`✓ Successfully terminated PID ${pid} (freed port ${port})`)
      setTimeout(() => setSuccessMsg(''), 4000)
      fetchPorts()
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setBusyPid(null)
    }
  }

  // Filter Ports
  const filteredPorts = ports.filter(p => {
    // Protocol Filter
    if (protocolFilter !== 'All' && p.protocol.toLowerCase() !== protocolFilter.toLowerCase()) return false

    // System Filter
    if (systemFilter === 'System' && p.port >= 1024) return false
    if (systemFilter === 'User' && p.port < 1024) return false

    // Search Filter
    if (search) {
      const query = search.toLowerCase()
      const matchPort = String(p.port).includes(query)
      const matchProcess = p.process.toLowerCase().includes(query)
      const matchCommand = (p.command || '').toLowerCase().includes(query)
      const matchIp = p.ip.toLowerCase().includes(query)
      return matchPort || matchProcess || matchCommand || matchIp
    }

    return true
  })

  // Metric aggregates
  const tcpCount = ports.filter(p => p.protocol.toLowerCase() === 'tcp').length
  const udpCount = ports.filter(p => p.protocol.toLowerCase() === 'udp').length
  const systemPortsCount = ports.filter(p => p.port < 1024).length
  const activeProcesses = new Set(ports.map(p => p.pid).filter(Boolean)).size

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1400, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={26} color="var(--color-primary)" />
            Network Sockets Monitor
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            Real-time inspection of listening ports, socket bindings, process mappings, and active executables.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchPorts} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing...' : 'Refresh Sockets'}
        </button>
      </div>

      {/* Metrics widgets grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {[
          { label: 'Listening Sockets', val: ports.length, icon: Network, color: '#3b82f6', desc: 'Total open endpoints' },
          { label: 'TCP Sockets', val: tcpCount, icon: Zap, color: '#10b981', desc: 'Active TCP streams' },
          { label: 'UDP Sockets', val: udpCount, icon: Code, color: '#a855f7', desc: 'Datagram endpoints' },
          { label: 'Privileged Sockets', val: systemPortsCount, icon: Shield, color: '#f59e0b', desc: 'Reserved system ports <1024' },
          { label: 'Active Processes', val: activeProcesses, icon: Activity, color: '#ec4899', desc: 'Unique PIDs listening' }
        ].map(w => (
          <div key={w.label} className="glass-card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: `rgba(${w.color === '#3b82f6' ? '59,130,246' : w.color === '#10b981' ? '16,185,129' : w.color === '#a855f7' ? '168,85,247' : w.color === '#f59e0b' ? '245,158,11' : '236,72,153'},0.06)`, border: `1px solid rgba(${w.color === '#3b82f6' ? '59,130,246' : w.color === '#10b981' ? '16,185,129' : w.color === '#a855f7' ? '168,85,247' : w.color === '#f59e0b' ? '245,158,11' : '236,72,153'},0.12)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <w.icon size={18} color={w.color} />
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>{w.label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-text)', marginTop: 2 }}>{w.val}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{w.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Notifications */}
      {error && (
        <div className="glass-card" style={{ padding: '14px 20px', background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.15)', color: 'var(--color-danger)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} />
          <span>Error: {error}</span>
        </div>
      )}
      {successMsg && (
        <div className="glass-card" style={{ padding: '14px 20px', background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.15)', color: 'var(--color-success)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Check size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Advanced Filter Console */}
      <div className="glass-card" style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            placeholder="Search port, process name, PID, address, or launch arguments..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input"
            style={{ width: '100%', paddingLeft: 34, height: 38, fontSize: '0.82rem' }}
          />
        </div>

        {/* Protocol Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Protocol:</span>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 3 }}>
            {['All', 'TCP', 'UDP'].map(p => (
              <button
                key={p}
                onClick={() => setProtocolFilter(p)}
                style={{
                  background: protocolFilter === p ? 'var(--color-primary)' : 'transparent',
                  color: protocolFilter === p ? 'white' : 'var(--color-text-muted)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* System Port Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Class:</span>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 3 }}>
            {['All', 'User', 'System'].map(c => (
              <button
                key={c}
                onClick={() => setSystemFilter(c)}
                style={{
                  background: systemFilter === c ? 'var(--color-primary)' : 'transparent',
                  color: systemFilter === c ? 'white' : 'var(--color-text-muted)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                {c === 'System' ? 'System (<1024)' : c === 'User' ? 'User (≥1024)' : 'All Ports'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Ports Table */}
      {loading ? (
        <div style={{ padding: 80, textAlign: 'center' }}>
          <RefreshCw size={36} className="animate-spin" style={{ opacity: 0.3, marginBottom: 12 }} />
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Reading Linux network socket tables...</div>
        </div>
      ) : filteredPorts.length === 0 ? (
        <div className="glass-card" style={{ padding: 64, textAlign: 'center' }}>
          <Network size={36} style={{ opacity: 0.2, marginBottom: 12 }} />
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No open ports match the specified filters.</div>
        </div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '14px 18px', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 60 }}>Status</th>
                <th style={{ padding: '14px 18px', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 70 }}>Proto</th>
                <th style={{ padding: '14px 18px', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 110 }}>Port</th>
                <th style={{ padding: '14px 18px', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 220 }}>Address & Binding</th>
                <th style={{ padding: '14px 18px', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 220 }}>Process</th>
                <th style={{ padding: '14px 18px', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Launch Command</th>
                <th style={{ padding: '14px 18px', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 100, textAlign: 'center' }}>Release</th>
              </tr>
            </thead>
            <tbody>
              {filteredPorts.map((p, i) => {
                const isPrivileged = p.port < 1024
                const isLocalOnly = p.ip === '127.0.0.1' || p.ip === '::1'
                
                return (
                  <tr key={i} style={{ borderBottom: i < filteredPorts.length - 1 ? '1px solid var(--color-border)' : 'none', transition: 'background 0.2s', background: isPrivileged ? 'rgba(245,158,11,0.01)' : 'transparent' }}>
                    
                    {/* Status dot */}
                    <td style={{ padding: '14px 18px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: isLocalOnly ? '#3b82f6' : 'var(--color-success)',
                          boxShadow: `0 0 10px ${isLocalOnly ? 'rgba(59,130,246,0.5)' : 'rgba(16,185,129,0.5)'}`,
                          animation: 'pulse 2s infinite'
                        }}
                        title={isLocalOnly ? 'Listening locally (127.0.0.1)' : 'Listening publicly (0.0.0.0)'}
                      />
                    </td>

                    {/* Protocol */}
                    <td style={{ padding: '14px 18px' }}>
                      <span className={`badge ${p.protocol.toLowerCase() === 'tcp' ? 'badge-green' : 'badge-blue'}`} style={{ fontSize: '0.65rem', padding: '3px 6px', textTransform: 'uppercase', fontWeight: 800 }}>
                        {p.protocol}
                      </span>
                    </td>

                    {/* Port number */}
                    <td style={{ padding: '14px 18px' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                        {p.port}
                      </span>
                    </td>

                    {/* Socket binding */}
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: isLocalOnly ? 'var(--color-primary)' : 'var(--color-text-dim)' }}>
                          {p.address}
                        </code>
                        <CopyButton text={p.address} />
                      </div>
                    </td>

                    {/* Process description */}
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text)' }}>
                          {p.process}
                        </span>
                        {p.pid ? (
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                            PID: <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{p.pid}</span>
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                            system daemon
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Launch command */}
                    <td style={{ padding: '14px 18px' }}>
                      {p.command ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 500 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#070708', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                            <code style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.72rem',
                              color: 'var(--color-text-dim)',
                              whiteSpace: expandedPids.has(p.pid) ? 'pre-wrap' : 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              wordBreak: 'break-all',
                              flex: 1
                            }}>
                              {expandedPids.has(p.pid) || p.command.length <= 40 ? p.command : `${p.command.substring(0, 40)}...`}
                            </code>
                            <CopyButton text={p.command} />
                          </div>
                          {p.command.length > 40 && (
                            <button
                              onClick={() => toggleExpand(p.pid)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--color-primary)',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                padding: 0,
                                textAlign: 'left',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                            >
                              {expandedPids.has(p.pid) ? 'Collapse Command' : 'Expand Full Command'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          —
                        </span>
                      )}
                    </td>

                    {/* Force-kill action */}
                    <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                      {p.pid ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => killProcess(p.pid, p.port)}
                          disabled={busyPid === p.pid}
                          style={{
                            borderColor: 'rgba(239,68,68,0.2)',
                            color: 'var(--color-danger)',
                            padding: '4px 8px',
                            height: 26,
                            fontSize: '0.72rem',
                            gap: 4
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                        >
                          {busyPid === p.pid ? <RefreshCw size={11} className="animate-spin"/> : <Trash2 size={11}/>}
                          Kill
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }} title="Kernels and core network spaces cannot be killed directly.">
                          system
                        </span>
                      )}
                    </td>

                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
