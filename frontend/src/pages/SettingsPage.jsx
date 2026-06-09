import { useState, useEffect, useRef } from 'react'
import { Save, Eye, EyeOff, Server, Key, Globe, Bell, Sliders, Palette, CheckCircle, Shield, Link, Unlink, RefreshCw, X, Copy, ExternalLink } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useBranding } from '../contexts/BrandingContext'

// Inline GitHub logo SVG (lucide-react version in use doesn't include it)
const GithubIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} role="img" aria-label="GitHub">
    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.09.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.03-2.682-.103-.253-.446-1.27.098-2.646 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.376.202 2.394.1 2.646.64.698 1.026 1.591 1.026 2.682 0 3.841-2.337 4.687-4.565 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.577.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
  </svg>
)

export default function SettingsPage() {
  const { user } = useAuth()
  const { branding, updateBranding } = useBranding()
  const [vps, setVps] = useState({ host: import.meta.env.VITE_VPS_HOST || '', user: 'root', keyPath: '/root/.ssh/id_rsa', port: '22' })
  const [notifications, setNotifications] = useState({ cpuThreshold: 80, ramThreshold: 90, emailAlerts: false, alertEmail: '' })
  const [apiUrl, setApiUrl] = useState(import.meta.env.VITE_API_URL || 'http://localhost:4001')
  const [saved, setSaved] = useState('')
  const [showKey, setShowKey] = useState(false)

  // Swap space states
  const [swapInfo, setSwapInfo] = useState({ active: false, totalSwapBytes: 0, usedSwapBytes: 0, swapFileExists: false, swapFileSizeBytes: 0 })
  const [swapSizeInput, setSwapSizeInput] = useState(5)
  const [swapLoading, setSwapLoading] = useState(false)
  const [swapActionBusy, setSwapActionBusy] = useState(false)
  const [swapMsg, setSwapMsg] = useState('')

  // ── GitHub Integration State ───────────────────────────────────────────────
  const [ghStatus, setGhStatus] = useState({ connected: false, clientIdConfigured: false })
  const [ghLoading, setGhLoading] = useState(true)
  const [ghConnecting, setGhConnecting] = useState(false)
  const [ghDeviceFlow, setGhDeviceFlow] = useState(null) // { user_code, verification_uri, device_code, interval }
  const [ghPollStatus, setGhPollStatus] = useState('') // 'polling'|'success'|'error'|''
  const [ghPollMsg, setGhPollMsg] = useState('')
  const pollIntervalRef = useRef(null)
  const [ghCopied, setGhCopied] = useState(false)

  const fetchSwap = async () => {
    setSwapLoading(true)
    try {
      const r = await api.get('/api/system/swap')
      setSwapInfo(r.data)
      if (r.data.swapFileSizeBytes > 0) {
        setSwapSizeInput(Math.round(r.data.swapFileSizeBytes / (1024 * 1024 * 1024)))
      }
    } catch (e) {}
    setSwapLoading(false)
  }

  useEffect(() => {
    fetchSwap()
    fetchGhStatus()
  }, [])

  // ── GitHub Integration Handlers ─────────────────────────────────────────────
  const fetchGhStatus = async () => {
    setGhLoading(true)
    try {
      const r = await api.get('/api/github/status')
      setGhStatus(r.data)
    } catch {}
    setGhLoading(false)
  }

  const startGithubConnect = async () => {
    setGhConnecting(true)
    setGhDeviceFlow(null)
    setGhPollStatus(''); setGhPollMsg('')
    try {
      const r = await api.post('/api/github/connect/start')
      setGhDeviceFlow(r.data)
      setGhPollStatus('polling')
      setGhPollMsg('Waiting for you to authorize on GitHub…')
      // Start polling at the interval returned by GitHub
      const interval = (r.data.interval || 5) * 1000
      pollIntervalRef.current = setInterval(() => pollGithubToken(r.data.device_code), interval)
    } catch (e) {
      setGhPollStatus('error')
      setGhPollMsg(e.response?.data?.error || e.message)
    }
    setGhConnecting(false)
  }

  const pollGithubToken = async (device_code) => {
    try {
      const r = await api.post('/api/github/connect/poll', { device_code })
      if (r.data.status === 'success') {
        clearInterval(pollIntervalRef.current)
        setGhPollStatus('success')
        setGhPollMsg(`✓ Connected as @${r.data.login}`)
        setGhDeviceFlow(null)
        await fetchGhStatus()
      } else if (r.data.status === 'error') {
        clearInterval(pollIntervalRef.current)
        setGhPollStatus('error')
        setGhPollMsg(r.data.error || 'Authorization failed or expired')
      }
      // 'pending' — keep polling
    } catch {}
  }

  const cancelGithubConnect = () => {
    clearInterval(pollIntervalRef.current)
    setGhDeviceFlow(null)
    setGhPollStatus('')
    setGhPollMsg('')
  }

  const disconnectGithub = async () => {
    if (!window.confirm('Disconnect GitHub account? Future private repo deployments will require a manual PAT.')) return
    try {
      await api.delete('/api/github/disconnect')
      setGhStatus({ connected: false, clientIdConfigured: ghStatus.clientIdConfigured })
    } catch (e) {
      alert('Failed to disconnect: ' + (e.response?.data?.error || e.message))
    }
  }

  const copyCode = () => {
    if (!ghDeviceFlow?.user_code) return
    navigator.clipboard.writeText(ghDeviceFlow.user_code).catch(() => {})
    setGhCopied(true)
    setTimeout(() => setGhCopied(false), 2000)
  }

  const configureSwap = async () => {
    setSwapActionBusy(true)
    setSwapMsg('')
    try {
      const { data } = await api.post('/api/system/swap', { sizeGB: swapSizeInput })
      setSwapMsg(`✓ ${data.message}`)
      await fetchSwap()
    } catch (err) {
      setSwapMsg(`✗ Error: ${err.response?.data?.error || err.message}`)
    }
    setSwapActionBusy(false)
  }

  const disableSwap = async () => {
    if (!window.confirm('Are you sure you want to completely disable and delete the swap file? This may cause the VPS to run out of memory under peak load.')) return
    setSwapActionBusy(true)
    setSwapMsg('')
    try {
      const { data } = await api.post('/api/system/swap', { sizeGB: 0 })
      setSwapMsg(`✓ ${data.message}`)
      setSwapSizeInput(5)
      await fetchSwap()
    } catch (err) {
      setSwapMsg(`✗ Error: ${err.response?.data?.error || err.message}`)
    }
    setSwapActionBusy(false)
  }

  // Local state for branding preview
  const [brandForm, setBrandForm] = useState({
    appName: branding.appName || 'ServerDash',
    logoUrl: branding.logoUrl || '',
    faviconUrl: branding.faviconUrl || '',
  })

  const saveSection = async (section, data) => {
    try { 
      await api.post(`/api/settings/${section}`, data) 
      setSaved(section)
      setTimeout(() => setSaved(''), 3000)
    } catch (e) {
      alert(`✗ Failed to save settings: ${e.message}`)
    }
  }

  const saveBranding = async () => {
    const res = await updateBranding(brandForm)
    if (res.success) {
      setSaved('branding')
      setTimeout(() => setSaved(''), 3000)
    } else {
      alert(`✗ Branding save error: ${res.error}`)
    }
  }

  const SectionCard = ({ title, desc, icon: Icon, children, onSave, saveKey }) => (
    <div className="glass-card animate-fade-in" style={{ padding: 26, display:'flex', flexDirection:'column', gap:18 }}>
      <div style={{ display: 'flex', justifyContent:'space-between', alignItems: 'flex-start', borderBottom:'1px solid var(--color-border)', paddingBottom:12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContext: 'center', flexShrink:0 }}>
            <Icon size={16} color="var(--color-primary)" style={{ margin:'auto' }} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>{title}</h3>
            <p style={{ margin: '2px 0 0 0', fontSize:'0.76rem', color:'var(--color-text-muted)' }}>{desc}</p>
          </div>
        </div>
        
        {onSave && (
          <button className="btn btn-primary btn-sm" onClick={onSave} style={{ padding: '6px 12px', fontSize:'0.75rem' }}>
            <Save size={13} /> {saved === saveKey ? '✓ Saved!' : 'Save changes'}
          </button>
        )}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  )

  return (
    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Header and branding */}
      <div style={{ borderBottom:'1px solid var(--color-border)', paddingBottom: 16 }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em' }}>System Settings Suite</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
          Adjust dashboard custom branding, notifications, host connection protocols, and white-label details.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        {/* Left column settings cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Custom Branding & White-Labeling */}
          <SectionCard 
            title="Custom Branding (White-Labeling)" 
            desc="Personalize the application display names, custom logo images, and browser favicons."
            icon={Palette} 
            onSave={saveBranding} 
            saveKey="branding"
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label className="label">Branding Dashboard Name</label>
                  <input 
                    className="input" 
                    value={brandForm.appName} 
                    onChange={e => setBrandForm(v => ({ ...v, appName: e.target.value }))} 
                    placeholder="e.g. MyVPS Admin" 
                  />
                </div>
                <div>
                  <label className="label">Custom Logo Image URL</label>
                  <input 
                    className="input" 
                    value={brandForm.logoUrl} 
                    onChange={e => setBrandForm(v => ({ ...v, logoUrl: e.target.value }))} 
                    placeholder="https://example.com/logo.png" 
                  />
                </div>
                <div>
                  <label className="label">Custom Favicon URL (.ico / .png)</label>
                  <input 
                    className="input" 
                    value={brandForm.faviconUrl} 
                    onChange={e => setBrandForm(v => ({ ...v, faviconUrl: e.target.value }))} 
                    placeholder="https://example.com/favicon.ico" 
                  />
                </div>
              </div>

              {/* Real-time brand preview container */}
              <div style={{ border:'1px dashed var(--color-border)', borderRadius:12, padding:16, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, background:'rgba(255,255,255,0.01)' }}>
                <span style={{ fontSize:'0.72rem', textTransform:'uppercase', fontWeight:700, color:'var(--color-text-muted)', letterSpacing:'0.05em' }}>Real-time Preview</span>
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:10, background:'var(--color-surface-2)', border:'1px solid var(--color-border)', width:'80%' }}>
                  <div style={{ width:24, height:24, borderRadius:6, background:'linear-gradient(135deg, #3b82f6, #6366f1)', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', flexShrink:0 }}>
                    {brandForm.logoUrl ? <img src={brandForm.logoUrl} alt="Logo" style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : <Server size={12} color="white"/>}
                  </div>
                  <span style={{ fontWeight:700, fontSize:'0.82rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{brandForm.appName}</span>
                </div>
                <div style={{ fontSize:'0.7rem', color:'var(--color-text-muted)', display:'flex', alignItems:'center', gap:4 }}>
                  <CheckCircle size={10} color="var(--color-success)"/> Page Favicon active
                </div>
              </div>
            </div>
          </SectionCard>

          {/* VPS SSH protocol settings */}
          <SectionCard 
            title="VPS SSH Protocol Connection" 
            desc="Configure local loopback credentials or administrative VPS container credentials."
            icon={Server} 
            onSave={() => saveSection('vps', vps)} 
            saveKey="vps"
          >
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div><label className="label">VPS Host IPv4 / Hostname</label><input className="input" value={vps.host} onChange={e => setVps(v => ({ ...v, host: e.target.value }))} placeholder="127.0.0.1" /></div>
              <div><label className="label">SSH Terminal Port</label><input className="input" value={vps.port} onChange={e => setVps(v => ({ ...v, port: e.target.value }))} placeholder="22" /></div>
            </div>
            <div><label className="label">SSH User</label><input className="input" value={vps.user} onChange={e => setVps(v => ({ ...v, user: e.target.value }))} placeholder="root" /></div>
            <div>
              <label className="label">SSH Key Path</label>
              <div style={{ position: 'relative' }}>
                <input className="input" type={showKey ? 'text' : 'password'} value={vps.keyPath} onChange={e => setVps(v => ({ ...v, keyPath: e.target.value }))} placeholder="/root/.ssh/id_rsa" style={{ paddingRight: 44 }} />
                <button type="button" onClick={() => setShowKey(!showKey)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </SectionCard>

          {/* VPS Virtual Memory Swap Space */}
          <div className="glass-card animate-fade-in" style={{ padding: 26, display:'flex', flexDirection:'column', gap:18 }}>
            <div style={{ display: 'flex', justifyContent:'space-between', alignItems: 'flex-start', borderBottom:'1px solid var(--color-border)', paddingBottom:12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink:0 }}>
                  <Sliders size={16} color="var(--color-primary)" style={{ margin:'auto' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>VPS NVMe Virtual Memory Swap Space</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize:'0.76rem', color:'var(--color-text-muted)' }}>
                    Allocate secondary virtual RAM from high-speed NVMe to prevent memory exhaustion and OOM crashes.
                  </p>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Current Swap Status</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: swapInfo.active ? 'var(--color-success)' : 'var(--color-text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: swapInfo.active ? 'var(--color-success)' : 'var(--color-text-muted)' }}></span>
                  {swapInfo.active ? 'ACTIVE & ONLINE' : 'INACTIVE'}
                </div>
              </div>
              <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Total Swap Allocated</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--color-text)', marginTop: 4 }}>
                  {swapInfo.totalSwapBytes > 0 ? `${(swapInfo.totalSwapBytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : 'None'}
                </div>
              </div>
              <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Used Swap (NVMe Cache)</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--color-text)', marginTop: 4 }}>
                  {swapInfo.usedSwapBytes > 0 ? `${(swapInfo.usedSwapBytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : '0 GB'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="label">Configure Swap File Size (GB)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <input 
                    type="range" 
                    min="1" 
                    max="16" 
                    value={swapSizeInput} 
                    onChange={e => setSwapSizeInput(parseInt(e.target.value))} 
                    style={{ flex: 1, accentColor: 'var(--color-primary)' }}
                  />
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, fontFamily: 'var(--font-mono)', minWidth: 50, textAlign: 'right' }}>
                    {swapSizeInput} GB
                  </span>
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                  Recommended sizes: 2GB to 8GB depending on your SSD/NVMe drive size.
                </p>
              </div>

              {swapMsg && (
                <div style={{ 
                  fontSize: '0.8rem', 
                  color: swapMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-danger)', 
                  fontWeight: 600,
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 8,
                  border: '1px solid var(--color-border)'
                }}>
                  {swapMsg}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button 
                  className="btn btn-primary" 
                  onClick={configureSwap} 
                  disabled={swapActionBusy || swapLoading}
                  style={{ flex: 1, height: 38, fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  {swapActionBusy ? 'Configuring Swap...' : '⚡ Apply & Configure Swap'}
                </button>
                {swapInfo.active && (
                  <button 
                    className="btn btn-secondary" 
                    onClick={disableSwap} 
                    disabled={swapActionBusy || swapLoading}
                    style={{ height: 38, padding: '0 16px', fontSize: '0.8rem', color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }}
                  >
                    Disable Swap
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right column settings cards */}
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          
          {/* Standing Local Authentication Card */}
          <SectionCard 
            title="Standing Authorization" 
            desc="Decoupled local system access token settings."
            icon={Shield}
          >
            <div>
              <label className="label">Admin Account Email</label>
              <input className="input" value={user?.email || 'admin@serverdash.local'} disabled style={{ opacity: 0.6 }} />
            </div>
            <div>
              <label className="label">Assigned Security Role</label>
              <input className="input" value="Primary Super-Administrator" disabled style={{ opacity: 0.6 }} />
            </div>
            <div style={{ background:'rgba(16,185,129,0.04)', padding:'10px 12px', border:'1px solid rgba(16,185,129,0.15)', borderRadius:10, display:'flex', gap:8, alignItems:'center' }}>
              <CheckCircle size={16} color="var(--color-success)"/>
              <span style={{ fontSize:'0.75rem', color:'var(--color-text-dim)' }}>
                Your session is secured using local JWTs signed by your unique server secret.
              </span>
            </div>
          </SectionCard>

          {/* System resource notifications triggers */}
          <SectionCard 
            title="Daemon Resource Alerts" 
            desc="Automate threshold triggers to notify you when CPU or Memory runs hot."
            icon={Bell} 
            onSave={() => saveSection('notifications', notifications)} 
            saveKey="notifications"
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="label">CPU Heat Trigger (%)</label>
                <input className="input" type="number" min={1} max={100} value={notifications.cpuThreshold} onChange={e => setNotifications(n => ({ ...n, cpuThreshold: +e.target.value }))} />
              </div>
              <div>
                <label className="label">RAM Heat Trigger (%)</label>
                <input className="input" type="number" min={1} max={100} value={notifications.ramThreshold} onChange={e => setNotifications(n => ({ ...n, ramThreshold: +e.target.value }))} />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop:6 }}>
              <div
                onClick={() => setNotifications(n => ({ ...n, emailAlerts: !n.emailAlerts }))}
                style={{ width: 40, height: 22, borderRadius: 11, background: notifications.emailAlerts ? 'var(--color-primary)' : 'var(--color-surface-3)', border: `1px solid ${notifications.emailAlerts ? 'var(--color-primary)' : 'var(--color-border)'}`, position: 'relative', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}
              >
                <div style={{ position: 'absolute', top: 2, left: notifications.emailAlerts ? 20 : 2, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </div>
              <span style={{ fontSize: '0.85rem', fontWeight:600 }}>Enable Automated Email Alerts</span>
            </label>
            
            {notifications.emailAlerts && (
              <div className="animate-fade-in">
                <label className="label">Target Alerts Email Inbox</label>
                <input className="input" type="email" value={notifications.alertEmail} onChange={e => setNotifications(n => ({ ...n, alertEmail: e.target.value }))} placeholder="sysadmin@example.com" />
              </div>
            )}
          </SectionCard>

          {/* Connection backend url */}
          <SectionCard 
            title="Backend Server Protocol" 
            desc="Specify the host address of the node express service."
            icon={Globe} 
            onSave={() => saveSection('api', { url: apiUrl })} 
            saveKey="api"
          >
            <div>
              <label className="label">Node Express API URL</label>
              <input className="input" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://localhost:4001" />
            </div>
          </SectionCard>

          {/* ── GitHub Integration Card ────────────────────────────────────── */}
          <div className="glass-card animate-fade-in" style={{ padding: 26, display:'flex', flexDirection:'column', gap:18 }}>
            {/* Card Header */}
            <div style={{ display: 'flex', justifyContent:'space-between', alignItems: 'flex-start', borderBottom:'1px solid var(--color-border)', paddingBottom:12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: ghStatus.connected ? 'rgba(16,185,129,0.08)' : 'rgba(99,102,241,0.08)', border: `1px solid ${ghStatus.connected ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink:0 }}>
                  <GithubIcon size={16} color={ghStatus.connected ? 'var(--color-success)' : 'var(--color-primary)'} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>GitHub Account Integration</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize:'0.76rem', color:'var(--color-text-muted)' }}>Link your GitHub account for seamless private repo deployments.</p>
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={fetchGhStatus} disabled={ghLoading} style={{ padding: '6px 10px' }}>
                <RefreshCw size={12} style={{ animation: ghLoading ? 'spin 1s linear infinite' : 'none' }} />
              </button>
            </div>

            {/* Connected state */}
            {ghStatus.connected ? (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 14px', background:'rgba(16,185,129,0.04)', border:'1px solid rgba(16,185,129,0.15)', borderRadius:10 }}>
                  {ghStatus.avatarUrl && (
                    <img src={ghStatus.avatarUrl} alt="avatar" style={{ width:40, height:40, borderRadius:'50%', border:'2px solid rgba(16,185,129,0.3)', flexShrink:0 }} />
                  )}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:'0.9rem' }}>{ghStatus.name || ghStatus.login}</div>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)' }}>@{ghStatus.login}</div>
                    {ghStatus.connectedAt && (
                      <div style={{ fontSize:'0.7rem', color:'var(--color-text-muted)', marginTop:2 }}>
                        Linked {new Date(ghStatus.connectedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', background:'rgba(16,185,129,0.1)', borderRadius:20 }}>
                    <CheckCircle size={12} color="var(--color-success)" />
                    <span style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--color-success)' }}>Connected</span>
                  </div>
                </div>
                <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)', padding:'8px 12px', background:'rgba(255,255,255,0.02)', borderRadius:8, border:'1px solid var(--color-border)' }}>
                  ✓ Private GitHub repositories will now deploy automatically without needing a Personal Access Token.
                </div>
                <button className="btn btn-secondary" onClick={disconnectGithub} style={{ color:'var(--color-danger)', borderColor:'rgba(239,68,68,0.2)', display:'flex', alignItems:'center', gap:6, justifyContent:'center', fontSize:'0.8rem' }}>
                  <Unlink size={13} /> Disconnect GitHub Account
                </button>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {/* Device flow modal overlay */}
                {ghDeviceFlow && (
                  <div style={{ padding:18, background:'rgba(99,102,241,0.05)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:12, display:'flex', flexDirection:'column', gap:14 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ fontWeight:700, fontSize:'0.875rem' }}>🔑 Authorize on GitHub</div>
                      <button onClick={cancelGithubConnect} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--color-text-muted)', padding:4 }}><X size={14} /></button>
                    </div>
                    <div style={{ fontSize:'0.82rem', color:'var(--color-text-muted)', lineHeight:1.5 }}>
                      1. Copy the code below<br />
                      2. Click the button to open GitHub<br />
                      3. Paste the code and click <strong>Authorize</strong>
                    </div>
                    {/* User code display */}
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:'1.4rem', fontWeight:800, letterSpacing:'0.15em', padding:'10px 14px', background:'var(--color-surface-3)', border:'2px solid rgba(99,102,241,0.3)', borderRadius:10, textAlign:'center', color:'var(--color-primary)' }}>
                        {ghDeviceFlow.user_code}
                      </div>
                      <button className="btn btn-secondary btn-sm" onClick={copyCode} style={{ flexShrink:0, height:44 }}>
                        {ghCopied ? <CheckCircle size={14} color="var(--color-success)" /> : <Copy size={14} />}
                      </button>
                    </div>
                    {/* Open GitHub button */}
                    <a href={ghDeviceFlow.verification_uri} target="_blank" rel="noopener noreferrer"
                      style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 16px', background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color:'var(--color-primary)', fontWeight:700, fontSize:'0.85rem', textDecoration:'none', transition:'all 0.15s' }}>
                      <ExternalLink size={14} /> Open GitHub Device Auth
                    </a>
                    {/* Polling status */}
                    {ghPollStatus && (
                      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:'0.8rem', color: ghPollStatus === 'error' ? 'var(--color-danger)' : ghPollStatus === 'success' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                        {ghPollStatus === 'polling' && <div style={{ width:12, height:12, border:'2px solid rgba(99,102,241,0.3)', borderTop:'2px solid var(--color-primary)', borderRadius:'50%', animation:'spin 1s linear infinite', flexShrink:0 }} />}
                        {ghPollStatus === 'success' && <CheckCircle size={12} color="var(--color-success)" />}
                        {ghPollMsg}
                      </div>
                    )}
                  </div>
                )}

                {!ghDeviceFlow && (
                  <>
                    {!ghStatus.clientIdConfigured && (
                      <div style={{ padding:'10px 12px', background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:'0.78rem', color:'var(--color-warning)' }}>
                        ⚠ <strong>GITHUB_CLIENT_ID</strong> not set in <code>.env</code>. Create a GitHub OAuth App and add the Client ID to enable this feature.
                      </div>
                    )}
                    <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)', lineHeight:1.6 }}>
                      Connect your GitHub account to enable private repo deployments without entering a Personal Access Token each time.
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={startGithubConnect}
                      disabled={ghConnecting || !ghStatus.clientIdConfigured}
                      style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'center' }}
                    >
                      <GithubIcon size={15} />
                      {ghConnecting ? 'Starting…' : 'Connect GitHub Account'}
                    </button>
                    {ghPollStatus === 'error' && (
                      <div style={{ fontSize:'0.78rem', color:'var(--color-danger)' }}>✗ {ghPollMsg}</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
