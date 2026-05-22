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
  const [days, setDays]       = useState(30)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<CollectResult[]>([])
  const [total, setTotal]     = useState(0)
  const [progress, setProgress] = useState(0)
  const [stored, setStored]   = useState<StoredEntry[]>([])
  const [error, setError]     = useState<string | null>(null)

  const fetchStored = useCallback(async () => {
    const res = await fetch('/api/storage')
    if (!res.ok) return
    const json = await res.json()
    if (json.success) {
      setStored(
        (json.listings as ListingData[]).map((l) => ({
          symbol: l.symbol,
          listingTime: l.listingTime,
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
      // Phase 1: 候補リスト取得
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

      // スキップ済みを即反映
      const skipResults: CollectResult[] = toSkip.map((s) => ({ symbol: s, status: 'skip' }))
      setResults(skipResults)
      setProgress(toSkip.length)

      // Phase 2: 1銘柄ずつ順次収集
      for (const { symbol, createTime } of toFetch) {
        const res2 = await fetch('/api/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, createTime }),
        })
        const json2 = await res2.json()
        const entry: CollectResult = {
          symbol,
          status: json2.status ?? 'error',
          error:  json2.error,
        }
        setResults((prev) => [...prev, entry])
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
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-white">データ収集</h1>

        {/* 収集設定 */}
        <div className="bg-gray-900 rounded-xl p-6 mb-6 border border-gray-800">
          <h2 className="text-lg font-semibold mb-4 text-gray-200">取得設定</h2>
          <div className="flex items-center gap-4 mb-4">
            <label className="text-gray-400 text-sm whitespace-nowrap">直近</label>
            <input
              type="number" min={1} max={365} value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
            <label className="text-gray-400 text-sm">日以内の新規上場銘柄</label>
          </div>
          <button
            onClick={handleCollect}
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
          >
            {loading ? '取得中...' : '取得開始'}
          </button>
        </div>

        {/* エラー */}
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-6 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* プログレス + 結果 */}
        {(loading || results.length > 0) && (
          <div className="bg-gray-900 rounded-xl p-6 mb-6 border border-gray-800">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">
              収集結果
              <span className="ml-2 text-sm font-normal text-gray-500">対象 {total} 件</span>
            </h2>

            {/* プログレスバー */}
            {loading && total > 0 && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{progress} / {total}</span>
                  <span>{pct}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-6 mb-4">
              {[
                { label: '取得完了', count: done,     color: 'text-green-400' },
                { label: 'スキップ', count: skip,     color: 'text-yellow-400' },
                { label: 'APIエラー', count: errCount, color: 'text-red-400' },
              ].map(({ label, count, color }) => (
                <div key={label} className="text-center">
                  <div className={`text-2xl font-bold ${color}`}>{count}</div>
                  <div className="text-xs text-gray-500 mt-1">{label}</div>
                </div>
              ))}
            </div>

            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-left border-b border-gray-800">
                    <th className="pb-2 pr-4">銘柄</th>
                    <th className="pb-2">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.symbol} className="border-b border-gray-800/50">
                      <td className="py-1.5 pr-4 font-mono text-gray-300">{r.symbol}</td>
                      <td className="py-1.5">
                        {r.status === 'done'  && <span className="text-green-400">完了</span>}
                        {r.status === 'skip'  && <span className="text-yellow-400">スキップ</span>}
                        {r.status === 'error' && <span className="text-red-400">エラー: {r.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 取得済み銘柄一覧 */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 className="text-lg font-semibold mb-4 text-gray-200">
            取得済み銘柄
            <span className="ml-2 text-sm font-normal text-gray-500">{stored.length} 件</span>
          </h2>
          {stored.length === 0 ? (
            <p className="text-gray-600 text-sm">データなし。「取得開始」で収集してください。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-left border-b border-gray-800">
                    <th className="pb-2 pr-6">銘柄</th>
                    <th className="pb-2 pr-6">上場日時</th>
                    <th className="pb-2 text-right">初動ポンプ率</th>
                  </tr>
                </thead>
                <tbody>
                  {stored
                    .sort((a, b) => b.listingTime - a.listingTime)
                    .map((s) => (
                      <tr key={s.symbol} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-2 pr-6 font-mono text-gray-200">{s.symbol}</td>
                        <td className="py-2 pr-6 text-gray-400">
                          {new Date(s.listingTime).toLocaleString('ja-JP', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2 text-right">
                          <span className={s.initialPumpPct >= 30 ? 'text-green-400 font-medium' : 'text-gray-400'}>
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
