'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import type { ScoreResult, ElapsedCategory, Trade } from '@/types'

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

function makeTradeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

// ===== Entry Modal =====
function EntryModal({
  result,
  btcChangeP,
  onClose,
  onSaved,
}: {
  result: ScoreResult
  btcChangeP: number
  onClose: () => void
  onSaved: () => void
}) {
  const [positionSize, setPositionSize] = useState('')
  const [notes, setNotes]               = useState('')
  const [saving, setSaving]             = useState(false)
  const [err, setErr]                   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    const trade: Trade = {
      id: makeTradeId(),
      symbol: result.symbol,
      entryDate: new Date().toISOString(),
      entryPrice: result.currentPrice,
      slPrice: result.slPrice,
      tpPrice: result.tpPrice,
      positionSize: parseFloat(positionSize) || 0,
      snapshot: {
        pumpPct: result.initialPumpPct,
        hoursElapsed: result.elapsedHours,
        volumeRatio: result.volRatio,
        fundingRate: result.fundingRate,
        btcChange24h: btcChangeP,
        score: result.score,
      },
      exitDate: null,
      exitPrice: null,
      status: 'open',
      pnlPct: null,
      pnlUsd: null,
      notes,
    }
    try {
      const res  = await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onSaved()
    } catch (e) {
      setErr(String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-panel border border-rim rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="font-mono font-bold text-lg text-ink">{result.symbol}</div>
            <div className="text-xs text-ink-faint mt-0.5">ショートエントリーを記録</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-panel-raised transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Price summary */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          <div className="bg-panel-raised rounded-lg p-3 text-center">
            <div className="text-xs text-ink-faint mb-1">エントリー</div>
            <div className="font-mono text-sm font-medium text-ink">{formatPrice(result.currentPrice)}</div>
          </div>
          <div className="bg-panel-raised rounded-lg p-3 text-center">
            <div className="text-xs text-ink-faint mb-1">SL (+30%)</div>
            <div className="font-mono text-sm font-medium text-red-400">{formatPrice(result.slPrice)}</div>
          </div>
          <div className="bg-panel-raised rounded-lg p-3 text-center">
            <div className="text-xs text-ink-faint mb-1">TP (−20%)</div>
            <div className="font-mono text-sm font-medium text-green-400">{formatPrice(result.tpPrice)}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-ink-dim mb-1.5">ポジションサイズ (USDT)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={positionSize}
              onChange={(e) => setPositionSize(e.target.value)}
              placeholder="例: 100"
              className="w-full bg-panel-raised border border-rim rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-blue-500/50"
            />
          </div>

          <div>
            <label className="block text-sm text-ink-dim mb-1.5">メモ（任意）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="例: 出来高枯渇が顕著"
              className="w-full bg-panel-raised border border-rim rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-blue-500/50 resize-none"
            />
          </div>

          {err && <div className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">{err}</div>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-panel-raised border border-rim text-sm text-ink-dim hover:text-ink transition-colors">
              キャンセル
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-panel-raised disabled:text-ink-faint disabled:cursor-not-allowed text-sm font-medium text-white transition-colors">
              {saving ? '記録中...' : 'エントリー記録'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ===== ScoreCard =====
function ScoreCard({
  result,
  btcChangeP,
  showEntry,
  onEntry,
}: {
  result: ScoreResult
  btcChangeP: number
  showEntry: boolean
  onEntry: (r: ScoreResult) => void
}) {
  const criteria = [
    { icon: '①', label: '初動ポンプ +50%',  passed: result.detail.initialPump,   value: `+${result.initialPumpPct.toFixed(1)}%` },
    { icon: '②', label: '出来高枯渇',        passed: result.detail.volumeExhaust, value: `ピーク比 ${(result.volRatio * 100).toFixed(1)}%` },
    { icon: '③', label: '24h以上経過',       passed: result.detail.elapsed24h,    value: `${result.elapsedHours}h経過` },
    { icon: '④', label: 'FR > +0.05%',      passed: result.detail.frHigh,        value: `${result.fundingRate >= 0 ? '+' : ''}${(result.fundingRate * 100).toFixed(4)}%` },
    { icon: '⑤', label: 'BTC環境',          passed: result.detail.btcBearish,    value: `${btcChangeP >= 0 ? '+' : ''}${btcChangeP.toFixed(2)}%` },
  ]

  const borderColor =
    result.recommendation === 'short'    ? 'border-red-500/50' :
    result.recommendation === 'consider' ? 'border-amber-500/40' :
    'border-rim'

  const recBadge =
    result.recommendation === 'short'    ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white">ショート推奨</span> :
    result.recommendation === 'consider' ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-600 text-white">要検討</span> :
    result.recommendation === 'excluded' ? <span className="px-2 py-0.5 rounded-full text-xs font-normal bg-panel-raised text-ink-faint border border-rim">対象外</span> :
                                           <span className="px-2 py-0.5 rounded-full text-xs font-normal bg-panel-raised text-ink-faint">見送り</span>

  const elapsedBadge =
    result.elapsedCategory === 'waiting' ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">待機中</span> :
    result.elapsedCategory === 'late'    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-faint/10 text-ink-faint font-medium">48h超</span> :
    null

  const categoryBadge =
    result.symbolCategory === 'stock'     ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">STOCK</span> :
    result.symbolCategory === 'commodity' ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">商品</span> :
    null

  return (
    <div className={`bg-panel rounded-xl border ${borderColor} p-5 flex flex-col gap-4`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <Link href={`/coin/${result.symbol}`} className="font-mono font-bold text-ink hover:text-blue-400 transition-colors">
              {result.symbol}
            </Link>
            {categoryBadge}
            {elapsedBadge}
          </div>
          <div className="text-xs text-ink-faint">
            上場後 {result.elapsedHours}h &nbsp;·&nbsp; {formatPrice(result.currentPrice)} USDT
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={`w-2.5 h-2.5 rounded-full ${i < result.score ? 'bg-blue-400' : 'bg-rim'}`} />
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

      {/* Entry button */}
      {showEntry && (result.recommendation === 'short' || result.recommendation === 'consider') && (
        <button
          onClick={() => onEntry(result)}
          className="w-full py-2 rounded-lg bg-red-600/15 border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-600/25 hover:border-red-500/50 transition-colors"
        >
          エントリー記録
        </button>
      )}
    </div>
  )
}

const TAB_CONFIG: { key: ElapsedCategory; label: string; desc: string }[] = [
  { key: 'sweet',   label: '推奨対象',  desc: '24〜48h — スイートスポット' },
  { key: 'waiting', label: '待機中',    desc: '0〜24h — まだ早い' },
  { key: 'late',    label: '観察のみ',  desc: '48h超 — 期待値逓減' },
]

export default function ScorePage() {
  const [state, setState]       = useState<ScoreState | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_MS / 1000)
  const nextAt = useRef(0)

  const [activeTab, setActiveTab]         = useState<ElapsedCategory>('sweet')
  const [showStock, setShowStock]         = useState(false)
  const [showCommodity, setShowCommodity] = useState(false)

  const [modalTarget, setModalTarget] = useState<ScoreResult | null>(null)
  const [toast, setToast]             = useState<string | null>(null)

  const fetchScores = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/score')
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

  function handleEntrySaved() {
    setModalTarget(null)
    setToast('エントリーを記録しました')
    setTimeout(() => setToast(null), 3500)
  }

  const btcChangeP = state?.btcChangeP ?? 0
  const btcTrend   = btcChangeP <= -2 ? '下落' : btcChangeP <= 2 ? '横ばい' : '上昇'
  const btcColor   = btcChangeP <= 2 ? 'text-green-400' : 'text-red-400'
  const mm = Math.floor(secondsLeft / 60)
  const ss = String(secondsLeft % 60).padStart(2, '0')

  const visibleAll = (state?.results ?? []).filter((r) => {
    if (r.symbolCategory === 'stock'     && !showStock)     return false
    if (r.symbolCategory === 'commodity' && !showCommodity) return false
    return true
  })

  const tabCounts = {
    sweet:   visibleAll.filter((r) => r.elapsedCategory === 'sweet').length,
    waiting: visibleAll.filter((r) => r.elapsedCategory === 'waiting').length,
    late:    visibleAll.filter((r) => r.elapsedCategory === 'late').length,
  }

  const displayed = visibleAll.filter((r) => r.elapsedCategory === activeTab)

  const shortCount    = displayed.filter((r) => r.recommendation === 'short').length
  const considerCount = displayed.filter((r) => r.recommendation === 'consider').length

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">

        {/* ページヘッダー */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-ink">自動スコアリング</h1>
            <p className="text-ink-dim text-sm mt-1">
              新規上場銘柄を5点満点でスコアリング
              <span className="ml-2 text-ink-faint text-xs">
                ※ バックテスト結果より 24〜48h後エントリーがスイートスポット。48h超は期待値逓減
              </span>
            </p>
          </div>

          <div className="flex items-center gap-4">
            {state && (
              <div className="bg-panel border border-rim rounded-xl px-4 py-3 text-center min-w-[84px]">
                <div className="text-xs text-ink-faint mb-1">BTC 24h</div>
                <div className={`text-lg font-bold font-mono ${btcColor}`}>
                  {btcChangeP >= 0 ? '+' : ''}{btcChangeP.toFixed(2)}%
                </div>
                <div className={`text-xs ${btcColor}`}>{btcTrend}</div>
              </div>
            )}

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

        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 mb-6 text-red-400 text-sm">{error}</div>
        )}

        {loading && !state && (
          <div className="text-center py-24">
            <div className="text-ink-dim text-lg mb-2">スコアリング中...</div>
            <div className="text-ink-faint text-sm">MEXC APIから銘柄データを取得しています</div>
          </div>
        )}

        {state && (
          <>
            {/* カテゴリフィルター */}
            <div className="bg-panel border border-rim rounded-xl px-5 py-3.5 mb-4 flex flex-wrap items-center gap-5">
              <span className="text-xs text-ink-faint font-medium uppercase tracking-wide">表示フィルター</span>
              <label className="flex items-center gap-2 cursor-default select-none">
                <input type="checkbox" checked readOnly className="w-4 h-4 accent-blue-500" />
                <span className="text-sm text-ink-dim">暗号通貨</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={showStock} onChange={(e) => setShowStock(e.target.checked)} className="w-4 h-4 accent-purple-500" />
                <span className="text-sm text-ink-dim">株式トークン（STOCK）を含む</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={showCommodity} onChange={(e) => setShowCommodity(e.target.checked)} className="w-4 h-4 accent-amber-500" />
                <span className="text-sm text-ink-dim">コモディティ（XAU/OIL等）を含む</span>
              </label>
            </div>

            {/* タブ */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {TAB_CONFIG.map(({ key, label, desc }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${
                    activeTab === key
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-panel border-rim text-ink-dim hover:text-ink hover:bg-panel-raised'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
                    activeTab === key ? 'bg-white/20 text-white' : 'bg-panel-raised text-ink-faint'
                  }`}>
                    {tabCounts[key]}
                  </span>
                </button>
              ))}
              <span className="ml-1 self-center text-xs text-ink-faint">
                {TAB_CONFIG.find((t) => t.key === activeTab)?.desc}
              </span>
            </div>

            {/* 統計バー */}
            <div className="flex flex-wrap gap-4 mb-5 text-sm">
              <span className="text-ink-faint">
                表示: <span className="text-ink">{displayed.length}</span> 銘柄
              </span>
              {activeTab === 'sweet' && (
                <>
                  <span className="text-ink-faint">
                    ショート推奨:{' '}
                    <span className="text-red-400 font-medium">{shortCount}</span> 件
                  </span>
                  <span className="text-ink-faint">
                    要検討:{' '}
                    <span className="text-amber-400 font-medium">{considerCount}</span> 件
                  </span>
                </>
              )}
              <span className="ml-auto text-ink-faint">
                {new Date(state.fetchedAt).toLocaleTimeString('ja-JP')} 時点
              </span>
            </div>

            {displayed.length === 0 && !loading && (
              <div className="text-center py-24 text-ink-faint">
                {activeTab === 'sweet'
                  ? '現在、24〜48h経過の銘柄はありません'
                  : activeTab === 'waiting'
                  ? '現在、待機中（0〜24h）の銘柄はありません'
                  : '現在、48h超の銘柄はありません'}
              </div>
            )}

            {displayed.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayed.map((r) => (
                  <ScoreCard
                    key={r.symbol}
                    result={r}
                    btcChangeP={state.btcChangeP}
                    showEntry={activeTab === 'sweet'}
                    onEntry={setModalTarget}
                  />
                ))}
              </div>
            )}
          </>
        )}

      </div>

      {/* Entry modal */}
      {modalTarget && state && (
        <EntryModal
          result={modalTarget}
          btcChangeP={state.btcChangeP}
          onClose={() => setModalTarget(null)}
          onSaved={handleEntrySaved}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-900/80 border border-green-700 text-green-300 text-sm font-medium px-4 py-3 rounded-xl shadow-lg backdrop-blur-sm">
          {toast}
        </div>
      )}
    </div>
  )
}
