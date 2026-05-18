import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Globe, Plus, Trash2, RotateCcw, Terminal, FileCode, ShieldCheck, ShieldOff, ExternalLink, RefreshCw, X, Save, Check, AlertTriangle, Lock, Unlock, Upload, ChevronRight, Folder, Server, Mail, Braces, Wrench, Search, Cpu, Boxes } from 'lucide-react'
import { localAuth } from '../lib/auth'
import api from '../lib/api'

function Overlay({ children, onClose }) {
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(3px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      {children}
    </div>,
    document.body
  )
}

// ── Nginx Config Editor Modal ────────────────────────────────────────────────
function NginxEditor({ site, onClose }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    api.get(`/api/sites/${site.id}/config`).then(r => { setContent(r.data.content); setLoading(false) }).catch(e => { setError(e.response?.data?.error || e.message); setLoading(false) })
  }, [site.id])
  const save = async () => {
    setSaving(true)
    try { await api.post(`/api/sites/${site.id}/config`, { content }); setSaving(false) }
    catch (e) { setError(e.response?.data?.error || e.message); setSaving(false) }
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div className="glass-card" style={{ width:'100%', maxWidth:860, maxHeight:'88vh', display:'flex', flexDirection:'column', padding:0, overflow:'hidden' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 18px', borderBottom:'1px solid var(--color-border)' }}>
          <div><div style={{ fontWeight:700 }}>nginx — {site.domain}</div><div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)' }}>{site.configFile}</div></div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving||loading}><Save size={13}/> {saving?'Saving…':'Save & Reload'}</button>
            <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={13}/></button>
          </div>
        </div>
        {error && <div style={{ padding:'8px 18px', background:'rgba(239,68,68,0.1)', color:'var(--color-danger)', fontSize:'0.8125rem' }}>{error}</div>}
        {loading ? <div style={{ padding:32, textAlign:'center', color:'var(--color-text-muted)' }}>Loading…</div>
          : <textarea value={content} onChange={e=>setContent(e.target.value)} style={{ flex:1, minHeight:420, background:'#0a0e17', color:'#e2e8f0', border:'none', padding:'14px 18px', fontFamily:'var(--font-mono)', fontSize:'0.8125rem', lineHeight:1.7, outline:'none', resize:'none' }}/>}
      </div>
    </div>
  )
}

// ── Site Creation Wizard ──────────────────────────────────────────────────────
const STEPS = ['Stack', 'Source', 'Config', 'Deploy']

