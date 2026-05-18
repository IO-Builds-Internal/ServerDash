import { useState, useEffect } from 'react'
import { Shield, ShieldAlert, Plus, Trash2, Power, AlertTriangle, CheckCircle, RefreshCw, Info, Lock } from 'lucide-react'
import api from '../lib/api'

export default function FirewallPage() {
  const [status, setStatus] = useState({ active: false, rules: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  
  // Rule form
  const [form, setForm] = useState({
    to: '',
    action: 'allow',
    from: '',
    proto: 'any',
    comment: ''
  })
  
  // Deletion modal
  const [deletingIndex, setDeletingIndex] = useState(null)

  const loadStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/firewall')
      setStatus(res.data)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const toggleFirewall = async () => {
    if (status.active) {
      const confirmDisable = window.confirm(
        '⚠️ Warning: Disabling the firewall will expose all ports to public access. Are you sure you want to proceed?'
      )
      if (!confirmDisable) return
    }
    
    setBusy(true)
    try {
      await api.post('/api/firewall/toggle', { active: !status.active })
      await loadStatus()
    } catch (e) {
      alert(`✗ Failed to toggle firewall: ${e.response?.data?.error || e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleAddRule = async (e) => {
    e.preventDefault()
    if (!form.to && !form.from) {
      alert('✗ You must specify either a target Port or a Source IP!')
      return
    }
    
    setBusy(true)
    try {
      await api.post('/api/firewall/rules', form)
      setForm({ to: '', action: 'allow', from: '', proto: 'any', comment: '' })
      await loadStatus()
    } catch (e) {
      alert(`✗ Failed to add rule: ${e.response?.data?.error || e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteRule = async () => {
    if (deletingIndex === null) return
    setBusy(true)
    try {
      await api.delete(`/api/firewall/rules/${deletingIndex}`)
      setDeletingIndex(null)
      await loadStatus()
    } catch (e) {
      alert(`✗ Failed to delete rule: ${e.response?.data?.error || e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const getActionBadgeColor = (action) => {
    switch (action?.toLowerCase()) {
      case 'allow': return 'var(--color-success)'
      case 'deny': return 'var(--color-danger)'
      case 'reject': return '#f59e0b'
      case 'limit': return '#3b82f6'
      default: return 'var(--color-text-muted)'
    }
  }

  const getPortBadgeColor = (port) => {
    const p = parseInt(port)
    if (p === 80 || p === 443) return 'rgba(16, 185, 129, 0.08)' // web ports - emerald green tint
    if (p === 22) return 'rgba(139, 92, 246, 0.08)' // ssh port - purple tint
    if (p === 3306 || p === 5432) return 'rgba(59, 130, 246, 0.08)' // db ports - blue tint
    return 'rgba(255, 255, 255, 0.02)'
  }

  const getPortTextColor = (port) => {
    const p = parseInt(port)
    if (p === 80 || p === 443) return '#10b981'
    if (p === 22) return '#8b5cf6'
    if (p === 3306 || p === 5432) return '#3b82f6'
    return 'var(--color-text)'
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Page Header */}
      <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={26} color="var(--color-primary)" /> Firewall & Security Shields
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
            Configure VPS host-level uncomplicated firewall (UFW) rules, manage active security shields, and block untrusted traffic.
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={loadStatus} disabled={loading || busy} style={{ padding: '8px 12px' }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          
          <button 
            className="btn" 
            onClick={toggleFirewall} 
            disabled={busy || loading}
            style={{
              padding: '8px 16px',
              fontWeight: 700,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: status.active ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
              border: `1px solid ${status.active ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
              color: status.active ? 'var(--color-danger)' : 'var(--color-success)',
              boxShadow: status.active ? '0 0 10px rgba(239, 68, 68, 0.1)' : '0 0 10px rgba(16, 185, 129, 0.1)'
            }}
          >
            <Power size={14} />
            {status.active ? 'Disable Firewall' : 'Enable Firewall'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--color-danger)', borderRadius: 10, padding: 14, fontSize: '0.82rem', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={15} />
          <span>Error loading firewall status: {error}</span>
        </div>
      )}

      {/* Top row status card */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: 20 }}>
        {/* Status Indicator */}
        <div className="glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center', minHeight: 180, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -20, top: -20, opacity: 0.04 }}>
            <Shield size={160} color="var(--color-primary)" />
          </div>
          
          <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>
            System Shield Status
          </span>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: status.active ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)', border: `1px solid ${status.active ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {status.active ? <CheckCircle size={22} color="var(--color-success)" /> : <ShieldAlert size={22} color="var(--color-danger)" />}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                {status.active ? 'ACTIVE' : 'INACTIVE'}
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {status.active ? 'All unlisted ports are blocked.' : 'All host ports are wide open.'}
              </p>
            </div>
          </div>
          
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: 'var(--color-text-dim)' }}>
            <Lock size={12} color="var(--color-primary)" /> 
            <span>SSH Port (22) and Web Ports (80, 443) are auto-protected.</span>
          </div>
        </div>

        {/* Protection Quick guide */}
        <div className="glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Info size={14} color="var(--color-primary)" /> UFW Shield Security Recommendations
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.76rem', color: 'var(--color-text-dim)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ margin: 0 }}>🛡️ <strong>Minimize Exposure</strong>: Only allow specific required ports (e.g. database ports, dev environment node app ports) to avoid botnet probes.</p>
              <p style={{ margin: 0 }}>🔒 <strong>Bind to Origin</strong>: Limit database ports (like 5432 or 3306) to only accept connections from your client origin IP.</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ margin: 0 }}>⚡ <strong>Limit Brute Force</strong>: Use the <code>Limit</code> action on SSH/Port 22 to automatically throttle connection attempts from offending IPs.</p>
              <p style={{ margin: 0 }}>📝 <strong>Label Rules</strong>: Add descriptive comments so it's easy to remember which container, client, or site a rule belongs to.</p>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr', gap: 20 }}>
        {/* Left Column: Create Rule Form */}
        <div className="glass-card animate-fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={16} color="var(--color-primary)" /> Add New Security Shield
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
              Inject a host UFW security policy rule.
            </p>
          </div>

          <form onSubmit={handleAddRule} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="label">Rule Policy Action</label>
              <select 
                className="input" 
                value={form.action} 
                onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
                style={{ background: 'var(--color-surface-2)', width: '100%' }}
              >
                <option value="allow">ALLOW (Accept Connections)</option>
                <option value="deny">DENY (Silently Drop)</option>
                <option value="reject">REJECT (Actively Block)</option>
                <option value="limit">LIMIT (Throttle Rate Limiting)</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
              <div>
                <label className="label">Target Port / Range</label>
                <input 
                  className="input" 
                  value={form.to} 
                  onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                  placeholder="e.g. 5432 or 8000:8010"
                />
              </div>
              <div>
                <label className="label">Protocol</label>
                <select 
                  className="input" 
                  value={form.proto} 
                  onChange={e => setForm(f => ({ ...f, proto: e.target.value }))}
                  style={{ background: 'var(--color-surface-2)', width: '100%' }}
                >
                  <option value="any">ANY (TCP/UDP)</option>
                  <option value="tcp">TCP Protocol</option>
                  <option value="udp">UDP Protocol</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Source IP / Subnet Filter</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>Default: Anywhere</span>
              </label>
              <input 
                className="input" 
                value={form.from} 
                onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
                placeholder="e.g. 203.0.113.50 or Anywhere"
              />
            </div>

            <div>
              <label className="label">Purpose / Comment Description</label>
              <input 
                className="input" 
                value={form.comment} 
                onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
                placeholder="e.g. Supabase DB Access"
                maxLength={40}
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={busy || loading} 
              style={{ width: '100%', marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Plus size={14} /> Add Firewall Rule
            </button>
          </form>
        </div>

        {/* Right Column: Rules List */}
        <div className="glass-card animate-fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>
                Active Host Shield Rules ({status.rules.length})
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
                Configured UFW rules loaded directly from VPS iptables hooks.
              </p>
            </div>
          </div>

          <div style={{ flex: 1, overflowX: 'auto', maxHeight: 400 }}>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 180, gap: 10 }}>
                <RefreshCw size={24} className="animate-spin" color="var(--color-primary)" />
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Fetching security shield table...</span>
              </div>
            ) : status.rules.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 180, gap: 10, border: '1px dashed var(--color-border)', borderRadius: 12, background: 'rgba(255,255,255,0.01)' }}>
                <Shield size={28} color="var(--color-text-muted)" style={{ opacity: 0.5 }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {status.active ? 'No active firewall rules defined.' : 'Firewall is inactive. Rules will list once enabled.'}
                </span>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: '8px 4px', width: 44 }}>Idx</th>
                    <th style={{ padding: '8px 8px' }}>Action</th>
                    <th style={{ padding: '8px 8px' }}>Port (To)</th>
                    <th style={{ padding: '8px 8px' }}>Source (From)</th>
                    <th style={{ padding: '8px 8px' }}>Description</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center', width: 44 }}>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {status.rules.map((rule) => (
                    <tr key={rule.index} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', verticalAlign: 'middle', transition: 'background 0.2s' }} className="table-row-hover">
                      <td style={{ padding: '10px 4px', color: 'var(--color-text-muted)', fontWeight: 700 }}>
                        #{rule.index}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span 
                          style={{
                            display: 'inline-block',
                            padding: '3px 7px',
                            borderRadius: 6,
                            fontSize: '0.68rem',
                            fontWeight: 800,
                            letterSpacing: '0.03em',
                            background: `${getActionBadgeColor(rule.action)}15`,
                            color: getActionBadgeColor(rule.action),
                            border: `1px solid ${getActionBadgeColor(rule.action)}25`
                          }}
                        >
                          {rule.action}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span 
                          style={{
                            display: 'inline-block',
                            padding: '3px 7px',
                            borderRadius: 6,
                            fontWeight: 700,
                            background: getPortBadgeColor(rule.to),
                            color: getPortTextColor(rule.to),
                            border: '1px solid rgba(255,255,255,0.04)'
                          }}
                        >
                          {rule.to}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--color-text-dim)' }}>
                        {rule.from}
                      </td>
                      <td style={{ padding: '10px 8px', color: 'var(--color-text-muted)' }}>
                        {rule.comment || rule.direction}
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                        <button 
                          className="btn-icon" 
                          onClick={() => setDeletingIndex(rule.index)}
                          style={{ color: 'var(--color-danger)', opacity: 0.8 }}
                          title="Delete Rule"
                          disabled={busy}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {deletingIndex !== null && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="glass-card animate-fade-in" style={{ padding: 26, maxWidth: 400, width: '90%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={16} color="var(--color-danger)" />
              </div>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>Delete Firewall Rule?</h3>
            </div>
            
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-dim)', margin: 0, lineHeight: 1.4 }}>
              Are you sure you want to delete UFW firewall rule <strong>#{deletingIndex}</strong>? This change will immediately apply to host iptables ports.
            </p>
            
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setDeletingIndex(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDeleteRule} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Trash2 size={13} /> Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
