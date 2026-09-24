import { createContext, useContext, useState, useEffect } from 'react'

export const THEMES = [
  { id: 'midnight', label: 'Midnight', name: 'Deep Space', color: '#7c6ef5', bg: '#08080f' },
  { id: 'slate',    label: 'Slate',    name: 'Arctic Office', color: '#4361ee', bg: '#f4f6fb' },
  { id: 'carbon',   label: 'Carbon',   name: 'Terminal Hacker', color: '#00ff88', bg: '#000000' },
  { id: 'aurora',   label: 'Aurora',   name: 'Sunset Gradient', color: '#f77f00', bg: '#0d0a1a' },
]

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('serverdash_theme') || localStorage.getItem('theme')
    if (saved === 'dark') return 'midnight'
    if (saved === 'light') return 'slate'
    if (THEMES.some(t => t.id === saved)) return saved
    return 'midnight'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('serverdash_theme', theme)
    // Backward compatibility for anything reading 'theme'
    localStorage.setItem('theme', theme === 'slate' ? 'light' : 'dark')
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => {
      const idx = THEMES.findIndex(t => t.id === prev)
      const next = THEMES[(idx + 1) % THEMES.length]
      return next.id
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
