import { useState, useEffect } from 'react'
import api from '../lib/api'
import { 
  Archive, Plus, RefreshCw, Trash2, Download, RotateCcw, 
  Check, AlertTriangle, ShieldCheck, ShieldAlert, Clock, Database, FileCode
} from 'lucide-react'

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(null) // holds snapshot filename being restored

  const loadSnapshots = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/snapshots')
      setSnapshots(data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSnapshots()
  }, [])

  const createSnapshot = async () => {
    setCreating(true)
    setError(null)
    setSuccess(null)
    try {
      const { data } = await api.post('/api/snapshots')
      setSuccess(data.message)
      await loadSnapshots()
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setCreating(false)
    }
  }

  const deleteSnapshot = async (filename) => {
    if (!confirm(`Are you sure you want to permanently delete snapshot '${filename}' from the server?`)) return
    setError(null)
    setSuccess(null)
    try {
      const { data } = await api.delete(`/api/snapshots/${filename}`)
      setSuccess(data.message)
      await loadSnapshots()
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    }
  }

  const restoreSnapshot = async (filename) => {
    if (!confirm(`⚠️ CRITICAL WARNING: Restoring server snapshot will overwrite existing website files, Nginx configurations, and MariaDB databases. Are you absolutely certain you want to proceed?`)) return
    
    setRestoring(filename)
    setError(null)
    setSuccess(null)
    try {
      const { data } = await api.post(`/api/snapshots/${filename}/restore`)
      setSuccess(data.message)
      alert('✓ Full Server Restore completed successfully!')
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setRestoring(null)
    }
  }

  const downloadSnapshot = (filename) => {
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:4001'}/api/snapshots/${filename}/download?token=${localStorage.getItem('sb-token') || ''}`, '_blank')
  }

  const formatSize = (bytes) => {
    if (!bytes) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Archive size={28} color="var(--color-primary)" />
            VPS Server Snapshots
          </h1>
          <p style={{ margin: '6px 0 0 0', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            Generate fully contained backups of all site files, Nginx server host configurations, metadata directories, and all MySQL databases.
          </p>
        </div>

        <button 
          className="btn btn-primary animate-hover" 
          onClick={createSnapshot} 
          disabled={creating || restoring}
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 42, padding: '0 20px' }}
        >
          {creating ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
          {creating ? 'Taking Snapshot...' : 'Create Full Snapshot'}
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.15)', color: 'var(--color-danger)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={18} />
          <span>Error: {error}</span>
        </div>
      )}
      {success && (
        <div style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.15)', color: 'var(--color-success)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Check size={18} />
          <span>{success}</span>
        </div>
      )}

      {/* Snapshot restoring banner status */}
      {restoring && (
        <div style={{ padding: '24px 30px', borderRadius: 12, background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.2)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <RefreshCw size={36} className="animate-spin" color="var(--color-primary)" />
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Restoring Server Snapshot...</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)', maxWidth: 500, lineHeight: 1.5 }}>
            ServerDash is currently extracting website source files, re-establishing Nginx host directories, importing database records, and restarting system services. Do not close this page.
          </p>
        </div>
      )}

      {/* Snapshot Inventory Card */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>Snapshot Archives</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadSnapshots} disabled={loading || creating || restoring}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh List
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 64, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
            Loading snapshot list...
          </div>
        ) : snapshots.length === 0 ? (
          <div style={{ padding: 64, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <Archive size={32} style={{ margin: '0 auto 12px auto', opacity: 0.3 }} />
            No server snapshot archives exist yet. Create a new full snapshot above!
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '12px 24px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Snapshot Filename</th>
                <th style={{ padding: '12px 24px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Created Date</th>
                <th style={{ padding: '12px 24px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Archive Size</th>
                <th style={{ padding: '12px 24px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 280, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.filename} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '16px 24px', fontSize: '0.85rem', fontWeight: 700 }}>
                    {s.filename}
                  </td>
                  <td style={{ padding: '16px 24px', fontSize: '0.82rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={13} />
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '16px 24px', fontSize: '0.82rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                    {formatSize(s.size)}
                  </td>
                  <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => restoreSnapshot(s.filename)}
                        disabled={creating || restoring}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, fontSize: '0.75rem', borderColor: 'rgba(59,130,246,0.3)', color: 'var(--color-primary)' }}
                      >
                        <RotateCcw size={12} />
                        Restore
                      </button>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => downloadSnapshot(s.filename)}
                        disabled={creating || restoring}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, fontSize: '0.75rem' }}
                      >
                        <Download size={12} />
                        Download
                      </button>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => deleteSnapshot(s.filename)}
                        disabled={creating || restoring}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, fontSize: '0.75rem', color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }}
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Snapshot Specs Card */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        
        <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={18} color="var(--color-success)" />
            What is Included in Snapshots?
          </h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li><strong>All Website Codebases</strong>: Backs up the entire source contents of the <code>/var/www/</code> directory.</li>
            <li><strong>Nginx Server Configurations</strong>: Retains virtual hosts from <code>/etc/nginx/sites-available/</code>.</li>
            <li><strong>Internal ServerDash Databases</strong>: Packs configuration states and metadata registers.</li>
            <li><strong>Global MySQL/MariaDB Databases</strong>: Safely exports a full dump of all active MySQL databases on the VPS.</li>
          </ul>
        </div>

        <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="var(--color-primary)" />
            Automated Snapshots Scheduling
          </h3>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Automated, scheduled snapshots can be set up directly on the server host via standard cron jobs, ensuring daily off-site archives and continuous backup compliance.
          </p>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--color-primary)' }}>
            0 2 * * * curl -X POST http://localhost:4001/api/snapshots
          </div>
        </div>

      </div>

    </div>
  )
}
