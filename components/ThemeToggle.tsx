'use client'

import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    setIsDark(stored !== 'light')
  }, [])

  function toggle() {
    const next = !isDark
    setIsDark(next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    document.documentElement.classList.toggle('light', !next)
  }

  return (
    <button
      onClick={toggle}
      title={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        zIndex: 9999,
        padding: '0.5rem',
        borderRadius: '0.5rem',
        border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
        background: isDark ? '#1f2937' : '#f3f4f6',
        color: isDark ? '#d1d5db' : '#4b5563',
        cursor: 'pointer',
        lineHeight: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        transition: 'background 0.2s, color 0.2s, border-color 0.2s',
      }}
      aria-label="テーマ切り替え"
    >
      {isDark ? (
        // Sun icon — switch to light
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        // Moon icon — switch to dark
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  )
}
