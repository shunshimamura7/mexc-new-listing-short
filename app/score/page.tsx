'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ScoreResult } from '@/types'

const REFRESH_MS = 5 * 60 * 1000

type ScoreState = {
  results: ScoreResult[]
  btcChangeP: number
  fetchedAt: number
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (price >= 1)    return price.toFixed(4)
  if (price >= 0.001) return price.toFixed(6)
  return price.toFixed(8)
}

function ScoreCard({ result, btcChangeP }: { result: ScoreResult; btcChangeP: number }) {
  const criteria = [
    { icon: '①', label: '初動ポンプ',   passed: result.detail.initialPump,   value: `+${result.initialPumpPct.toFixed(1)}%` },
    { icon: '②', label: '出来高枯渇',   passed: result.detail.volumeExhaust, value: `ピーク比 ${(result.volRatio * 100).toFixed(1)}%` },
    { icon: '③', label: '24h以上経過', passed: result.detail.elapsed24h,    value: `${result.elapsedHours}h経過` },
    { icon: '④', label: 'FR > +0.05%', passed: result.detail.frHigh,        value: `${result.fundingRate >= 0 ? '+' : ''}${(result.fundingRate * 100).toFixed(4)}%` },
    { icon: '⑤', label: 'BTC環境',     passed: result.detail.btcBearish,    value: `${btcChangeP >= 0 ? '+' : ''}${btcChangeP.toFixed(2)}%` },
  ]

  const borderColor =
    result.recommendation === 'short'   ? 'border-red-500/50' :
    result.recommendation === 'consider' ? 'border-amber-500/40' :
    'border-rim'

  const recBadge =
    result.recommendation === 'short' ? (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white">ショート推奨</span>
    ) : result.recommendation === 'consider' ? (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-600 text-white">要検討</span>
    ) : (
      <span className="px-2 py-0.5 rounded-full text-xs font-normal bg-panel-raised text-ink-faint">見送り</span>
    )

  return (
    <div className={`bg-panel rounded-xl border ${borderColor} p-5 flex flex-col gap-4`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono font-bold text-ink">{result.symbol}</div>
          <div className="text-xs text-ink-faint mt-0.5">
            上場後 {result.elapsedHours}h &nbsp;·&nbsp; {formatPrice(result.currentPrice)} USDT
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                className={`w-2.5 h-2.5 rounded-full ${i < result.score ? 'bg-blue-400' : 'bg-rim'}`}
              />
            ))}
            <span className="ml-1 text-sm font-bold text-ink">{result.score}/5</span>
          </div>
          {recBadge}
        </div>
      </div>

      {/* Criteria */}
      <div className="space-y-1.5">
        {criteria.map(({ icon, label, passed, value }) => (
          <div key={icon} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono ${passed ? 'text-blue-400' : 'text-ink-faint'}`}>{icon}</span>
              <span className={passed ? 'text-ink' : 'text-ink-faint'}>{label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-faint">{value}</span>
              <span className={`text-xs font-bold w-3 text-center ${passed ? 'text-green-400' : 'text-ink-faint'}`}>
                {passed ? '✓' : '✗'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* SL / TP */}
      <div className="border-t border-rim pt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-ink-faint mb-0.5">SL (+30%)</div>
          <div className="font-mono text-red-400 font-medium">{formatPrice(result.slPrice)}</div>
        </div>
        <div>
          <div className="text-xs text-ink-faint mb-0.5">TP (−20%)</div>
          <div className="font-mono text-green-400 font-medium">{formatPrice(result.tpPrice)}</div>
        </div>
      </div>
    </div>
  )
}

export default function ScorePage() {
  const [state, setState] = useState<ScoreState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_MS / 1000)
  const nextAt = useRef(0)

  const fetchScores = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/score')
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setState({ results: json.results, btcChangeP: json.btcChangeP, fetchedAt: json.fetchedAt })
      nextAt.current = Date.now() + REFRESH_MS
      setSecondsLeft(REFRESH_MS / 1000)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchScores()
    const id = setInterval(fetchScores, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchScores])

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((nextAt.current - Date.now()) / 1000)))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const btcChangeP = state?.btcChangeP ?? 0
  const btcTrend   = btcChangeP <= -2 ? '下落' : btcChangeP <= 2 ? '横ばい' : '上昇'
  const btcColor   = btcChangeP <= 2 ? 'text-green-400' : 'text-red-400'
  const mm = Math.floor(secondsLeft / 60)
  const ss = String(secondsLeft % 60).padStart(2, '0')

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">

        {/* Page header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-ink">自動スコアリング</h1>
            <p className="text-ink-dim text-sm mt-1">新規上場銘柄のショート機会を5点満点でスコアリング（直近7日）</p>
          </div>

          <div className="flex items-center gap-4">
            {/* BTC badge */}
            {state && (
              <div className="bg-panel border border-rim rounded-xl px-4 py-3 text-center min-w-[84px]">
                <div className="text-xs text-ink-faint mb-1">BTC 24h</div>
                <div className={`text-lg font-bold font-mono ${btcColor}`}>
                  {btcChangeP >= 0 ? '+' : ''}{btcChangeP.toFixed(2)}%
                </div>
                <div className={`text-xs ${btcColor}`}>{btcTrend}</div>
              </div>
            )}

            {/* Refresh button + countdown */}
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={fetchScores}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-panel-raised disabled:text-ink-faint disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors text-white"
              >
                {loading ? '取得中...' : '今すぐ更新'}
              </button>
              {!loading && state && (
                <div className="text-xs text-ink-faint">次回更新 {mm}:{ss}</div>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 mb-6 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Initial loading */}
        {loading && !state && (
          <div className="text-center py-24">
            <div className="text-ink-dim text-lg mb-2">スコアリング中...</div>
            <div className="text-ink-faint text-sm">MEXC APIから銘柄データを取得しています</div>
          </div>
        )}

        {/* Stats bar */}
        {state && (
          <div className="flex flex-wrap gap-4 mb-5 text-sm">
            <span className="text-ink-faint">
              対象: <span className="text-ink">{state.results.length}</span> 銘柄
            </span>
            <span className="text-ink-faint">
              ショート推奨:{' '}
              <span className="text-red-400 font-medium">
                {state.results.filter((r) => r.recommendation === 'short').length}
              </span>{' '}
              件
            </span>
            <span className="text-ink-faint">
              要検討:{' '}
              <span className="text-amber-400 font-medium">
                {state.results.filter((r) => r.recommendation === 'consider').length}
              </span>{' '}
              件
            </span>
            <span className="ml-auto text-ink-faint">
              {new Date(state.fetchedAt).toLocaleTimeString('ja-JP')} 時点
            </span>
          </div>
        )}

        {/* Empty state */}
        {state && state.results.length === 0 && !loading && (
          <div className="text-center py-24 text-ink-faint">
            直近7日の新規上場銘柄が見つかりませんでした
          </div>
        )}

        {/* Card grid */}
        {state && state.results.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {state.results.map((r) => (
              <ScoreCard key={r.symbol} result={r} btcChangeP={state.btcChangeP} />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