function Wizard({ onClose, onCreated }) {
  const [step, setStep] = useState(0)
  const [type, setType] = useState('static') // static|node|php|proxy
  const [source, setSource] = useState('none') // none|git|zip
  const [domain, setDomain] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gitVisibility, setGitVisibility] = useState(null) // null|public|private
  const [gitCheckBusy, setGitCheckBusy] = useState(false)
  const [gitToken, setGitToken] = useState('')
  const [gitUser, setGitUser] = useState('')
  const [nodeVersion, setNodeVersion] = useState('system')
  const [nodeVersions, setNodeVersions] = useState([])
  const [port, setPort] = useState(3000)
  const [suggestedPort, setSuggestedPort] = useState(null)
  const [envText, setEnvText] = useState('')
  const [nodePackageManager, setNodePackageManager] = useState('npm')
  const [nodeInstallCommand, setNodeInstallCommand] = useState('npm install')
  const [nodeBuildCommand, setNodeBuildCommand] = useState('npm run build')
  const [nodeStartCommand, setNodeStartCommand] = useState('npm start')
  const [runNodeInstall, setRunNodeInstall] = useState(true)
  const [runNodeBuild, setRunNodeBuild] = useState(false)
  const [runNodeStart, setRunNodeStart] = useState(true)
  const [nodeOutputDir, setNodeOutputDir] = useState('')
  const [phpPreset, setPhpPreset] = useState('blank')
  const [phpVersion, setPhpVersion] = useState('8.2')
  const [wpTitle, setWpTitle] = useState('')
  const [wpAdminUser, setWpAdminUser] = useState('admin')
  const [wpAdminPass, setWpAdminPass] = useState('')
  const [wpAdminEmail, setWpAdminEmail] = useState('')
  const [configureMailboxes, setConfigureMailboxes] = useState(false)
  const [mailboxes, setMailboxes] = useState('')
  const [zipFile, setZipFile] = useState(null)
  const [ssl, setSsl] = useState(false)
  const [lines, setLines] = useState([])
  const [deploying, setDeploying] = useState(false)
  const [done, setDone] = useState(false)
  const termRef = useRef()
  const fileRef = useRef()

  useEffect(() => {
    api.get('/api/sites/node-versions').then(r => setNodeVersions(r.data.versions||[])).catch(()=>{})
    api.get('/api/sites/suggest-port', { params:{start:3000} }).then(r => { setPort(r.data.port); setSuggestedPort(r.data.port) }).catch(()=>{})
  }, [])

  useEffect(() => {
    if (type === 'node') {
      setEnvText(v => v || `NODE_ENV=production\nPORT=${port}`)
    }
    if (type === 'python' || type === 'flask') {
      setEnvText(v => v || `FLASK_ENV=production\nPORT=${port}`)
    }
    if (type === 'php') {
      setEnvText('')
      setWpTitle(t => t || domain || 'WordPress Site')
      setWpAdminEmail(e => e || `admin@${domain || 'example.com'}`)
    }
  }, [type, domain, port])

  useEffect(() => {
    if (type !== 'node') return
    if (source === 'none') {
      setRunNodeInstall(false)
      setRunNodeBuild(false)
      setRunNodeStart(false)
    } else {
      setRunNodeInstall(true)
      setRunNodeStart(true)
    }
  }, [type, source])

  useEffect(() => { termRef.current?.scrollTo(0, termRef.current.scrollHeight) }, [lines])

  const checkGitRepo = async (url) => {
    if (!url || !url.startsWith('http')) return
    setGitCheckBusy(true); setGitVisibility(null)
    try { const r = await api.get('/api/sites/check-repo', { params:{url} }); setGitVisibility(r.data.visibility) }
    catch { setGitVisibility('unknown') }
    setGitCheckBusy(false)
  }

  const deploy = async () => {
    setDeploying(true); setLines([]); setStep(3)
    try {
      const token = localAuth.getToken() || ''
      const body = new FormData()
      body.append('domain', domain)
      body.append('type', type)
      body.append('source', source)
      if (source==='git') { body.append('gitRepo', gitUrl); body.append('branch', gitBranch) }
      if (gitVisibility==='private') { body.append('gitUser', gitUser); body.append('gitToken', gitToken) }
      body.append('port', port)
      body.append('envVars', envText)
      body.append('ssl', ssl)
      body.append('nodeVersion', nodeVersion)
      body.append('nodePackageManager', nodePackageManager)
      body.append('nodeInstallCommand', runNodeInstall ? nodeInstallCommand : '')
      body.append('nodeBuildCommand', runNodeBuild ? nodeBuildCommand : '')
      body.append('nodeStartCommand', runNodeStart ? nodeStartCommand : '')
      body.append('nodeOutputDir', nodeOutputDir)
      body.append('phpPreset', phpPreset)
      body.append('phpVersion', phpVersion)
      body.append('wpTitle', wpTitle)
      body.append('wpAdminUser', wpAdminUser)
      body.append('wpAdminPass', wpAdminPass)
      body.append('wpAdminEmail', wpAdminEmail)
      body.append('mailboxes', configureMailboxes ? mailboxes : '')
      if (source==='zip' && zipFile) body.append('zip', zipFile)

      const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/sites/create-wizard`, {
        method:'POST', headers:{ Authorization:`Bearer ${token}` }, body
      })
      
      if (!resp.ok) {
        let errText = await resp.text()
        try { errText = JSON.parse(errText).error || errText } catch {}
        throw new Error(errText || `Server returned ${resp.status}`)
      }

      const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf=''
      while(true) {
        const {done:d,value} = await reader.read(); if(d) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop()
        parts.forEach(l => { if(l.startsWith('data: ')) setLines(p=>[...p,l.slice(6)]) })
      }
      setDone(true); onCreated()
    } catch (e) {
      setLines(p=>[...p, `✗ Upload/Network Error: ${e.message}`])
    } finally {
      setDeploying(false)
    }
  }

  const TYPES = [
    { id:'static', Icon: Globe, title:'Static / SPA', desc:'React, Vue, plain HTML', hint:'Build output or ready-to-serve files' },
    { id:'node',   Icon: Server, title:'Node.js', desc:'Express, Next.js, PM2', hint:'Vercel-style install/build/start controls' },
    { id:'python', Icon: Terminal, title:'Flask / Python', desc:'Flask, Gunicorn, PM2', hint:'Automated virtualenv and package dependencies' },
    { id:'php',    Icon: Boxes, title:'PHP / WordPress', desc:'PHP-FPM, Laravel, WordPress', hint:'PHP version, WordPress bootstrap, CDN cache rules' },
    { id:'proxy',  Icon: Cpu, title:'Reverse Proxy', desc:'Proxy to existing service', hint:'Forward domain traffic to a local port' },
  ]

  return (
    <Overlay onClose={!deploying ? onClose : undefined}>
      <div className="glass-card" style={{ width:'100%', maxWidth:860, padding:0, overflow:'hidden', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 80px rgba(0,0,0,0.45)' }}>
        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontWeight:700, fontSize:'1.0625rem' }}>New Website</div>
            <div style={{ display:'flex', gap:4, marginTop:6 }}>
              {STEPS.map((s,i) => (
                <div key={s} style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <div style={{ fontSize:'0.75rem', padding:'2px 10px', borderRadius:20, background: i===step ? 'rgba(59,130,246,0.2)' : i<step ? 'rgba(16,185,129,0.15)' : 'var(--color-surface-3)', color: i===step ? 'var(--color-primary)' : i<step ? 'var(--color-success)' : 'var(--color-text-muted)', fontWeight: i===step ? 700:400 }}>{i<step?'✓ ':''}{s}</div>
                  {i<STEPS.length-1 && <ChevronRight size={12} color="var(--color-text-muted)"/>}
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={13}/></button>
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {/* Step 0: Stack */}
          {step===0 && (
            <div>
              <p style={{ color:'var(--color-text-muted)', marginBottom:16, fontSize:'0.875rem' }}>What kind of site are you deploying?</p>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:12 }}>
                {TYPES.map(t => (
                  <div key={t.id} onClick={()=>setType(t.id)} style={{ padding:16, borderRadius:10, border:`2px solid ${type===t.id?'var(--color-primary)':'var(--color-border)'}`, background: type===t.id?'rgba(59,130,246,0.08)':'var(--color-surface-2)', cursor:'pointer', transition:'all 0.15s' }}>
                    <div style={{ width:34, height:34, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', background:type===t.id?'rgba(59,130,246,0.18)':'var(--color-surface-3)', marginBottom:10 }}>
                      <t.Icon size={17} color={type===t.id?'var(--color-primary)':'var(--color-text-muted)'}/>
                    </div>
                    <div style={{ fontWeight:700, marginBottom:2 }}>{t.title}</div>
                    <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)' }}>{t.desc}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--color-text-muted)', marginTop:8 }}>{t.hint}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:18 }}>
                <label className="label">Domain name</label>
                <input className="input" value={domain} onChange={e=>setDomain(e.target.value)} placeholder="mysite.com" />
              </div>
            </div>
          )}

          {/* Step 1: Source */}
          {step===1 && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {type!=='proxy' && (
                <div>
                  <label className="label" style={{ marginBottom:8 }}>Source Optional</label>
                  <div style={{ display:'flex', gap:8 }}>
                    {['none','git','zip'].map(s=>(
                      <button key={s} onClick={()=>setSource(s)} style={{ flex:1, padding:'8px 0', borderRadius:8, border:`2px solid ${source===s?'var(--color-primary)':'var(--color-border)'}`, background:source===s?'rgba(59,130,246,0.1)':'var(--color-surface-2)', cursor:'pointer', fontWeight:source===s?700:400, color:source===s?'var(--color-primary)':'var(--color-text-muted)' }}>
                        {s==='none'?'Skip for now':s==='git'?'Git Repository':'Upload ZIP'}
                      </button>
                    ))}
                  </div>
                  <p style={{ margin:'6px 0 0', fontSize:'0.75rem', color:'var(--color-text-muted)' }}>You can create nginx/app config now and upload or connect source later from Files or Deploy.</p>
                </div>
              )}

              {type === 'proxy' ? (
                <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔀</div>
                  <h3 style={{ margin: '0 0 8px', color: 'var(--color-text)' }}>No Source Files Needed</h3>
                  <p style={{ margin: 0 }}>Reverse proxies forward traffic to an existing port.</p>
                  <p style={{ margin: '4px 0 0' }}>Click Next to configure the upstream port.</p>
                </div>
              ) : source === 'none' ? (
                <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 34, background:'var(--color-surface-2)', border:'1px solid var(--color-border)', borderRadius:10 }}>
                  <Folder size={28} style={{ margin:'0 auto 10px' }} />
                  <h3 style={{ margin:'0 0 6px', color:'var(--color-text)' }}>Create Empty Site</h3>
                  <p style={{ margin:0 }}>ServerDash will create the folder and nginx config only.</p>
                  <p style={{ margin:'4px 0 0' }}>Add files, connect Git, or run commands later.</p>
                </div>
              ) : source === 'git' ? (
                <div>
                  <label className="label">Git Repository URL</label>
                  <div style={{ position: 'relative' }}>
                    <input className="input" value={gitUrl} onChange={e => { setGitUrl(e.target.value); setGitVisibility(null) }} onBlur={() => checkGitRepo(gitUrl)} placeholder="https://github.com/user/repo" style={{ paddingRight: 120 }} />
                    {gitCheckBusy && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Checking…</span>}
                    {gitVisibility === 'public' && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}><Unlock size={11} /> Public</span>}
                    {gitVisibility === 'private' && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: 4 }}><Lock size={11} /> Private</span>}
                  </div>
                  {gitVisibility === 'private' && (
                    <div style={{ marginTop: 12, padding: 14, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 10, color: 'var(--color-warning)' }}>🔒 Private repository — enter access credentials</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div><label className="label">GitHub Username</label><input className="input" value={gitUser} onChange={e => setGitUser(e.target.value)} placeholder="username" /></div>
                        <div><label className="label">Access Token / PAT</label><input className="input" type="password" value={gitToken} onChange={e => setGitToken(e.target.value)} placeholder="ghp_xxxxx" /></div>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 8 }}>Generate at GitHub → Settings → Developer Settings → Personal Access Tokens</p>
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}><label className="label">Branch</label><input className="input" value={gitBranch} onChange={e => setGitBranch(e.target.value)} placeholder="main" /></div>
                </div>
              ) : (
                <div>
                  <label className="label">Upload ZIP file</label>
                  <div onClick={()=>fileRef.current.click()} style={{ border:'2px dashed var(--color-border)', borderRadius:10, padding:32, textAlign:'center', cursor:'pointer', background:'var(--color-surface-2)' }}>
                    <Upload size={28} style={{ margin:'0 auto 10px', color:'var(--color-text-muted)' }}/>
                    <div style={{ fontWeight:600 }}>{zipFile?zipFile.name:'Click to select ZIP'}</div>
                    <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)', marginTop:4 }}>Your built site files (dist/ or build/)</div>
                    <input ref={fileRef} type="file" accept=".zip" style={{ display:'none' }} onChange={e=>setZipFile(e.target.files?.[0]||null)}/>
                  </div>
                </div>
              )}

              {type==='node' && (
                <div className="glass-card" style={{ padding:14 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                    <Braces size={15} color="var(--color-primary)" />
                    <div style={{ fontWeight:700, fontSize:'0.9rem' }}>Node Runtime</div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div>
                      <label className="label">Node.js Version</label>
                      <select className="input" value={nodeVersion} onChange={e=>setNodeVersion(e.target.value)}>
                        <option value="system">System ({nodeVersions[0]||'current'})</option>
                        {nodeVersions.map(v=><option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Package Manager</label>
                      <select className="input" value={nodePackageManager} onChange={e=>setNodePackageManager(e.target.value)}>
                        <option value="npm">npm</option>
                        <option value="pnpm">pnpm</option>
                        <option value="yarn">yarn</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Config */}
          {step===2 && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {(type==='node'||type==='proxy'||type==='python'||type==='flask') && (
                <div>
                  <label className="label" style={{ display:'flex', justifyContent:'space-between' }}>
                    App Port
                    {suggestedPort && <span style={{ fontSize:'0.75rem', color:'var(--color-success)' }}>✓ {suggestedPort} is available</span>}
                  </label>
                  <input className="input" type="number" value={port} onChange={e=>setPort(parseInt(e.target.value)||3000)} />
                  {suggestedPort && port!==suggestedPort && <p style={{ fontSize:'0.75rem', color:'var(--color-warning)', marginTop:4 }}>⚠ Port {port} may be in use. Suggested: {suggestedPort}</p>}
                </div>
              )}

              <div>
                <label className="label">.env Variables (paste your .env file content)</label>
                <textarea value={envText} onChange={e=>setEnvText(e.target.value)} placeholder={'NODE_ENV=production\nPORT=3000\nDATABASE_URL=...\n# Add your environment variables here'} style={{ width:'100%', height:160, background:'#0a0e17', color:'#e2e8f0', border:'1px solid var(--color-border)', borderRadius:8, padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:'0.8125rem', lineHeight:1.6, outline:'none', resize:'vertical', boxSizing:'border-box' }}/>
                <p style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', marginTop:4 }}>These will be saved to /var/www/{domain||'yoursite'}/.env</p>
              </div>

              {type==='node' && (
                <div className="glass-card" style={{ padding:16 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                    <Wrench size={15} color="var(--color-primary)" />
                    <div style={{ fontWeight:700, fontSize:'0.9rem' }}>Build & Process Commands</div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div>
                      <label className="label"><input type="checkbox" checked={runNodeInstall} onChange={e=>setRunNodeInstall(e.target.checked)} style={{ marginRight:6 }}/>Run Install Now</label>
                      <input className="input" value={nodeInstallCommand} onChange={e=>setNodeInstallCommand(e.target.value)} placeholder="npm install" disabled={!runNodeInstall} />
                    </div>
                    <div>
                      <label className="label"><input type="checkbox" checked={runNodeBuild} onChange={e=>setRunNodeBuild(e.target.checked)} style={{ marginRight:6 }}/>Run Build Now</label>
                      <input className="input" value={nodeBuildCommand} onChange={e=>setNodeBuildCommand(e.target.value)} placeholder="npm run build" disabled={!runNodeBuild} />
                    </div>
                    <div>
                      <label className="label"><input type="checkbox" checked={runNodeStart} onChange={e=>setRunNodeStart(e.target.checked)} style={{ marginRight:6 }}/>Start PM2 Now</label>
                      <input className="input" value={nodeStartCommand} onChange={e=>setNodeStartCommand(e.target.value)} placeholder="npm start" disabled={!runNodeStart} />
                    </div>
                    <div><label className="label">Static Output Dir (optional)</label><input className="input" value={nodeOutputDir} onChange={e=>setNodeOutputDir(e.target.value)} placeholder=".next, dist, build" /></div>
                  </div>
                  <p style={{ margin:'8px 0 0', fontSize:'0.75rem', color:'var(--color-text-muted)' }}>Leave steps unchecked to configure the site now and run build/start later.</p>
                </div>
              )}

              {type==='php' && (
                <div className="glass-card" style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <FileCode size={15} color="var(--color-primary)" />
                    <div style={{ fontWeight:700, fontSize:'0.9rem' }}>PHP Site Options</div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div>
                      <label className="label">Preset</label>
                      <select className="input" value={phpPreset} onChange={e=>setPhpPreset(e.target.value)}>
                        <option value="blank">Blank PHP / existing app</option>
                        <option value="wordpress">One-click WordPress</option>
                        <option value="laravel">Laravel-ready config</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">PHP-FPM Version</label>
                      <select className="input" value={phpVersion} onChange={e=>setPhpVersion(e.target.value)}>
                        <option value="8.3">PHP 8.3</option>
                        <option value="8.2">PHP 8.2</option>
                        <option value="8.1">PHP 8.1</option>
                      </select>
                    </div>
                  </div>
                  {phpPreset==='wordpress' && (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                      <div><label className="label">Site Title</label><input className="input" value={wpTitle} onChange={e=>setWpTitle(e.target.value)} placeholder={domain || 'WordPress Site'} /></div>
                      <div><label className="label">Admin Email</label><input className="input" value={wpAdminEmail} onChange={e=>setWpAdminEmail(e.target.value)} placeholder={`admin@${domain || 'example.com'}`} /></div>
                      <div><label className="label">Admin Username</label><input className="input" value={wpAdminUser} onChange={e=>setWpAdminUser(e.target.value)} /></div>
                      <div><label className="label">Admin Password</label><input className="input" type="password" value={wpAdminPass} onChange={e=>setWpAdminPass(e.target.value)} placeholder="Leave blank to generate" /></div>
                    </div>
                  )}
                  <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:'0.875rem', color:'var(--color-text)' }}>
                    <input type="checkbox" checked={configureMailboxes} onChange={e=>setConfigureMailboxes(e.target.checked)} />
                    Configure mailboxes now
                  </label>
                  {configureMailboxes && (
                    <div>
                      <label className="label"><Mail size={13} style={{ display:'inline', marginRight:4 }}/> Mailboxes to prepare</label>
                      <textarea className="input" value={mailboxes} onChange={e=>setMailboxes(e.target.value)} placeholder={`admin@${domain || 'example.com'}:strong-password\nsupport@${domain || 'example.com'}:another-password`} style={{ height:82, fontFamily:'var(--font-mono)', resize:'vertical' }} />
                      <p style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', margin:'4px 0 0' }}>Optional. You can skip this and configure mail later from SMTP & Mail.</p>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <input type="checkbox" id="ssl-chk" checked={ssl} onChange={e=>setSsl(e.target.checked)} style={{ width:16, height:16 }}/>
                <label htmlFor="ssl-chk" style={{ fontSize:'0.875rem' }}>
                  Enable SSL with Let's Encrypt (certbot) — domain must point to this server's IP first
                </label>
              </div>
            </div>
          )}

          {/* Step 3: Deploy */}
          {step===3 && (
            <div>
              <div style={{ marginBottom:12, fontSize:'0.875rem', color:'var(--color-text-muted)' }}>
                {done ? '✅ Deployment complete!' : deploying ? '⚙️ Deploying…' : 'Ready to deploy'}
              </div>
              <div ref={termRef} className="terminal" style={{ height:300, overflowY:'auto', fontSize:'0.8rem' }}>
                {lines.length===0 ? <span style={{ color:'var(--color-text-muted)' }}>Starting deployment…</span> : lines.map((l,i)=>(
                  <div key={i} style={{ color:l.startsWith('✓')?'var(--color-success)':l.startsWith('✗')?'var(--color-danger)':undefined }}>{l}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div style={{ padding:'14px 20px', borderTop:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between' }}>
          <button className="btn btn-secondary" onClick={()=>step>0?setStep(s=>s-1):onClose()} disabled={deploying}>{step===0?'Cancel':'← Back'}</button>
          {step<2 && <button className="btn btn-primary" onClick={()=>setStep(s=>s+1)} disabled={step===0&&!domain.trim()}>Next →</button>}
          {step===2 && <button className="btn btn-primary" onClick={deploy}>🚀 Deploy Site</button>}
          {step===3 && done && <button className="btn btn-success" onClick={onClose}>Done ✓</button>}
        </div>
      </div>
    </Overlay>
  )
}

// ── Main WebsitesPage ─────────────────────────────────────────────────────────
const TYPE_COLORS = { static: '#3b82f6', proxy: '#8b5cf6', node: '#10b981', php: '#f59e0b', python: '#3776ab', flask: '#3776ab', 'no-nginx': '#6b7280' }
const TYPE_LABELS = { static: 'Static / SPA', node: 'Node.js App', php: 'PHP / WP', python: 'Flask / Python', flask: 'Flask / Python', proxy: 'Reverse Proxy', 'no-nginx': 'No Nginx' }

export default function WebsitesPage() {
  const navigate = useNavigate()
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/sites')
      setSites(r.data)
    } catch {
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {showWizard && <Wizard onClose={() => setShowWizard(false)} onCreated={() => { setShowWizard(false); load() }} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Websites</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
            {sites.length} site{sites.length !== 1 ? 's' : ''} configured on Nginx
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-icon" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
          <button className="btn btn-primary" onClick={() => setShowWizard(true)}><Plus size={16} /> New Site</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : sites.length === 0 ? (
        <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <Globe size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <p>No nginx sites found</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowWizard(true)}>
            <Plus size={14} /> Create First Site
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {sites.map(site => (
            <div key={site.id} className="glass-card card-hover" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', overflow: 'hidden' }}>
              
              {/* Card Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ 
                    width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', 
                    background: `${TYPE_COLORS[site.type] || '#6b7280'}1a`, color: TYPE_COLORS[site.type] || '#6b7280' 
                  }}>
                    <Globe size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>
                      {site.domain}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                      <span style={{ 
                        fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4, fontWeight: 700, 
                        background: `${TYPE_COLORS[site.type] || '#6b7280'}1a`, color: TYPE_COLORS[site.type] || '#6b7280' 
                      }}>
                        {TYPE_LABELS[site.type] || site.type}
                      </span>
                      {site.ssl ? (
                        <span className="badge badge-green" style={{ fontSize: '0.625rem', padding: '1px 5px' }}>✓ SSL</span>
                      ) : (
                        <span className="badge badge-red" style={{ fontSize: '0.625rem', padding: '1px 5px' }}>HTTP</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Specs & Routes */}
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-dim)', display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Root Dir:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={site.root}>
                    {site.root || '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Gateway:</span>
                  <span>
                    {site.proxyPort ? (
                      <code style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>proxy → :{site.proxyPort}</code>
                    ) : (
                      <code style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>static direct</code>
                    )}
                  </span>
                </div>
              </div>

              {/* Manage Action */}
              <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
                <button 
                  className="btn btn-secondary btn-sm" 
                  style={{ flex: 1 }} 
                  onClick={() => navigate(`/websites/manage/${site.id}`)}
                >
                  <Wrench size={13} /> Manage Site
                </button>
                <a 
                  href={`${site.ssl ? 'https' : 'http'}://${site.domain}`} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn btn-secondary btn-icon btn-sm"
                  title="Visit website"
                >
                  <ExternalLink size={13} />
                </a>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  )
}
