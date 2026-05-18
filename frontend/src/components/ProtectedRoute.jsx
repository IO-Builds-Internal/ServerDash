import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  // Render nothing while auth resolves — App.jsx shows the loading overlay
  if (loading) return null

  if (!user) return <Navigate to="/login" replace />
  return children
}
