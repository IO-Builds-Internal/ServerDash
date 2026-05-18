import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/Sidebar'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'
import WebsitesPage from './pages/WebsitesPage'
import PackagesPage from './pages/PackagesPage'
import FilesPage from './pages/FilesPage'
import DockerPage from './pages/DockerPage'
import SupabasePage from './pages/SupabasePage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import SmtpPage from './pages/SmtpPage'
import SettingsPage from './pages/SettingsPage'
import SiteDetailPage from './pages/SiteDetailPage'
import PortsPage from './pages/PortsPage'
import FtpPage from './pages/FtpPage'
import SnapshotsPage from './pages/SnapshotsPage'
import { Server } from 'lucide-react'
import { BrandingProvider, useBranding } from './contexts/BrandingContext'
import { ThemeProvider } from './contexts/ThemeContext'

function DashboardLayout() {
  const [connected, setConnected] = useState(true)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-background)', width: '100%' }}>
      <Sidebar connected={connected} />
      <main style={{ flex: 1, overflow: 'auto', padding: '24px', minWidth: 0 }}>
        <Routes>
          <Route path="/overview" element={<OverviewPage onConnectionChange={setConnected} />} />
          <Route path="/websites" element={<WebsitesPage />} />
          <Route path="/websites/manage/:id" element={<SiteDetailPage />} />
          <Route path="/ftp" element={<FtpPage />} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/docker" element={<DockerPage />} />
          <Route path="/supabase" element={<SupabasePage />} />
          <Route path="/supabase/project/:id" element={<ProjectDetailPage />} />
          <Route path="/smtp" element={<SmtpPage />} />
          <Route path="/snapshots" element={<SnapshotsPage />} />
          <Route path="/ports" element={<PortsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  )
}

// Single loading overlay — rendered exactly once while Supabase resolves the session.
// Both LoginPage and ProtectedRoute return null while loading=true, so this
// is the only loading UI the user ever sees.
function AppInner() {
  const { loading } = useAuth()
  const { branding } = useBranding()

  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-background)', flexDirection: 'column', gap: 16,
    }}>
      <div style={{
        width: 52, height: 52,
        background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
        borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 40px rgba(59,130,246,0.3)',
      }}>
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt="Logo" style={{ width: '100%', height: '100%', borderRadius: 16, objectFit: 'cover' }} />
        ) : (
          <Server size={24} color="white" />
        )}
      </div>
      <div style={{
        width: 26, height: 26,
        border: '2px solid rgba(99,102,241,0.2)',
        borderTop: '2px solid #6366f1',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>
        {branding.appName}
      </p>
    </div>
  )

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <DashboardLayout />
        </ProtectedRoute>
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <BrandingProvider>
          <AuthProvider>
            <AppInner />
          </AuthProvider>
        </BrandingProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
