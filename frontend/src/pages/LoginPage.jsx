import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import PasskeyAuthModal from '../components/PasskeyAuthModal'

export default function LoginPage() {
  const { user, loading, initialized, refresh } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && user) {
      navigate('/overview', { replace: true })
    }
  }, [user, loading, navigate])

  if (loading) return null

  if (user) return null

  return (
    <PasskeyAuthModal
      initialized={initialized}
      onAuthenticated={async () => {
        await refresh()
        navigate('/overview', { replace: true })
      }}
    />
  )
}
