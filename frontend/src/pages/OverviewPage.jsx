import { useState, useEffect, useRef, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Cpu, MemoryStick, HardDrive, Activity, Clock, BarChart3, Globe, Database, Shield, Search, Terminal, ArrowUpRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { formatUptime } from '../lib/utils'

const MAX_CHART_POINTS = 600
const POLL_INTERVAL = 5000      // ms between polls when connected
const RETRY_INTERVAL = 10000   // ms between retries when disconnected

const HISTORY_RANGES = [
  { value: '5m', label: '5m', ms: 5 * 60 * 1000 },
  { value: '15m', label: '15m', ms: 15 * 60 * 1000 },
  { value: '1h', label: '1h', ms: 60 * 60 * 1000 },
  { value: '6h', label: '6h', ms: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
]

function downsample(points, max = MAX_CHART_POINTS) {
  if (points.length <= max) return points
  const step = Math.ceil(points.length / max)
  return points.filter((_, i) => i % step === 0 || i === points.length - 1)
}

function chartTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function normalizeHistorySample(sample) {
  return {
    ts: sample.timestamp,
    time: chartTime(sample.timestamp),
    cpu: sample.cpu ?? sample.cpu?.usage ?? 0,
    ram: sample.ram ?? 0,
    disk: sample.disk ?? 0,
  }
}

function CircularGauge({ value = 0, max = 100, color, size = 80 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={8} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
    </svg>
  )
}

function MetricCard({ title, icon: Icon, color, children }) {
  return (
    <div className="glass-card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${color}18`,
          border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={16} color={color} />
        </div>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}

function ProgressMetric({ used, total, unit = 'GB', color }) {
  const pct = total > 0 ? (used / total) * 100 : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span className="metric-value">{used?.toFixed(1)}<span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', marginLeft: 2 }}>{unit}</span></span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>/ {total?.toFixed(1)} {unit}</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{pct.toFixed(1)}% used</div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: '0.8125rem',
    }}>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: 4, fontSize: '0.75rem' }}>{label}</p>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 500 }}>
          {p.name}: {p.value?.toFixed(1)}%
        </div>
      ))}
    </div>
  )
}

