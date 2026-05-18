import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  LayoutDashboard, Globe, Package, FolderOpen, Container,
  Database, Mail, Settings, ChevronLeft, ChevronRight,
  LogOut, Server, Wifi, WifiOff, Activity, Sun, Moon, HardDrive, Archive, Shield, LineChart
} from 'lucide-react'
import { useBranding } from '../contexts/BrandingContext'
import { useTheme } from '../contexts/ThemeContext'

const navItems = [
  { path: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { path: '/analytics', icon: LineChart, label: 'Web Analytics' },
  { path: '/websites', icon: Globe, label: 'Websites' },
  { path: '/ftp', icon: HardDrive, label: 'FTP Accounts' },
  { path: '/packages', icon: Package, label: 'Packages' },
  { path: '/files', icon: FolderOpen, label: 'File Manager' },
  { path: '/docker', icon: Container, label: 'Docker Apps' },
  { path: '/supabase', icon: Database, label: 'Supabase Projects' },
  { path: '/smtp', icon: Mail, label: 'SMTP & Mail' },
  { path: '/snapshots', icon: Archive, label: 'Server Snapshots' },
  { path: '/ports', icon: Activity, label: 'Ports Monitor' },
  { path: '/firewall', icon: Shield, label: 'Firewall Shield' },
  { path: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar({ connected = true }) {
  const [collapsed, setCollapsed] = useState(false)
  const { user, signOut } = useAuth()
  const { branding } = useBranding()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    if (window.confirm('Are you sure you want to sign out of ServerDash?')) {
      await signOut()
      navigate('/login')
    }
  }

  return (
    <aside
      style={{
        width: collapsed ? '64px' : '240px',
        height: '100vh',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
        position: 'sticky',
        top: 0,
        flexShrink: 0,
        zIndex: 10,
        overflow: 'hidden',
      }}
    >
      {/* Logo & branding */}
      <div style={{
        padding: collapsed ? '20px 16px' : '20px 20px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        overflow: 'hidden',
      }}>
        <div style={{
          width: 32, height: 32,
          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 0 12px rgba(59,130,246,0.4)',
          overflow: 'hidden'
        }}>
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Server size={16} color="white" />
          )}
        </div>
        {!collapsed && (
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text)', letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {branding.appName}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>VPS Management</div>
          </div>
        )}
      </div>

      {/* Connection status */}
      <div style={{
        padding: collapsed ? '12px 16px' : '10px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, borderRadius: '50%',
          background: connected ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
        }}>
          {connected
            ? <Wifi size={12} color="var(--color-success)" />
            : <WifiOff size={12} color="var(--color-danger)" />
          }
        </span>
        {!collapsed && (
          <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>
            <span style={{ color: connected ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {connected ? '● Connected' : '● Offline'}
            </span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto', minHeight: 0 }}>
        {navItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: collapsed ? '10px 16px' : '10px 12px',
              borderRadius: 8,
              marginBottom: 2,
              textDecoration: 'none',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              background: isActive ? 'rgba(59,130,246,0.1)' : 'transparent',
              border: isActive ? '1px solid rgba(59,130,246,0.2)' : '1px solid transparent',
              transition: 'all 0.15s ease',
              justifyContent: collapsed ? 'center' : 'flex-start',
              overflow: 'hidden',
            })}
            title={collapsed ? label : undefined}
          >
            {({ isActive }) => (
              <>
                <Icon size={18} style={{ flexShrink: 0, color: isActive ? 'var(--color-primary)' : 'inherit' }} />
                {!collapsed && (
                  <span style={{
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                  }}>
                    {label}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User info & logout */}
      <div style={{
        padding: collapsed ? '12px 8px' : '12px 16px',
        borderTop: '1px solid var(--color-border)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          marginBottom: 10,
          gap: 8,
        }}>
          {!collapsed && (
            <div style={{
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1
            }}>
              {user?.email ?? 'Demo Mode'}
            </div>
          )}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s',
              flexShrink: 0
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-primary)'; e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)' }}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
        <button
          onClick={handleSignOut}
          title="Sign out"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 8px',
            borderRadius: 8,
            background: 'none',
            border: '1px solid transparent',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontFamily: 'var(--font-sans)',
            transition: 'all 0.15s',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'none' }}
        >
          <LogOut size={16} />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          position: 'absolute',
          right: -14,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s',
          zIndex: 20,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-3)'; e.currentTarget.style.color = 'var(--color-text)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface-2)'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  )
}
