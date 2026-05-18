import { createContext, useContext, useState, useEffect } from 'react'
import api from '../lib/api'

const BrandingContext = createContext(null)

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState({
    appName: 'ServerDash',
    logoUrl: '',
    faviconUrl: '',
  })

  const loadBranding = async () => {
    try {
      const res = await api.get('/api/settings')
      if (res.data && res.data.branding) {
        const brand = res.data.branding
        setBranding({
          appName: brand.appName || 'ServerDash',
          logoUrl: brand.logoUrl || '',
          faviconUrl: brand.faviconUrl || '',
        })
      }
    } catch (e) {
      console.error('Error loading branding settings:', e)
    }
  }

  useEffect(() => {
    loadBranding()
  }, [])

  useEffect(() => {
    // 1. Dynamic document title update
    document.title = branding.appName ? `${branding.appName} — Standalone VPS Dashboard` : 'ServerDash'

    // 2. Dynamic favicon update
    if (branding.faviconUrl) {
      let link = document.querySelector("link[rel~='icon']")
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.getElementsByTagName('head')[0].appendChild(link)
      }
      link.href = branding.faviconUrl
    }
  }, [branding])

  const updateBranding = async (newBrand) => {
    try {
      const payload = {
        appName: newBrand.appName || 'ServerDash',
        logoUrl: newBrand.logoUrl || '',
        faviconUrl: newBrand.faviconUrl || '',
      }
      await api.post('/api/settings/branding', payload)
      setBranding(payload)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.response?.data?.error || e.message }
    }
  }

  return (
    <BrandingContext.Provider value={{ branding, updateBranding, refresh: loadBranding }}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  const context = useContext(BrandingContext)
  if (!context) {
    throw new Error('useBranding must be used within a BrandingProvider')
  }
  return context
}
