'use client'

import { Fragment, useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { BacktestResponse, TradeResult, HeatmapCell, GridSearchResult, GridsearchLatestData } from '@/types'

const SL_RANGE = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
const TP_RANGE = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]

const MEDAL = [
  { num: 'text-yellow-400', border: 'border-yellow-500/40', bg: 'bg-yellow-500/5' },
  { num: 'text-slate-300',  border: 'border-slate-400/40',  bg: 'bg-slate-500/5'  },
  { num: 'text-amber-600',  border: 'border-amber-700/40',  bg: 'bg-amber-700/5'  },
]

const OUTCOME_LABEL: Record<string, string> = { tp: 'TP', sl: 'SL', forced: '強制' }
const OUTCOME_COLOR: Record<string, string> = {
  tp: 'text-green-400', sl: 'text-red-400', forced: 'text-amber-400',
}

function winRateColor(rate: number, count: number): string {
  if (count === 0) return ''
  return `hsl(${Math.round(rate * 1.2)},65%,38%)`
}

function Badge({ label, value, color = 'text-ink' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center px-2.5 py-1.5 bg-panel-raised rounded-lg border border-rim min-w-[3.5rem]">
      <span className={`font-mono font-semibold text-sm leading-tight ${color}`}>{value}</span>
      <span className="text-[10px] text-ink-faint mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  )
}

function TradeTable({ trades }: { trades: TradeResult[] }) {
  return (
    <div className="overflow-x-auto max-h-52 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-panel-raised">
          <tr className="text-ink-faint border-b border-rim">
            <th className="pb-1.5 pr-4 text-left font-normal">銘柄</th>
            <th className="pb-1.5 pr-4 text-right font-normal">エントリー</th>
            <th className="pb-1.5 pr-4 text-right font-normal">決済</th>
            <th className="pb-1.5 pr-4 text-center font-normal">結果</th>
            <th className="pb-1.5 text-right font-normal">PnL</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} className="border-b border-rim">
              <td className="py-1 pr-4 font-mono text-ink-dim">{t.symbol}</td>
              <td className="py-1 pr-4 text-right font-mono text-ink-faint">{t.entryPrice.toFixed(4)}</td>
              <td className="py-1 pr-4 text-right font-mono text-ink-faint">{t.exitPrice.toFixed(4)}</td>
              <td className="py-1 pr-4 text-center">
                <span className={`font-medium ${OUTCOME_COLOR[t.outcome]}`}>{OUTCOME_LABEL[t.outcome]}</span>
              </td>
              <td className={`py-1 text-right font-mono font-medium ${t.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RankCard({ r, rank, isExpanded, isExpandLoading, trades, onExpand }: {
  r: GridSearchResult
  rank: number
  isExpanded: boolean
  isExpandLoading: boolean
  trades: TradeResult[]
  onExpand: () => void
}) {
  const medal = rank <= 3 ? MEDAL[rank - 1] : null
  const borderCls = medal ? `${medal.border} ${medal.bg}` : 'border-rim'

  return (
    <div>
      <div
        onClick={onExpand}
        className={`bg-panel p-4 border ${borderCls} cursor-pointer select-none hover:bg-panel-raised transition-colors ${isExpanded ? 'rounded-t-xl' : 'rounded-xl'}`}
      >
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold font-mono w-8 text-center flex-shrink-0 ${medal?.num ?? 'text-ink-faint'}`}>
            {rank}
          </div>
          <div className="flex flex-wrap gap-2 flex-1 min-w-0">
            <Badge label="エントリー" value={`${r.entryHours}h後`} />
            <Badge label="SL" value={`${r.slPct}%`} color="text-red-400" />
            <Badge label="TP" value={`${r.tpPct}%`} color="text-green-400" />
            <Badge label="勝率" value={`${r.winRate.toFixed(1)}%`} color={r.winRate >= 50 ? 'text-green-400' : 'text-ink-dim'} />
            <Badge label="期待値" value={`${r.expectedValue >= 0 ? '+' : ''}${r.expectedValue.toFixed(2)}%`} color={r.expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            <Badge label="N件" value={String(r.tradeCount)} />
          </div>
          <span className="text-ink-faint text-sm flex-shrink-0">
            {isExpandLoading ? '…' : isExpanded ? '▲' : '▼'}
          </span>
        </div>
      </div>
      {isExpanded && (
        <div className={`border border-t-0 ${medal ? medal.border : 'border-rim'} rounded-b-xl bg-panel-raised px-4 py-3`}>
          <p className="text-xs text-ink-faint mb-2 font-medium">
            {r.entryHours}h後 / SL {r.slPct}% / TP {r.tpPct}% — {trades.length} トレード
          </p>
          <TradeTable trades={trades} />
        </div>
      )}
    </div>
  )
}

function HeatmapGrid({ cells, activeSl, activeTp }: {
  cells: HeatmapCell[]
  activeSl: number
  activeTp: number
}) {
  const cellMap = new Map(cells.map((c) => [`${c.sl}-${c.tp}`, c]))
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="text-ink-faint text-right pr-2 pb-1 font-normal">SL↓TP→</th>
            {TP_RANGE.map((tp) => (
              <th key={tp} className={`text-center pb-1 font-normal w-10 ${tp === activeTp ? 'text-blue-400 font-semibold' : 'text-ink-faint'}`}>
                {tp}%
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SL_RANGE.map((sl) => (
            <tr key={sl}>
              <td className={`text-right pr-2 py-0.5 font-normal ${sl === activeSl ? 'text-blue-400 font-semibold' : 'text-ink-faint'}`}>
                {sl}%
              </td>
              {TP_RANGE.map((tp) => {
                const cell     = cellMap.get(`${sl}-${tp}`)
                const wr       = cell?.winRate ?? 0
                const cnt      = cell?.tradeCount ?? 0
                const isActive = sl === activeSl && tp === activeTp
                const bgColor  = cnt > 0 ? winRateColor(wr, cnt) : undefined
                return (
                  <td key={tp} className="p-0">
                    <div
                      title={`SL${sl}% / TP${tp}%\n勝率: ${wr.toFixed(1)}%\n平均PnL: ${cell?.avgPnl.toFixed(1) ?? '—'}%\nトレード数: ${cnt}`}
                      style={bgColor ? { backgroundColor: bgColor } : undefined}
                      className={`w-10 h-7 flex items-center justify-center rounded text-center font-mono
                        ${!bgColor ? 'bg-panel-raised text-ink-faint' : 'text-white'}
                        ${isActive ? 'ring-2 ring-blue-400 z-10 relative' : ''}`}
                    >
                      {cnt > 0 ? `${Math.round(wr)}` : '—'}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SliderField({ label, value, min, max, step = 1, unit = '', onChange, disabled }: {
  label: string; value: number; min: number; max: number
  step?: number; unit?: string; onChange: (v: number) => void; disabled: boolean
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-ink-dim">{label}</span>
        <span className="text-ink font-mono">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full accent-blue-500"
      />
    </div>
  )
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const h = Math.floor(diff / 3_600_000)
  if (h < 1)  return `${Math.floor(diff / 60_000)}分前`
  if (h < 24) return `${h}時間前`
  return `${Math.floor(h / 24)}日前`
}

export default function BacktestPage() {
  const [entryHours, setEntryHours]       = useState(1)
  const [slPct, setSlPct]                 = useState(20)
  const [tpPct, setTpPct]                 = useState(30)
  const [minPumpPct, setMinPumpPct]       = useState(0)
  const [minFdvMcRatio, setMinFdvMcRatio] = useState(0)
  const [minFR, setMinFR]                 = useState(0)
  const [excludeStock, setExcludeStock]   = useState(false)
  const [stockOnly, setStockOnly]         = useState(false)

  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [result, setResult]     = useState<BacktestResponse | null>(null)

  const [gsLoading, setGsLoading]           = useState(false)
  const [gsError, setGsError]               = useState<string | null>(null)
  const [gsResults, setGsResults]           = useState<GridSearchResult[] | null>(null)
  const [gsListingCount, setGsListingCount] = useState(0)
  const [gsSortBy, setGsSortBy]             = useState<'ev' | 'avgPnl' | 'winRate'>('ev')
  const [gsShowAll, setGsShowAll]           = useState(false)

  const [expandedKey, setExpandedKey]         = useState<string | null>(null)
  const [expandedTrades, setExpandedTrades]   = useState<Record<string, TradeResult[]>>({})
  const [expandedLoading, setExpandedLoading] = useState<string | null>(null)

  const [latestGs, setLatestGs] = useState<GridsearchLatestData | null>(null)

  useEffect(() => {
    fetch('/api/gridsearch/latest')
      .then((r) => r.json())
      .then((j) => { if (j.success && j.data) setLatestGs(j.data) })
      .catch(() => {})
  }, [])

  function handleExcludeStock(v: boolean) { setExcludeStock(v); if (v) setStockOnly(false) }
  function handleStockOnly(v: boolean)    { setStockOnly(v);    if (v) setExcludeStock(false) }

  async function handleRun() {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryHours, slPct, tpPct, minPumpPct, minFdvMcRatio, minFR, excludeStock, stockOnly }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setResult({ summary: json.summary, heatmap: json.heatmap, timing: json.timing })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleExpand(r: GridSearchResult) {
    const key = `${r.entryHours}-${r.slPct}-${r.tpPct}`
    if (expandedKey === key) { setExpandedKey(null); return }
    if (expandedTrades[key]) { setExpandedKey(key); return }
    setExpandedLoading(key)
    try {
      const res  = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryHours: r.entryHours, slPct: r.slPct, tpPct: r.tpPct, minPumpPct, minFdvMcRatio, minFR, excludeStock, stockOnly }),
      })
      const json = await res.json()
      if (json.success) {
        setExpandedTrades((prev) => ({ ...prev, [key]: json.summary.trades }))
        setExpandedKey(key)
      }
    } finally {
      setExpandedLoading(null)
    }
  }

  async function handleGridSearch() {
    setGsLoading(true)
    setGsError(null)
    try {
      const res  = await fetch('/api/gridsearch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minPumpPct, minFdvMcRatio, minFR, excludeStock, stockOnly }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setGsResults(json.results)
      setGsListingCount(json.listingCount)
    } catch (e) {
      setGsError(String(e))
    } finally {
      setGsLoading(false)
    }
  }

  const { summary, heatmap, timing } = result ?? {}

  const gsSorted = gsResults
    ? [...gsResults].sort((a, b) =>
        gsSortBy === 'ev'      ? b.expectedValue - a.expectedValue :
        gsSortBy === 'avgPnl'  ? b.avgPnl - a.avgPnl :
                                 b.winRate - a.winRate
      )
    : []
  const gsDisplayed = gsShowAll ? gsSorted : gsSorted.slice(0, 100)

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-ink mb-1">バックテスト</h1>
          <p className="text-ink-dim text-sm">エントリータイミング・SL/TPを最適化します</p>
        </div>

        {/* 最新グリッドサーチ結果（GitHub Actions 自動計算） */}
        {latestGs && (
          <div className="bg-panel rounded-xl border border-rim mb-6 overflow-hidden">
            <div className="px-5 py-4 border-b border-rim bg-panel-raised flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-ink">最新グリッドサーチ結果</h2>
                <p className="text-xs text-ink-faint mt-0.5">
                  自動収集後に計算 · {formatTimeAgo(latestGs.savedAt)} 更新
                  {' '}· データ {latestGs.listingCount} 件
                  {' '}· 初動ポンプ {latestGs.params.minPumpPct}%以上
                </p>
              </div>
              <span className="text-xs text-ink-faint bg-panel px-2.5 py-1 rounded-lg font-mono border border-rim">
                {latestGs.params.entryHours.join('/')}h
                {' '}× SL {latestGs.params.slRange.join('/')}%
                {' '}× TP {latestGs.params.tpRange.join('/')}%
              </span>
            </div>
            <div className="p-4 space-y-2">
              {latestGs.results.slice(0, 10).map((r, i) => {
                const medal = i < 3 ? MEDAL[i] : null
                return (
                  <div
                    key={i}
                    className={`bg-panel rounded-xl p-4 border ${medal ? `${medal.border} ${medal.bg}` : 'border-rim'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`text-2xl font-bold font-mono w-8 text-center flex-shrink-0 ${medal?.num ?? 'text-ink-faint'}`}>
                        {i + 1}
                      </div>
                      <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                        <Badge label="エントリー" value={`${r.entryHours}h後`} />
                        <Badge label="SL" value={`${r.slPct}%`} color="text-red-400" />
                        <Badge label="TP" value={`${r.tpPct}%`} color="text-green-400" />
                        <Badge label="勝率" value={`${r.winRate.toFixed(1)}%`} color={r.winRate >= 50 ? 'text-green-400' : 'text-ink-dim'} />
                        <Badge label="期待値" value={`${r.expectedValue >= 0 ? '+' : ''}${r.expectedValue.toFixed(2)}%`} color={r.expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                        <Badge label="N件" value={String(r.tradeCount)} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 設定 3カラム */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

          {/* エントリー設定 */}
          <div className="bg-panel rounded-xl p-5 border border-rim space-y-5">
            <h2 className="font-semibold text-ink">エントリー設定</h2>
            <SliderField label="エントリータイミング" value={entryHours} min={1} max={60} unit="時間後" onChange={setEntryHours} disabled={loading} />
            <SliderField label="SL（ショート損切り）" value={slPct} min={5} max={50} step={5} unit="%" onChange={setSlPct} disabled={loading} />
            <SliderField label="TP（ショート利確）" value={tpPct} min={10} max={70} step={5} unit="%" onChange={setTpPct} disabled={loading} />
          </div>

          {/* フィルター */}
          <div className="bg-panel rounded-xl p-5 border border-rim space-y-4">
            <h2 className="font-semibold text-ink">フィルター（任意）</h2>
            <div className="space-y-2">
              <p className="text-xs text-ink-faint uppercase tracking-wide">銘柄タイプ</p>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={excludeStock} disabled={loading} onChange={(e) => handleExcludeStock(e.target.checked)} className="w-4 h-4 accent-blue-500" />
                <span className="text-sm text-ink-dim">STOCK銘柄を除外</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={stockOnly} disabled={loading} onChange={(e) => handleStockOnly(e.target.checked)} className="w-4 h-4 accent-purple-500" />
                <span className="text-sm text-ink-dim">STOCK銘柄のみ</span>
              </label>
            </div>
            <div className="border-t border-rim pt-3 space-y-4">
              <p className="text-xs text-ink-faint uppercase tracking-wide">数値フィルター</p>
              <SliderField label="初動ポンプ幅 以上" value={minPumpPct} min={0} max={200} step={10} unit="%" onChange={setMinPumpPct} disabled={loading} />
              <div className="opacity-40">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-ink-dim">FDV/MC 以上</span>
                  <span className="text-ink-faint text-xs">データなし</span>
                </div>
                <input type="range" min={0} max={20} value={0} disabled className="w-full accent-blue-500 cursor-not-allowed" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-ink-dim">|FR| 以上</span>
                  <span className="text-ink font-mono">{minFR.toFixed(2)}%</span>
                </div>
                <input type="range" min={0} max={0.5} step={0.01} value={minFR} onChange={(e) => setMinFR(Number(e.target.value))} disabled={loading} className="w-full accent-blue-500" />
                <p className="text-xs text-ink-faint mt-1">収集時スナップショット値</p>
              </div>
            </div>
          </div>

          {/* 実行ボタン + 結果 */}
          <div className="bg-panel rounded-xl p-5 border border-rim flex flex-col">
            <h2 className="font-semibold text-ink mb-4">実行</h2>
            <button
              onClick={handleRun}
              disabled={loading || gsLoading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-panel-raised disabled:text-ink-faint disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-white mb-2"
            >
              {loading ? '計算中...' : 'バックテスト実行'}
            </button>
            <button
              onClick={handleGridSearch}
              disabled={loading || gsLoading}
              className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-panel-raised disabled:text-ink-faint disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-white mb-5"
            >
              {gsLoading ? 'グリッドサーチ中...' : 'グリッドサーチ実行'}
            </button>

            {error && (
              <div className="text-red-400 text-sm bg-red-950/60 border border-red-800 rounded-lg p-3 mb-4">
                {error}
              </div>
            )}

            {summary && (
              <div className="bg-panel-raised rounded-xl p-5 border border-rim flex-1 flex flex-col items-center justify-center gap-4 text-center">
                <div>
                  <div className={`text-5xl font-bold font-mono ${summary.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                    {summary.winRate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-ink-faint mt-1">勝率</div>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                  <Badge
                    label="期待値"
                    value={`${summary.avgPnl >= 0 ? '+' : ''}${summary.avgPnl.toFixed(2)}%`}
                    color={summary.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
                  />
                  <Badge label="最大DD" value={`-${summary.maxDrawdown.toFixed(1)}%`} color="text-amber-400" />
                  <Badge label="件数" value={String(summary.tradeCount)} />
                </div>
              </div>
            )}
          </div>
        </div>

        {result && (
          <>
            {/* ヒートマップ */}
            <div className="bg-panel rounded-xl p-5 border border-rim mb-6">
              <h2 className="font-semibold text-ink mb-1">SL × TP ヒートマップ（勝率 %）</h2>
              <p className="text-xs text-ink-faint mb-4">
                エントリー {entryHours}時間後 固定 ／ 現在選択: SL {slPct}% × TP {tpPct}%（青枠）
              </p>
              <HeatmapGrid cells={heatmap!} activeSl={slPct} activeTp={tpPct} />
            </div>

            {/* タイミングチャート */}
            <div className="bg-panel rounded-xl p-5 border border-rim mb-6">
              <h2 className="font-semibold text-ink mb-1">エントリータイミング別 勝率</h2>
              <p className="text-xs text-ink-faint mb-4">
                SL {slPct}% × TP {tpPct}% 固定 ／ X軸: 上場後N時間後エントリー
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={timing} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-rim)" />
                  <XAxis dataKey="hours" tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={(v) => `${v}h`} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={(v) => `${v}%`} width={42} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--c-panel-raised)', border: '1px solid var(--c-rim)', borderRadius: 8, color: 'var(--c-ink)' }}
                    labelFormatter={(v) => `上場後 ${v}時間後`}
                    formatter={(v, name) => {
                      const val = typeof v === 'number' ? v.toFixed(1) : String(v)
                      if (name === 'winRate') return [`${val}%`, '勝率']
                      if (name === 'avgPnl')  return [`${val}%`, '平均PnL']
                      return [val, String(name)]
                    }}
                  />
                  <ReferenceLine y={50} stroke="var(--c-ink-faint)" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="winRate" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} name="winRate" />
                  <Line type="monotone" dataKey="avgPnl"  stroke="#22c55e" strokeWidth={2} dot={{ r: 3, fill: '#22c55e' }} strokeDasharray="4 4" name="avgPnl" />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 text-xs text-ink-faint">
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-500 inline-block" /> 勝率 (%)</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-green-500 inline-block" /> 平均PnL (%)</span>
              </div>
            </div>

            {/* トレード一覧 */}
            <div className="bg-panel rounded-xl border border-rim overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-rim bg-panel-raised">
                <h2 className="font-semibold text-ink">
                  トレード一覧
                  <span className="ml-2 text-sm font-normal text-ink-faint">{summary!.trades.length} 件</span>
                </h2>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel">
                    <tr className="text-ink-faint text-left border-b border-rim">
                      <th className="px-5 py-2.5 font-medium">銘柄</th>
                      <th className="px-3 py-2.5 text-right font-medium">エントリー</th>
                      <th className="px-3 py-2.5 text-right font-medium">決済</th>
                      <th className="px-3 py-2.5 text-center font-medium">結果</th>
                      <th className="px-5 py-2.5 text-right font-medium">PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rim">
                    {(summary!.trades as TradeResult[]).map((t, i) => (
                      <tr key={i} className="hover:bg-panel-raised transition-colors">
                        <td className="px-5 py-2 font-mono text-ink">{t.symbol}</td>
                        <td className="px-3 py-2 text-right font-mono text-ink-dim">{t.entryPrice.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-mono text-ink-dim">{t.exitPrice.toFixed(4)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`font-medium ${OUTCOME_COLOR[t.outcome]}`}>{OUTCOME_LABEL[t.outcome]}</span>
                        </td>
                        <td className={`px-5 py-2 text-right font-mono font-medium ${t.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* グリッドサーチ結果 */}
        {(gsResults || gsError) && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-semibold text-ink text-lg">
                  グリッドサーチ結果
                  {gsResults && (
                    <span className="ml-2 text-sm font-normal text-ink-faint">
                      {gsResults.length.toLocaleString()} 組み合わせ ／ データ {gsListingCount} 件
                    </span>
                  )}
                </h2>
                <p className="text-xs text-ink-faint mt-0.5">
                  エントリー 1〜60h × SL 5〜50%（5%刻み）× TP 10〜70%（10%刻み）
                </p>
              </div>
              {gsResults && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-ink-faint">ソート:</span>
                  {(['ev', 'avgPnl', 'winRate'] as const).map((key) => (
                    <button
                      key={key}
                      onClick={() => setGsSortBy(key)}
                      className={`px-3 py-1 rounded-lg transition-colors ${gsSortBy === key ? 'bg-emerald-700 text-white' : 'bg-panel-raised text-ink-dim hover:text-ink'}`}
                    >
                      {key === 'ev' ? '期待値' : key === 'avgPnl' ? '平均PnL' : '勝率'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {gsError && (
              <div className="text-red-400 text-sm bg-red-950/60 border border-red-800 rounded-lg p-3 mb-4">{gsError}</div>
            )}

            {gsResults && (
              <>
                {/* TOP10 ランキングカード */}
                <div className="space-y-2 mb-4">
                  {gsDisplayed.slice(0, 10).map((r, i) => {
                    const key = `${r.entryHours}-${r.slPct}-${r.tpPct}`
                    return (
                      <RankCard
                        key={key}
                        r={r}
                        rank={i + 1}
                        isExpanded={expandedKey === key}
                        isExpandLoading={expandedLoading === key}
                        trades={expandedTrades[key] ?? []}
                        onExpand={() => handleExpand(r)}
                      />
                    )
                  })}
                </div>

                {/* 11位以降 テーブル */}
                {gsDisplayed.length > 10 && (
                  <div className="bg-panel rounded-xl border border-rim overflow-hidden">
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-panel-raised z-10">
                          <tr className="text-ink-faint text-left border-b border-rim">
                            <th className="px-4 py-2.5 w-10 font-medium">#</th>
                            <th className="px-2 py-2.5 font-medium">エントリー</th>
                            <th className="px-2 py-2.5 text-right font-medium">SL</th>
                            <th className="px-2 py-2.5 text-right font-medium">TP</th>
                            <th className="px-2 py-2.5 text-right font-medium">勝率</th>
                            <th className="px-2 py-2.5 text-right font-medium">平均PnL</th>
                            <th className="px-2 py-2.5 text-right font-medium">期待値</th>
                            <th className="px-4 py-2.5 text-right font-medium">N</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rim">
                          {gsDisplayed.slice(10).map((r, idx) => {
                            const rank  = idx + 11
                            const key   = `${r.entryHours}-${r.slPct}-${r.tpPct}`
                            const isExp = expandedKey === key
                            const isLd  = expandedLoading === key
                            const trs   = expandedTrades[key] ?? []
                            return (
                              <Fragment key={key}>
                                <tr
                                  onClick={() => handleExpand(r)}
                                  className="cursor-pointer hover:bg-panel-raised transition-colors select-none"
                                >
                                  <td className="px-4 py-2 font-mono text-xs text-ink-faint">{rank}</td>
                                  <td className="px-2 py-2 text-ink-dim">{r.entryHours}h後</td>
                                  <td className="px-2 py-2 text-right font-mono text-red-400">{r.slPct}%</td>
                                  <td className="px-2 py-2 text-right font-mono text-green-400">{r.tpPct}%</td>
                                  <td className={`px-2 py-2 text-right font-mono ${r.winRate >= 50 ? 'text-green-400' : 'text-ink-dim'}`}>{r.winRate.toFixed(1)}%</td>
                                  <td className={`px-2 py-2 text-right font-mono ${r.avgPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{r.avgPnl >= 0 ? '+' : ''}{r.avgPnl.toFixed(2)}%</td>
                                  <td className={`px-2 py-2 text-right font-mono font-medium ${r.expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{r.expectedValue >= 0 ? '+' : ''}{r.expectedValue.toFixed(2)}%</td>
                                  <td className="px-4 py-2 text-right text-ink-faint text-xs">
                                    <span className="mr-1">{r.tradeCount}</span>
                                    <span>{isLd ? '…' : isExp ? '▲' : '▼'}</span>
                                  </td>
                                </tr>
                                {isExp && (
                                  <tr>
                                    <td colSpan={8} className="p-0">
                                      <div className="px-4 py-3 bg-panel-raised border-b border-rim">
                                        <p className="text-xs text-ink-faint mb-2 font-medium">
                                          {r.entryHours}h後 / SL {r.slPct}% / TP {r.tpPct}% — {trs.length} トレード
                                        </p>
                                        <TradeTable trades={trs} />
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {gsSorted.length > 100 && (
                  <button
                    onClick={() => setGsShowAll((v) => !v)}
                    className="mt-3 text-sm text-ink-faint hover:text-ink transition-colors"
                  >
                    {gsShowAll ? '▲ 上位100件に戻す' : `▼ 全 ${gsSorted.length.toLocaleString()} 件を表示`}
                  </button>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
