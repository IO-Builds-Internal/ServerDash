import React from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react'

export function Overlay({ children, onClose }) {
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      {children}
    </div>,
    document.body
  )
}

export function Dialog({ title, message, type = 'info', onConfirm, onCancel, confirmText = 'OK', cancelText = 'Cancel' }) {
  const isConfirm = type === 'confirm' || type === 'warning';
  
  return (
    <Overlay onClose={onCancel}>
      <div className="glass-card animate-fade-in" style={{ padding: '28px 32px', maxWidth: 440, width: '100%', display: 'flex', flexDirection: 'column', gap: 16, border: type === 'warning' ? '1px solid rgba(239, 68, 68, 0.2)' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {type === 'success' && <CheckCircle2 size={24} color="var(--color-success)" />}
          {type === 'warning' && <AlertTriangle size={24} color="var(--color-danger)" />}
          {type === 'confirm' && <AlertTriangle size={24} color="var(--color-warning)" />}
          {type === 'info' && <Info size={24} color="var(--color-primary)" />}
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{title}</h3>
        </div>
        
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          {message}
        </p>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
          {isConfirm && (
            <button className="btn btn-secondary" onClick={onCancel} style={{ height: 38, padding: '0 20px' }}>
              {cancelText}
            </button>
          )}
          <button 
            className="btn btn-primary" 
            onClick={onConfirm} 
            style={{ 
              height: 38, 
              padding: '0 20px', 
              background: type === 'warning' ? 'var(--color-danger)' : undefined 
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
