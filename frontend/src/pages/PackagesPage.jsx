import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, Download, Trash2, RefreshCw, Upload, Terminal as TermIcon,
  Package, Plus, CheckCircle, X, Play, ShieldAlert, Cpu, Check, AlertTriangle, PlayCircle
} from 'lucide-react'
import { localAuth } from '../lib/auth'
import api from '../lib/api'

function TermOutput({ lines, height = 300, running, onClear, onStop }) {
  const ref = useRef()
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight) }, [lines])

  return (
    <div className="glass-card animate-fade-in" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 700 }}>
          <TermIcon size={14} color="var(--color-primary)" />
          Execution Log Console
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {running && (
            <button className="btn btn-danger btn-sm" style={{ padding: '3px 8px', fontSize: '0.7rem' }} onClick={onStop}>
              Stop Process
            </button>
          )}
          <button className="btn btn-secondary btn-sm" style={{ padding: '3px 8px', fontSize: '0.7rem' }} onClick={onClear}>
            Clear Output
          </button>
        </div>
      </div>

      <div
        ref={ref}
        className="terminal"
        style={{
          height,
          overflowY: 'auto',
          fontSize: '0.8rem',
          lineHeight: 1.6,
          borderRadius: 0,
          border: 'none',
          background: '#010409',
          padding: 16
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
            Console idle. Command execution and installation outputs will print here...
          </div>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              style={{
                color: l.startsWith('✓') || l.startsWith('Congratulations!') ? '#34d399' : l.startsWith('✗') || l.startsWith('Failed') || l.startsWith('Error') ? '#f87171' : l.startsWith('$') ? '#818cf8' : undefined,
                fontFamily: 'var(--font-mono)',
                marginTop: 2
              }}
            >
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function useSSEStream() {
  const [lines, setLines] = useState([])
  const [running, setRunning] = useState(false)
  const ctrlRef = useRef(null)

  const stream = useCallback(async (url, method = 'GET', body = null) => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setLines([])
    setRunning(true)

    // FIXING THE CRITICAL AUTHENTICATION BUG: 
    // Fetching the correct JWT token from localAuth utility
    const token = localAuth.getToken() || ''

    const opts = {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal
    }

    if (method === 'POST') {
      opts.method = 'POST'
      opts.headers['Content-Type'] = 'application/json'
      if (body) opts.body = JSON.stringify(body)
    }

    try {
      const resp = await fetch(url, opts)
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (ctrlRef.current && !ctrlRef.current.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop()

        parts.forEach(line => {
          if (line.startsWith('data: ')) {
            setLines(l => [...l, line.slice(6)])
          } else if (line.trim()) {
            setLines(l => [...l, line])
          }
        })
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setLines(l => [...l, `✗ Stream error: ${e.message}`])
      }
    } finally {
      setRunning(false)
    }
  }, [])

  const stop = () => {
    ctrlRef.current?.abort()
    setLines(l => [...l, '✗ Command aborted by user'])
    setRunning(false)
  }

  const clear = () => {
    setLines([])
  }

  return { lines, running, stream, stop, clear }
}

export default function PackagesPage() {
  // Tabs: 'install' | 'installed' | 'zip' | 'git' | 'exec' | 'panel'
  const [tab, setTab] = useState('install')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installed, setInstalled] = useState([])
  const [loadingInstalled, setLoadingInstalled] = useState(false)
  const [pkgFilter, setPkgFilter] = useState('')
  const { lines, running, stream, stop, clear } = useSSEStream()
  const fileRef = useRef()
  const [zipDest, setZipDest] = useState('/usr/local/bin')
  const [uploading, setUploading] = useState(false)
  const [command, setCommand] = useState('')
  const [gitRepoUrl, setGitRepoUrl] = useState('')
  const [gitDest, setGitDest] = useState('/var/www')
  const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4001'

  const doSearch = useCallback(async (q) => {
    if (q.length < 2) { setSearchResults([]); return }
    setSearching(true)
    try {
      const r = await api.get('/api/packages/search', { params: { q } })
      setSearchResults(r.data)
    } catch (e) {
      console.error(e)
    }
    setSearching(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQuery), 400)
    return () => clearTimeout(t)
  }, [searchQuery, doSearch])

  const loadInstalled = async () => {
    setLoadingInstalled(true)
    try {
      const r = await api.get('/api/packages/list')
      setInstalled(r.data)
    } catch (e) {
      console.error(e)
    }
    setLoadingInstalled(false)
  }

  useEffect(() => {
    if (tab === 'installed') loadInstalled()
  }, [tab])

  const checkPanelUpdate = async () => {
    setCheckingUpdate(true)
    try {
      const r = await api.get('/api/packages/serverdash-update/status')
      setUpdateStatus(r.data)
    } catch (e) {
      console.error(e)
    }
    setCheckingUpdate(false)
  }

  useEffect(() => {
    if (tab === 'panel') checkPanelUpdate()
  }, [tab])

  const install = (pkg) => {
    stream(`${BASE}/api/packages/stream?pkg=${encodeURIComponent(pkg)}`)
  }

  const remove = (pkg) => {
    if (!confirm(`Are you sure you want to uninstall ${pkg} from this server?`)) return
    stream(`${BASE}/api/packages/stream?pkg=${encodeURIComponent(pkg)}&action=remove`)
  }

  const aptUpdate = () => {
    stream(`${BASE}/api/packages/update`)
  }

  const uploadZip = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('dest', zipDest)
    try {
      const r = await api.post('/api/packages/zip', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      alert(`✓ Installed successfully!\nOutput: ${r.data.output?.substring(0, 300) || 'Done'}`)
    } catch (e) {
      alert(`✗ Upload/Install failed: ${e.response?.data?.error || e.message}`)
    }
    setUploading(false)
    e.target.value = ''
  }

  const execStream = () => {
    if (!command.trim()) return
    stream(`${BASE}/api/packages/exec-stream?command=${encodeURIComponent(command)}`)
  }

  const installGitPackage = () => {
    if (!gitRepoUrl.trim()) return
    stream(`${BASE}/api/packages/git-install?repoUrl=${encodeURIComponent(gitRepoUrl.trim())}&dest=${encodeURIComponent(gitDest.trim())}`)
  }

  const filteredInstalled = installed.filter(p =>
    !pkgFilter || p.name?.toLowerCase().includes(pkgFilter.toLowerCase())
  )

  const PRESET_COMMANDS = [
    { cmd: 'apt-get upgrade -y', label: 'Upgrade Packages', desc: 'Upgrades all installed packages' },
    { cmd: 'apt-get autoremove -y', label: 'Autoremove Packages', desc: 'Cleans unused dependency packages' },
    { cmd: 'apt-get clean', label: 'Clean apt Cache', desc: 'Frees system storage by cleaning package cache' },
    { cmd: 'systemctl status nginx', label: 'Nginx Daemon Status', desc: 'Checks running status of web server' },
    { cmd: 'systemctl status postfix', label: 'Postfix Service', desc: 'Checks status of local SMTP mail agent' },
    { cmd: 'npm -g list --depth=0', label: 'Global npm Packages', desc: 'List top-level global NodeJS packages' },
    { cmd: 'pip3 list', label: 'Python Packages', desc: 'List packages registered on Python 3 pip' },
    { cmd: 'node -v && npm -v', label: 'Node & npm Versions', desc: 'Query active JavaScript compiler specs' },
  ]

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em' }}>System Package Manager</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
            Control apt, execute administrative shell commands, and deploy local package binaries directly onto the VPS.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={aptUpdate} disabled={running}>
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} /> Synchronize apt update
        </button>
      </div>

      {/* Modern Vercel-like selector tabs */}
      <div className="tabs" style={{ marginBottom: 10 }}>
        <button className={`tab ${tab === 'install' ? 'active' : ''}`} onClick={() => setTab('install')}>
          🔍 Search & Install
        </button>
        <button className={`tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
          📦 Installed Packages
        </button>
        <button className={`tab ${tab === 'zip' ? 'active' : ''}`} onClick={() => setTab('zip')}>
          📁 Install from Local File
        </button>
        <button className={`tab ${tab === 'git' ? 'active' : ''}`} onClick={() => setTab('git')}>
          📥 Install from Git
        </button>
        <button className={`tab ${tab === 'exec' ? 'active' : ''}`} onClick={() => setTab('exec')}>
          ⌨️ Administrative Shell
        </button>
        <button className={`tab ${tab === 'panel' ? 'active' : ''}`} onClick={() => setTab('panel')}>
          🛡️ ServerDash Updates
        </button>
      </div>

      {/* Dynamic Content */}
      <div style={{ minHeight: 400 }}>

        {/* TAB 1: SEARCH & INSTALL */}
        {tab === 'install' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Search Pane */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, height: 'fit-content' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Apt Package Finder</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Search the Ubuntu package archive to install software directly.
                </p>
              </div>

              <div style={{ position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input
                  className="input"
                  style={{ paddingLeft: 44, fontSize: '0.95rem' }}
                  placeholder="Type to search (e.g. redis-server, git, python3-pip…)"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>

              {searching && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <RefreshCw size={14} className="animate-spin" /> Pulling details from apt-cache...
                </div>
              )}

              {searchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
                  {searchResults.map(pkg => (
                    <div key={pkg.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', transition: 'border-color 0.2s' }}>
                      <Package size={18} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{pkg.name}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                          {pkg.description || 'No description available'}
                        </div>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={() => install(pkg.name)} disabled={running}>
                        <Download size={12} /> Install
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 12 }}>
                  <AlertTriangle size={24} style={{ display: 'block', margin: '0 auto 10px', color: 'var(--color-warning)' }} />
                  No packages registered under "{searchQuery}"
                </div>
              )}
            </div>

            {/* Execution logs */}
            <div>
              <TermOutput lines={lines} running={running} onClear={clear} onStop={stop} height={380} />
            </div>
          </div>
        )}

        {/* TAB 2: INSTALLED PACKAGES */}
        {tab === 'installed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="glass-card" style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Currently Installed Packages</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  A list of package binaries currently active on this virtual private server.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ position: 'relative' }}>
                  <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                  <input
                    className="input"
                    placeholder="Filter package list..."
                    value={pkgFilter}
                    onChange={e => setPkgFilter(e.target.value)}
                    style={{ paddingLeft: 34, height: 38, fontSize: '0.85rem', width: 220 }}
                  />
                </div>
                <button className="btn btn-secondary" onClick={loadInstalled} disabled={loadingInstalled} title="Refresh Installed Packages">
                  <RefreshCw size={15} className={loadingInstalled ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr', gap: 20 }}>
              <div className="table-container" style={{ maxHeight: 550, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ padding: '12px 18px' }}>Software Package</th>
                      <th style={{ padding: '12px 18px' }}>Version</th>
                      <th style={{ padding: '12px 18px' }}>Installed Size</th>
                      <th style={{ padding: '12px 18px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingInstalled ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                          <RefreshCw size={20} className="animate-spin" style={{ display: 'block', margin: '0 auto 10px' }} />
                          Loading registered dpkg-query list...
                        </td>
                      </tr>
                    ) : filteredInstalled.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                          No installed packages found matching "{pkgFilter}"
                        </td>
                      </tr>
                    ) : (
                      filteredInstalled.map(pkg => (
                        <tr key={pkg.name}>
                          <td style={{ padding: '12px 18px', fontWeight: 700, fontSize: '0.88rem', color: 'var(--color-text)' }}>{pkg.name}</td>
                          <td style={{ padding: '12px 18px', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{pkg.version}</td>
                          <td style={{ padding: '12px 18px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{pkg.size}</td>
                          <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                            <button className="btn btn-danger btn-sm" style={{ padding: 6 }} onClick={() => remove(pkg.name)} disabled={running} title="Uninstall package">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <TermOutput lines={lines} running={running} onClear={clear} onStop={stop} height={400} />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: INSTALL FROM LOCAL FILE */}
        {tab === 'zip' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Deploy Local Package / Binary</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Upload a `.deb` package file, or drag-and-drop a compressed archive to install scripts.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(6,182,212,0.04)', padding: 14, borderRadius: 10, border: '1px solid rgba(6,182,212,0.15)' }}>
                <ShieldAlert size={20} color="var(--color-info)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-dim)', lineHeight: 1.4 }}>
                  <strong>Supported format triggers:</strong><br />
                  • <code>.deb</code> packages will install via <code>dpkg -i</code>.<br />
                  • <code>.zip</code> / <code>.tar.gz</code> will extract directly into your specified destination directory.
                </span>
              </div>

              <div>
                <label className="label">Extraction Destination Path</label>
                <input className="input" value={zipDest} onChange={e => setZipDest(e.target.value)} placeholder="/usr/local/bin" />
              </div>

              <div
                onClick={() => fileRef.current.click()}
                style={{
                  border: '2px dashed var(--color-border)',
                  borderRadius: 14,
                  padding: 40,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.01)',
                  transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-primary)'
                  e.currentTarget.style.background = 'rgba(99,102,241,0.03)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.01)'
                }}
              >
                <Upload size={36} color="var(--color-text-muted)" />
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>Click or drag a file to upload</p>
                  <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Compatible extensions: .deb · .zip · .tar.gz</p>
                </div>
                <input ref={fileRef} type="file" accept=".deb,.zip,.tar.gz,.tgz" style={{ display: 'none' }} onChange={uploadZip} disabled={uploading} />
              </div>

              {uploading && (
                <div style={{ textAlign: 'center', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                  <RefreshCw size={14} className="animate-spin" /> Streaming and deploying file...
                </div>
              )}
            </div>

            <div>
              <TermOutput lines={lines} running={running} onClear={clear} onStop={stop} height={380} />
            </div>
          </div>
        )}

        {/* TAB 4: RUN ADMINISTRATIVE COMMANDS */}
        {tab === 'exec' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Presets and Custom Commands */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Administrative Shell Console</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Execute administrative commands securely inside the VPS sandbox container.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  value={command}
                  onChange={e => setCommand(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && execStream()}
                  placeholder="e.g. systemctl status nginx  or  npm -g install ..."
                  style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
                />
                <button className="btn btn-primary" onClick={execStream} disabled={running || !command.trim()}>
                  <PlayCircle size={15} /> Execute
                </button>
              </div>

              {/* Quick Presets Grid */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.05em', fontWeight: 700 }}>
                  Quick Preset Commands
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {PRESET_COMMANDS.map(item => (
                    <button
                      key={item.cmd}
                      onClick={() => { setCommand(item.cmd); }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--color-border)',
                        background: 'rgba(255,255,255,0.01)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'
                        e.currentTarget.style.background = 'rgba(99,102,241,0.02)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--color-border)'
                        e.currentTarget.style.background = 'rgba(255,255,255,0.01)'
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>{item.label}</div>
                      <code style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', display: 'block', marginTop: 4, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.cmd}
                      </code>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Terminal output */}
            <div>
              <TermOutput lines={lines} running={running} onClear={clear} onStop={stop} height={380} />
            </div>
          </div>
        )}

        {/* TAB 5: INSTALL FROM GIT */}
        {tab === 'git' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Deploy Package from Git</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Clone any repository from GitHub, GitLab, or Bitbucket, and let ServerDash auto-compile and deploy it.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(99,102,241,0.04)', padding: 14, borderRadius: 10, border: '1px solid rgba(99,102,241,0.15)' }}>
                <Cpu size={20} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-dim)', lineHeight: 1.4 }}>
                  <strong>Auto-Build Engine:</strong><br />
                  ServerDash automatically scans for <code>package.json</code> (npm installs), <code>requirements.txt</code> (python setups), and <code>Makefile</code> (executes make compilation) to set up your app packages dynamically!
                </span>
              </div>

              <div>
                <label className="label">Git Repository Clone URL</label>
                <input
                  className="input"
                  value={gitRepoUrl}
                  onChange={e => setGitRepoUrl(e.target.value)}
                  placeholder="e.g. https://github.com/expressjs/express.git"
                />
              </div>

              <div>
                <label className="label">Clone Destination Path</label>
                <input
                  className="input"
                  value={gitDest}
                  onChange={e => setGitDest(e.target.value)}
                  placeholder="/var/www"
                />
              </div>

              <button
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start', marginTop: 10 }}
                onClick={installGitPackage}
                disabled={running || !gitRepoUrl.trim()}
              >
                {running ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                {running ? 'Cloning & Deploying...' : 'Clone & Auto-Build'}
              </button>
            </div>

            <div>
              <TermOutput lines={lines} running={running} onClear={clear} onStop={stop} height={380} />
            </div>
          </div>
        )}

        {/* TAB 6: SERVERDASH SELF-UPGRADE */}
        {tab === 'panel' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>ServerDash Self-Upgrades</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Track repository releases and trigger hot automated updates directly from Git.
                </p>
              </div>

              {checkingUpdate ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  <RefreshCw size={20} className="animate-spin" style={{ display: 'block', margin: '0 auto 10px' }} />
                  Querying git status tracking updates from upstream branch...
                </div>
              ) : !updateStatus ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  Failed to query repository status.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  
                  {/* Status Badge */}
                  <div style={{ 
                    padding: 14, borderRadius: 10, 
                    background: updateStatus.updateAvailable ? 'rgba(245,158,11,0.05)' : 'rgba(16,185,129,0.05)',
                    border: updateStatus.updateAvailable ? '1px solid rgba(245,158,11,0.15)' : '1px solid rgba(16,185,129,0.15)',
                    color: updateStatus.updateAvailable ? '#f59e0b' : '#10b981',
                    display: 'flex', alignItems: 'center', gap: 10
                  }}>
                    {updateStatus.updateAvailable ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {updateStatus.updateAvailable 
                        ? 'Panel Update Available! A new stable release is ready to build.' 
                        : 'ServerDash is up-to-date! You are running the latest stable release.'
                      }
                    </span>
                  </div>

                  {/* Git Info Box */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 10, border: '1px solid var(--color-border)', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Git Remote Upstream:</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{updateStatus.repoUrl}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.02)', paddingTop: 10 }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Current Local Commit:</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <code style={{ background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>
                          {updateStatus.currentCommit}
                        </code>
                        <span style={{ color: 'var(--color-text-dim)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={updateStatus.currentMsg}>
                          ({updateStatus.currentMsg})
                        </span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.02)', paddingTop: 10 }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Latest Git Release:</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <code style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--color-primary)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {updateStatus.latestCommit}
                        </code>
                        <span style={{ color: 'var(--color-text-dim)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={updateStatus.latestMsg}>
                          ({updateStatus.latestMsg})
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Upgrade trigger button */}
                  <div style={{ marginTop: 10, display: 'flex', gap: 12 }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => stream(`${BASE}/api/packages/serverdash-update/run`)}
                      disabled={running}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', fontSize: '0.88rem' }}
                    >
                      <Play size={14} /> {running ? 'Upgrading Panel...' : 'Pull & Run Automated Upgrade'}
                    </button>
                    
                    <button
                      className="btn btn-secondary"
                      onClick={checkPanelUpdate}
                      disabled={running || checkingUpdate}
                    >
                      <RefreshCw size={14} className={checkingUpdate ? 'animate-spin' : ''} /> Check Again
                    </button>
                  </div>

                  {lines.some(l => l.includes('🏆 SUCCESS')) && (
                    <div style={{ marginTop: 10, background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.2)', padding: 14, borderRadius: 10, color: '#10b981', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 8 }} className="animate-pulse">
                      <CheckCircle size={15} />
                      <span>Upgrade complete! Relaying process connections. The panel will automatically reload in 5 seconds...</span>
                    </div>
                  )}

                </div>
              )}
            </div>

            <div>
              <TermOutput lines={lines} running={running} onClear={clear} onStop={stop} height={380} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
