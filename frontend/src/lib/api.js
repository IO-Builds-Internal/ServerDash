import axios from 'axios'
import { localAuth } from './auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4001',
  timeout: 30000,
})

// Attach local token to every request
api.interceptors.request.use((config) => {
  const token = localAuth.getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 401 handler: only auto-logout on token_expired (not on network errors)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      const code = error.response?.data?.code
      if (code === 'token_expired') {
        localAuth.setToken(null)
        window.location.replace('/login')
      }
    }
    return Promise.reject(error)
  }
)

export default api
