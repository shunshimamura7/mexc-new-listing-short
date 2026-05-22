'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ListingData } from '@/types'

type CollectResult = {
  symbol: string
  status: 'done' | 'skip' | 'error'
  error?: string
}

type StoredEntry = Pick<ListingData, 'symbol' | 'listingTime' | 'initialPumpPct'>

export default function CollectPage() {
  const [days, setDays]         = useState(30)
  const [loading, setLoading]   = useState(false)
  const [results, setResults]   = useState<CollectResult[]>([])
  const [total, setTotal]       = useState(0)
  const [progress, setProgress] = useState(0)
  const [stored, setStored]     = useState<StoredEntry[]>([])
  const [error, setError]       = useState<string | null>(null)

  const fetchStored = useCallback(async () => {
    const res = await fetch('/api/storage')
    if (!res.ok) return
    const json = await res.json()
    if (json.success) {
      setStored(
        (json.listings as ListingData[]).map((l) => ({
          symbol:         l.symbol,
          listingTime:    l.listingTime,
          initialPumpPct: l.initialPumpPct,
        }))
      )
    }
  }, [])

  useEffect(() => { fetchStored() }, [fetchStored])

  async function handleCollect() {
    setLoading(true)
    setError(null)
    setResults([])
    setProgress(0)

    try {
      const res1 = await fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      const json1 = await res1.json()
      if (!json1.success) throw new Error(json1.error)

      const toFetch: { symbol: string; createTime: number }[] = json1.toFetch
      const toSkip:  string[]                                  = json1.toSkip
      const tot = json1.total as number
      setTotal(tot)

      setResults(toSkip.map((s) => ({ symbol: s, status: 'skip' })))
      setProgress(toSkip.length)

      for (const { symbol, createTime } of toFetch) {
        const res2 = await fetch('/api/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, createTime }),
        })
        const json2 = await res2.json()
        setResults((prev) => [...prev, { symbol, status: json2.status ?? 'error', error: json2.error }])
        setProgress((prev) => prev + 1)
      }

      await fetchStored()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const done     = results.filter((r) => r.status === 'done').length
  const skip     = results.filter((r) => r.status === 'skip').length
  const errCount = results.filter((r) => r.status === 'error').length
  const pct      = total > 0 ? Math.round((progress / total) * 100) : 0

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink mb-1">データ収集</h1>
          <p className="text-ink-dim text-sm">MEXC APIから新規上場銘柄のKlineデータを取得・保存します</p>
        </div>

        {/* 取得設定 */}
        <div className="bg-panel rounded-xl p-6 mb-6 border border-rim">
          <h2 className="text-base font-semibold text-ink mb-4">取得設定</h2>
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <span className="text-ink-dim text-sm">直近</span>
            <input
              type="number" min={1} max={365} value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-20 bg-panel-raised border border-rim rounded-lg px-3 py-2 text-ink text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
            <span className="text-ink-dim text-sm">日以内の新規上場銘柄</span>
          </div>
          <button
            onClick={handleCollect}
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-panel-raised disabled:text-ink-faint disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-white"
          >
            {loading ? '取得中...' : '取得開始'}
          </button>
        </div>

        {/* エラー */}
        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 mb-6 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* プログレスバー */}
        {loading && total > 0 && (
          <div className="bg-panel rounded-xl p-5 border border-rim mb-4">
            <div className="flex justify-between text-xs text-ink-faint mb-2">
              <span>収集中... {progress} / {total}</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full bg-panel-raised rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* サマリーカード */}
        {results.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-4">
              {[
                { label: '取得完了', count: done,     text: 'text-green-400', border: 'border-green-500/30', bg: 'bg-green-500/5'  },
                { label: 'スキップ', count: skip,     text: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/5'  },
                { label: 'APIエラー', count: errCount, text: 'text-red-400',   border: 'border-red-500/30',   bg: 'bg-red-500/5'    },
              ].map(({ label, count, text, border, bg }) => (
                <div key={label} className={`rounded-xl p-5 border ${border} ${bg} text-center`}>
                  <div className={`text-4xl font-bold font-mono ${text}`}>{count}</div>
                  <div className="text-sm text-ink-faint mt-2">{label}</div>
                </div>
              ))}
            </div>

            {/* 銘柄別ステータスリスト */}
            <div className="bg-panel rounded-xl border border-rim mb-6 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-rim bg-panel-raised">
                <h2 className="text-sm font-semibold text-ink">銘柄別ステータス</h2>
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-rim">
                {results.map((r) => (
                  <div key={r.symbol} className="flex items-center justify-between px-5 py-2.5 hover:bg-panel-raised transition-colors">
                    <span className="font-mono text-sm text-ink">{r.symbol}</span>
                    <span className={`text-sm font-medium ${
                      r.status === 'done'  ? 'text-green-400' :
                      r.status === 'skip'  ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {r.status === 'done'  && '✓ 取得完了'}
                      {r.status === 'skip'  && '– スキップ'}
                      {r.status === 'error' && `✗ エラー${r.error ? ': ' + r.error : ''}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 取得済み銘柄テーブル */}
        <div className="bg-panel rounded-xl border border-rim overflow-hidden">
          <div className="px-6 py-4 border-b border-rim bg-panel-raised flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">取得済み銘柄</h2>
            <span className="text-sm text-ink-faint font-mono bg-panel px-3 py-1 rounded-lg border border-rim">
              {stored.length} 件
            </span>
          </div>
          {stored.length === 0 ? (
            <div className="px-6 py-12 text-center text-ink-faint text-sm">
              データなし。「取得開始」で収集してください。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-faint text-left border-b border-rim">
                    <th className="px-6 py-3 font-medium">銘柄</th>
                    <th className="px-4 py-3 font-medium">上場日時</th>
                    <th className="px-6 py-3 text-right font-medium">初動ポンプ率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rim">
                  {[...stored]
                    .sort((a, b) => b.listingTime - a.listingTime)
                    .map((s) => (
                      <tr key={s.symbol} className="hover:bg-panel-raised transition-colors">
                        <td className="px-6 py-3 font-mono text-ink">{s.symbol}</td>
                        <td className="px-4 py-3 text-ink-dim">
                          {new Date(s.listingTime).toLocaleString('ja-JP', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className={s.initialPumpPct >= 30 ? 'text-green-400 font-medium' : 'text-ink-dim'}>
                            +{s.initialPumpPct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
