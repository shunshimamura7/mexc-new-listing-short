'use client'

import { useState, useEffect } from 'react'
import type { CoinAnalysis, CategorySummary, LongResearchData } from '@/app/api/long-research/route'

type Tab = 'stock' | 'commodity_metal' | 'commodity_energy'

const TAB_LABELS: Record<Tab, string> = {
  stock:            'STOCK',
  commodity_metal:  '貴金属',
  commodity_energy: 'エネルギー・その他',
}

function fmt1(n: number) { return n.toFixed(1) }

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

function TrendBadge({ trend }: { trend: CoinAnalysis['trend'] }) {
  const cls = trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-ink-dim'
  const label = trend === 'up' ? '上昇' : trend === 'down' ? '下落' : '横ばい'
  return <span className={`font-medium ${cls}`}>{label}</span>
}

type SortKey = 'range24h' | 'range48h' | 'pump24h' | 'dump24h' | 'range72h' | 'klineCount'

function CoinTable({ coins }: { coins: CoinAnalysis[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('range24h')
  const [asc, setAsc] = useState(false)

  function handleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v)
    else { setSortKey(key); setAsc(false) }
  }

  const sorted = [...coins].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey]
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

  if (coins.length === 0) {
    return <p className="text-ink-faint text-sm py-8 text-center">データなし</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-panel-raised">
          <tr className="border-b border-rim">
            <th className="pb-2 pr-3 text-left font-normal text-ink-faint">銘柄</th>
            <th className="pb-2 pr-3 text-left font-normal text-ink-faint whitespace-nowrap">上場日時</th>
            <Th k="range24h"   label="24h値幅" />
            <Th k="range48h"   label="48h値幅" />
            <Th k="pump24h"    label="24h最大上昇" />
            <Th k="dump24h"    label="24h最大下落" />
            <Th k="range72h"   label="72h値幅" />
            <th className="pb-2 pr-3 text-center font-normal text-ink-faint">トレンド</th>
            <Th k="klineCount" label="kline本数" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.symbol} className="border-b border-rim hover:bg-panel-raised/50 transition-colors">
              <td className="py-1.5 pr-3 font-mono text-ink font-medium">{c.symbol}</td>
              <td className="py-1.5 pr-3 text-ink-faint whitespace-nowrap">
                {new Date(c.listingTime).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </td>
              <td className="py-1.5 pr-3 text-right font-mono text-amber-400">{fmt1(c.range24h)}%</td>
              <td className="py-1.5 pr-3 text-right font-mono text-ink-dim">{fmt1(c.range48h)}%</td>
              <td className="py-1.5 pr-3 text-right font-mono text-green-400">+{fmt1(c.pump24h)}%</td>
              <td className="py-1.5 pr-3 text-right font-mono text-red-400">-{fmt1(c.dump24h)}%</td>
              <td className="py-1.5 pr-3 text-right font-mono text-ink-dim">{fmt1(c.range72h)}%</td>
              <td className="py-1.5 pr-3 text-center"><TrendBadge trend={c.trend} /></td>
              <td className="py-1.5 text-right font-mono text-ink-faint">{c.klineCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function LongResearchPage() {
  const [data, setData]       = useState<LongResearchData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [tab, setTab]         = useState<Tab>('stock')

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

  const activeCoins   = data ? data[tab] : []
  const activeSummary = data?.summary[tab]
  const overallAvg24h = activeSummary?.avgRange24h ?? 0

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
          <div className="text-ink-faint text-sm">読み込み中...</div>
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

          {/* Tabs + Table */}
          <div className="bg-panel border border-rim rounded-xl overflow-hidden">
            {/* Tab bar */}
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
                  <span className="ml-1.5 text-xs text-ink-faint">
                    ({data[t].length})
                  </span>
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="p-4">
              <CoinTable coins={activeCoins} />
            </div>
          </div>
        </>
      )}
    </main>
  )
}
