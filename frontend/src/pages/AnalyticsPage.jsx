import { useState, useEffect, useRef } from 'react'
import { 
  LineChart as ChartIcon, Users, Activity, Globe, ArrowUpRight, 
  RefreshCw, Radio, Server, CheckCircle2, AlertTriangle, 
  HelpCircle, Eye, ShieldAlert, Cpu
} from 'lucide-react'
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, 
  Tooltip, CartesianGrid 
} from 'recharts'
import api from '../lib/api'

export default function AnalyticsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshInterval, setRefreshInterval] = useState(10) // default 10 seconds
  const [activeTab, setActiveTab] = useState('paths') // 'paths' | 'origins' | 'ips'
  const timerRef = useRef(null)

  const loadAnalytics = async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/analytics')
      setData(res.data)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      if (!isSilent) setLoading(false)
    }
  }

  // Handle auto-refresh interval configuration
  useEffect(() => {
    loadAnalytics()
    
    if (timerRef.current) clearInterval(timerRef.current)
    
    if (refreshInterval > 0) {
      timerRef.current = setInterval(() => {
        loadAnalytics(true)
      }, refreshInterval * 1000)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [refreshInterval])

  // Clean raw bytes into human readable sizes
  const formatBytes = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Generate chart data matching timestamps to local times
  const getFormattedHistory = () => {
    if (!data?.history || data.history.length === 0) return []
    return data.history.map(item => {
      const date = new Date(item.timestamp)
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return {
        ...item,
        time: timeStr
      }
    })
  }

  const chartData = getFormattedHistory()

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* Page Header */}
      <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ChartIcon size={26} color="var(--color-primary)" /> Web Traffic & Visitor Analytics
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
            Monitor real-time Nginx web traffic rates, active visitor connections, top referrers, unique hosts, and response performance histories.
          </p>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Refresh Interval Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', padding: '4px 10px', borderRadius: 8 }}>
            <Radio size={12} color={refreshInterval > 0 ? 'var(--color-success)' : 'var(--color-text-muted)'} className={refreshInterval > 0 ? 'animate-pulse' : ''} />
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Auto Refresh:</span>
            <select 
              value={refreshInterval} 
              onChange={e => setRefreshInterval(parseInt(e.target.value))}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-text)', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', outline: 'none' }}
            >
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={0}>Off</option>
            </select>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={() => loadAnalytics(false)} disabled={loading} style={{ padding: '8px 12px' }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--color-danger)', borderRadius: 10, padding: 14, fontSize: '0.82rem', display: 'flex', gap: 8, alignItems: 'center' }}>
          <ShieldAlert size={15} />
          <span>Error loading web traffic statistics: {error}</span>
        </div>
      )}

      {/* Real-time Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1.2fr', gap: 16 }}>
        
        {/* Metric 1: Live Sockets */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 12, top: 12, width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', boxShadow: '0 0 10px var(--color-primary)' }} className="animate-pulse" />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Live Connections</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>
              {data ? data.connections : '--'}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-success)', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
              <ArrowUpRight size={10} /> Active
            </span>
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>Established raw TCP sockets</span>
        </div>

        {/* Metric 2: Live Active Users */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 12, top: 12, width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }} className="animate-pulse" />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Online Visitors</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>
              {data ? data.liveUsers : '--'}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 700 }}>Live Session</span>
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>Unique live connected IPs</span>
        </div>

        {/* Metric 3: Unique 24h visitors */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Unique Visitors</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>
              {data ? data.uniqueUsers : '--'}
            </span>
            <span style={{ fontSize: '0.66rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', color: 'var(--color-text-muted)' }}>Last 5K</span>
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>Unique remote client IPs</span>
        </div>

        {/* Metric 4: Total Requests */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Parsed Requests</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>
              {data ? data.totalRequests : '--'}
            </span>
            <span style={{ fontSize: '#10b981', fontWeight: 700, fontSize: '0.7rem' }}>Log Hits</span>
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>Requests volume analyzed</span>
        </div>

        {/* Metric 5: Total Bandwidth */}
        <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Data Bandwidth</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 900, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {data ? formatBytes(data.bandwidthBytes) : '--'}
            </span>
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>Total output payload size sent</span>
        </div>

      </div>

      {/* Historical AreaChart */}
      <div className="glass-card" style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>Web Traffic History (Rolling 24 Hours)</h3>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Displays visitor requests, socket states, and live sessions mapped in real-time intervals.
          </p>
        </div>

        <div style={{ width: '100%', height: 280 }}>
          {loading && !data ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
              <RefreshCw size={24} className="animate-spin" color="var(--color-primary)" />
            </div>
          ) : chartData.length === 0 ? (
            <div style={{ display: 'flex', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px dashed var(--color-border)', borderRadius: 12 }}>
              <HelpCircle size={28} color="var(--color-text-muted)" style={{ opacity: 0.5 }} />
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No historical checkpoints recorded yet. Graph will populate automatically.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0.005}/>
                  </linearGradient>
                  <linearGradient id="colorLive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.005}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.02)" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  stroke="var(--color-text-muted)" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false}
                  dy={10}
                />
                <YAxis 
                  stroke="var(--color-text-muted)" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false}
                  dx={-10}
                />
                <Tooltip 
                  contentStyle={{ 
                    background: 'rgba(20,20,30,0.85)', 
                    backdropFilter: 'blur(8px)',
                    border: '1px solid var(--color-border)', 
                    borderRadius: 10,
                    fontSize: '0.75rem',
                    color: 'var(--color-text)'
                  }} 
                />
                <Area 
                  type="monotone" 
                  dataKey="requests" 
                  name="Requests Volume"
                  stroke="var(--color-primary)" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorRequests)" 
                />
                <Area 
                  type="monotone" 
                  dataKey="liveUsers" 
                  name="Online Visitors"
                  stroke="#10b981" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorLive)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Insights Breakdown Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', gap: 20 }}>
        
        {/* Left Column: Top Visitor Tables (Tabbed) */}
        <div className="glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>Web Traffic Spotlights</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                View requested endpoints, referral domains, and visitor source countries.
              </p>
            </div>

            {/* Tab Toggles */}
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: 3, border: '1px solid var(--color-border)' }}>
              <button 
                className="btn btn-sm" 
                style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.72rem', fontWeight: 600, background: activeTab === 'paths' ? 'var(--color-primary)' : 'transparent', color: activeTab === 'paths' ? '#fff' : 'var(--color-text-muted)' }}
                onClick={() => setActiveTab('paths')}
              >
                Top Paths
              </button>
              <button 
                className="btn btn-sm" 
                style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.72rem', fontWeight: 600, background: activeTab === 'origins' ? 'var(--color-primary)' : 'transparent', color: activeTab === 'origins' ? '#fff' : 'var(--color-text-muted)' }}
                onClick={() => setActiveTab('origins')}
              >
                Referrals
              </button>
              <button 
                className="btn btn-sm" 
                style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.72rem', fontWeight: 600, background: activeTab === 'countries' ? 'var(--color-primary)' : 'transparent', color: activeTab === 'countries' ? '#fff' : 'var(--color-text-muted)' }}
                onClick={() => setActiveTab('countries')}
              >
                Visitor Locations
              </button>
              <button 
                className="btn btn-sm" 
                style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.72rem', fontWeight: 600, background: activeTab === 'ips' ? 'var(--color-primary)' : 'transparent', color: activeTab === 'ips' ? '#fff' : 'var(--color-text-muted)' }}
                onClick={() => setActiveTab('ips')}
              >
                Visitor IPs
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto', minHeight: 280 }}>
            {loading && !data ? (
              <div style={{ display: 'flex', minHeight: 240, alignItems: 'center', justifyContent: 'center' }}>
                <RefreshCw size={22} className="animate-spin" color="var(--color-primary)" />
              </div>
            ) : !data ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
                No active traffic data to report.
              </div>
            ) : activeTab === 'paths' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: '8px 4px' }}>Requested Path</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', width: 100 }}>Requests</th>
                    <th style={{ padding: '8px 8px', width: 120 }}>Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPaths.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign:'center', padding: 24, color:'var(--color-text-muted)' }}>No paths parsed yet.</td>
                    </tr>
                  ) : (
                    data.topPaths.map((p, idx) => {
                      const maxCount = data.topPaths[0]?.count || 1
                      const pct = Math.min(100, Math.round((p.count / maxCount) * 100))
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="table-row-hover">
                          <td style={{ padding: '10px 4px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-dim)', wordBreak: 'break-all' }}>
                            {p.path}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>
                            {p.count}
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, var(--color-primary), #6366f1)' }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            ) : activeTab === 'origins' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: '8px 4px' }}>Referral Source Hostname</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', width: 100 }}>Requests</th>
                    <th style={{ padding: '8px 8px', width: 120 }}>Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topOrigins.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign:'center', padding: 32, color:'var(--color-text-muted)' }}>
                        <Globe size={18} style={{ display:'block', margin:'0 auto 6px', opacity:0.4 }}/>
                        No external host referrers detected. Direct browser traffic only.
                      </td>
                    </tr>
                  ) : (
                    data.topOrigins.map((o, idx) => {
                      const maxCount = data.topOrigins[0]?.count || 1
                      const pct = Math.min(100, Math.round((o.count / maxCount) * 100))
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="table-row-hover">
                          <td style={{ padding: '10px 4px', fontWeight: 600, color: 'var(--color-text-dim)' }}>
                            {o.origin}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>
                            {o.count}
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            ) : activeTab === 'countries' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: '8px 4px' }}>Visitor Country Location</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', width: 100 }}>Requests</th>
                    <th style={{ padding: '8px 8px', width: 120 }}>Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topCountries.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign:'center', padding: 24, color:'var(--color-text-muted)' }}>No countries resolved yet.</td>
                    </tr>
                  ) : (
                    data.topCountries.map((c, idx) => {
                      const maxCount = data.topCountries[0]?.count || 1
                      const pct = Math.min(100, Math.round((c.count / maxCount) * 100))
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="table-row-hover">
                          <td style={{ padding: '10px 4px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-dim)' }}>
                            {c.country}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>
                            {c.count}
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)' }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: '8px 4px' }}>Visitor IP Address</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', width: 100 }}>Requests</th>
                    <th style={{ padding: '8px 8px', width: 120 }}>Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topIPs.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign:'center', padding: 24, color:'var(--color-text-muted)' }}>No client IPs captured yet.</td>
                    </tr>
                  ) : (
                    data.topIPs.map((ipObj, idx) => {
                      const maxCount = data.topIPs[0]?.count || 1
                      const pct = Math.min(100, Math.round((ipObj.count / maxCount) * 100))
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="table-row-hover">
                          <td style={{ padding: '10px 4px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-text-dim)' }}>
                            {ipObj.ip}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>
                            {ipObj.count}
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #f59e0b, #eab308)' }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Column: User Agents & Response Health */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Section A: User Agents Breakdown */}
          <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800 }}>Browser & Bot Breakdown</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                Operating systems and client browsers visiting your applications.
              </p>
            </div>

            {loading && !data ? (
              <div style={{ display: 'flex', height: 120, alignItems: 'center', justifyContent: 'center' }}>
                <RefreshCw size={18} className="animate-spin" color="var(--color-primary)" />
              </div>
            ) : !data ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: 20 }}>No records.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.76rem' }}>
                {Object.entries(data.topUserAgents).map(([browser, count]) => {
                  const total = Object.values(data.topUserAgents).reduce((a, b) => a + b, 0) || 1
                  const pct = Math.round((count / total) * 100)
                  
                  const colorMap = {
                    Chrome: 'var(--color-primary)',
                    Safari: '#10b981',
                    Firefox: '#f59e0b',
                    Edge: '#3b82f6',
                    Bots: '#ef4444',
                    Other: 'var(--color-text-muted)'
                  }
                  const barColor = colorMap[browser] || 'var(--color-primary)'
                  
                  return (
                    <div key={browser} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                        <span style={{ color: 'var(--color-text-dim)' }}>{browser}</span>
                        <span style={{ color: 'var(--color-text)' }}>{count} ({pct}%)</span>
                      </div>
                      <div style={{ width: '100%', height: 5, borderRadius: 2, background: 'rgba(255,255,255,0.02)', overflow:'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: barColor }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Section B: Nginx HTTP Status Health */}
          <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800 }}>Nginx Server Health</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                Response distribution codes representing traffic health.
              </p>
            </div>

            {loading && !data ? (
              <div style={{ display: 'flex', height: 100, alignItems: 'center', justifyContent: 'center' }}>
                <RefreshCw size={18} className="animate-spin" color="var(--color-primary)" />
              </div>
            ) : !data ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: 20 }}>No records.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                
                {/* 2xx Success */}
                <div style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 8, padding: 12, display:'flex', flexDirection:'column', gap:4 }}>
                  <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#10b981', textTransform:'uppercase', letterSpacing:'0.04em' }}>2xx SUCCESS</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{data.statusCodes['2xx']}</span>
                </div>

                {/* 3xx Redirect */}
                <div style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 8, padding: 12, display:'flex', flexDirection:'column', gap:4 }}>
                  <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#3b82f6', textTransform:'uppercase', letterSpacing:'0.04em' }}>3xx REDIRECT</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{data.statusCodes['3xx']}</span>
                </div>

                {/* 4xx Clients Error */}
                <div style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: 12, display:'flex', flexDirection:'column', gap:4 }}>
                  <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#f59e0b', textTransform:'uppercase', letterSpacing:'0.04em' }}>4xx BLOCK/FAIL</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{data.statusCodes['4xx']}</span>
                </div>

                {/* 5xx Servers Fault */}
                <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: 12, display:'flex', flexDirection:'column', gap:4 }}>
                  <span style={{ fontSize: '0.66rem', fontWeight: 800, color: 'var(--color-danger)', textTransform:'uppercase', letterSpacing:'0.04em' }}>5xx SERVER FAULT</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--color-danger)' }}>{data.statusCodes['5xx']}</span>
                </div>

              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  )
}
