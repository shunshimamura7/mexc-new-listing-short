'use client'

import { useState, useEffect } from 'react'
import type { CoinAnalysis, CategorySummary, LongResearchData } from '@/app/api/long-research/route'
import type { StockSignal } from '@/lib/stock-signal'
import type { StockSignalData } from '@/app/api/stock-signal/route'

type Tab = 'stock' | 'commodity_metal' | 'commodity_energy'

const TAB_LABELS: Record<Tab, string> = {
  stock:            'STOCK',
  commodity_metal:  '貴金属',
  commodity_energy: 'エネルギー・その他',
}

function fmt1(n: number) { return n.toFixed(1) }
function fmt2(n: number) { return n.toFixed(2) }

// ---- Verdict Banner ----
function Verdict({ avg24h }: { avg24h: number }) {
  if (avg24h >= 5) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-950/20 px-4 py-3 flex items-center gap-3">
        <span className="text-lg">✅</span>
        <div>
          <p className="text-green-400 font-medium text-sm">値動きあり・ロング戦略の検証価値あり</p>
          <p className="text-ink-faint text-xs mt-0.5">平均24h値幅 {fmt1(avg24h)}% — 十分なボラティリティが確認されています</p>
        </div>
      </div>
    )
  }
  if (avg24h >= 2) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-4 py-3 flex items-center gap-3">
        <span className="text-lg">⚠️</span>
        <div>
          <p className="text-amber-400 font-medium text-sm">値動き小さめ・追加検証推奨</p>
          <p className="text-ink-faint text-xs mt-0.5">平均24h値幅 {fmt1(avg24h)}% — ロング戦略には追加データが必要です</p>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 flex items-center gap-3">
      <span className="text-lg">❌</span>
      <div>
        <p className="text-red-400 font-medium text-sm">値動きなし・ロング戦略は難しい</p>
        <p className="text-ink-faint text-xs mt-0.5">平均24h値幅 {fmt1(avg24h)}% — ボラティリティが低すぎます</p>
      </div>
    </div>
  )
}

