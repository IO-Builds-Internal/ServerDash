import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate as useReactRouterNavigate } from 'react-router-dom'
import {
  Folder, File, ChevronRight, ChevronUp, Upload, Download,
  Trash2, Plus, Edit2, RefreshCw, X, Save, FolderPlus, Eye,
  ArrowLeft, Search, Copy, Check, Scissors, Clipboard, Archive
} from 'lucide-react'
import api from '../lib/api'
import { localAuth } from '../lib/auth'

const EDITABLE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.htm', '.css', '.scss',
  '.md', '.txt', '.yaml', '.yml', '.env', '.sh', '.py', '.php', '.conf', '.nginx', '.htaccess', '.xml', '.svg']

function isEditable(name) {
  const ext = '.' + name.split('.').pop().toLowerCase()
  return EDITABLE_EXTENSIONS.includes(ext) || !name.includes('.')
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function EditorModal({ file, onClose }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/files/read', { params: { path: file } })
      .then(r => { setContent(r.data.content); setLoading(false) })
      .catch(e => { setError(e.response?.data?.error || e.message); setLoading(false) })
  }, [file])

  const save = async () => {
    setSaving(true)
    try { await api.post('/api/files/write', { path: file, content }); setSaved(true); setTimeout(() => setSaved(false), 2000) }
    catch (e) { setError(e.response?.data?.error || e.message) }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{file}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || loading}>
              <Save size={13} /> {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={13} /></button>
          </div>
        </div>
        {error && <div style={{ padding: '8px 18px', background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)', fontSize: '0.8125rem' }}>{error}</div>}
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading…</div> : (
          <textarea
            value={content} onChange={e => setContent(e.target.value)}
            style={{ flex: 1, minHeight: 500, background: '#0a0e17', color: '#e2e8f0', border: 'none', padding: '14px 18px', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', lineHeight: 1.7, outline: 'none', resize: 'none' }}
          />
        )}
      </div>
    </div>
  )
}

function RenameModal({ item, currentPath, onClose, onDone }) {
  const [name, setName] = useState(item.name)
  const [busy, setBusy] = useState(false)
  const oldPath = currentPath.endsWith('/') ? currentPath + item.name : currentPath + '/' + item.name
  const newPath = currentPath.endsWith('/') ? currentPath + name : currentPath + '/' + name

  const submit = async (e) => {
    e.preventDefault(); setBusy(true)
    try { await api.post('/api/files/rename', { from: oldPath, to: newPath }); onDone() }
    catch (e) { alert(e.response?.data?.error || e.message); setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass-card" style={{ width: 400, padding: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Rename</h3>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus required />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Rename</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function FilesPage({ initialPath, jailedPath }) {
  const location = useLocation()
  const routerNavigate = useReactRouterNavigate()
  const backToSite = location.state?.backToSite
  const [path, setPath] = useState(location.state?.path || initialPath || (jailedPath ? jailedPath : '/root'))
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [editor, setEditor] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [search, setSearch] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(null)
  const [clipboard, setClipboard] = useState({ action: null, paths: [] })
  const fileInput = useRef()

  const load = useCallback(async (p = path) => {
    setLoading(true); setSelected(new Set())
    try {
      const r = await api.get('/api/files/list', { params: { path: p } })
      setFiles(r.data.files || [])
      setPath(r.data.path)
    } catch (e) {
      alert(e.response?.data?.error || e.message)
    }
    setLoading(false)
  }, [path])

  useEffect(() => { load() }, [])

  const navigate = (dir) => {
    let newPath = dir.startsWith('/') ? dir : `${path}/${dir}`.replace(/\/+/g, '/')
    if (jailedPath && !newPath.startsWith(jailedPath)) newPath = jailedPath
    load(newPath)
  }

  const goUp = () => {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    let newPath = '/' + parts.join('/') || '/'
    if (jailedPath && !newPath.startsWith(jailedPath)) newPath = jailedPath
    load(newPath)
  }

  const breadcrumbs = () => {
    let parts = path.split('/').filter(Boolean)
    let rootPrefix = ''
    if (jailedPath) {
      const jailedParts = jailedPath.split('/').filter(Boolean)
      parts = parts.slice(jailedParts.length)
      rootPrefix = jailedPath
      return [{ name: jailedPath, path: jailedPath }, ...parts.map((p, i) => ({ name: p, path: rootPrefix + '/' + parts.slice(0, i + 1).join('/') }))]
    }
    return [{ name: '/', path: '/' }, ...parts.map((p, i) => ({ name: p, path: '/' + parts.slice(0, i + 1).join('/') }))]
  }

  const toggleSelect = (name) => {
    setSelected(s => {
      const n = new Set(s)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })
  }

  const deleteSelected = async () => {
    if (!selected.size || !confirm(`Delete ${selected.size} item(s)?`)) return
    const paths = [...selected].map(n => `${path}/${n}`.replace(/\/+/g, '/'))
    await api.delete('/api/files/delete', { data: { paths } })
    load()
  }

  const createFolder = async (e) => {
    e.preventDefault()
    await api.post('/api/files/mkdir', { path: `${path}/${newFolderName}`.replace(/\/+/g, '/') })
    setNewFolderName(''); setShowNewFolder(false); load()
  }

  const upload = async (e) => {
    const uploadedFiles = e.target.files
    if (!uploadedFiles.length) return
    setUploading(true)
    for (const file of uploadedFiles) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('path', path)
      try { await api.post('/api/files/upload', fd) }
      catch (err) { alert(`Upload failed: ${err.response?.data?.error || err.message}`) }
    }
    setUploading(false)
    load()
  }

  const download = (name) => {
    const filePath = `${path}/${name}`.replace(/\/+/g, '/')
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:4001'}/api/files/download?path=${encodeURIComponent(filePath)}&token=${localAuth.getToken() || ''}`)
  }

  const copyPath = (name) => {
    const full = `${path}/${name}`.replace(/\/+/g, '/')
    navigator.clipboard.writeText(full)
    setCopied(name); setTimeout(() => setCopied(null), 2000)
  }

  const handleCopy = () => {
    if (!selected.size) return
    const pathsToCopy = [...selected].map(n => `${path}/${n}`.replace(/\/+/g, '/'))
    setClipboard({ action: 'copy', paths: pathsToCopy })
    setSelected(new Set())
  }

  const handleCut = () => {
    if (!selected.size) return
    const pathsToCut = [...selected].map(n => `${path}/${n}`.replace(/\/+/g, '/'))
    setClipboard({ action: 'cut', paths: pathsToCut })
    setSelected(new Set())
  }

  const handlePaste = async () => {
    if (!clipboard.paths.length) return
    try {
      const endpoint = clipboard.action === 'copy' ? '/api/files/copy' : '/api/files/move'
      await api.post(endpoint, { from: clipboard.paths, to: path })
      if (clipboard.action === 'cut') {
        setClipboard({ action: null, paths: [] })
      }
      load()
    } catch (err) {
      alert(`Paste failed: ${err.response?.data?.error || err.message}`)
    }
  }

  const moveSelectedUp = async () => {
    if (!selected.size) return
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0 || (jailedPath && path === jailedPath)) {
      alert('Cannot move further up. You are at the root path.')
      return
    }
    parts.pop()
    const parentPath = '/' + parts.join('/') || '/'
    
    const pathsToMove = [...selected].map(n => `${path}/${n}`.replace(/\/+/g, '/'))
    try {
      await api.post('/api/files/move', { from: pathsToMove, to: parentPath })
      load()
    } catch (err) {
      alert(`Move failed: ${err.response?.data?.error || err.message}`)
    }
  }

  const compressSelected = async () => {
    if (!selected.size) return
    const archiveName = prompt('Enter name for the ZIP archive:', 'archive.zip')
    if (!archiveName) return
    
    const pathsToCompress = [...selected].map(n => `${path}/${n}`.replace(/\/+/g, '/'))
    try {
      await api.post('/api/files/compress', { paths: pathsToCompress, archiveName })
      load()
    } catch (err) {
      alert(`Compression failed: ${err.response?.data?.error || err.message}`)
    }
  }

  const extractArchive = async (name) => {
    if (!confirm(`Extract ZIP archive '${name}' in the current folder?`)) return
    const filePath = `${path}/${name}`.replace(/\/+/g, '/')
    try {
      await api.post('/api/files/extract', { filePath })
      load()
    } catch (err) {
      alert(`Extraction failed: ${err.response?.data?.error || err.message}`)
    }
  }

  const filtered = files.filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase()))
  const dirs = filtered.filter(f => f.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))
  const fls = filtered.filter(f => f.type !== 'dir').sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {editor && <EditorModal file={editor} onClose={() => setEditor(null)} />}
      {renaming && <RenameModal item={renaming} currentPath={path} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); load() }} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>File Manager</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
            Full VPS filesystem access {backToSite && <span>(Browsing files for <strong>{backToSite.domain}</strong>)</span>}
          </p>
        </div>
        {backToSite && (
          <button 
            className="btn btn-secondary" 
            onClick={() => routerNavigate(`/websites/${backToSite.id}`)}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6, 
              padding: '8px 16px', 
              background: 'rgba(59, 130, 246, 0.08)', 
              borderColor: 'rgba(59, 130, 246, 0.25)', 
              color: 'var(--color-primary)' 
            }}
          >
            <ArrowLeft size={14}/> Back to Manage Site ({backToSite.domain})
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="glass-card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 200, flexWrap: 'wrap' }}>
          {path !== '/' && (!jailedPath || path !== jailedPath) && (
            <button onClick={goUp} className="btn btn-secondary btn-sm" title="Go up"><ArrowLeft size={13} /></button>
          )}
          {breadcrumbs().map((b, i, arr) => (
            <span key={b.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => load(b.path)} style={{ background: 'none', border: 'none', color: i === arr.length - 1 ? 'var(--color-text)' : 'var(--color-primary)', cursor: 'pointer', padding: '2px 4px', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: i === arr.length - 1 ? 600 : 400 }}>
                {b.name}
              </button>
              {i < arr.length - 1 && <ChevronRight size={12} color="var(--color-text-muted)" />}
            </span>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', width: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input className="input" placeholder="Filter…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 30, height: 32, fontSize: '0.8125rem' }} />
        </div>

        {/* Actions */}
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm animate-hover" onClick={handleCopy} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Copy selected items to clipboard">
              <Copy size={13} /> Copy
            </button>
            <button className="btn btn-secondary btn-sm animate-hover" onClick={handleCut} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Cut selected items to clipboard">
              <Scissors size={13} /> Cut
            </button>
            {path !== '/' && (!jailedPath || path !== jailedPath) && (
              <button className="btn btn-secondary btn-sm animate-hover" onClick={moveSelectedUp} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Move selected items to the parent folder">
                <ChevronUp size={13} /> Move to Parent
              </button>
            )}
            <button className="btn btn-secondary btn-sm animate-hover" onClick={compressSelected} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Compress selected items into a ZIP archive">
              <Archive size={13} /> Zip Selected
            </button>
            <button className="btn btn-danger btn-sm animate-hover" onClick={deleteSelected} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={13} /> Delete ({selected.size})
            </button>
          </div>
        )}
        {clipboard.paths.length > 0 && (
          <button 
            className="btn btn-primary btn-sm animate-pulse-light" 
            onClick={handlePaste} 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6, 
              background: 'linear-gradient(135deg, var(--color-primary) 0%, #4f46e5 100%)', 
              borderColor: 'var(--color-primary)' 
            }} 
            title={`Paste ${clipboard.paths.length} item(s) from clipboard into current directory`}
          >
            <Clipboard size={13} /> Paste ({clipboard.paths.length} item{clipboard.paths.length !== 1 ? 's' : ''})
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => setShowNewFolder(v => !v)}><FolderPlus size={13} /> New Folder</button>
        <button className="btn btn-secondary btn-sm" onClick={() => fileInput.current.click()} disabled={uploading}>
          <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={fileInput} type="file" multiple style={{ display: 'none' }} onChange={upload} />
        <button className="btn btn-secondary btn-sm" onClick={() => load()}><RefreshCw size={13} /></button>
      </div>

      {/* Quick access shortcuts */}
      {!jailedPath && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { label: '🏠 /root', path: '/root' },
            { label: '🌐 /var/www', path: '/var/www' },
            { label: '⚙️ /etc/nginx', path: '/etc/nginx' },
            { label: '📦 /opt', path: '/opt' },
            { label: '🐳 /var/lib/docker', path: '/var/lib/docker' },
            { label: '📁 /', path: '/' },
            { label: '📝 /etc', path: '/etc' },
            { label: '🗄️ /home', path: '/home' },
          ].map(s => (
            <button key={s.path} onClick={() => load(s.path)}
              style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: path === s.path ? 'rgba(59,130,246,0.15)' : 'var(--color-surface-2)', color: path === s.path ? 'var(--color-primary)' : 'var(--color-text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {showNewFolder && (
        <form onSubmit={createFolder} style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} autoFocus style={{ flex: 1 }} required />
          <button type="submit" className="btn btn-primary btn-sm">Create</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowNewFolder(false)}><X size={13} /></button>
        </form>
      )}

      {/* File list */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden', flex: 1 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, width: 32 }}>
                    <input type="checkbox" checked={selected.size === files.length && files.length > 0}
                      onChange={e => setSelected(e.target.checked ? new Set(files.map(f => f.name)) : new Set())} />
                  </th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Name</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Size</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Modified</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Permissions</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...dirs, ...fls].map(file => {
                  const fullPath = `${path}/${file.name}`.replace(/\/+/g, '/')
                  const isDir = file.type === 'dir'
                  return (
                    <tr key={file.name} style={{ borderBottom: '1px solid var(--color-border)', background: selected.has(file.name) ? 'rgba(59,130,246,0.07)' : 'transparent' }}
                      onMouseEnter={e => e.currentTarget.style.background = selected.has(file.name) ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = selected.has(file.name) ? 'rgba(59,130,246,0.07)' : 'transparent'}>
                      <td style={{ padding: '8px 16px' }}>
                        <input type="checkbox" checked={selected.has(file.name)} onChange={() => toggleSelect(file.name)} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: isDir ? 'pointer' : 'default' }}
                          onClick={() => isDir && navigate(file.name)}>
                          {isDir
                            ? <Folder size={15} color="#f59e0b" style={{ flexShrink: 0 }} />
                            : file.type === 'link'
                              ? <Folder size={15} color="#06b6d4" style={{ flexShrink: 0 }} />
                              : <File size={15} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />}
                          <span style={{ fontSize: '0.875rem', color: isDir ? 'var(--color-text)' : file.type === 'link' ? '#06b6d4' : 'var(--color-text-dim)', fontWeight: isDir ? 500 : 400 }}>
                            {file.name}{file.linkTarget ? <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}> → {file.linkTarget}</span> : null}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {isDir ? '—' : formatSize(file.size)}
                      </td>
                      <td style={{ padding: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {file.modified?.substring(0, 10) || '—'}
                      </td>
                      <td style={{ padding: '8px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                        {file.permissions}
                      </td>
                      <td style={{ padding: '8px 16px' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {file.name.endsWith('.zip') && (
                            <button onClick={() => extractArchive(file.name)} className="btn btn-secondary btn-sm animate-hover" title="Extract ZIP archive here" style={{ borderColor: 'rgba(16,185,129,0.35)', color: 'var(--color-success)' }}>
                              <Archive size={12} />
                            </button>
                          )}
                          <button onClick={() => copyPath(file.name)} className="btn btn-secondary btn-sm" title="Copy path">
                            {copied === file.name ? <Check size={12} color="var(--color-success)" /> : <Copy size={12} />}
                          </button>
                          {!isDir && isEditable(file.name) && (
                            <button onClick={() => setEditor(fullPath)} className="btn btn-secondary btn-sm" title="Edit"><Edit2 size={12} /></button>
                          )}
                          {!isDir && (
                            <button onClick={() => download(file.name)} className="btn btn-secondary btn-sm" title="Download"><Download size={12} /></button>
                          )}
                          <button onClick={() => setRenaming(file)} className="btn btn-secondary btn-sm" title="Rename"><Edit2 size={12} /></button>
                          <button onClick={() => { setSelected(new Set([file.name])); deleteSelected() }} className="btn btn-danger btn-sm" title="Delete"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {dirs.length + fls.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>Empty directory</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>
        {dirs.length} folders · {fls.length} files · {path}
      </p>
    </div>
  )
}
