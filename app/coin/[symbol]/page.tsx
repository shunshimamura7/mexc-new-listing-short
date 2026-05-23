'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { ListingData, ScoreDetail, CoinGeckoData } from '@/types'

type CoinDetailResponse = {
  success: boolean
  listing: ListingData
  score: {
    detail: ScoreDetail
    total: number
    volRatio: number
  }
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 1)    return p.toFixed(4)
  if (p >= 0.001) return p.toFixed(6)
  return p.toFixed(8)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatLargeNum(n: number | null): string {
  if (n === null) return 'N/A'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-panel rounded-xl border border-rim p-4">
      <div className="text-xs text-ink-faint mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${color ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
    </div>
  )
}

export default function CoinDetailPage() {
  const { symbol } = useParams<{ symbol: string }>()
  const router = useRouter()

  const [data, setData]       = useState<CoinDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [gecko, setGecko]     = useState<CoinGeckoData | null>(null)

  useEffect(() => {
    fetch(`/api/coin/${symbol}`)
      .then((r) => r.json())
      .then((j: CoinDetailResponse) => {
        if (j.success) setData(j)
        else setError('データが見つかりません')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))

    fetch(`/api/coingecko/${symbol}`)
      .then((r) => r.json())
      .then((j) => { if (j.success) setGecko({ fdvUsd: j.fdvUsd, marketCapUsd: j.marketCapUsd }) })
      .catch(() => {})
  }, [symbol])

  if (loading) {
    return (
      <div className="min-h-screen p-6 flex items-center justify-center">
        <div className="text-ink-dim">読み込み中...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen p-6">
        <div className="max-w-5xl mx-auto">
          <button onClick={() => router.back()} className="text-ink-faint text-sm hover:text-ink mb-4 flex items-center gap-1">
            ← 戻る
          </button>
          <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 text-red-400">
            {error ?? 'データが見つかりません'}
          </div>
        </div>
      </div>
    )
  }

  const { listing, score } = data

  const chartData = listing.klines.map((k, i) => ({
    hour: i,
    close:  k.close,
    open:   k.open,
    high:   k.high,
    low:    k.low,
    volume: k.volume,
  }))

  const entryPrice = listing.klines[0]?.open || listing.klines[0]?.close || 0
  const lastPrice  = listing.klines[listing.klines.length - 1]?.close ?? 0
  const peakVol    = Math.max(...listing.klines.map((k) => k.volume))

  const scoreCriteria = [
    { icon: '①', label: '初動ポンプ +50%以上', passed: score.detail.initialPump,   value: `+${listing.initialPumpPct.toFixed(1)}%` },
    { icon: '②', label: '出来高枯渇（ピーク比30%以下）', passed: score.detail.volumeExhaust, value: `ピーク比 ${(score.volRatio * 100).toFixed(1)}%` },
    { icon: '③', label: '上場24時間以上経過', passed: score.detail.elapsed24h,    value: `${Math.floor((Date.now() - listing.listingTime) / 3_600_000)}h` },
    { icon: '④', label: 'FR > +0.05%', passed: score.detail.frHigh,        value: `${(listing.maxFR * 100).toFixed(4)}%` },
    { icon: '⑤', label: 'BTC環境（要ライブデータ）', passed: false, value: '—' },
  ]

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto">

        {/* ヘッダー */}
        <div className="mb-6">
          <button onClick={() => router.back()} className="text-ink-faint text-sm hover:text-ink mb-3 flex items-center gap-1 transition-colors">
            ← 戻る
          </button>
          <h1 className="text-3xl font-bold font-mono text-ink">{listing.symbol}</h1>
          <p className="text-ink-dim text-sm mt-1">上場日時: {formatDate(listing.listingTime)}</p>
        </div>

        {/* 統計カード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="初動ポンプ"
            value={`+${listing.initialPumpPct.toFixed(1)}%`}
            color={listing.initialPumpPct >= 50 ? 'text-amber-400' : 'text-ink'}
          />
          <StatCard
            label="スコア"
            value={`${score.total}/5`}
            sub="BTC除く最大4点"
            color={score.total >= 3 ? 'text-amber-400' : 'text-ink-dim'}
          />
          <StatCard
            label="FR (max)"
            value={listing.maxFR !== 0 ? `${(listing.maxFR * 100).toFixed(4)}%` : 'N/A'}
            color={listing.maxFR > 0.0005 ? 'text-green-400' : 'text-ink-dim'}
          />
          <StatCard
            label="OI (max)"
            value={listing.maxOI > 0 ? `$${(listing.maxOI / 1e6).toFixed(2)}M` : 'N/A'}
          />
        </div>

        {/* FDV / MC */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatCard
            label="FDV (CoinGecko)"
            value={gecko ? formatLargeNum(gecko.fdvUsd) : '取得中...'}
          />
          <StatCard
            label="時価総額 (CoinGecko)"
            value={gecko ? formatLargeNum(gecko.marketCapUsd) : '取得中...'}
          />
        </div>

        {/* 価格チャート */}
        <div className="bg-panel rounded-xl border border-rim p-5 mb-6">
          <h2 className="font-semibold text-ink mb-1">価格チャート（1h足）</h2>
          <p className="text-xs text-ink-faint mb-4">
            上場時 {formatPrice(entryPrice)} → 現在 {formatPrice(lastPrice)}
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-rim)" />
              <XAxis
                dataKey="hour"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={(v) => `${v}h`}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={(v) => formatPrice(v)}
                width={72}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--c-panel-raised)', border: '1px solid var(--c-rim)', borderRadius: 8, color: 'var(--c-ink)' }}
                labelFormatter={(v) => `上場後 ${v}時間`}
                formatter={(v) => [formatPrice(Number(v)), '終値']}
              />
              {entryPrice > 0 && (
                <ReferenceLine y={entryPrice} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: '上場', fill: '#94a3b8', fontSize: 10 }} />
              )}
              <Line type="monotone" dataKey="close" stroke="#f59e0b" strokeWidth={2} dot={false} name="終値" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 出来高チャート */}
        <div className="bg-panel rounded-xl border border-rim p-5 mb-6">
          <h2 className="font-semibold text-ink mb-1">出来高推移</h2>
          <p className="text-xs text-ink-faint mb-4">
            ピーク: {peakVol > 1e6 ? `${(peakVol / 1e6).toFixed(2)}M` : peakVol.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-rim)" />
              <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--c-panel-raised)', border: '1px solid var(--c-rim)', borderRadius: 8, color: 'var(--c-ink)' }}
                labelFormatter={(v) => `上場後 ${v}時間`}
                formatter={(v) => [Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }), '出来高']}
              />
              <Bar dataKey="volume" fill="#6366f1" radius={[2, 2, 0, 0]} name="出来高" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* スコアリング */}
        <div className="bg-panel rounded-xl border border-rim p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-ink">スコアリング結果</h2>
            <div className="flex items-center gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className={`w-3 h-3 rounded-full ${i < score.total ? 'bg-amber-400' : 'bg-rim'}`} />
              ))}
              <span className="ml-1 font-bold text-ink">{score.total}/5</span>
            </div>
          </div>
          <div className="space-y-2">
            {scoreCriteria.map(({ icon, label, passed, value }) => (
              <div key={icon} className="flex items-center justify-between text-sm py-1.5 border-b border-rim last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono ${passed ? 'text-amber-400' : 'text-ink-faint'}`}>{icon}</span>
                  <span className={passed ? 'text-ink' : 'text-ink-faint'}>{label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-faint">{value}</span>
                  <span className={`text-sm font-bold w-4 text-center ${passed ? 'text-green-400' : 'text-ink-faint'}`}>
                    {passed ? '✓' : '✗'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-3">
            ※ ⑤BTC環境はライブデータが必要なためスコアリングページで確認してください
          </p>
        </div>

      </div>
    </div>
  )
}
