import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { localAuth } from '../lib/auth'
import { Dialog } from '../components/Dialog'
import { 
  Globe, ArrowLeft, ShieldCheck, ShieldAlert, FolderOpen, 
  Terminal, FileCode, RotateCcw, Save, Trash2, ExternalLink, 
  AlertTriangle, Wrench, Shield, Check, X, RefreshCw, Eye, EyeOff,
  GitBranch, GitCommit, GitPullRequest, Code, Settings, Plus, Key, Copy, HelpCircle,
  Cpu, HardDrive, Lock, Database, Mail, Send, Play, Boxes, Upload
} from 'lucide-react'
import FilesPage from './FilesPage'

export default function SiteDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  // Tabs: 'overview' | 'deployments' | 'build' | 'env' | 'git' | 'nginx'
  const [activeTab, setActiveTab] = useState('overview')
  
  const [site, setSite] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Git Data State
  const [gitData, setGitData] = useState(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState(null)

  // Build Settings State
  const [buildSettings, setBuildSettings] = useState({
    installCommand: 'npm install --production',
    buildCommand: 'npm run build',
    restartCommand: '',
    nodeVersion: 'system'
  })
  const [buildLoading, setBuildLoading] = useState(false)
  const [buildSaving, setBuildSaving] = useState(false)
  const [buildSaved, setBuildSaved] = useState(false)

  // Env Variables State
  const [envContent, setEnvContent] = useState('')
  const [envLoading, setEnvLoading] = useState(false)
  const [envSaving, setEnvSaving] = useState(false)
  const [envSaved, setEnvSaved] = useState(false)
  const [envMode, setEnvMode] = useState('list') // 'list' | 'raw'
  const [envPairs, setEnvPairs] = useState([])
  const [newEnvKey, setNewEnvKey] = useState('')
  const [newEnvVal, setNewEnvVal] = useState('')
  const [maskedKeys, setMaskedKeys] = useState({})

  // Domain Mail/SMTP States
  const [mailSettings, setMailSettings] = useState({ smtp: { host: '', port: '587', username: '', password: '', encryption: 'TLS' }, mailboxes: [], forwarders: [], domain: '' })
  const [mailLoading, setMailLoading] = useState(false)
  const [mailError, setMailError] = useState(null)
  const [mailSuccess, setMailSuccess] = useState(null)
  const [mailBusy, setMailBusy] = useState(false)
  const [mailboxForm, setMailboxForm] = useState({ username: '', password: '' })
  const [forwarderForm, setForwarderForm] = useState({ source: '', target: '' })
  const [smtpSaved, setSmtpSaved] = useState(false)
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [testRecipient, setTestRecipient] = useState('')
  const [testBusy, setTestBusy] = useState(false)

  // Nginx Config Editor state
  const [configContent, setConfigContent] = useState('')
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState(null)
  const [configSaved, setConfigSaved] = useState(false)

  // Actions & Logs state
  const [actionLogs, setActionLogs] = useState([])
  const [showLogs, setShowLogs] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  // Isolated Terminal & Scripts state
  const [terminalCmd, setTerminalCmd] = useState('')
  const [siteTermLogs, setSiteTermLogs] = useState([])
  const [siteTermRunning, setSiteTermRunning] = useState(false)
  const siteTermRef = useRef()
  const [siteScripts, setSiteScripts] = useState([])
  const [scriptsLoading, setScriptsLoading] = useState(false)

  // Delete modal state
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteWithFiles, setDeleteWithFiles] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Database password reset states
  const [showDbPassword, setShowDbPassword] = useState(false)
  const [showWpPassword, setShowWpPassword] = useState(false)
  const [resettingDb, setResettingDb] = useState(false)

  const [dialog, setDialog] = useState(null)

  // WordPress installation states
  const [wpTitle, setWpTitle] = useState('')
  const [wpAdminUser, setWpAdminUser] = useState('admin')
  const [wpAdminPass, setWpAdminPass] = useState('')
  const [wpAdminEmail, setWpAdminEmail] = useState('')
  const [wpInstalling, setWpInstalling] = useState(false)

  // ZIP upload state
  const [zipUploadFile, setZipUploadFile] = useState(null)
  const [zipUploading, setZipUploading] = useState(false)
  const zipInputRef = useRef()

  useEffect(() => {
    if (site) {
      setWpTitle(site.domain || 'WordPress Site')
      setWpAdminEmail(`admin@${site.domain || 'example.com'}`)
    }
  }, [site])

  const handleInstallWordPress = async (e) => {
    e.preventDefault()
    setActionLogs([`▶ Initializing WordPress installation for ${site.domain}...`])
    setShowLogs(true)
    setActionBusy(true)
    setWpInstalling(true)
    setActiveTab('deployments')

    const token = localAuth.getToken() || ''
    try {
      const resp = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4001'}/api/sites/${id}/install-wordpress`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          wpTitle,
          wpAdminUser,
          wpAdminPass,
          wpAdminEmail,
        })
      })

      if (!resp.ok) {
        throw new Error(`Server returned status code ${resp.status}`)
      }

      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop()
        parts.forEach(l => {
          if (l.startsWith('data: ')) {
            setActionLogs(prev => [...prev, l.slice(6)])
          } else if (l.trim()) {
            setActionLogs(prev => [...prev, l])
          }
        })
      }
      loadSite()
    } catch (err) {
      setActionLogs(prev => [...prev, `✗ WordPress Installation Failed: ${err.message}`])
    } finally {
      setActionBusy(false)
      setWpInstalling(false)
    }
  }

  const handleUploadZip = async (file) => {
    if (!file) return
    setZipUploading(true)
    const formData = new FormData()
    formData.append('zip', file)

    try {
      await api.post(`/api/sites/${id}/upload-zip`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      showSuccess('ZIP Uploaded', `✓ ZIP file '${file.name}' has been successfully uploaded and extracted into your site root!`)
      setZipUploadFile(null)
      loadSite()
    } catch (err) {
      showError('Upload Error', err.response?.data?.error || err.message)
    } finally {
      setZipUploading(false)
    }
  }

  const showSuccess = (title, message) => {
    setDialog({ title, message, type: 'success', onConfirm: () => setDialog(null) })
  }
  const showError = (title, message) => {
    setDialog({ title, message, type: 'warning', onConfirm: () => setDialog(null) })
  }

  const termRef = useRef()

  const resetDbPassword = async () => {
    setDialog({
      title: 'Reset Database Password?',
      message: 'Are you absolutely sure you want to reset the database password? This will alter the MySQL user credentials and overwrite the password in the website configurations.',
      type: 'confirm',
      onConfirm: async () => {
        setDialog(null)
        setResettingDb(true)
        try {
          const res = await api.post(`/api/sites/${id}/db-reset-password`)
          if (res.data && res.data.success) {
            showSuccess('Password Reset Success', `✓ Database password reset successfully!\n\nNew password: ${res.data.newPassword}`)
            // Reload site details
            const r = await api.get(`/api/sites/${id}`)
            setSite(r.data)
          }
        } catch (e) {
          showError('Failed to Reset Password', e.response?.data?.error || e.message)
        } finally {
          setResettingDb(false)
        }
      },
      onCancel: () => setDialog(null)
    })
  }

  const loadSite = async () => {
    try {
      const r = await api.get(`/api/sites/${id}`)
      setSite(r.data)
      setError(null)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadConfig = async () => {
    setConfigLoading(true)
    setConfigError(null)
    try {
      const r = await api.get(`/api/sites/${id}/config`)
      setConfigContent(r.data.content)
    } catch (e) {
      setConfigError(e.response?.data?.error || e.message)
    } finally {
      setConfigLoading(false)
    }
  }

  const loadEnv = async () => {
    setEnvLoading(true)
    try {
      const r = await api.get(`/api/sites/${id}/env`)
      setEnvContent(r.data.env)
      parseEnvToPairs(r.data.env)
    } catch (e) {
      console.error(e)
    } finally {
      setEnvLoading(false)
    }
  }

  const parseEnvToPairs = (content) => {
    if (!content) {
      setEnvPairs([])
      return
    }
    const lines = content.split('\n')
    const pairs = []
    const initialMask = {}
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        const value = trimmed.slice(eqIdx + 1).trim()
        pairs.push({ id: index, key, value })
        initialMask[key] = true
      }
    })
    setEnvPairs(pairs)
    setMaskedKeys(initialMask)
  }

  const serializePairsToEnv = (pairsList) => {
    return pairsList.map(p => `${p.key}=${p.value}`).join('\n')
  }

  const saveEnv = async (contentToSave) => {
    setEnvSaving(true)
    setEnvSaved(false)
    try {
      await api.post(`/api/sites/${id}/env`, { envContent: contentToSave })
      setEnvContent(contentToSave)
      setEnvSaved(true)
      setTimeout(() => setEnvSaved(false), 3000)
    } catch (e) {
      showError('Save Error', 'Failed to save .env file: ' + (e.response?.data?.error || e.message))
    } finally {
      setEnvSaving(false)
    }
  }

  const handleAddEnvPair = () => {
    if (!newEnvKey.trim() || !newEnvVal.trim()) return
    const key = newEnvKey.trim().toUpperCase()
    const value = newEnvVal.trim()
    
    // Check if key already exists
    if (envPairs.some(p => p.key === key)) {
      showError('Variable Exists', `Variable ${key} already exists. Please edit it or remove it first.`)
      return
    }

    const updatedPairs = [...envPairs, { id: Date.now(), key, value }]
    setEnvPairs(updatedPairs)
    setNewEnvKey('')
    setNewEnvVal('')
    setMaskedKeys(prev => ({ ...prev, [key]: true }))
    
    const newRaw = serializePairsToEnv(updatedPairs)
    saveEnv(newRaw)
  }

  const handleRemoveEnvPair = (key) => {
    const updatedPairs = envPairs.filter(p => p.key !== key)
    setEnvPairs(updatedPairs)
    const newRaw = serializePairsToEnv(updatedPairs)
    saveEnv(newRaw)
  }

  const toggleMask = (key) => {
    setMaskedKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const loadBuildSettings = async () => {
    setBuildLoading(true)
    try {
      const r = await api.get(`/api/sites/${id}/build-settings`)
      setBuildSettings(r.data)
    } catch (e) {
      console.error(e)
    } finally {
      setBuildLoading(false)
    }
  }

  const saveBuildSettings = async () => {
    setBuildSaving(true)
    setBuildSaved(false)
    try {
      await api.post(`/api/sites/${id}/build-settings`, buildSettings)
      setBuildSaved(true)
      setTimeout(() => setBuildSaved(false), 3000)
    } catch (e) {
      showError('Save Error', 'Failed to save build settings: ' + (e.response?.data?.error || e.message))
    } finally {
      setBuildSaving(false)
    }
  }

  const loadGit = async () => {
    setGitLoading(true)
    setGitError(null)
    try {
      const r = await api.get(`/api/sites/${id}/git`)
      setGitData(r.data)
    } catch (e) {
      setGitError(e.response?.data?.error || e.message)
    } finally {
      setGitLoading(false)
    }
  }

  const loadMail = async () => {
    setMailLoading(true)
    setMailError(null)
    try {
      const { data } = await api.get(`/api/sites/${id}/mail`)
      setMailSettings(data)
    } catch (e) {
      setMailError(e.response?.data?.error || e.message)
    } finally {
      setMailLoading(false)
    }
  }

  const saveMailSmtp = async (e) => {
    e.preventDefault()
    setSmtpSaving(true)
    setMailError(null)
    setMailSuccess(null)
    try {
      const { data } = await api.post(`/api/sites/${id}/mail/smtp`, mailSettings.smtp)
      setMailSuccess(data.message)
      setSmtpSaved(true)
      setTimeout(() => setSmtpSaved(false), 3000)
    } catch (e) {
      setMailError(e.response?.data?.error || e.message)
    } finally {
      setSmtpSaving(false)
    }
  }

  const createMailbox = async (e) => {
    e.preventDefault()
    if (!mailboxForm.username || !mailboxForm.password) return
    setMailBusy(true)
    setMailError(null)
    setMailSuccess(null)
    try {
      const { data } = await api.post(`/api/sites/${id}/mail/mailbox`, mailboxForm)
      setMailSuccess(data.message)
      setMailboxForm({ username: '', password: '' })
      await loadMail()
    } catch (e) {
      setMailError(e.response?.data?.error || e.message)
    } finally {
      setMailBusy(false)
    }
  }

  const deleteMailbox = async (username) => {
    setDialog({
      title: 'Delete Mailbox?',
      message: `Are you sure you want to permanently delete mailbox '${username}'? This will delete all emails contained within it.`,
      type: 'confirm',
      onConfirm: async () => {
        setDialog(null)
        setMailBusy(true)
        setMailError(null)
        setMailSuccess(null)
        try {
          const { data } = await api.delete(`/api/sites/${id}/mail/mailbox/${username}`)
          setMailSuccess(data.message)
          await loadMail()
        } catch (e) {
          setMailError(e.response?.data?.error || e.message)
        } finally {
          setMailBusy(false)
        }
      },
      onCancel: () => setDialog(null)
    })
  }

  const createForwarder = async (e) => {
    e.preventDefault()
    if (!forwarderForm.source || !forwarderForm.target) return
    setMailBusy(true)
    setMailError(null)
    setMailSuccess(null)
    try {
      const { data } = await api.post(`/api/sites/${id}/mail/forwarder`, forwarderForm)
      setMailSuccess(data.message)
      setForwarderForm({ source: '', target: '' })
      await loadMail()
    } catch (e) {
      setMailError(e.response?.data?.error || e.message)
    } finally {
      setMailBusy(false)
    }
  }

  const deleteForwarder = async (source) => {
    setDialog({
      title: 'Delete Forwarder?',
      message: `Are you sure you want to permanently delete the email forwarder for '${source}'?`,
      type: 'confirm',
      onConfirm: async () => {
        setDialog(null)
        setMailBusy(true)
        setMailError(null)
        setMailSuccess(null)
        try {
          const { data } = await api.delete(`/api/sites/${id}/mail/forwarder/${source}`)
          setMailSuccess(data.message)
          await loadMail()
        } catch (e) {
          setMailError(e.response?.data?.error || e.message)
        } finally {
          setMailBusy(false)
        }
      },
      onCancel: () => setDialog(null)
    })
  }

  const testDomainMail = async () => {
    if (!testRecipient) return
    setTestBusy(true)
    setMailError(null)
    setMailSuccess(null)
    try {
      const { data } = await api.post(`/api/sites/${id}/mail/test`, { to: testRecipient })
      setMailSuccess(data.message)
    } catch (e) {
      setMailError(e.response?.data?.error || e.message)
    } finally {
      setTestBusy(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    loadSite()
    loadConfig()
    loadEnv()
    loadBuildSettings()
    loadGit()
    loadMail()
    loadScripts()
  }, [id])

  const loadScripts = async () => {
    setScriptsLoading(true)
    try {
      const r = await api.get(`/api/sites/${id}/scripts`)
      setSiteScripts(r.data.scripts || [])
    } catch (e) {} finally {
      setScriptsLoading(false)
    }
  }

  const runSiteCommand = async (cmd) => {
    const commandToRun = cmd || terminalCmd
    if (!commandToRun) return
    
    setSiteTermRunning(true)
    if (!cmd) setTerminalCmd('')
    setSiteTermLogs(prev => [...prev, `$ ${commandToRun}`])
    
    try {
      const resp = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4001'}/api/sites/${id}/exec-stream?command=${encodeURIComponent(commandToRun)}`, {
        headers: { Authorization: `Bearer ${localAuth.getToken() || ''}` }
      })
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop()
        parts.forEach(l => {
          if (l.startsWith('data: ')) setSiteTermLogs(prev => [...prev, l.slice(6)])
          else if (l.trim()) setSiteTermLogs(prev => [...prev, l])
        })
      }
    } catch (e) {
      setSiteTermLogs(prev => [...prev, `Error: ${e.message}`])
    } finally {
      setSiteTermRunning(false)
    }
  }

  useEffect(() => {
    if (siteTermRef.current) {
      siteTermRef.current.scrollTo({ top: siteTermRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [siteTermLogs])

  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTo({ top: termRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [actionLogs])

  const saveConfig = async () => {
    setConfigSaving(true)
    setConfigError(null)
    setConfigSaved(false)
    try {
      await api.post(`/api/sites/${id}/config`, { content: configContent })
      setConfigSaved(true)
      setTimeout(() => setConfigSaved(false), 3000)
      loadSite()
    } catch (e) {
      setConfigError(e.response?.data?.error || e.message)
    } finally {
      setConfigSaving(false)
    }
  }

  const runDeploy = async (commitHash) => {
    const actualHash = typeof commitHash === 'string' ? commitHash : null
    setActionLogs([actualHash ? `▶ Triggering rollback to commit ${actualHash}...` : '▶ Triggering website deployment...'])
    setShowLogs(true)
    setActionBusy(true)
    setActiveTab('deployments')
    const token = localAuth.getToken() || ''
    
    try {
      const resp = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4001'}/api/sites/${id}/deploy`, { 
        method: 'POST', 
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ commitHash: actualHash })
      })
      
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop()
        parts.forEach(l => {
          if (l.startsWith('data: ')) {
            setActionLogs(prev => [...prev, l.slice(6)])
          } else if (l.trim()) {
            setActionLogs(prev => [...prev, l])
          }
        })
      }
      loadSite()
      loadGit()
    } catch (e) {
      setActionLogs(prev => [...prev, `✗ Deployment Failed: ${e.message}`])
    } finally {
      setActionBusy(false)
    }
  }

  const runSSL = async () => {
    setActionLogs(['▶ Requesting SSL certificate from Let\'s Encrypt (certbot)...'])
    setShowLogs(true)
    setActionBusy(true)
    setActiveTab('deployments')
    try {
      const r = await api.post(`/api/sites/${id}/ssl`)
      const lines = r.data.output ? r.data.output.split('\n') : ['✓ SSL Certificate configured successfully!']
      setActionLogs(prev => [...prev, ...lines])
      loadSite()
    } catch (e) {
      const err = e.response?.data?.error || e.message
      setActionLogs(prev => [...prev, `✗ SSL Request Failed: ${err}`])
    } finally {
      setActionBusy(false)
    }
  }

  const performDelete = async () => {
    setDeleting(true)
    try {
      await api.delete(`/api/sites/${id}?deleteFiles=${deleteWithFiles}`)
      navigate('/websites')
    } catch (e) {
      alert(e.response?.data?.error || e.message)
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:20, padding:20 }}>
        <div className="skeleton" style={{ height: 60, width: '40%' }} />
        <div className="skeleton" style={{ height: 180 }} />
        <div className="skeleton" style={{ height: 350 }} />
      </div>
    )
  }

  if (error || !site) {
    return (
      <div className="glass-card animate-fade-in" style={{ padding:32, textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
        <AlertTriangle size={48} color="var(--color-danger)" />
        <div>
          <h3 style={{ margin:0, fontSize:'1.25rem' }}>Failed to Load Site</h3>
          <p style={{ color:'var(--color-text-muted)', marginTop:8 }}>{error || 'Website not found'}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/websites')}><ArrowLeft size={14}/> Back to Websites</button>
      </div>
    )
  }

  const TYPE_LABELS = { static: 'Static / SPA', node: 'Node.js App', php: 'PHP / WordPress', proxy: 'Reverse Proxy' }
  const TYPE_COLORS = { static: '#3b82f6', node: '#10b981', php: '#f59e0b', proxy: '#8b5cf6' }

  return (
    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:20 }}>
      
      {/* Vercel Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', paddingBottom: 16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <button className="btn btn-secondary btn-icon" onClick={() => navigate('/websites')} title="Back" style={{ borderRadius:'50%', width:40, height:40 }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <h2 style={{ fontSize:'1.75rem', fontWeight:800, margin:0, letterSpacing: '-0.03em' }}>{site.domain}</h2>
              <span style={{ 
                fontSize:'0.75rem', padding:'3px 10px', borderRadius:20, fontWeight:700, 
                background:`${TYPE_COLORS[site.type] || '#6b7280'}1a`, color: TYPE_COLORS[site.type] || '#6b7280',
                border:`1px solid ${TYPE_COLORS[site.type] || '#6b7280'}33`
              }}>
                {TYPE_LABELS[site.type] || site.type}
              </span>
              {site.ssl ? (
                <span className="badge badge-green" style={{ fontSize:'0.7rem' }}><ShieldCheck size={12}/> Secure Let's Encrypt SSL</span>
              ) : (
                <span className="badge badge-red" style={{ fontSize:'0.7rem' }}><ShieldAlert size={12}/> Unsecured HTTP</span>
              )}
            </div>
            <p style={{ color:'var(--color-text-muted)', fontSize:'0.85rem', margin:'6px 0 0 0', display:'flex', alignItems:'center', gap:6 }}>
              Status: <span style={{ 
                color: (site.status === 'active' || site.status === 'Running') ? 'var(--color-success)' : 'var(--color-warning)', 
                fontWeight:700, display:'flex', alignItems:'center', gap:4 
              }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:'currentColor', display:'inline-block' }} className={(site.status === 'active' || site.status === 'Running') ? "animate-pulse-dot" : ""}/> 
                {site.status === 'no-nginx' ? 'Inactive (No Nginx Config)' : (site.status || 'Active')}
              </span>
              {gitData?.hasGit && (
                <>
                  <span style={{ color:'rgba(255,255,255,0.15)' }}>|</span>
                  <span style={{ display:'flex', alignItems:'center', gap:4 }}><GitBranch size={13}/> {gitData.branch}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <a href={site.isSystemPanel ? '/' : `${site.ssl ? 'https' : 'http'}://${site.domain}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
            <ExternalLink size={15}/> Visit Live Website
          </a>
          {site.isSystemPanel ? (
            <button className="btn btn-danger" disabled style={{ opacity: 0.5, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }} title="System Protected: ServerDash panel protects this host's configuration.">
              <Lock size={15}/> System Protected
            </button>
          ) : (
            <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15}/> Remove Site
            </button>
          )}
        </div>
      </div>

      {/* Modern Vercel-like top navigation tabs */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          Overview
        </button>
        <button className={`tab ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
          Files
        </button>
        <button className={`tab ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
          Terminal
        </button>
        {!site.isSystemPanel && (
          <>
            <button className={`tab ${activeTab === 'deployments' ? 'active' : ''}`} onClick={() => setActiveTab('deployments')}>
              Deployments {actionBusy && <span style={{ display:'inline-block', width:8, height:8, background:'var(--color-primary)', borderRadius:'50%' }} className="animate-pulse-dot"/>}
            </button>
            <button className={`tab ${activeTab === 'build' ? 'active' : ''}`} onClick={() => setActiveTab('build')}>
              Build & Start Settings
            </button>
            <button className={`tab ${activeTab === 'env' ? 'active' : ''}`} onClick={() => setActiveTab('env')}>
              Environment Variables
            </button>
            <button className={`tab ${activeTab === 'git' ? 'active' : ''}`} onClick={() => setActiveTab('git')}>
              Git Integration
            </button>
          </>
        )}
        <button className={`tab ${activeTab === 'nginx' ? 'active' : ''}`} onClick={() => setActiveTab('nginx')}>
          Nginx Config
        </button>
        {!site.isSystemPanel && (
          <button className={`tab ${activeTab === 'mail' ? 'active' : ''}`} onClick={() => setActiveTab('mail')}>
            Mail & SMTP Settings
          </button>
        )}
      </div>

      {/* Dynamic Tab Body */}
      <div className="animate-fade-in" style={{ minHeight: 400 }}>
        
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:20 }}>
            {/* Specs & Configuration card */}
            <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
              <div className="glass-card" style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
                <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800, borderBottom:'1px solid var(--color-border)', paddingBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                  <Wrench size={18} color="var(--color-primary)"/> App Core Specifications
                </h3>
                
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
                  <div>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>Deployment Path</div>
                    <div style={{ fontSize:'0.85rem', marginTop:6, display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontFamily:'var(--font-mono)', wordBreak:'break-all' }}>{site.root || '—'}</span>
                      {site.root && (
                        <button className="btn btn-secondary btn-sm" style={{ padding:'2px 6px', fontSize:'0.7rem' }} onClick={() => navigate('/files', { state: { path: site.root, backToSite: { id, domain: site.domain } } })}>
                          <FolderOpen size={11}/> Browse files
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>Traffic Routing (Reverse Proxy)</div>
                    <div style={{ fontSize:'0.85rem', marginTop:6 }}>
                      {site.proxyPort ? (
                        <span className="badge badge-blue">Local Port Gateway: {site.proxyPort}</span>
                      ) : (
                        <span className="badge badge-gray">Direct Public File Serving</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>SSL Let's Encrypt</div>
                    <div style={{ fontSize:'0.85rem', marginTop:6, display:'flex', alignItems:'center', gap:8 }}>
                      {site.ssl ? (
                        <span style={{ color:'var(--color-success)', fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>✓ Configured & Encrypted</span>
                      ) : (
                        <span style={{ color:'var(--color-danger)', fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>✗ Not encrypted</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>Vhost Configuration File</div>
                    <div style={{ fontSize:'0.85rem', marginTop:6, fontFamily:'var(--font-mono)', color:'var(--color-text-muted)', wordBreak:'break-all' }}>
                      {site.configFile || 'Built-in / Custom Nginx config'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Connected Git Commit preview if exists */}
              {gitData?.hasGit && (
                <div className="glass-card" style={{ padding:24, display:'flex', flexDirection:'column', gap:14 }}>
                  <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800, borderBottom:'1px solid var(--color-border)', paddingBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                    <GitPullRequest size={18} color="var(--color-success)"/> Production Branch Linkage
                  </h3>
                  
                  <div style={{ display:'flex', gap:16, alignItems:'center', background:'rgba(255,255,255,0.02)', padding:16, borderRadius:12, border:'1px solid var(--color-border)' }}>
                    <div style={{ background:'rgba(16, 185, 129, 0.1)', color:'var(--color-success)', padding:12, borderRadius:8 }}>
                      <GitBranch size={22}/>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:'0.9rem', color:'var(--color-text)' }}>
                        Connected repository branch: <code style={{ color:'var(--color-success)', background:'rgba(16, 185, 129, 0.08)', padding:'2px 6px', borderRadius:4 }}>{gitData.branch}</code>
                      </div>
                      <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)', marginTop:4, wordBreak:'break-all' }}>
                        URL: <a href={gitData.repoUrl} target="_blank" rel="noopener noreferrer" style={{ color:'var(--color-primary)', textDecoration:'none' }}>{gitData.repoUrl}</a>
                      </div>
                    </div>
                  </div>

                  {gitData.lastCommit && (
                    <div style={{ padding:'0 8px' }}>
                      <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:8 }}>
                        Latest Deployment Commit
                      </div>
                      <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                        <GitCommit size={14} style={{ marginTop:3, color:'var(--color-text-muted)' }}/>
                        <div>
                          <div style={{ fontSize:'0.85rem', fontWeight:600, color:'var(--color-text)' }}>{gitData.lastCommit.subject}</div>
                          <div style={{ fontSize:'0.78rem', color:'var(--color-text-muted)', marginTop:4 }}>
                            by <strong>{gitData.lastCommit.author}</strong> ({gitData.lastCommit.date}) — Commit Hash: <code style={{ color:'var(--color-primary)' }}>{gitData.lastCommit.hash}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {gitData.behindCount > 0 && (
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:12, borderRadius:8, background:'rgba(245, 158, 11, 0.06)', border:'1px solid rgba(245, 158, 11, 0.15)', marginTop:4 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:'0.8rem', color:'var(--color-warning)' }}>
                        <AlertTriangle size={15}/>
                        <span>Your server is <strong>{gitData.behindCount}</strong> commits behind origin.</span>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={runDeploy} disabled={actionBusy}>
                        <RotateCcw size={12}/> Pull & Auto-Deploy
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* WordPress Admin Credentials Panel */}
              {site?.database?.wpUser && site?.database?.wpPass && (
                <div className="glass-card animate-fade-in" style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
                  <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800, borderBottom:'1px solid var(--color-border)', paddingBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                    <Lock size={18} color="var(--color-primary)"/> WordPress Admin Access Credentials
                  </h3>
                  
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
                    <div style={{ gridColumn:'span 2' }}>
                      <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>WP-Admin Login URL</div>
                      <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:6 }}>
                        <a 
                          href={site.isSystemPanel ? '/' : `${site.ssl ? 'https' : 'http'}://${site.domain}/wp-admin`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ fontSize:'0.9rem', fontFamily:'var(--font-mono)', fontWeight:600, color:'var(--color-primary)', display:'flex', alignItems:'center', gap:6 }}
                        >
                          {site.ssl ? 'https' : 'http'}://{site.domain}/wp-admin <ExternalLink size={14}/>
                        </a>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>Admin Username</div>
                      <div style={{ fontSize:'0.9rem', marginTop:6, fontFamily:'var(--font-mono)', fontWeight:600 }}>{site.database.wpUser}</div>
                    </div>
                    
                    <div>
                      <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Admin Password</div>
                      <div style={{ display:'flex', gap:10 }}>
                        <input 
                          type={showWpPassword ? "text" : "password"} 
                          value={site.database.wpPass} 
                          disabled 
                          style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:'0.85rem', background:'rgba(255,255,255,0.01)', border:'1px solid var(--color-border)', borderRadius:8, padding:'8px 12px', color:'var(--color-text)' }} 
                        />
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowWpPassword(!showWpPassword)} title={showWpPassword ? "Hide password" : "Show password"} style={{ padding:'0 12px' }}>
                          {showWpPassword ? <EyeOff size={15}/> : <Eye size={15}/>}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Database Credentials Panel */}
              {site?.database && (
                <div className="glass-card animate-fade-in" style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
                  <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800, borderBottom:'1px solid var(--color-border)', paddingBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                    <Database size={18} color="var(--color-primary)"/> WordPress & PHP MySQL Database
                  </h3>
                  
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
                    <div>
                      <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>MySQL Database Name</div>
                      <div style={{ fontSize:'0.9rem', marginTop:6, fontFamily:'var(--font-mono)', fontWeight:600 }}>{site.database.dbName}</div>
                    </div>
                    
                    <div>
                      <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>MySQL Database User</div>
                      <div style={{ fontSize:'0.9rem', marginTop:6, fontFamily:'var(--font-mono)', fontWeight:600 }}>{site.database.dbUser}</div>
                    </div>
                    
                    <div style={{ gridColumn:'span 2' }}>
                      <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>MySQL Access Password</div>
                      <div style={{ display:'flex', gap:10 }}>
                        <input 
                          type={showDbPassword ? "text" : "password"} 
                          value={site.database.dbPass} 
                          disabled 
                          style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:'0.85rem', background:'rgba(255,255,255,0.01)', border:'1px solid var(--color-border)', borderRadius:8, padding:'8px 12px', color:'var(--color-text)' }} 
                        />
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowDbPassword(!showDbPassword)} title={showDbPassword ? "Hide password" : "Show password"} style={{ padding:'0 12px' }}>
                          {showDbPassword ? <EyeOff size={15}/> : <Eye size={15}/>}
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={resetDbPassword} disabled={resettingDb} style={{ gap:6 }}>
                          {resettingDb ? <RefreshCw size={13} className="animate-spin"/> : <Key size={13}/>}
                          {resettingDb ? 'Resetting Access...' : 'Reset Access Password'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* WordPress Installer Panel */}
              {site.type === 'php' && !site.database && (
                <div className="glass-card animate-fade-in" style={{ padding:24, display:'flex', flexDirection:'column', gap:18 }}>
                  <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800, borderBottom:'1px solid var(--color-border)', paddingBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                    <Boxes size={18} color="var(--color-primary)"/> One-Click WordPress Bootstrapper
                  </h3>
                  <p style={{ margin:0, fontSize:'0.82rem', color:'var(--color-text-muted)', lineHeight:1.5 }}>
                    Your directory does not contain WordPress configuration files. You can deploy a fully pre-configured, lightning-fast WordPress core installation instantly!
                  </p>
                  
                  <form onSubmit={handleInstallWordPress} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:8 }}>
                    <div>
                      <label className="label">Site Title</label>
                      <input className="input" value={wpTitle} onChange={e=>setWpTitle(e.target.value)} required style={{ color: 'var(--color-text)' }} />
                    </div>
                    <div>
                      <label className="label">Admin Email</label>
                      <input className="input" type="email" value={wpAdminEmail} onChange={e=>setWpAdminEmail(e.target.value)} required style={{ color: 'var(--color-text)' }} />
                    </div>
                    <div>
                      <label className="label">Admin Username</label>
                      <input className="input" value={wpAdminUser} onChange={e=>setWpAdminUser(e.target.value)} required style={{ color: 'var(--color-text)' }} />
                    </div>
                    <div>
                      <label className="label">Admin Password</label>
                      <input className="input" type="password" value={wpAdminPass} onChange={e=>setWpAdminPass(e.target.value)} placeholder="Leave blank to generate randomly" style={{ border:'1px solid var(--color-border)', color: 'var(--color-text)' }} />
                    </div>
                    <div style={{ gridColumn:'span 2', marginTop:8 }}>
                      <button type="submit" className="btn btn-primary" disabled={wpInstalling || actionBusy} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                        {wpInstalling ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} />}
                        {wpInstalling ? 'Installing WordPress Core (Downloading & Configuring DB)...' : 'Install WordPress Core Now'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* ZIP File Codebase Uploader Panel */}
              {site.type !== 'proxy' && !site.isSystemPanel && (
                <div className="glass-card animate-fade-in" style={{ padding:24, display:'flex', flexDirection:'column', gap:14 }}>
                  <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800, borderBottom:'1px solid var(--color-border)', paddingBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                    <Upload size={18} color="var(--color-success)"/> Upload Site Codebase (ZIP Archive)
                  </h3>
                  <p style={{ margin:0, fontSize:'0.82rem', color:'var(--color-text-muted)', lineHeight:1.5 }}>
                    Quickly upload your site's codebase in a `.zip` archive. ServerDash will automatically extract and deploy it directly inside the root folder (<code>{site.root}</code>).
                  </p>
                  
                  <div onClick={()=>zipInputRef.current?.click()} style={{ border:'2px dashed var(--color-border)', borderRadius:10, padding:24, textAlign:'center', cursor:'pointer', background:'rgba(255,255,255,0.01)', marginTop:8, transition:'all 0.2s', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                    <Upload size={22} style={{ color:'var(--color-text-muted)', marginBottom:8 }}/>
                    <div style={{ fontWeight:600, fontSize:'0.85rem' }}>{zipUploadFile ? zipUploadFile.name : 'Select or drop ZIP file here'}</div>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', marginTop:2 }}>Maximum size determined by php/nginx client upload limits</div>
                    <input type="file" ref={zipInputRef} accept=".zip" hidden onChange={e => { if (e.target.files?.[0]) handleUploadZip(e.target.files[0]) }} />
                  </div>
                  {zipUploading && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--color-primary)', fontSize:'0.8rem', fontWeight:700, marginTop:10, justifyContent:'center' }}>
                      <RefreshCw size={14} className="animate-spin" /> Uploading and extracting ZIP files...
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick Actions Panel */}
            <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
              <div className="glass-card" style={{ padding:24, display:'flex', flexDirection:'column', gap:16 }}>
                <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800, borderBottom:'1px solid var(--color-border)', paddingBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                  <Cpu size={18} color="var(--color-primary)"/> App Actions
                </h3>
                
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <button className="btn btn-primary" onClick={runDeploy} disabled={actionBusy || !site.configFile} style={{ width:'100%', justifyContent:'flex-start' }}>
                    {actionBusy ? <RefreshCw size={15} className="animate-spin"/> : <RotateCcw size={15}/>}
                    {actionBusy ? 'Processing Action…' : 'Trigger Full Redeploy'}
                  </button>
                  <button className="btn btn-secondary" onClick={runSSL} disabled={actionBusy || !site.configFile} style={{ width:'100%', justifyContent:'flex-start' }}>
                    <Shield size={15}/> Re-config Let's Encrypt SSL
                  </button>
                  {site.root && (
                    <button className="btn btn-secondary" onClick={() => navigate('/files', { state: { path: site.root, backToSite: { id, domain: site.domain } } })} style={{ width:'100%', justifyContent:'flex-start' }}>
                      <FolderOpen size={15}/> Open in File Manager
                    </button>
                  )}
                </div>
              </div>

              {/* Active Server specs widget */}
              <div className="glass-card" style={{ padding:24, display:'flex', flexDirection:'column', gap:12 }}>
                <h4 style={{ margin:0, fontSize:'0.75rem', fontWeight:800, textTransform:'uppercase', color:'var(--color-text-muted)', letterSpacing:'0.06em' }}>Live Deployment Status</h4>
                {site.status === 'no-nginx' ? (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <span style={{ fontSize:'2rem', fontWeight:800, color: 'var(--color-warning)' }}>0%</span>
                      <span className="badge badge-red" style={{ padding:'2px 8px' }}>Orphaned</span>
                    </div>
                    <div style={{ fontSize:'0.78rem', color:'var(--color-text-muted)', lineHeight:1.5 }}>
                      This website directory exists in <code>/var/www</code> but has <strong>no active Nginx config</strong>. Nginx is not currently serving it.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <span style={{ fontSize:'2rem', fontWeight:800 }}>100%</span>
                      <span className="badge badge-green" style={{ padding:'2px 8px' }}>Active</span>
                    </div>
                    <div style={{ fontSize:'0.78rem', color:'var(--color-text-muted)', lineHeight:1.5 }}>
                      Your website domain <strong>{site.domain}</strong> is active and served correctly under {site.type === 'proxy' ? 'reverse Nginx proxying' : 'Nginx direct file serving'}.
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: DEPLOYMENTS & LOGS */}
        {activeTab === 'deployments' && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            <div className="glass-card" style={{ padding:24, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800 }}>Website Deployment Engine</h3>
                <p style={{ margin:'4px 0 0 0', fontSize:'0.82rem', color:'var(--color-text-muted)' }}>
                  Trigger a live build and start process. Our engine clones/pulls commits from Git, installs production node dependencies, builds your scripts, and reloads your PM2 container.
                </p>
              </div>
              <button className="btn btn-primary" onClick={runDeploy} disabled={actionBusy}>
                {actionBusy ? <RefreshCw size={15} className="animate-spin"/> : <RotateCcw size={15}/>}
                Trigger Deployment
              </button>
            </div>

            <div className="glass-card" style={{ padding:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 20px', borderBottom:'1px solid var(--color-border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:'0.85rem', fontWeight:700 }}>
                  <Terminal size={15} color="var(--color-primary)"/> Build & Deploy Console
                </div>
                {actionBusy && (
                  <span className="badge badge-blue animate-pulse-dot" style={{ fontSize:'0.7rem' }}>Deploying Live...</span>
                )}
              </div>
              
              <div 
                ref={termRef}
                className="terminal" 
                style={{ 
                  borderRadius:0, border:'none', minHeight:380, maxHeight: 600, overflowY:'auto', 
                  fontSize:'0.78rem', padding:16, background:'#010409' 
                }}
              >
                {actionLogs.length === 0 ? (
                  <div style={{ color:'var(--color-text-muted)' }}>
                    Console idle. Click "Trigger Deployment" to view the build pipeline execution live.
                  </div>
                ) : (
                  actionLogs.map((l, i) => (
                    <div 
                      key={i} 
                      style={{ 
                        color: l.startsWith('✓') || l.startsWith('Congratulations!') ? '#34d399' : l.startsWith('✗') || l.startsWith('Error') || l.startsWith('⚠') ? '#f87171' : undefined,
                        marginTop: 3,
                        fontFamily: 'var(--font-mono)'
                      }}
                    >
                      {l}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: BUILD SETTINGS */}
        {activeTab === 'build' && (
          <div className="glass-card animate-fade-in" style={{ padding:24, display:'flex', flexDirection:'column', gap:20 }}>
            <div>
              <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800 }}>Build & Development Settings</h3>
              <p style={{ margin:'4px 0 0 0', fontSize:'0.82rem', color:'var(--color-text-muted)' }}>
                Configure custom commands used by the deployment engine. These commands will execute sequentially when building the app.
              </p>
            </div>

            {buildLoading ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--color-text-muted)' }}>Loading build settings...</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth: 650 }}>
                <div>
                  <label className="label">Node.js Engine Version</label>
                  <select 
                    className="input" 
                    value={buildSettings.nodeVersion} 
                    onChange={e => setBuildSettings(prev => ({ ...prev, nodeVersion: e.target.value }))}
                  >
                    <option value="system">Default Node.js (System-wide Version)</option>
                    <option value="v20.x">Node.js v20.x (LTS)</option>
                    <option value="v18.x">Node.js v18.x (LTS)</option>
                    <option value="v16.x">Node.js v16.x</option>
                  </select>
                  <span style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', display:'block', marginTop:4 }}>
                    Define which Node environment executes build commands and PM2 runtimes.
                  </span>
                </div>

                <div>
                  <label className="label">Install Command</label>
                  <input 
                    type="text" 
                    className="input" 
                    value={buildSettings.installCommand} 
                    onChange={e => setBuildSettings(prev => ({ ...prev, installCommand: e.target.value }))}
                    placeholder="e.g. npm install --production"
                  />
                  <span style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', display:'block', marginTop:4 }}>
                    Command to run to download and configure node dependencies (runs before build). Set to empty to skip.
                  </span>
                </div>

                <div>
                  <label className="label">Build Command</label>
                  <input 
                    type="text" 
                    className="input" 
                    value={buildSettings.buildCommand} 
                    onChange={e => setBuildSettings(prev => ({ ...prev, buildCommand: e.target.value }))}
                    placeholder="e.g. npm run build"
                  />
                  <span style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', display:'block', marginTop:4 }}>
                    Compiles or bundles your app (runs after install). Set to empty to skip.
                  </span>
                </div>

                <div>
                  <label className="label">Restart / Execution Command</label>
                  <input 
                    type="text" 
                    className="input" 
                    value={buildSettings.restartCommand} 
                    onChange={e => setBuildSettings(prev => ({ ...prev, restartCommand: e.target.value }))}
                    placeholder={`e.g. pm2 restart "${site.domain}"`}
                  />
                  <span style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', display:'block', marginTop:4 }}>
                    Start/Restart script executed by PM2 daemon after build. Default: <code>pm2 restart "{site.domain}"</code>
                  </span>
                </div>

                <div style={{ display:'flex', gap:10, marginTop:10 }}>
                  <button className="btn btn-primary" onClick={saveBuildSettings} disabled={buildSaving}>
                    {buildSaving ? <RefreshCw size={13} className="animate-spin"/> : buildSaved ? <Check size={13}/> : <Save size={13}/>}
                    {buildSaving ? 'Saving...' : buildSaved ? 'Settings Saved' : 'Save Build Settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ENV VARIABLES */}
        {activeTab === 'env' && (
          <div className="glass-card animate-fade-in" style={{ padding:24, display:'flex', flexDirection:'column', gap:20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800 }}>Environment Variables (.env)</h3>
                <p style={{ margin:'4px 0 0 0', fontSize:'0.82rem', color:'var(--color-text-muted)' }}>
                  Manage sensitive configurations and tokens. Saved variables are injected directly into your app's environment (.env file in document root).
                </p>
              </div>
              <div className="tabs" style={{ margin:0, borderBottom:'none' }}>
                <button className={`tab btn-sm ${envMode === 'list' ? 'active' : ''}`} style={{ padding:'6px 12px' }} onClick={() => setEnvMode('list')}>
                  Key-Value Editor
                </button>
                <button className={`tab btn-sm ${envMode === 'raw' ? 'active' : ''}`} style={{ padding:'6px 12px' }} onClick={() => setEnvMode('raw')}>
                  Raw Text Editor
                </button>
              </div>
            </div>

            {envLoading ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--color-text-muted)' }}>Loading env variables...</div>
            ) : envMode === 'raw' ? (
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <textarea 
                  value={envContent} 
                  onChange={e => setEnvContent(e.target.value)} 
                  placeholder="PORT=3000&#10;API_KEY=my_secret_token&#10;DATABASE_URL=mongodb://..."
                  style={{ 
                    width:'100%', minHeight:300, background:'#030712', color:'#cdd6f4', 
                    border:'1px solid var(--color-border)', borderRadius:12, padding:16, 
                    fontFamily:'var(--font-mono)', fontSize:'0.82rem', lineHeight:1.6, outline:'none', resize:'vertical'
                  }}
                />
                <button className="btn btn-primary" style={{ alignSelf:'flex-start' }} onClick={() => {
                  parseEnvToPairs(envContent)
                  saveEnv(envContent)
                }} disabled={envSaving}>
                  {envSaving ? <RefreshCw size={13} className="animate-spin"/> : envSaved ? <Check size={13}/> : <Save size={13}/>}
                  {envSaving ? 'Saving...' : envSaved ? 'Env Saved Successfully' : 'Save Environment Variables'}
                </button>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
                {/* Add new variable block */}
                <div style={{ display:'flex', gap:10, alignItems:'flex-end', background:'rgba(255,255,255,0.02)', padding:16, borderRadius:12, border:'1px solid var(--color-border)' }}>
                  <div style={{ flex:1 }}>
                    <label className="label">Variable Key</label>
                    <input 
                      type="text" 
                      className="input" 
                      value={newEnvKey} 
                      onChange={e => setNewEnvKey(e.target.value)} 
                      placeholder="e.g. DATABASE_PASSWORD"
                    />
                  </div>
                  <div style={{ flex:2 }}>
                    <label className="label">Value</label>
                    <input 
                      type="text" 
                      className="input" 
                      value={newEnvVal} 
                      onChange={e => setNewEnvVal(e.target.value)} 
                      placeholder="Enter value"
                    />
                  </div>
                  <button className="btn btn-primary" onClick={handleAddEnvPair}>
                    <Plus size={16}/> Add Variable
                  </button>
                </div>

                {/* List of existing variables */}
                <div>
                  <h4 style={{ margin:'0 0 12px 0', fontSize:'0.82rem', textTransform:'uppercase', color:'var(--color-text-muted)', letterSpacing:'0.05em' }}>
                    Active Variables ({envPairs.length})
                  </h4>
                  {envPairs.length === 0 ? (
                    <div style={{ padding:20, textAlign:'center', color:'var(--color-text-muted)', border:'1px dashed var(--color-border)', borderRadius:12 }}>
                      No environment variables configured. Add one above or switch to Raw Editor.
                    </div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      {envPairs.map(p => (
                        <div key={p.key} style={{ display:'flex', justifyItems:'center', justifyContent:'space-between', padding:'10px 16px', background:'rgba(15,23,42,0.4)', border:'1px solid var(--color-border)', borderRadius:10 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:12, flex:1 }}>
                            <Lock size={13} color="var(--color-primary)"/>
                            <strong style={{ fontFamily:'var(--font-mono)', fontSize:'0.85rem' }}>{p.key}</strong>
                          </div>
                          
                          <div style={{ display:'flex', alignItems:'center', gap:10, flex:2 }}>
                            <input 
                              type={maskedKeys[p.key] ? 'password' : 'text'}
                              value={p.value}
                              readOnly
                              style={{ 
                                background:'none', border:'none', color:'var(--color-text-dim)', 
                                fontFamily:'var(--font-mono)', fontSize:'0.85rem', width:'80%', outline:'none'
                              }}
                            />
                            <button className="btn btn-secondary btn-icon" style={{ padding:4 }} onClick={() => toggleMask(p.key)} title={maskedKeys[p.key] ? 'Unmask secret' : 'Mask secret'}>
                              {maskedKeys[p.key] ? <Eye size={12}/> : <EyeOff size={12}/>}
                            </button>
                          </div>

                          <button className="btn btn-danger btn-sm" style={{ padding:4 }} onClick={() => handleRemoveEnvPair(p.key)} title="Delete variable">
                            <Trash2 size={12}/>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: GIT INTEGRATION */}
        {activeTab === 'git' && (
          <div className="glass-card animate-fade-in" style={{ padding:24, display:'flex', flexDirection:'column', gap:20 }}>
            <div>
              <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800 }}>Git Integration & Webhooks</h3>
              <p style={{ margin:'4px 0 0 0', fontSize:'0.82rem', color:'var(--color-text-muted)' }}>
                Connect your repository to automate your deployment pipeline. Every time a new commit is detected on your server, ServerDash can trigger an automated rebuild.
              </p>
            </div>

            {gitLoading ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--color-text-muted)' }}>Fetching repository status...</div>
            ) : gitData && gitData.hasGit ? (
              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
                {/* Repository Details */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
                  <div style={{ background:'rgba(255,255,255,0.02)', padding:18, borderRadius:12, border:'1px solid var(--color-border)' }}>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>Repository Connection</div>
                    <div style={{ fontSize:'0.9rem', fontWeight:700, marginTop:8, wordBreak:'break-all' }}>
                      {gitData.repoUrl || 'Local Repository'}
                    </div>
                    <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)', marginTop:6, display:'flex', alignItems:'center', gap:4 }}>
                      Branch: <code style={{ color:'var(--color-primary)' }}>{gitData.branch}</code>
                    </div>
                  </div>

                  <div style={{ background:'rgba(255,255,255,0.02)', padding:18, borderRadius:12, border:'1px solid var(--color-border)' }}>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>Auto-Deployment Poller</div>
                    <div style={{ fontSize:'0.9rem', fontWeight:700, marginTop:8, color:'var(--color-success)', display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:8, height:8, background:'var(--color-success)', borderRadius:'50%' }} className="animate-pulse-dot"/>
                      Active & Configured
                    </div>
                    <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)', marginTop:6 }}>
                      Poller sweeps repository commits automatically in the background.
                    </div>
                  </div>
                </div>

                {/* Commit Details Card */}
                {gitData.lastCommit && (
                  <div style={{ display:'flex', flexDirection:'column', gap:10, padding:18, background:'rgba(99,102,241,0.03)', border:'1px solid var(--color-primary-glow)', borderRadius:12 }}>
                    <div style={{ fontSize:'0.75rem', color:'var(--color-primary)', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                      Latest Commit Logged
                    </div>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                      <GitCommit size={18} style={{ color:'var(--color-primary)', marginTop:3 }}/>
                      <div>
                        <div style={{ fontWeight:700, fontSize:'0.9rem' }}>{gitData.lastCommit.subject}</div>
                        <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)', marginTop:4 }}>
                          Author: <strong>{gitData.lastCommit.author}</strong> ({gitData.lastCommit.email})
                        </div>
                        <div style={{ fontSize:'0.8rem', color:'var(--color-text-muted)', marginTop:2 }}>
                          Date: {gitData.lastCommit.date} — Hash: <code style={{ color:'var(--color-primary)' }}>{gitData.lastCommit.hash}</code>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Vercel-like Git Deployment Webhook */}
                <div style={{ display:'flex', flexDirection:'column', gap:8, padding:18, background:'rgba(255,255,255,0.01)', border:'1px dashed var(--color-border)', borderRadius:12 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontWeight:700, fontSize:'0.88rem' }}>
                    <Globe size={14} color="var(--color-primary)"/> Continuous Deployment Webhook
                  </div>
                  <p style={{ margin:0, fontSize:'0.8rem', color:'var(--color-text-muted)', lineHeight:1.5 }}>
                    Copy this URL and paste it into your GitHub/GitLab Repository settings under <strong>Webhooks</strong> (Event: Push) to trigger instantaneous builds on git push:
                  </p>
                  <div style={{ display:'flex', gap:8, marginTop:4 }}>
                    <input 
                      type="text" 
                      readOnly 
                      className="input" 
                      style={{ fontSize:'0.75rem', fontFamily:'var(--font-mono)', padding:'8px 12px' }}
                      value={`${window.location.protocol}//${window.location.hostname}:4001/api/sites/${id}/webhook`}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                      navigator.clipboard.writeText(`${window.location.protocol}//${window.location.hostname}:4001/api/sites/${id}/deploy`)
                      alert('Webhook URL copied!')
                    }}>
                      <Copy size={13}/> Copy
                    </button>
                  </div>
                </div>

                {/* Commit History & Rollback Console */}
                {gitData.commits && gitData.commits.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 10 }}>
                    <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <RotateCcw size={16} color="var(--color-primary)"/> Git Deployment History & Rollbacks
                      </h3>
                      <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        Select a previous commit deployment to immediately roll back / restore your live environment to that state.
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {gitData.commits.map((commit, index) => {
                        const isCurrent = gitData.lastCommit?.hash === commit.hash
                        return (
                          <div 
                            key={commit.hash} 
                            style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              padding: '12px 16px', 
                              background: isCurrent ? 'rgba(59, 130, 246, 0.04)' : 'rgba(255, 255, 255, 0.01)', 
                              border: isCurrent ? '1px solid var(--color-primary-glow)' : '1px solid var(--color-border)', 
                              borderRadius: 10,
                              transition: 'all 0.2s'
                            }}
                          >
                            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                              <GitCommit size={16} style={{ marginTop: 2, color: isCurrent ? 'var(--color-primary)' : 'var(--color-text-muted)', flexShrink: 0 }} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: isCurrent ? 'var(--color-primary)' : 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {commit.subject}
                                  </span>
                                  {isCurrent && (
                                    <span className="badge badge-green" style={{ fontSize: '0.6rem', padding: '1px 6px' }}>Current Active</span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                                  by <strong>{commit.author}</strong> ({commit.date}) — Commit: <code style={{ color: 'var(--color-text-dim)' }}>{commit.hash}</code>
                                </div>
                              </div>
                            </div>
                            
                            {!isCurrent && (
                              <button 
                                className="btn btn-secondary btn-sm" 
                                style={{ gap: 6, padding: '5px 12px', fontSize: '0.75rem', flexShrink: 0 }} 
                                onClick={() => {
                                  setDialog({
                                    title: 'Rollback Deployment?',
                                    message: `Are you sure you want to roll back this website to commit ${commit.hash} (${commit.subject})? This will hard reset the git state and trigger a complete rebuild.`,
                                    type: 'confirm',
                                    onConfirm: () => {
                                      setDialog(null)
                                      runDeploy(commit.hash)
                                    },
                                    onCancel: () => setDialog(null)
                                  })
                                }}
                                disabled={actionBusy}
                              >
                                <RotateCcw size={11} /> Restore Deploy
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding:32, textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:12, border:'1px dashed var(--color-border)', borderRadius:16 }}>
                <GitPullRequest size={36} color="var(--color-text-muted)"/>
                <div>
                  <h4 style={{ margin:0, fontSize:'0.95rem', fontWeight:700 }}>No Git repository linked to document root</h4>
                  <p style={{ margin:'4px 0 0 0', fontSize:'0.82rem', color:'var(--color-text-muted)', maxWidth: 450 }}>
                    To enable Git features, this site must have been created via Git cloning, or you can manually initialize git inside your folder.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 6: NGINX CONFIG & SSL */}
        {activeTab === 'nginx' && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            <div className="glass-card" style={{ padding:24, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <h3 style={{ margin:0, fontSize:'1.1rem', fontWeight:800 }}>Nginx Server Configurations</h3>
                <p style={{ margin:'4px 0 0 0', fontSize:'0.82rem', color:'var(--color-text-muted)' }}>
                  Hot-edit your Nginx virtual host configurations directly. Press Save to automatically test configurations (`nginx -t`) and reload the Nginx daemon safely.
                </p>
              </div>
              {site.isSystemPanel ? (
                <button className="btn btn-secondary btn-sm" disabled style={{ padding: '8px 14px', opacity: 0.5, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={14}/> System Protected (Read-Only)
                </button>
              ) : (
                <button 
                  className="btn btn-primary btn-sm" 
                  onClick={saveConfig} 
                  disabled={configSaving} 
                  style={{ padding: '8px 14px' }}
                >
                  {configSaving ? <RefreshCw size={14} className="animate-spin"/> : configSaved ? <Check size={14}/> : <Save size={14}/>}
                  {configSaving ? 'Testing Nginx Config...' : configSaved ? 'Hot-Reload Complete' : 'Save & Hot-Reload'}
                </button>
              )}
            </div>

            {site.isSystemPanel && (
              <div style={{ padding:14, borderRadius:10, background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.2)', color:'#f59e0b', fontSize:'0.82rem', display:'flex', gap:8, alignItems:'center' }}>
                <Lock size={15} />
                <span><strong>Protected Configuration</strong>: This is the primary Nginx binding configuration for the ServerDash control panel. Edits here are disabled to prevent administrative lockouts.</span>
              </div>
            )}

            {configError && (
              <div style={{ padding:16, borderRadius:12, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.15)', color:'var(--color-danger)', fontSize:'0.85rem', display:'flex', alignItems:'center', gap:8 }}>
                <AlertTriangle size={16}/> {configError}
              </div>
            )}

            <div className="glass-card" style={{ padding:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
              {configLoading ? (
                <div style={{ padding:48, textAlign:'center', color:'var(--color-text-muted)' }}>Loading virtual host contents...</div>
              ) : (
                <textarea 
                  value={configContent} 
                  onChange={e => !site.isSystemPanel && setConfigContent(e.target.value)} 
                  readOnly={site.isSystemPanel}
                  placeholder="Enter Nginx virtual host contents..."
                  style={{ 
                    width:'100%', minHeight:420, background:'#030712', color:'#cbd5e1', 
                    border:'none', padding:20, fontFamily:'var(--font-mono)', 
                    fontSize:'0.8125rem', lineHeight:1.7, outline:'none', resize:'vertical',
                    opacity: site.isSystemPanel ? 0.75 : 1
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* TAB 7: MAIL & SMTP SETTINGS */}
        {activeTab === 'mail' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            
            {/* Notifications */}
            {mailError && (
              <div style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.15)', color: 'var(--color-danger)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertTriangle size={16} />
                <span>Error: {mailError}</span>
              </div>
            )}
            {mailSuccess && (
              <div style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.15)', color: 'var(--color-success)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Check size={16} />
                <span>{mailSuccess}</span>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 24, alignItems: 'start' }}>
              
              {/* Left Side: SMTP Relay settings for this domain */}
              <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mail size={18} color="var(--color-primary)" />
                    Domain Outbound SMTP Relay
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    Configure dedicated outbound SMTP credentials specifically for this site to dispatch transactional emails safely.
                  </p>
                </div>

                <form onSubmit={saveMailSmtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label className="label">SMTP Host</label>
                    <input
                      className="input"
                      value={mailSettings.smtp?.host || ''}
                      onChange={e => setMailSettings(prev => ({ ...prev, smtp: { ...prev.smtp, host: e.target.value } }))}
                      placeholder="smtp.gmail.com"
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="label">Port</label>
                      <input
                        className="input"
                        type="number"
                        value={mailSettings.smtp?.port || ''}
                        onChange={e => setMailSettings(prev => ({ ...prev, smtp: { ...prev.smtp, port: e.target.value } }))}
                        placeholder="587"
                      />
                    </div>
                    <div>
                      <label className="label">Encryption</label>
                      <select
                        className="input"
                        value={mailSettings.smtp?.encryption || 'TLS'}
                        onChange={e => setMailSettings(prev => ({ ...prev, smtp: { ...prev.smtp, encryption: e.target.value } }))}
                      >
                        <option>TLS</option>
                        <option>SSL</option>
                        <option>None</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">Username</label>
                    <input
                      className="input"
                      value={mailSettings.smtp?.username || ''}
                      onChange={e => setMailSettings(prev => ({ ...prev, smtp: { ...prev.smtp, username: e.target.value } }))}
                      placeholder="e.g. info@domain.com"
                    />
                  </div>
                  <div>
                    <label className="label">Password</label>
                    <input
                      className="input"
                      type="password"
                      value={mailSettings.smtp?.password || ''}
                      onChange={e => setMailSettings(prev => ({ ...prev, smtp: { ...prev.smtp, password: e.target.value } }))}
                      placeholder="••••••••"
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" disabled={smtpSaving} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6 }}>
                    {smtpSaving ? <RefreshCw size={14} className="animate-spin" /> : smtpSaved ? <Check size={14} /> : <Save size={14} />}
                    {smtpSaving ? 'Saving Configurations...' : smtpSaved ? 'Saved Successfully' : 'Save SMTP Settings'}
                  </button>
                </form>

                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 18, marginTop: 4 }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>
                    Quick Connection Test
                  </h4>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      className="input"
                      style={{ flex: 1, height: 36, fontSize: '0.8rem' }}
                      value={testRecipient}
                      onChange={e => setTestRecipient(e.target.value)}
                      placeholder="Recipient email address..."
                    />
                    <button className="btn btn-secondary" onClick={testDomainMail} disabled={testBusy || !testRecipient} style={{ height: 36, fontSize: '0.8rem', padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {testBusy ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                      Test
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Side: Virtual Mailboxes & Aliases (Postfix) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                
                {/* Provision Virtual Mailbox Card */}
                <div className="glass-card" style={{ padding: 24 }}>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Plus size={18} color="var(--color-primary)" />
                    Provision Domain Mailbox
                  </h3>
                  <p style={{ margin: '0 0 18px 0', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    Create dynamic local virtual mailboxes mapped to the domain <strong>{mailSettings.domain || site.domain}</strong>.
                  </p>

                  <form onSubmit={createMailbox} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <label className="label">Mailbox Username</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          className="input"
                          style={{ textAlign: 'right' }}
                          value={mailboxForm.username}
                          onChange={e => setMailboxForm(prev => ({ ...prev, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
                          placeholder="e.g. info"
                          required
                        />
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>@{mailSettings.domain || site.domain}</span>
                      </div>
                    </div>

                    <div style={{ flex: '1 1 200px' }}>
                      <label className="label">Password</label>
                      <input
                        className="input"
                        type="password"
                        value={mailboxForm.password}
                        onChange={e => setMailboxForm(prev => ({ ...prev, password: e.target.value }))}
                        placeholder="Password..."
                        required
                      />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={mailBusy} style={{ height: 38, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={14} /> Provision
                    </button>
                  </form>
                </div>

                {/* Provision Email Alias/Forwarder Card */}
                <div className="glass-card" style={{ padding: 24 }}>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Send size={18} color="var(--color-primary)" />
                    Create Email Alias / Forwarder
                  </h3>
                  <p style={{ margin: '0 0 18px 0', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    Instantly forward incoming domain mail aliases to external targets with zero setup friction.
                  </p>

                  <form onSubmit={createForwarder} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 180px' }}>
                      <label className="label">Alias Source</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          className="input"
                          style={{ textAlign: 'right' }}
                          value={forwarderForm.source}
                          onChange={e => setForwarderForm(prev => ({ ...prev, source: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
                          placeholder="e.g. contact"
                          required
                        />
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>@{mailSettings.domain || site.domain}</span>
                      </div>
                    </div>

                    <div style={{ flex: '1 1 220px' }}>
                      <label className="label">Forward Target Email</label>
                      <input
                        className="input"
                        type="email"
                        value={forwarderForm.target}
                        onChange={e => setForwarderForm(prev => ({ ...prev, target: e.target.value }))}
                        placeholder="e.g. myname@gmail.com"
                        required
                      />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={mailBusy} style={{ height: 38, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={14} /> Add Forwarder
                    </button>
                  </form>
                </div>

                {/* Mailboxes and Forwarders Inventory list */}
                <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: 20, borderBottom: '1px solid var(--color-border)' }}>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>Domain Email Accounts & Forwarders</h4>
                  </div>

                  {mailLoading ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      <RefreshCw size={18} className="animate-spin" style={{ margin: '0 auto 8px auto', opacity: 0.4 }} />
                      Loading configured email records...
                    </div>
                  ) : (!mailSettings.mailboxes || mailSettings.mailboxes.length === 0) && (!mailSettings.forwarders || mailSettings.forwarders.length === 0) ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      No virtual mailboxes or aliases configured for this domain yet.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--color-border)' }}>
                          <th style={{ padding: '10px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Email Record</th>
                          <th style={{ padding: '10px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Record Type</th>
                          <th style={{ padding: '10px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Scope Target</th>
                          <th style={{ padding: '10px 16px', fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', width: 80, textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Render Mailboxes */}
                        {mailSettings.mailboxes?.map((m) => (
                          <tr key={m.username} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td style={{ padding: '12px 16px', fontSize: '0.82rem', fontWeight: 700 }}>
                              {m.username}@{mailSettings.domain || site.domain}
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>Local Mailbox</span>
                            </td>
                            <td style={{ padding: '12px 16px', fontSize: '0.78rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                              /var/mail/vhosts/{site.domain}/{m.username}/
                            </td>
                            <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => deleteMailbox(m.username)}
                                style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)', padding: '2px 8px', fontSize: '0.7rem' }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}

                        {/* Render Forwarders */}
                        {mailSettings.forwarders?.map((f) => (
                          <tr key={f.source} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td style={{ padding: '12px 16px', fontSize: '0.82rem', fontWeight: 700 }}>
                              {f.source}@{mailSettings.domain || site.domain}
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>Email Forwarder</span>
                            </td>
                            <td style={{ padding: '12px 16px', fontSize: '0.82rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                              ➜ {f.target}
                            </td>
                            <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => deleteForwarder(f.source)}
                                style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)', padding: '2px 8px', fontSize: '0.7rem' }}
                              >
                                Delete
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

          </div>
        )}

        {/* TAB: FILES */}
        {activeTab === 'files' && (
          <div className="glass-card" style={{ height: '70vh', padding: 0, overflow: 'hidden' }}>
            <FilesPage jailedPath={site.root} />
          </div>
        )}

        {/* TAB: TERMINAL & SCRIPTS */}
        {activeTab === 'terminal' && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
            {/* Terminal Panel */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Isolated Web Terminal</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Run commands safely within {site.domain}'s root directory. Dangerous system commands are blocked.
                </p>
              </div>
              <div 
                ref={siteTermRef}
                className="terminal" 
                style={{ 
                  borderRadius: 8, minHeight: 380, maxHeight: 500, overflowY: 'auto', 
                  fontSize: '0.8rem', padding: 16, background: '#010409', color: '#cdd6f4', fontFamily: 'var(--font-mono)'
                }}
              >
                {siteTermLogs.length === 0 ? (
                  <div style={{ color: 'var(--color-text-muted)' }}>Terminal ready. Connected to {site.root}</div>
                ) : (
                  siteTermLogs.map((l, i) => (
                    <div key={i} style={{ marginTop: 2, color: l.includes('BLOCKED:') || l.includes('Error:') ? '#f87171' : l.startsWith('$') ? '#60a5fa' : 'inherit' }}>
                      {l}
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={e => { e.preventDefault(); runSiteCommand() }} style={{ display: 'flex', gap: 10 }}>
                <input 
                  type="text" 
                  className="input" 
                  style={{ flex: 1, fontFamily: 'var(--font-mono)' }} 
                  placeholder="npm install, composer update, etc."
                  value={terminalCmd}
                  onChange={e => setTerminalCmd(e.target.value)}
                  disabled={siteTermRunning}
                />
                <button type="submit" className="btn btn-primary" disabled={siteTermRunning || !terminalCmd.trim()}>
                  {siteTermRunning ? <RefreshCw size={15} className="animate-spin" /> : <Terminal size={15} />}
                  Run
                </button>
              </form>
            </div>

            {/* Scripts Panel */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Code size={18} color="var(--color-primary)"/> Executable Scripts
              </h3>
              {scriptsLoading ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Scanning directory...</div>
              ) : siteScripts.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No .sh scripts or package.json scripts found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {siteScripts.map((sc, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {sc.type === 'npm' ? <span style={{ color: '#cb3837', fontWeight: 700, fontSize: '0.7rem' }}>NPM</span> : <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.7rem' }}>SH</span>}
                        <code style={{ fontSize: '0.8rem' }}>{sc.name}</code>
                      </div>
                      <button className="btn btn-secondary btn-sm" onClick={() => runSiteCommand(sc.command)} disabled={siteTermRunning}>
                        <Play size={12} /> Run
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 460 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, color:'var(--color-danger)' }}>
              <AlertTriangle size={26}/>
              <h3 style={{ margin:0, fontSize:'1.25rem', fontWeight:800 }}>Permanently Delete Website?</h3>
            </div>
            <p style={{ margin:'14px 0', fontSize:'0.9rem', color:'var(--color-text-muted)', lineHeight:1.5 }}>
              Are you sure you want to delete the configuration files for <strong>{site.domain}</strong>? This will remove Nginx virtual hosts.
            </p>
            {(() => {
              const targetRoot = site.root || `/var/www/${site.domain}`
              return (
                <div style={{ display:'flex', alignItems:'flex-start', gap:10, background:'rgba(239,68,68,0.06)', padding:14, borderRadius:10, border:'1px solid rgba(239,68,68,0.15)' }}>
                  <input 
                    type="checkbox" 
                    id="del-files-detail" 
                    checked={deleteWithFiles} 
                    onChange={e => setDeleteWithFiles(e.target.checked)} 
                    style={{ width:18, height:18, marginTop:2, cursor:'pointer' }}
                  />
                  <label htmlFor="del-files-detail" style={{ fontSize:'0.85rem', cursor:'pointer', color:'var(--color-text-dim)', lineHeight:1.4 }}>
                    <strong>Also permanently delete site files</strong> located at:<br/>
                    <code style={{ fontSize:'0.75rem', color:'#f87171', background:'rgba(0,0,0,0.2)', padding:'2px 4px', borderRadius:4, marginTop:4, display:'inline-block' }}>{targetRoot}</code>
                  </label>
                </div>
              )
            })()}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:12, marginTop:20 }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={performDelete} disabled={deleting}>
                {deleting ? 'Deleting Site…' : 'Yes, Delete Site'}
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog && <Dialog {...dialog} />}
    </div>
  )
}