export default function OverviewPage({ onConnectionChange }) {
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState(null)
  const [history, setHistory] = useState([])
  const [sites, setSites] = useState([])
  const [projects, setProjects] = useState([])
  const [ports, setPorts] = useState([])
  const [portsFilter, setPortsFilter] = useState('')
  const [historyRange, setHistoryRange] = useState('1h')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [polling, setPolling] = useState(true)
  const [connected, setConnected] = useState(true)
  const [failCount, setFailCount] = useState(0)
  const [retryIn, setRetryIn] = useState(null)  // seconds until next retry
  const intervalRef = useRef(null)
  const retryTimerRef = useRef(null)
  const countdownRef = useRef(null)

  const selectedRange = HISTORY_RANGES.find(r => r.value === historyRange) || HISTORY_RANGES[2]

  const fetchHistory = useCallback(async (range = historyRange) => {
    setHistoryLoading(true)
    try {
      const res = await api.get('/api/metrics/history', { params: { range } })
      const points = (res.data || []).map(normalizeHistorySample)
      setHistory(downsample(points))
    } catch (err) {
      console.warn('Metric history fetch failed:', err.message)
    } finally {
      setHistoryLoading(false)
    }
  }, [historyRange])

  const startCountdown = useCallback((seconds) => {
    setRetryIn(seconds)
    clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setRetryIn(s => {
        if (s <= 1) { clearInterval(countdownRef.current); return null }
        return s - 1
      })
    }, 1000)
  }, [])

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await api.get('/api/metrics')
      const data = res.data
      setMetrics(data)
      setConnected(true)
      setFailCount(0)
      setRetryIn(null)
      clearInterval(countdownRef.current)
      onConnectionChange?.(true)

      setHistory(prev => {
        const cutoff = Date.now() - selectedRange.ms
        const point = {
          ts: data.timestamp,
          time: chartTime(data.timestamp),
          cpu: data.cpu?.usage ?? 0,
          ram: data.ram?.total > 0 ? (data.ram.used / data.ram.total) * 100 : 0,
          disk: data.disk?.usePct ?? 0,
        }
        const next = [...prev, point].filter(p => Date.parse(p.ts) >= cutoff)
        return downsample(next)
      })
    } catch (err) {
      setConnected(false)
      setFailCount(f => f + 1)
      onConnectionChange?.(false)
      console.warn('Metrics fetch failed:', err.message)
    }
  }, [onConnectionChange, selectedRange.ms])

  useEffect(() => {
    fetchHistory(historyRange)
    
    // Fetch ecosystem overview data
    api.get('/api/sites').then(res => setSites(res.data)).catch(() => {})
    api.get('/api/supabase/projects').then(res => setProjects(res.data)).catch(() => {})
    api.get('/api/ports').then(res => setPorts(res.data)).catch(() => {})
  }, [fetchHistory, historyRange])

  // Main polling effect
  useEffect(() => {
    fetchMetrics()
    if (polling) {
      intervalRef.current = setInterval(fetchMetrics, POLL_INTERVAL)
    }
    return () => {
      clearInterval(intervalRef.current)
      clearInterval(countdownRef.current)
    }
  }, [fetchMetrics, polling])

  // When disconnected, switch to slower retry cadence with countdown
  useEffect(() => {
    if (!connected && polling) {
      clearInterval(intervalRef.current)
      clearInterval(retryTimerRef.current)
      startCountdown(Math.round(RETRY_INTERVAL / 1000))
      retryTimerRef.current = setInterval(() => {
        fetchMetrics()
        startCountdown(Math.round(RETRY_INTERVAL / 1000))
      }, RETRY_INTERVAL)
      return () => {
        clearInterval(retryTimerRef.current)
        clearInterval(countdownRef.current)
      }
    } else if (connected && polling) {
      clearInterval(retryTimerRef.current)
      clearInterval(intervalRef.current)
      intervalRef.current = setInterval(fetchMetrics, POLL_INTERVAL)
    }
  }, [connected, polling, fetchMetrics, startCountdown])

  const togglePolling = () => {
    setPolling(p => {
      const next = !p
      if (!next) {
        clearInterval(intervalRef.current)
        clearInterval(retryTimerRef.current)
        clearInterval(countdownRef.current)
        setRetryIn(null)
      } else {
        fetchMetrics()
        intervalRef.current = setInterval(fetchMetrics, POLL_INTERVAL)
      }
      return next
    })
  }

  const retryNow = () => {
    clearInterval(retryTimerRef.current)
    clearInterval(countdownRef.current)
    setRetryIn(null)
    fetchMetrics()
    if (polling) {
      startCountdown(Math.round(RETRY_INTERVAL / 1000))
      retryTimerRef.current = setInterval(() => {
        fetchMetrics()
        startCountdown(Math.round(RETRY_INTERVAL / 1000))
      }, RETRY_INTERVAL)
    }
  }

  return (
    <div className="animate-fade-in">

      {/* Disconnected banner */}
      {!connected && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          padding: '10px 16px', marginBottom: 16, borderRadius: 10,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--color-warning)', fontSize: '0.875rem' }}>
                Backend unreachable
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginLeft: 8 }}>
                {failCount > 1 ? `${failCount} consecutive failures · ` : ''}
                {retryIn != null ? `Retrying in ${retryIn}s…` : 'Retrying…'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={retryNow}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.8rem' }}
            >
              ↺ Retry Now
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Server Overview</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
            Live system metrics with saved history
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--color-surface-3)', padding: 4, borderRadius: 10 }}>
            {HISTORY_RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setHistoryRange(r.value)}
                style={{
                  border: 'none',
                  borderRadius: 8,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: historyRange === r.value ? 700 : 500,
                  background: historyRange === r.value ? 'var(--color-surface-2)' : 'transparent',
                  color: historyRange === r.value ? 'var(--color-text)' : 'var(--color-text-muted)',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={togglePolling}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected && polling ? 'var(--color-success)' : !polling ? 'var(--color-text-muted)' : 'var(--color-warning)',
              animation: polling ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
            }} />
            {!polling ? 'Paused' : connected ? 'Live' : 'Reconnecting…'}
          </button>
        </div>
      </div>

      {/* Top metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* CPU */}
        <MetricCard title="CPU Usage" icon={Cpu} color="#3b82f6">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <CircularGauge value={metrics?.cpu?.usage ?? 0} max={100} color="#3b82f6" size={80} />
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)',
              }}>
                {(metrics?.cpu?.usage ?? 0).toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="metric-value">{(metrics?.cpu?.usage ?? 0).toFixed(1)}%</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>utilization</div>
            </div>
          </div>
        </MetricCard>

        {/* RAM */}
        <MetricCard title="Memory" icon={MemoryStick} color="#10b981">
          <ProgressMetric
            used={metrics?.ram?.used ?? 0}
            total={metrics?.ram?.total ?? 8}
            unit="GB"
            color="#10b981"
          />
          {metrics?.ram?.swapTotal > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>NVMe Swap Space</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {metrics.ram.swapUsed?.toFixed(1)} GB / {metrics.ram.swapTotal?.toFixed(1)} GB
                </span>
              </div>
              <div className="progress-bar" style={{ height: '4px', background: 'rgba(255,255,255,0.06)' }}>
                <div 
                  className="progress-fill" 
                  style={{ 
                    width: `${metrics.ram.swapTotal > 0 ? (metrics.ram.swapUsed / metrics.ram.swapTotal) * 100 : 0}%`, 
                    background: 'linear-gradient(90deg, #10b981, #6366f1)',
                    height: '4px',
                    transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
                  }} 
                />
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {(metrics.ram.swapTotal > 0 ? (metrics.ram.swapUsed / metrics.ram.swapTotal) * 100 : 0).toFixed(1)}% swap used
              </div>
            </div>
          )}
        </MetricCard>

        {/* Disk */}
        <MetricCard title="Disk" icon={HardDrive} color="#f59e0b">
          <ProgressMetric
            used={metrics?.disk?.used ?? 0}
            total={metrics?.disk?.total ?? 100}
            unit="GB"
            color="#f59e0b"
          />
        </MetricCard>

        {/* Network */}
        <MetricCard title="Network" icon={Activity} color="#6366f1">
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 2 }}>↓ IN</div>
                <div className="metric-value" style={{ fontSize: '1.25rem' }}>
                  {(metrics?.network?.in ?? 0).toFixed(1)}
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: 2 }}>
                    {metrics?.network?.inUnit ?? 'KB/s'}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 2 }}>↑ OUT</div>
                <div className="metric-value" style={{ fontSize: '1.25rem' }}>
                  {(metrics?.network?.out ?? 0).toFixed(1)}
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: 2 }}>
                    {metrics?.network?.outUnit ?? 'KB/s'}
                  </span>
                </div>
              </div>
            </div>
            {(metrics?.network?.totalRxGB || metrics?.network?.totalTxGB) && (
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>Total ↓ {metrics.network.totalRxGB} GB</span>
                <span>↑ {metrics.network.totalTxGB} GB</span>
              </div>
            )}
          </div>
        </MetricCard>

        {/* Uptime */}
        <MetricCard title="Uptime" icon={Clock} color="#ec4899">
          <div className="metric-value" style={{ fontSize: '1.5rem' }}>
            {formatUptime(metrics?.uptime)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 6 }}>system running time</div>
        </MetricCard>

        {/* Load Average */}
        <MetricCard title="Load Average" icon={BarChart3} color="#f97316">
          <div style={{ display: 'flex', gap: 16 }}>
            {['m1', 'm5', 'm15'].map((key, i) => (
              <div key={key} style={{ textAlign: 'center' }}>
                <div className="metric-value" style={{ fontSize: '1.25rem' }}>{metrics?.loadAvg?.[key] ?? '0.00'}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {['1m', '5m', '15m'][i]}
                </div>
              </div>
            ))}
          </div>
        </MetricCard>
      </div>

      {/* Ecosystem Overview Summary Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Sites Summary Card */}
        <div className="glass-card card-hover" style={{ padding: 20, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => navigate('/websites')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Globe size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hosted Websites</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4, letterSpacing: '-0.02em' }}>{sites.length}</div>
            </div>
          </div>
          <ArrowUpRight size={18} color="var(--color-text-muted)" />
        </div>

        {/* Supabase Summary Card */}
        <div className="glass-card card-hover" style={{ padding: 20, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => navigate('/supabase')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(16,185,129,0.1)', color: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Database size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Supabase Projects</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4, letterSpacing: '-0.02em' }}>{projects.length}</div>
            </div>
          </div>
          <ArrowUpRight size={18} color="var(--color-text-muted)" />
        </div>

        {/* Listen Ports Summary Card */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Listen Ports</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4, letterSpacing: '-0.02em' }}>{ports.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* CPU Chart */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>CPU History</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {historyLoading ? 'loading saved data' : `${selectedRange.label} saved`}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={history} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone" dataKey="cpu" name="CPU"
                stroke="#3b82f6" strokeWidth={2} dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* RAM Chart */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>Memory History</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {historyLoading ? 'loading saved data' : `${selectedRange.label} saved`}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={history} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone" dataKey="ram" name="RAM"
                stroke="#10b981" strokeWidth={2} dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Used Ports & Services Monitor Panel */}
      <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={18} color="var(--color-primary)" />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700 }}>Active Listen Ports & Services</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Real-time host binding and process tracking</p>
            </div>
          </div>
          <div className="search-input" style={{ width: 280, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input 
              type="text" 
              placeholder="Filter port or process name..." 
              value={portsFilter} 
              onChange={e => setPortsFilter(e.target.value)}
              style={{ width: '100%', padding: '6px 12px 6px 32px', borderRadius: 8, background: 'var(--color-surface-3)', border: '1px solid var(--color-border)', fontSize: '0.8125rem', outline: 'none', color: 'var(--color-text)' }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Port</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Process Name</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>PID</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Local Socket Address</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Availability</th>
              </tr>
            </thead>
            <tbody>
              {ports
                .filter(p => p.port.toString().includes(portsFilter) || p.process.toLowerCase().includes(portsFilter.toLowerCase()))
                .map((p, idx) => (
                  <tr key={idx} style={{ borderBottom: idx < ports.length - 1 ? '1px solid rgba(255,255,255,0.02)' : 'none' }}>
                    <td style={{ padding: '12px', fontWeight: 700, color: 'var(--color-primary)' }}>:{p.port}</td>
                    <td style={{ padding: '12px' }}>
                      <span className="badge badge-gray" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 600 }}>
                        {p.process || 'unknown'}
                      </span>
                    </td>
                    <td style={{ padding: '12px', color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                      {p.pid || '—'}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                      {p.address}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {p.public ? (
                        <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>Public (WAN)</span>
                      ) : (
                        <span className="badge badge-blue" style={{ fontSize: '0.7rem' }}>Local (LAN)</span>
                      )}
                    </td>
                  </tr>
                ))}
              {ports.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>No active listening ports found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
