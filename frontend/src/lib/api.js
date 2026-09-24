import axios from 'axios'

// In production, when VITE_API_URL is '' or undefined, requests are relative ('')
// so they route cleanly through the Nginx reverse proxy on the VPS.
// In local dev (import.meta.env.DEV === true), fall back to localhost:4001.
export const API_BASE = typeof import.meta.env.VITE_API_URL === 'string'
  ? import.meta.env.VITE_API_URL
  : (import.meta.env.DEV ? 'http://localhost:4001' : '')

/**
 * Universal authenticated fetch helper that always includes session cookies (credentials: 'include')
 * and resolves against the correct API_BASE.
 */
export async function authFetch(url, options = {}) {
  const targetUrl = url.startsWith('http') ? url : `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`
  return fetch(targetUrl, {
    ...options,
    credentials: 'include',
  })
}

const api = axios.create({
  baseURL: API_BASE,
  // Increase timeout — deploy/SSL/WordPress ops can take 2-5 min.
  timeout: 120000,
  // Passkey auth: session cookie is httpOnly and auto-sent with credentials: 'include'
  withCredentials: true,
})

// 401 handler: reject error gracefully without triggering infinite reload loops
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && error.response?.data?.code === 'session_expired') {
      window.dispatchEvent(new Event('session_expired'))
    }
    return Promise.reject(error)
  }
)

export default api