// ---- Correlation Insight Banner ----
function CorrelationInsight({ summary }: { summary: CategorySummary }) {
  if (summary.correlationCount === 0) return null
  const ratio   = summary.strongCorrelation / summary.correlationCount
  const avgCorr = summary.avgCorrelation ?? 0

  if (ratio >= 0.5) {
    return (
      <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 px-4 py-3 flex items-center gap-3">
        <span className="text-lg">📈</span>
        <div>
          <p className="text-blue-400 font-medium text-sm">原資産との連動性が高い・上場タイミングと原資産トレンドが重要</p>
          <p className="text-ink-faint text-xs mt-0.5">
            強相関(≥0.6): {summary.strongCorrelation}/{summary.correlationCount}件、平均相関係数 {fmt2(avgCorr)}
          </p>
        </div>
      </div>
    )
  }
  if (avgCorr <= 0.3) {
    return (
      <div className="rounded-lg border border-slate-500/30 bg-slate-900/30 px-4 py-3 flex items-center gap-3">
        <span className="text-lg">📊</span>
        <div>
          <p className="text-ink font-medium text-sm">原資産との連動性は低い・MEXC独自の需給で動いている可能性</p>
          <p className="text-ink-faint text-xs mt-0.5">
            強相関(≥0.6): {summary.strongCorrelation}/{summary.correlationCount}件、平均相関係数 {fmt2(avgCorr)}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-4 py-3 flex items-center gap-3">
      <span className="text-lg">🔍</span>
      <div>
        <p className="text-amber-400 font-medium text-sm">銘柄によって連動性が異なる・個別分析推奨</p>
        <p className="text-ink-faint text-xs mt-0.5">
          強相関(≥0.6): {summary.strongCorrelation}/{summary.correlationCount}件、平均相関係数 {fmt2(avgCorr)}
        </p>
      </div>
    </div>
  )
}

// ---- Summary Card ----
function SummaryCard({ label, summary }: { label: string; summary: CategorySummary }) {
  const total = summary.count || 1
  return (
    <div className="bg-panel-raised border border-rim rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-ink font-semibold text-sm">{label}</span>
        <span className="text-ink-faint text-xs">{summary.count} 件</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          <span className="text-amber-400 font-mono font-semibold text-base">{fmt1(summary.avgRange24h)}%</span>
          <span className="text-ink-faint text-[10px]">平均24h値幅</span>
        </div>
        <div className="flex flex-col">
          <span className="text-amber-400 font-mono font-semibold text-base">{fmt1(summary.avgPump24h)}%</span>
          <span className="text-ink-faint text-[10px]">平均24h最大上昇</span>
        </div>
      </div>
      {summary.correlationCount > 0 && (
        <div className="flex flex-col">
          <span className="text-blue-400 font-mono font-semibold text-sm">
            {summary.strongCorrelation}/{summary.correlationCount} 件
          </span>
          <span className="text-ink-faint text-[10px]">相関あり（|r|≥0.6）</span>
          {summary.avgCorrelation !== null && (
            <span className="text-ink-faint text-[10px]">平均相関係数 {fmt2(summary.avgCorrelation)}</span>
          )}
        </div>
      )}
      {summary.avgListingPremium !== null && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1">
            <span className={`font-mono font-semibold text-sm ${summary.avgListingPremium >= 5 ? 'text-red-400' : summary.avgListingPremium <= -5 ? 'text-green-400' : 'text-ink-dim'}`}>
              {summary.avgListingPremium >= 0 ? '+' : ''}{fmt1(summary.avgListingPremium)}%
            </span>
            <span className="text-ink-faint text-[10px]">平均上場乖離率</span>
          </div>
          <span className="text-[10px]">
            <span className="text-green-400">割安 {summary.undervalued}件</span>
            <span className="text-ink-faint"> / </span>
            <span className="text-red-400">割高 {summary.overvalued}件</span>
          </span>
        </div>
      )}
      {(summary.longEdgeCount > 0 || summary.shortEdgeCount > 0) && (
        <div className="flex flex-col gap-0.5 border-t border-rim pt-2">
          <span className="text-ink-faint text-[10px] mb-0.5">エッジ候補</span>
          <span className="text-[10px]">
            <span className="text-green-400">📈 ロング {summary.longEdgeCount}件</span>
            <span className="text-ink-faint"> / </span>
            <span className="text-red-400">📉 ショート {summary.shortEdgeCount}件</span>
          </span>
        </div>
      )}
      {summary.count > 0 && (
        <div>
          <p className="text-ink-faint text-[10px] mb-1">トレンド方向</p>
          <div className="flex gap-1 text-xs">
            <span className="text-green-400">上昇 {summary.trendUp}</span>
            <span className="text-ink-faint">/</span>
            <span className="text-red-400">下落 {summary.trendDown}</span>
            <span className="text-ink-faint">/</span>
            <span className="text-ink-dim">横ばい {summary.trendFlat}</span>
          </div>
          <div className="mt-1.5 h-1.5 flex rounded-full overflow-hidden gap-px">
            <div className="bg-green-500" style={{ width: `${(summary.trendUp / total) * 100}%` }} />
            <div className="bg-red-500"   style={{ width: `${(summary.trendDown / total) * 100}%` }} />
            <div className="bg-slate-600" style={{ width: `${(summary.trendFlat / total) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Signal Cards ----
function SignalCard({
  signal,
  onEntry,
}: {
  signal: StockSignal
  onEntry: (symbol: string) => Promise<void>
}) {
  const [entering, setEntering] = useState(false)
  const [done, setDone]         = useState<string | null>(null)

  async function handleEntry() {
    setEntering(true)
    try {
      await onEntry(signal.symbol)
      setDone('エントリー済み')
    } catch (e) {
      setDone(String(e))
    } finally {
      setEntering(false)
    }
  }

  const isLong    = signal.direction === 'long'
  const isShort   = signal.direction === 'short'
  const dirColor  = isLong ? 'text-green-400' : isShort ? 'text-red-400' : 'text-ink-dim'
  const dirLabel  = isLong ? '📈 ロング' : isShort ? '📉 ショート' : '—'
  const borderCls = isLong
    ? 'border-green-500/30 bg-green-950/10'
    : isShort
      ? 'border-red-500/30 bg-red-950/10'
      : 'border-rim bg-panel-raised'

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${borderCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono font-semibold text-sm text-ink">{signal.symbol}</p>
          <p className="text-blue-400 text-xs">${signal.ticker}</p>
        </div>
        <div className="text-right">
          <p className={`font-bold text-sm ${dirColor}`}>{dirLabel}</p>
          <p className="text-ink-faint text-[10px]">信頼度 {signal.confidence}</p>
        </div>
      </div>

      {/* Price row */}
      {signal.regularPrice !== null && (
        <div className="flex gap-3 text-xs">
          <span className="text-ink-faint">通常価格</span>
          <span className="font-mono text-ink">${signal.regularPrice.toFixed(2)}</span>
          {signal.extendedChange !== null && (
            <span className={`font-mono font-medium ${signal.extendedChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {signal.extendedType === 'pre' ? '時間前' : '時間後'}{signal.extendedChange >= 0 ? '+' : ''}{fmt1(signal.extendedChange)}%
            </span>
          )}
        </div>
      )}

      {/* EPS row */}
      {signal.epsSurprise !== null && (
        <div className="flex gap-3 text-xs">
          <span className="text-ink-faint">EPSサプライズ</span>
          <span className={`font-mono font-medium ${signal.epsSurprise >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {signal.epsSurprise >= 0 ? '+' : ''}{fmt1(signal.epsSurprise)}%
          </span>
          {signal.daysToEarnings !== null && (
            <span className="text-amber-400">決算まで{signal.daysToEarnings}日</span>
          )}
        </div>
      )}

      {/* Analyst row */}
      {signal.recommendation && (
        <div className="flex gap-3 text-xs">
          <span className="text-ink-faint">アナリスト</span>
          <span className="text-ink-dim">{signal.recommendation}</span>
          {signal.targetUpside !== null && (
            <span className={`font-mono font-medium ${signal.targetUpside >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              目標 {signal.targetUpside >= 0 ? '+' : ''}{fmt1(signal.targetUpside)}%
            </span>
          )}
        </div>
      )}

      {/* Reasons */}
      {signal.reasons.length > 0 && (
        <ul className="text-[10px] text-ink-faint space-y-0.5">
          {signal.reasons.map((r, i) => <li key={i}>• {r}</li>)}
        </ul>
      )}

      {/* SL/TP + Entry button */}
      {signal.direction && (
        <div className="flex items-center justify-between mt-1 pt-2 border-t border-rim">
          <span className="text-[10px] text-ink-faint">
            SL {signal.slPct}% / TP {signal.tpPct}%
          </span>
          {done ? (
            <span className="text-[10px] text-ink-dim">{done}</span>
          ) : (
            <button
              onClick={handleEntry}
              disabled={entering}
              className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
            >
              {entering ? '送信中…' : 'ペーパーエントリー'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SignalSection({
  signals,
  loading,
}: {
  signals: StockSignal[]
  loading: boolean
}) {
  const [entryMsg, setEntryMsg] = useState<{ symbol: string; msg: string } | null>(null)

  async function handleEntry(symbol: string) {
    const res  = await fetch('/api/stock-signal/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    })
    const json = await res.json()
    if (!json.success) {
      setEntryMsg({ symbol, msg: json.error ?? 'エラー' })
      throw new Error(json.error)
    }
    setEntryMsg({ symbol, msg: 'エントリー完了' })
  }

  const active = signals.filter((s) => s.direction !== null)
  const passive = signals.filter((s) => s.direction === null)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">リアルタイムシグナル</h2>
        {loading && <span className="text-ink-faint text-xs">取得中...</span>}
        {!loading && (
          <span className="text-ink-faint text-xs">
            シグナルあり {active.length}件 / 監視中 {signals.length}件
          </span>
        )}
      </div>

      {entryMsg && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-400">
          {entryMsg.symbol}: {entryMsg.msg}
        </div>
      )}

      {active.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {active.map((s) => (
            <SignalCard key={s.symbol} signal={s} onEntry={handleEntry} />
          ))}
        </div>
      )}

      {active.length === 0 && !loading && (
        <div className="rounded-lg border border-rim bg-panel-raised px-4 py-3 text-center">
          <p className="text-ink-faint text-sm">現在アクティブなシグナルはありません</p>
          <p className="text-ink-faint text-xs mt-0.5">監視中: {passive.length}件</p>
        </div>
      )}
    </div>
  )
}

// ---- Helpers ----
function TrendBadge({ trend }: { trend: CoinAnalysis['trend'] }) {
  const cls = trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-ink-dim'
  const label = trend === 'up' ? '上昇' : trend === 'down' ? '下落' : '横ばい'
  return <span className={`font-medium ${cls}`}>{label}</span>
}

function CorrBadge({ corr }: { corr: number | null }) {
  if (corr === null) return <span className="text-ink-faint">—</span>
  const abs = Math.abs(corr)
  const cls =
    abs >= 0.6 ? 'text-green-400' :
    abs >= 0.3 ? 'text-amber-400' :
    corr < -0.3 ? 'text-red-400' :
    'text-ink-dim'
  return <span className={`font-mono font-medium ${cls}`}>{corr >= 0 ? '+' : ''}{fmt2(corr)}</span>
}

// ---- Unified Table (STOCK・コモディティ共通) ----
type SortKey = 'range24h' | 'range48h' | 'pump24h' | 'dump24h' | 'range72h' | 'klineCount' | 'correlation' | 'stockChange' | 'listingPremium'

function CoinTable({
  coins,
  isStock,
  signalMap,
}: {
  coins: CoinAnalysis[]
  isStock: boolean
  signalMap: Map<string, StockSignal>
}) {
  const [sortKey, setSortKey] = useState<SortKey>('range24h')
  const [asc, setAsc] = useState(false)

  function handleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v)
    else { setSortKey(key); setAsc(false) }
  }

  const sorted = [...coins].sort((a, b) => {
    const va = a[sortKey] ?? (asc ? Infinity : -Infinity)
    const vb = b[sortKey] ?? (asc ? Infinity : -Infinity)
    const diff = (va as number) - (vb as number)
    return asc ? diff : -diff
  })

  function Th({ k, label }: { k: SortKey; label: string }) {
    const active = sortKey === k
    return (
      <th
        className={`pb-2 pr-3 text-right font-normal cursor-pointer select-none whitespace-nowrap hover:text-ink transition-colors ${active ? 'text-amber-400' : 'text-ink-faint'}`}
        onClick={() => handleSort(k)}
      >
        {label}{active ? (asc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  if (coins.length === 0) return <p className="text-ink-faint text-sm py-8 text-center">データなし</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-panel-raised">
          <tr className="border-b border-rim">
            <th className="pb-2 pr-3 text-left font-normal text-ink-faint">銘柄</th>
            <th className="pb-2 pr-3 text-left font-normal text-ink-faint">ティッカー</th>
            <th className="pb-2 pr-3 text-left font-normal text-ink-faint whitespace-nowrap">上場日時</th>
            <Th k="range24h"       label="24h値幅" />
            <Th k="range48h"       label="48h値幅" />
            <Th k="pump24h"        label="24h最大上昇" />
            <Th k="dump24h"        label="24h最大下落" />
            <Th k="range72h"       label="72h値幅" />
            <th className="pb-2 pr-3 text-center font-normal text-ink-faint">トレンド</th>
            <Th k="listingPremium" label="上場乖離率" />
            <Th k="correlation"    label="相関係数" />
            <Th k="stockChange"    label="原資産変化" />
            <th className="pb-2 pr-3 text-center font-normal text-ink-faint">エッジ</th>
            {isStock && (
              <>
                <th className="pb-2 pr-3 text-right font-normal text-ink-faint whitespace-nowrap">時間外%</th>
                <th className="pb-2 pr-3 text-right font-normal text-ink-faint">EPS</th>
                <th className="pb-2 pr-3 text-center font-normal text-ink-faint">シグナル</th>
              </>
            )}
            <Th k="klineCount"     label="kline本数" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const sig = isStock ? signalMap.get(c.symbol) : undefined
            return (
              <tr key={c.symbol} className="border-b border-rim hover:bg-panel-raised/50 transition-colors">
                <td className="py-1.5 pr-3 font-mono text-ink font-medium">{c.symbol}</td>
                <td className="py-1.5 pr-3 font-mono text-blue-400">
                  {c.ticker ? `$${c.ticker}` : '—'}
                </td>
                <td className="py-1.5 pr-3 text-ink-faint whitespace-nowrap">
                  {new Date(c.listingTime).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-amber-400">{fmt1(c.range24h)}%</td>
                <td className="py-1.5 pr-3 text-right font-mono text-ink-dim">{fmt1(c.range48h)}%</td>
                <td className="py-1.5 pr-3 text-right font-mono text-green-400">+{fmt1(c.pump24h)}%</td>
                <td className="py-1.5 pr-3 text-right font-mono text-red-400">-{fmt1(c.dump24h)}%</td>
                <td className="py-1.5 pr-3 text-right font-mono text-ink-dim">{fmt1(c.range72h)}%</td>
                <td className="py-1.5 pr-3 text-center"><TrendBadge trend={c.trend} /></td>
                <td className="py-1.5 pr-3 text-right font-mono">
                  {c.listingPremium !== null
                    ? <span className={c.listingPremium >= 5 ? 'text-red-400' : c.listingPremium <= -5 ? 'text-green-400' : 'text-ink-dim'}>
                        {c.listingPremium >= 0 ? '+' : ''}{fmt1(c.listingPremium)}%
                      </span>
                    : <span className="text-ink-faint">—</span>
                  }
                </td>
                <td className="py-1.5 pr-3 text-right"><CorrBadge corr={c.correlation} /></td>
                <td className="py-1.5 pr-3 text-right font-mono">
                  {c.stockChange !== null
                    ? <span className={c.stockChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {c.stockChange >= 0 ? '+' : ''}{fmt1(c.stockChange)}%
                      </span>
                    : <span className="text-ink-faint">—</span>
                  }
                </td>
                <td className="py-1.5 pr-3 text-center text-xs">
                  {c.longEdge  ? <span className="text-green-400">📈 ロング</span>  :
                   c.shortEdge ? <span className="text-red-400">📉 ショート</span> :
                   <span className="text-ink-faint">—</span>}
                </td>
                {isStock && (
                  <>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {sig?.extendedChange != null
                        ? <span className={sig.extendedChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {sig.extendedChange >= 0 ? '+' : ''}{fmt1(sig.extendedChange)}%
                          </span>
                        : <span className="text-ink-faint">—</span>
                      }
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {sig?.epsSurprise != null
                        ? <span className={sig.epsSurprise >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {sig.epsSurprise >= 0 ? '+' : ''}{fmt1(sig.epsSurprise)}%
                          </span>
                        : <span className="text-ink-faint">—</span>
                      }
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      {sig?.direction === 'long'  ? <span className="text-green-400">📈</span> :
                       sig?.direction === 'short' ? <span className="text-red-400">📉</span>   :
                       <span className="text-ink-faint">—</span>}
                    </td>
                  </>
                )}
                <td className="py-1.5 text-right font-mono text-ink-faint">{c.klineCount}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---- Page ----
export default function LongResearchPage() {
  const [data, setData]             = useState<LongResearchData | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [tab, setTab]               = useState<Tab>('stock')
  const [signals, setSignals]       = useState<StockSignal[]>([])
  const [signalLoading, setSignalLoading] = useState(false)

  useEffect(() => {
    fetch('/api/long-research')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setData(j.data)
        else setError(j.error ?? 'エラー')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // Fetch stock signals when STOCK tab is shown
  useEffect(() => {
    if (tab !== 'stock') return
    setSignalLoading(true)
    fetch('/api/stock-signal')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setSignals((j.data as StockSignalData).signals)
      })
      .catch(() => {})
      .finally(() => setSignalLoading(false))
  }, [tab])

  const activeCoins   = data ? data[tab] : []
  const activeSummary = data?.summary[tab]
  const overallAvg24h = activeSummary?.avgRange24h ?? 0

  const signalMap = new Map(signals.map((s) => [s.symbol, s]))

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">ロング検証 🧪</h1>
        <p className="text-ink-dim text-sm mt-1">STOCK・コモディティ銘柄の値動きを分析します</p>
        <p className="text-ink-faint text-xs mt-0.5">※実験的機能・ショート戦略とは独立しています</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-ink-faint text-sm">読み込み中（Yahoo Finance取得を含む）...</div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryCard label="STOCK"            summary={data.summary.stock} />
            <SummaryCard label="貴金属コモディティ" summary={data.summary.commodity_metal} />
            <SummaryCard label="エネルギー・その他" summary={data.summary.commodity_energy} />
          </div>

          {/* Verdict Banner */}
          {activeSummary && activeSummary.count > 0 && (
            <Verdict avg24h={overallAvg24h} />
          )}

          {/* Correlation Insight */}
          {activeSummary && activeSummary.correlationCount > 0 && (
            <CorrelationInsight summary={activeSummary} />
          )}

          {/* Signal Section (STOCK tab only) */}
          {tab === 'stock' && (
            <SignalSection signals={signals} loading={signalLoading} />
          )}

          {/* Tabs + Table */}
          <div className="bg-panel border border-rim rounded-xl overflow-hidden">
            <div className="flex border-b border-rim">
              {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    tab === t
                      ? 'border-amber-400 text-amber-400'
                      : 'border-transparent text-ink-dim hover:text-ink'
                  }`}
                >
                  {TAB_LABELS[t]}
                  <span className="ml-1.5 text-xs text-ink-faint">({data[t].length})</span>
                </button>
              ))}
            </div>
            <div className="p-4">
              <CoinTable
                coins={activeCoins}
                isStock={tab === 'stock'}
                signalMap={signalMap}
              />
            </div>
          </div>
        </>
      )}
    </main>
  )
}
