'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV_LINKS = [
  { href: '/score',    label: 'スコアリング' },
  { href: '/collect',  label: 'データ収集' },
  { href: '/backtest', label: 'バックテスト' },
  { href: '/trades',   label: 'マイトレード' },
  { href: '/settings', label: '設定' },
]

export function Header() {
  const pathname = usePathname()
  const [isDark, setIsDark]         = useState(true)
  const [openCount, setOpenCount]   = useState<number | null>(null)

  useEffect(() => {
    setIsDark(localStorage.getItem('theme') !== 'light')
  }, [])

  useEffect(() => {
    async function fetchOpenCount() {
      try {
        const res  = await fetch('/api/trades')
        const json = await res.json()
        if (json.success) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const count = (json.trades as any[]).filter((t: any) => t.status === 'open').length
          setOpenCount(count)
        }
      } catch {
        // ignore
      }
    }
    fetchOpenCount()
    const id = setInterval(fetchOpenCount, 60_000)
    return () => clearInterval(id)
  }, [])

  function toggleTheme() {
    const next = !isDark
    setIsDark(next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    document.documentElement.classList.toggle('light', !next)
  }

  return (
    <header className="sticky top-0 z-50 bg-panel border-b border-rim">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>
          <span className="font-bold text-ink text-base group-hover:text-amber-400 transition-colors">
            MEXC Short
          </span>
        </Link>

        {/* Nav + toggle */}
        <div className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href
            const isTrades = href === '/trades'
            const showBadge = isTrades && openCount !== null && openCount > 0
            return (
              <Link
                key={href}
                href={href}
                className={`relative px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-panel-raised text-amber-400'
                    : 'text-ink-dim hover:text-ink hover:bg-panel-raised'
                }`}
              >
                {label}
                {showBadge && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold leading-none">
                    {openCount}
                  </span>
                )}
              </Link>
            )
          })}

          <div className="w-px h-5 bg-rim mx-2" />

          <button
            onClick={toggleTheme}
            title={isDark ? 'ライトモード' : 'ダークモード'}
            aria-label="テーマ切り替え"
            className="p-2 rounded-lg text-ink-dim hover:text-ink hover:bg-panel-raised transition-colors"
          >
            {isDark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
        </div>

      </div>
    </header>
  )
}
