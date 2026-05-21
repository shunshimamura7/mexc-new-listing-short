'use client'

import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { BacktestResponse, TradeResult, HeatmapCell, GridSearchResult } from '@/types'

// ヒートマップの軸
const SL_RANGE = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
const TP_RANGE = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]

function winRateColor(rate: number, count: number): string {
  if (count === 0) return 'bg-gray-800 text-gray-600'
  // 0% → red, 50% → yellow, 100% → green  (HSL hue 0→120)
  const hue = Math.round(rate * 1.2)
  return `hsl(${hue},70%,35%)`
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
            <th className="text-gray-500 text-right pr-2 pb-1 font-normal">SL↓TP→</th>
            {TP_RANGE.map((tp) => (
              <th
                key={tp}
                className={`text-center pb-1 font-normal w-10 ${tp === activeTp ? 'text-blue-400 font-semibold' : 'text-gray-500'}`}
              >
                {tp}%
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SL_RANGE.map((sl) => (
            <tr key={sl}>
              <td className={`text-right pr-2 py-0.5 font-normal ${sl === activeSl ? 'text-blue-400 font-semibold' : 'text-gray-500'}`}>
                {sl}%
              </td>
              {TP_RANGE.map((tp) => {
                const cell = cellMap.get(`${sl}-${tp}`)
                const wr = cell?.winRate ?? 0
                const cnt = cell?.tradeCount ?? 0
                const isActive = sl === activeSl && tp === activeTp
                const bgColor = cnt > 0 ? winRateColor(wr, cnt) : undefined
                return (
                  <td key={tp} className="p-0">
                    <div
                      title={`SL${sl}% / TP${tp}%\n勝率: ${wr.toFixed(1)}%\n平均PnL: ${cell?.avgPnl.toFixed(1) ?? '—'}%\nトレード数: ${cnt}`}
                      style={bgColor ? { backgroundColor: bgColor } : undefined}
                      className={`w-10 h-7 flex items-center justify-center rounded text-center font-mono
                        ${!bgColor ? 'bg-gray-800 text-gray-600' : 'text-white'}
                        ${isActive ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-gray-950 z-10 relative' : ''}
                      `}
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

function SliderField({
  label, value, min, max, step = 1, unit = '', onChange, disabled,
}: {
  label: string; value: number; min: number; max: number
  step?: number; unit?: string; onChange: (v: number) => void; disabled: boolean
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-mono">{value}{unit}</span>
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

const OUTCOME_LABEL: Record<string, string> = { tp: 'TP', sl: 'SL', forced: '強制' }
const OUTCOME_COLOR: Record<string, string> = {
  tp: 'text-green-400', sl: 'text-red-400', forced: 'text-yellow-400',
}

export default function BacktestPage() {
  const [entryHours, setEntryHours]         = useState(1)
  const [slPct, setSlPct]                   = useState(20)
  const [tpPct, setTpPct]                   = useState(30)
  const [minPumpPct, setMinPumpPct]         = useState(0)
  const [minFdvMcRatio, setMinFdvMcRatio]   = useState(0)
  const [minFR, setMinFR]                   = useState(0)
  const [excludeStock, setExcludeStock]     = useState(false)
  const [stockOnly, setStockOnly]           = useState(false)

  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [result, setResult]     = useState<BacktestResponse | null>(null)

  const [gsLoading, setGsLoading]   = useState(false)
  const [gsError, setGsError]       = useState<string | null>(null)
  const [gsResults, setGsResults]   = useState<GridSearchResult[] | null>(null)
  const [gsListingCount, setGsListingCount] = useState(0)
  const [gsSortBy, setGsSortBy]     = useState<'ev' | 'avgPnl' | 'winRate'>('ev')
  const [gsShowAll, setGsShowAll]   = useState(false)

  function handleExcludeStock(v: boolean) {
    setExcludeStock(v)
    if (v) setStockOnly(false)
  }
  function handleStockOnly(v: boolean) {
    setStockOnly(v)
    if (v) setExcludeStock(false)
  }

  async function handleRun() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/backtest', {
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

  async function handleGridSearch() {
    setGsLoading(true)
    setGsError(null)
    try {
      const res = await fetch('/api/gridsearch', {
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
    ? [...gsResults].sort((a, b) => {
        if (gsSortBy === 'ev')      return b.expectedValue - a.expectedValue
        if (gsSortBy === 'avgPnl')  return b.avgPnl - a.avgPnl
        return b.winRate - a.winRate
      })
    : []
  const gsDisplayed = gsShowAll ? gsSorted : gsSorted.slice(0, 100)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-white">バックテスト</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* パラメータ */}
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-5">
            <h2 className="font-semibold text-gray-200">エントリー設定</h2>
            <SliderField label="エントリータイミング" value={entryHours} min={1} max={60} unit="時間後" onChange={setEntryHours} disabled={loading} />
            <SliderField label="SL（ショート損切り）" value={slPct} min={5} max={50} step={5} unit="%" onChange={setSlPct} disabled={loading} />
            <SliderField label="TP（ショート利確）" value={tpPct} min={10} max={70} step={5} unit="%" onChange={setTpPct} disabled={loading} />
          </div>

          {/* フィルター */}
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
            <h2 className="font-semibold text-gray-200">フィルター（任意）</h2>

            {/* STOCK フィルター */}
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">銘柄タイプ</p>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox" checked={excludeStock} disabled={loading}
                  onChange={(e) => handleExcludeStock(e.target.checked)}
                  className="w-4 h-4 accent-blue-500"
                />
                <span className="text-sm text-gray-300">STOCK銘柄を除外</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox" checked={stockOnly} disabled={loading}
                  onChange={(e) => handleStockOnly(e.target.checked)}
                  className="w-4 h-4 accent-purple-500"
                />
                <span className="text-sm text-gray-300">STOCK銘柄のみ</span>
              </label>
            </div>

            <div className="border-t border-gray-800 pt-3 space-y-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">数値フィルター</p>
              <SliderField label="初動ポンプ幅 以上" value={minPumpPct} min={0} max={200} step={10} unit="%" onChange={setMinPumpPct} disabled={loading} />

              {/* FDV/MC: データ未取得のためグレーアウト */}
              <div className="opacity-40">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">FDV/MC 以上</span>
                  <span className="text-gray-500 text-xs">データなし</span>
                </div>
                <input type="range" min={0} max={20} value={0} disabled className="w-full accent-blue-500 cursor-not-allowed" />
              </div>

              {/* FR: 小数形式で保存（0.001406 = 0.1406%）、スライダーは % 単位 */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">|FR| 以上</span>
                  <span className="text-white font-mono">{minFR.toFixed(2)}%</span>
                </div>
                <input
                  type="range" min={0} max={0.5} step={0.01} value={minFR}
                  onChange={(e) => setMinFR(Number(e.target.value))}
                  disabled={loading}
                  className="w-full accent-blue-500"
                />
                <p className="text-xs text-gray-600 mt-1">収集時スナップショット値</p>
              </div>
            </div>
          </div>

          {/* 実行 + サマリー */}
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 flex flex-col">
            <h2 className="font-semibold text-gray-200 mb-4">結果</h2>
            <button
              onClick={handleRun}
              disabled={loading || gsLoading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors mb-2"
            >
              {loading ? '計算中...' : 'バックテスト実行'}
            </button>
            <button
              onClick={handleGridSearch}
              disabled={loading || gsLoading}
              className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors mb-5"
            >
              {gsLoading ? `グリッドサーチ中...` : 'グリッドサーチ実行'}
            </button>

            {error && (
              <div className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg p-3 mb-4">
                {error}
              </div>
            )}

            {summary && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800 rounded-lg p-3 text-center">
                  <div className={`text-2xl font-bold ${summary.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                    {summary.winRate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">勝率</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-3 text-center">
                  <div className={`text-2xl font-bold ${summary.avgPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {summary.avgPnl >= 0 ? '+' : ''}{summary.avgPnl.toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">平均PnL</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-orange-400">
                    -{summary.maxDrawdown.toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">最大DD</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-200">{summary.tradeCount}</div>
                  <div className="text-xs text-gray-500 mt-1">トレード数</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {result && (
          <>
            {/* ヒートマップ */}
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 mb-6">
              <h2 className="font-semibold text-gray-200 mb-1">SL × TP ヒートマップ（勝率 %）</h2>
              <p className="text-xs text-gray-500 mb-4">
                エントリー {entryHours}時間後 固定 ／ 現在選択: SL {slPct}% × TP {tpPct}%（青枠）
              </p>
              <HeatmapGrid cells={heatmap!} activeSl={slPct} activeTp={tpPct} />
            </div>

            {/* エントリータイミング別グラフ */}
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 mb-6">
              <h2 className="font-semibold text-gray-200 mb-1">エントリータイミング別 勝率</h2>
              <p className="text-xs text-gray-500 mb-4">
                SL {slPct}% × TP {tpPct}% 固定 ／ X軸: 上場後N時間後エントリー
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={timing} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="hours"
                    tick={{ fill: '#9ca3af', fontSize: 12 }}
                    tickFormatter={(v) => `${v}h`}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: '#9ca3af', fontSize: 12 }}
                    tickFormatter={(v) => `${v}%`}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                    labelFormatter={(v) => `上場後 ${v}時間後`}
                    formatter={(v, name) => {
                      const val = typeof v === 'number' ? v.toFixed(1) : String(v)
                      if (name === 'winRate') return [`${val}%`, '勝率']
                      if (name === 'avgPnl') return [`${val}%`, '平均PnL']
                      return [val, String(name)]
                    }}
                  />
                  <ReferenceLine y={50} stroke="#6b7280" strokeDasharray="4 4" />
                  <Line
                    type="monotone" dataKey="winRate" stroke="#3b82f6"
                    strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} name="winRate"
                  />
                  <Line
                    type="monotone" dataKey="avgPnl" stroke="#22c55e"
                    strokeWidth={2} dot={{ r: 3, fill: '#22c55e' }} strokeDasharray="4 4" name="avgPnl"
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-500 inline-block" /> 勝率 (%)</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-green-500 inline-block border-dashed" /> 平均PnL (%)</span>
              </div>
            </div>

            {/* トレード一覧 */}
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <h2 className="font-semibold text-gray-200 mb-4">
                トレード一覧
                <span className="ml-2 text-sm font-normal text-gray-500">{summary!.trades.length} 件</span>
              </h2>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="text-gray-500 text-left border-b border-gray-800">
                      <th className="pb-2 pr-4">銘柄</th>
                      <th className="pb-2 pr-4 text-right">エントリー</th>
                      <th className="pb-2 pr-4 text-right">決済</th>
                      <th className="pb-2 pr-4 text-center">結果</th>
                      <th className="pb-2 text-right">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary!.trades as TradeResult[]).map((t, i) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-1.5 pr-4 font-mono text-gray-200">{t.symbol}</td>
                        <td className="py-1.5 pr-4 text-right font-mono text-gray-400">
                          {t.entryPrice.toFixed(4)}
                        </td>
                        <td className="py-1.5 pr-4 text-right font-mono text-gray-400">
                          {t.exitPrice.toFixed(4)}
                        </td>
                        <td className="py-1.5 pr-4 text-center">
                          <span className={`font-medium ${OUTCOME_COLOR[t.outcome]}`}>
                            {OUTCOME_LABEL[t.outcome]}
                          </span>
                        </td>
                        <td className={`py-1.5 text-right font-mono font-medium ${t.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
          <div className="bg-gray-900 rounded-xl p-5 border border-emerald-900 mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-semibold text-gray-200">
                  グリッドサーチ結果
                  {gsResults && (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {gsResults.length.toLocaleString()} 組み合わせ ／ データ {gsListingCount} 件
                    </span>
                  )}
                </h2>
                <p className="text-xs text-gray-600 mt-0.5">
                  エントリー 1〜60h × SL 5〜50%（5%刻み）× TP 10〜70%（10%刻み）
                </p>
              </div>
              {gsResults && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">ソート:</span>
                  {(['ev', 'avgPnl', 'winRate'] as const).map((key) => (
                    <button
                      key={key}
                      onClick={() => setGsSortBy(key)}
                      className={`px-3 py-1 rounded-lg transition-colors ${
                        gsSortBy === key
                          ? 'bg-emerald-700 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {key === 'ev' ? '期待値' : key === 'avgPnl' ? '平均PnL' : '勝率'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {gsError && (
              <div className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg p-3 mb-4">
                {gsError}
              </div>
            )}

            {gsResults && (
              <>
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-900 z-10">
                      <tr className="text-gray-500 text-left border-b border-gray-800">
                        <th className="pb-2 pr-3 w-8">#</th>
                        <th className="pb-2 pr-3">エントリー</th>
                        <th className="pb-2 pr-3 text-right">SL</th>
                        <th className="pb-2 pr-3 text-right">TP</th>
                        <th className="pb-2 pr-3 text-right">勝率</th>
                        <th className="pb-2 pr-3 text-right">平均PnL</th>
                        <th className="pb-2 pr-3 text-right">期待値</th>
                        <th className="pb-2 text-right">N</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gsDisplayed.map((r, i) => {
                        const isTop10 = i < 10
                        return (
                          <tr
                            key={i}
                            className={`border-b border-gray-800/50 ${
                              isTop10
                                ? 'bg-emerald-950/60 hover:bg-emerald-950/80'
                                : 'hover:bg-gray-800/30'
                            }`}
                          >
                            <td className={`py-1.5 pr-3 font-mono text-xs ${isTop10 ? 'text-emerald-400 font-bold' : 'text-gray-600'}`}>
                              {i + 1}
                            </td>
                            <td className="py-1.5 pr-3 text-gray-300">
                              {r.entryHours}h後
                            </td>
                            <td className="py-1.5 pr-3 text-right font-mono text-red-400">
                              {r.slPct}%
                            </td>
                            <td className="py-1.5 pr-3 text-right font-mono text-green-400">
                              {r.tpPct}%
                            </td>
                            <td className={`py-1.5 pr-3 text-right font-mono ${r.winRate >= 50 ? 'text-green-400' : 'text-gray-400'}`}>
                              {r.winRate.toFixed(1)}%
                            </td>
                            <td className={`py-1.5 pr-3 text-right font-mono ${r.avgPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {r.avgPnl >= 0 ? '+' : ''}{r.avgPnl.toFixed(2)}%
                            </td>
                            <td className={`py-1.5 pr-3 text-right font-mono font-medium ${r.expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {r.expectedValue >= 0 ? '+' : ''}{r.expectedValue.toFixed(2)}%
                            </td>
                            <td className="py-1.5 text-right text-gray-500 text-xs">
                              {r.tradeCount}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {gsSorted.length > 100 && (
                  <button
                    onClick={() => setGsShowAll((v) => !v)}
                    className="mt-3 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {gsShowAll
                      ? '▲ 上位100件に戻す'
                      : `▼ 全 ${gsSorted.length.toLocaleString()} 件を表示`}
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
