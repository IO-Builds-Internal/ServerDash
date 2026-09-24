import { useTheme } from '../contexts/ThemeContext'

export default function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme()

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 6px',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderRadius: '9999px',
      }}
      role="radiogroup"
      aria-label="Theme selector"
    >
      {themes.map((t) => {
        const isActive = theme === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${t.label} theme (${t.name})`}
            title={`${t.label} — ${t.name}`}
            onClick={() => setTheme(t.id)}
            style={{
              position: 'relative',
              width: 18,
              height: 18,
              borderRadius: '50%',
              backgroundColor: t.color,
              border: isActive ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
              boxShadow: isActive ? `0 0 10px ${t.color}` : 'none',
              transform: isActive ? 'scale(1.15)' : 'scale(1)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              cursor: 'pointer',
              padding: 0,
              outline: 'none',
            }}
          />
        )
      })}
    </div>
  )
}
