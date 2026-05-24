'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Trade, TradeStatus, PaperTrade, PatternName } from '@/types'
import { ALL_PATTERNS, PATTERN_SPECS, grossPnlPct, roundTripCostPct, formatPrice as fmtPrice } from '@/lib/trading-engine'
import type { UnifiedTrade, UnifiedSummary } from '@/app/api/paper-trades/unified/route'

const PRICE_POLL_MS = 10_000

type Tab = 'open' | 'closed' | 'all'

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (price >= 1)    return price.toFixed(4)
  if (price >= 0.001) return price.toFixed(6)
  return price.toFixed(8)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function pnlColor(pnl: number | null): string {
  if (pnl === null) return 'text-ink-dim'
  return pnl >= 0 ? 'text-green-400' : 'text-red-400'
}

function statusBadge(status: TradeStatus) {
  if (status === 'open')          return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400">未決済</span>
  if (status === 'closed_tp')     return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400">TP決済</span>
  if (status === 'closed_sl')     return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400">SL決済</span>
  return                                 <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-panel-raised text-ink-faint border border-rim">手動決済</span>
}

function detectExitStatus(exitPrice: number, trade: Trade): TradeStatus {
  const tpDist = Math.abs(exitPrice - trade.tpPrice) / trade.entryPrice
  const slDist = Math.abs(exitPrice - trade.slPrice) / trade.entryPrice
  if (tpDist < 0.02) return 'closed_tp'
  if (slDist < 0.02) return 'closed_sl'
  return 'closed_manual'
}

// ===== Exit Modal =====
function ExitModal({
  trade,
  currentPrice,
  onClose,
  onSaved,
}: {
  trade: Trade
  currentPrice: number | null
  onClose: () => void
  onSaved: () => void
}) {
  const suggested = currentPrice ? formatPrice(currentPrice) : ''
  const [exitPriceStr, setExitPriceStr] = useState(suggested)
  const [saving, setSaving]             = useState(false)
  const [err, setErr]                   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const exitPrice = parseFloat(exitPriceStr)
    if (isNaN(exitPrice) || exitPrice <= 0) { setErr('有効な価格を入力してください'); return }
    setSaving(true)
    setErr(null)

    const pnlPct = (trade.entryPrice - exitPrice) / trade.entryPrice * 100
    const pnlUsd = trade.positionSize > 0 ? trade.positionSize * pnlPct / 100 : null
    const status = detectExitStatus(exitPrice, trade)

    try {
      const res  = await fetch(`/api/trades/${trade.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exitDate: new Date().toISOString(), exitPrice, status, pnlPct, pnlUsd }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onSaved()
    } catch (e) {
      setErr(String(e))
      setSaving(false)
    }
  }

  const exitPrice = parseFloat(exitPriceStr)
  const previewPnl = !isNaN(exitPrice) && exitPrice > 0
    ? (trade.entryPrice - exitPrice) / trade.entryPrice * 100
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-panel border border-rim rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="font-mono font-bold text-lg text-ink">{trade.symbol}</div>
            <div className="text-xs text-ink-faint mt-0.5">決済を記録</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-panel-raised transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          <div className="bg-panel-raised rounded-lg p-3 text-center">
            <div className="text-xs text-ink-faint mb-1">エントリー</div>
            <div className="font-mono text-sm font-medium text-ink">{formatPrice(trade.entryPrice)}</div>
          </div>
          <div className="bg-panel-raised rounded-lg p-3 text-center">
            <div className="text-xs text-ink-faint mb-1">SL</div>
            <div className="font-mono text-sm font-medium text-red-400">{formatPrice(trade.slPrice)}</div>
          </div>
          <div className="bg-panel-raised rounded-lg p-3 text-center">
            <div className="text-xs text-ink-faint mb-1">TP</div>
            <div className="font-mono text-sm font-medium text-green-400">{formatPrice(trade.tpPrice)}</div>
          </div>
        </div>

        {currentPrice && (
          <div className="text-xs text-ink-faint mb-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            現在価格: <span className="font-mono text-ink">{formatPrice(currentPrice)}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-ink-dim mb-1.5">決済価格</label>
            <input
              type="number"
              min="0"
              step="any"
              value={exitPriceStr}
              onChange={(e) => setExitPriceStr(e.target.value)}
              placeholder="決済価格を入力"
              className="w-full bg-panel-raised border border-rim rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-amber-500/50"
              autoFocus
            />
          </div>

          {previewPnl !== null && (
            <div className={`text-sm font-medium ${previewPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              損益: {previewPnl >= 0 ? '+' : ''}{previewPnl.toFixed(2)}%
              {trade.positionSize > 0 && (
                <span className="ml-2 text-ink-faint font-normal">
                  ({previewPnl >= 0 ? '+' : ''}{(trade.positionSize * previewPnl / 100).toFixed(2)} USDT)
                </span>
              )}
            </div>
          )}

          {err && <div className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">{err}</div>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-panel-raised border border-rim text-sm text-ink-dim hover:text-ink transition-colors">
              キャンセル
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-panel-raised disabled:text-ink-faint disabled:cursor-not-allowed text-sm font-medium text-white transition-colors">
              {saving ? '記録中...' : '決済確定'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ===== Delete confirmation =====
function DeleteConfirm({ trade, onClose, onDeleted }: { trade: Trade; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    await fetch(`/api/trades/${trade.id}`, { method: 'DELETE' })
    onDeleted()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-panel border border-rim rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-semibold text-ink mb-2">記録を削除しますか？</div>
        <div className="text-sm text-ink-faint mb-5 font-mono">{trade.symbol}</div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-panel-raised border border-rim text-sm text-ink-dim hover:text-ink transition-colors">
            キャンセル
          </button>
          <button onClick={handleDelete} disabled={deleting} className="flex-1 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-sm font-medium text-white transition-colors">
            {deleting ? '削除中...' : '削除'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== Trade Row =====
function TradeRow({
  trade,
  price,
  onExit,
  onDelete,
}: {
  trade: Trade
  price: number | null
  onExit: (t: Trade) => void
  onDelete: (t: Trade) => void
}) {
  const isOpen = trade.status === 'open'
  const livePnlPct = isOpen && price
    ? (trade.entryPrice - price) / trade.entryPrice * 100
    : null

  const displayPnl  = isOpen ? livePnlPct : trade.pnlPct
  const displayExit = isOpen ? price : trade.exitPrice

  return (
    <tr className="border-b border-rim hover:bg-panel-raised/50 transition-colors">
      <td className="py-3 pr-4">
        <div className="font-mono text-sm font-medium text-ink">{trade.symbol}</div>
        <div className="text-xs text-ink-faint mt-0.5">{formatDate(trade.entryDate)}</div>
      </td>
      <td className="py-3 pr-4 text-right">
        <div className="font-mono text-sm text-ink">{formatPrice(trade.entryPrice)}</div>
      </td>
      <td className="py-3 pr-4 text-right">
        {displayExit !== null && displayExit !== undefined
          ? <div className={`font-mono text-sm ${isOpen ? 'text-ink-dim' : 'text-ink'}`}>{formatPrice(displayExit)}{isOpen && price ? ' ●' : ''}</div>
          : <div className="text-ink-faint text-sm">—</div>
        }
      </td>
      <td className="py-3 pr-4 text-right">
        {displayPnl !== null
          ? <div className={`font-mono text-sm font-medium ${pnlColor(displayPnl)}`}>
              {displayPnl >= 0 ? '+' : ''}{displayPnl.toFixed(2)}%
              {isOpen && <span className="text-[10px] ml-1 text-ink-faint">live</span>}
            </div>
          : <div className="text-ink-faint text-sm">—</div>
        }
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          {statusBadge(trade.status)}
        </div>
      </td>
      <td className="py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          {isOpen && (
            <button
              onClick={() => onExit(trade)}
              className="px-3 py-1 rounded-lg bg-panel-raised border border-rim text-xs text-ink-dim hover:text-ink hover:border-amber-500/40 transition-colors"
            >
              決済
            </button>
          )}
          <button
            onClick={() => onDelete(trade)}
            className="p-1.5 rounded-lg text-ink-faint hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="削除"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Paper Trades View ─────────────────────────────────────────────────────────
type PatternStat = { total: number; wins: number; totalPnl: number; liquidations: number }

function computePatternStats(trades: PaperTrade[]): Partial<Record<PatternName, PatternStat>> {
  const stats: Partial<Record<PatternName, PatternStat>> = {}
  for (const t of trades.filter((x) => x.status === 'closed')) {
    if (!stats[t.pattern]) stats[t.pattern] = { total: 0, wins: 0, totalPnl: 0, liquidations: 0 }
    const s = stats[t.pattern]!
    s.total++
    if (t.exitReason === 'tp')          s.wins++
    if (t.exitReason === 'liquidation') s.liquidations++
    s.totalPnl += t.netPnlPct ?? 0
  }
  return stats
}

function SummaryBar({ label, s, color }: { label: string; s: UnifiedSummary; color: string }) {
  return (
    <div className="bg-panel border border-rim rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${color}`}>{label}</span>
        <span className="text-ink-faint text-xs">{s.total}件</span>
      </div>
      <div className="flex gap-3 text-xs mt-1">
        <span className="text-amber-400 font-mono font-bold text-base">{s.open}</span>
        <span className="text-ink-faint self-end text-[10px]">未決済</span>
        <span className="text-ink font-mono font-bold text-base ml-2">{s.closed}</span>
        <span className="text-ink-faint self-end text-[10px]">決済済み</span>
      </div>
      <div className="flex gap-3 text-xs">
        <span className={s.winRate !== null ? (s.winRate >= 50 ? 'text-green-400' : 'text-red-400') : 'text-ink-faint'}>
          勝率 {s.winRate !== null ? `${s.winRate.toFixed(0)}%` : '—'}
        </span>
        <span className={s.avgPnlPct !== null ? (s.avgPnlPct >= 0 ? 'text-green-400' : 'text-red-400') : 'text-ink-faint'}>
          平均 {s.avgPnlPct !== null ? `${s.avgPnlPct >= 0 ? '+' : ''}${s.avgPnlPct.toFixed(1)}%` : '—'}
        </span>
      </div>
    </div>
  )
}

function UnifiedTradeRow({ t }: { t: UnifiedTrade }) {
  const isClosed = t.status === 'closed'
  const dirIcon  = t.side === 'long' ? '📈' : '📉'
  const exitIcon = t.exitReason === 'tp' ? '✅' : t.exitReason === 'sl' ? '🛑' : t.exitReason === 'liquidation' ? '💥' : null
  const pnl      = t.pnlPct ?? null
  return (
    <tr className={`border-b border-rim transition-colors ${isClosed ? (pnl !== null && pnl >= 0 ? 'bg-green-950/10 hover:bg-green-950/20' : 'bg-red-950/10 hover:bg-red-950/20') : 'hover:bg-panel-raised/50'}`}>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{dirIcon}</span>
          <span className="font-mono text-sm text-ink font-medium">{t.symbol}</span>
          {t.ticker && <span className="text-blue-400 text-xs">${t.ticker}</span>}
        </div>
        <div className="text-[10px] text-ink-faint mt-0.5">
          {new Date(t.entryTime).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          {t.pattern && <span className="ml-1.5 font-mono text-amber-400">[{t.pattern}]</span>}
          {t.confidence != null && <span className="ml-1.5 text-blue-400">信頼度{t.confidence}</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${t.category === 'stock' ? 'bg-blue-500/15 text-blue-400' : 'bg-amber-500/15 text-amber-400'}`}>
          {t.category === 'stock' ? 'STOCK' : '暗号ミーム'}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-ink-dim text-xs">${t.entryPrice.toFixed(4)}</td>
      <td className="px-3 py-2 text-right font-mono text-ink-dim text-xs">
        {t.exitPrice != null ? `$${t.exitPrice.toFixed(4)}` : '—'}
      </td>
      <td className="px-3 py-2 text-center">{exitIcon ?? (isClosed ? '—' : <span className="text-[10px] text-amber-400">保有中</span>)}</td>
      <td className={`px-4 py-2 text-right font-mono font-medium text-sm ${pnl !== null ? (pnl >= 0 ? 'text-green-400' : 'text-red-400') : 'text-ink-faint'}`}>
        {pnl !== null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%` : '—'}
      </td>
    </tr>
  )
}

type PaperCategory = 'all' | 'crypto_meme' | 'stock'

function PaperTradesView() {
  type UnifiedResponse = {
    trades: UnifiedTrade[]
    summary: { all: UnifiedSummary; crypto_meme: UnifiedSummary; stock: UnifiedSummary }
  }

  const [data, setData]         = useState<UnifiedResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [category, setCategory] = useState<PaperCategory>('all')
  const [subTab, setSubTab]     = useState<'list' | 'stats'>('list')
  const [lastRun, setLastRun]   = useState<string | null>(null)

  // Keep raw PaperTrades for pattern stats (crypto only)
  const [rawCrypto, setRawCrypto] = useState<PaperTrade[]>([])

  const load = useCallback(async () => {
    try {
      const [uRes, cRes] = await Promise.all([
        fetch('/api/paper-trades/unified'),
        fetch('/api/paper-trades'),
      ])
      const [uJson, cJson] = await Promise.all([uRes.json(), cRes.json()])
      if (uJson.success) setData(uJson)
      if (cJson.success) setRawCrypto(cJson.trades as PaperTrade[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch last cron run timestamp
  useEffect(() => {
    fetch('/api/stock-signal/last-run')
      .then((r) => r.json())
      .then((j) => { if (j.lastRun) setLastRun(j.lastRun as string) })
      .catch(() => {})
  }, [])

  if (loading) return <div className="text-center py-16 text-ink-faint text-sm">読み込み中...</div>

  const trades   = data?.trades ?? []
  const summary  = data?.summary
  const filtered =
    category === 'all'        ? trades :
    category === 'crypto_meme' ? trades.filter((t) => t.category === 'crypto_meme') :
    trades.filter((t) => t.category === 'stock')

  const cryptoStats = computePatternStats(rawCrypto)

  // Empty state with diagnostic context
  if (trades.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-rim bg-panel-raised px-6 py-8 text-center space-y-2">
          <p className="text-ink font-medium">ペーパートレードはまだありません</p>
          <p className="text-ink-faint text-xs">暗号ミーム: スコアリングAPIが推奨対象（スコア≥3）を検出すると自動エントリーされます</p>
          <p className="text-ink-faint text-xs">STOCK: シグナル信頼度≥40 かつ日次3件以内で自動エントリーされます</p>
          {lastRun && (
            <p className="text-ink-faint text-[10px] mt-2">
              最終STOCKチェック: {new Date(lastRun).toLocaleString('ja-JP')}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Summary bars */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryBar label="全体"      s={summary.all}        color="text-ink" />
          <SummaryBar label="暗号ミーム" s={summary.crypto_meme} color="text-amber-400" />
          <SummaryBar label="STOCK"    s={summary.stock}      color="text-blue-400" />
        </div>
      )}

      {/* Last run */}
      {lastRun && (
        <p className="text-ink-faint text-[10px] text-right">
          最終STOCKチェック: {new Date(lastRun).toLocaleString('ja-JP')}
        </p>
      )}

      {/* Category + sub-tab selectors */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-panel border border-rim rounded-xl p-1">
          {(['all', 'crypto_meme', 'stock'] as PaperCategory[]).map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${category === c ? 'bg-amber-500 text-white' : 'text-ink-dim hover:text-ink'}`}>
              {c === 'all' ? `全体 (${trades.length})` : c === 'crypto_meme' ? `暗号ミーム (${summary?.crypto_meme.total ?? 0})` : `STOCK (${summary?.stock.total ?? 0})`}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-panel border border-rim rounded-xl p-1">
          {(['list', 'stats'] as const).map((k) => (
            <button key={k} onClick={() => setSubTab(k)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${subTab === k ? 'bg-panel-raised text-amber-400' : 'text-ink-dim hover:text-ink'}`}>
              {k === 'list' ? '一覧' : 'パターン比較'}
            </button>
          ))}
        </div>
      </div>

      {/* Trade list */}
      {subTab === 'list' && (
        <div className="bg-panel rounded-xl border border-rim overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center text-ink-faint text-sm">
              {category === 'stock'
                ? 'STOCKペーパートレードはまだありません。信頼度≥40のシグナルが出ると自動エントリーされます。'
                : '暗号ミームペーパートレードはまだありません。'}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-panel-raised z-10">
                  <tr className="text-ink-faint text-left border-b border-rim">
                    <th className="px-4 py-2.5 font-medium">銘柄 / 日時</th>
                    <th className="px-3 py-2.5 font-medium">種別</th>
                    <th className="px-3 py-2.5 text-right font-medium">エントリー</th>
                    <th className="px-3 py-2.5 text-right font-medium">決済</th>
                    <th className="px-3 py-2.5 text-center font-medium">結果</th>
                    <th className="px-4 py-2.5 text-right font-medium">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => <UnifiedTradeRow key={t.id} t={t} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pattern stats (crypto only) */}
      {subTab === 'stats' && (
        <div className="bg-panel rounded-xl border border-rim overflow-hidden">
          <div className="px-5 py-3.5 border-b border-rim bg-panel-raised">
            <h3 className="text-sm font-semibold text-ink">パターン別成績（暗号ミーム）</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-faint text-left border-b border-rim">
                  <th className="px-4 py-2.5 font-medium">パターン</th>
                  <th className="px-3 py-2.5 font-medium">エントリー</th>
                  <th className="px-3 py-2.5 font-medium">SL/TP</th>
                  <th className="px-3 py-2.5 text-right font-medium">試行</th>
                  <th className="px-3 py-2.5 text-right font-medium">勝率</th>
                  <th className="px-3 py-2.5 text-right font-medium">平均PnL</th>
                  <th className="px-4 py-2.5 text-right font-medium">清算</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rim">
                {ALL_PATTERNS.map((p) => {
                  const spec = PATTERN_SPECS[p]
                  const s    = cryptoStats[p]
                  const wr   = s && s.total > 0 ? s.wins / s.total * 100 : null
                  const avg  = s && s.total > 0 ? s.totalPnl / s.total : null
                  return (
                    <tr key={p} className="hover:bg-panel-raised transition-colors">
                      <td className="px-4 py-2.5 font-mono font-bold text-amber-400">{p}</td>
                      <td className="px-3 py-2.5 text-ink-dim text-xs">{spec.entryStyle === 'B' ? '分割' : '一括'}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-dim">
                        SL{spec.slPct}%/TP{spec.tpPct}%
                        {spec.tp1Pct ? ` (TP1 ${spec.tp1Pct}%)` : ''}
                      </td>
                      <td className="px-3 py-2.5 text-right text-ink-dim">{s?.total ?? 0}</td>
                      <td className={`px-3 py-2.5 text-right font-mono ${wr !== null ? (wr >= 50 ? 'text-green-400' : 'text-red-400') : 'text-ink-dim'}`}>
                        {wr !== null ? `${wr.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${avg !== null ? (avg >= 0 ? 'text-green-400' : 'text-red-400') : 'text-ink-dim'}`}>
                        {avg !== null ? `${avg >= 0 ? '+' : ''}${avg.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-red-400">
                        {s?.liquidations ?? 0}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Real Trades ───────────────────────────────────────────────────────────────
export default function TradesPage() {
  const [mode, setMode]         = useState<'real' | 'paper'>('real')
  const [trades, setTrades]     = useState<Trade[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [tab, setTab]           = useState<Tab>('open')
  const [prices, setPrices]     = useState<Record<string, number>>({})
  const [exitTarget, setExitTarget]   = useState<Trade | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Trade | null>(null)
  const [toast, setToast]             = useState<string | null>(null)

  const loadTrades = useCallback(async () => {
    try {
      const res  = await fetch('/api/trades')
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setTrades(json.trades as Trade[])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTrades() }, [loadTrades])

  // Poll prices for open trades
  useEffect(() => {
    const openSymbols = trades.filter((t) => t.status === 'open').map((t) => t.symbol)
    if (openSymbols.length === 0) return

    async function pollPrices() {
      const entries = await Promise.all(
        openSymbols.map(async (sym) => {
          try {
            const res  = await fetch(`/api/mexc/ticker/${sym}`)
            const json = await res.json()
            return json.success ? [sym, json.price as number] as const : null
          } catch {
            return null
          }
        })
      )
      const map: Record<string, number> = {}
      for (const entry of entries) {
        if (entry) map[entry[0]] = entry[1]
      }
      setPrices(map)
    }

    pollPrices()
    const id = setInterval(pollPrices, PRICE_POLL_MS)
    return () => clearInterval(id)
  }, [trades])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function handleExitSaved() {
    setExitTarget(null)
    await loadTrades()
    showToast('決済を記録しました')
  }

  async function handleDeleted() {
    setDeleteTarget(null)
    await loadTrades()
    showToast('記録を削除しました')
  }

  const openTrades   = trades.filter((t) => t.status === 'open')
  const closedTrades = trades.filter((t) => t.status !== 'open')

  const displayedTrades =
    tab === 'open'   ? openTrades :
    tab === 'closed' ? closedTrades :
    trades

  // Stats
  const closedWithPnl = closedTrades.filter((t) => t.pnlPct !== null)
  const winCount  = closedWithPnl.filter((t) => (t.pnlPct ?? 0) > 0).length
  const winRate   = closedWithPnl.length > 0 ? (winCount / closedWithPnl.length * 100) : null
  const avgPnl    = closedWithPnl.length > 0 ? closedWithPnl.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / closedWithPnl.length : null
  const totalPnlUsd = closedTrades.filter((t) => t.pnlUsd !== null).reduce((s, t) => s + (t.pnlUsd ?? 0), 0)

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto">

        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink">マイトレード</h1>
            <p className="text-ink-dim text-sm mt-1">記録したショートエントリーの管理・損益確認</p>
          </div>
          {/* Mode switcher */}
          <div className="flex gap-1 bg-panel border border-rim rounded-xl p-1">
            <button
              onClick={() => setMode('real')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === 'real' ? 'bg-amber-500 text-white' : 'text-ink-dim hover:text-ink'}`}
            >
              実弾
            </button>
            <button
              onClick={() => setMode('paper')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === 'paper' ? 'bg-amber-500 text-white' : 'text-ink-dim hover:text-ink'}`}
            >
              ペーパー
            </button>
          </div>
        </div>

        {mode === 'paper' && <PaperTradesView />}

        {mode === 'real' && <>

        {/* Stats cards */}
        {trades.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-panel border border-rim rounded-xl p-4">
              <div className="text-2xl font-bold font-mono text-amber-400">{openTrades.length}</div>
              <div className="text-xs text-ink-faint mt-1">未決済</div>
            </div>
            <div className="bg-panel border border-rim rounded-xl p-4">
              <div className="text-2xl font-bold font-mono text-ink">{closedTrades.length}</div>
              <div className="text-xs text-ink-faint mt-1">決済済み</div>
            </div>
            <div className="bg-panel border border-rim rounded-xl p-4">
              <div className={`text-2xl font-bold font-mono ${winRate !== null ? (winRate >= 50 ? 'text-green-400' : 'text-red-400') : 'text-ink-dim'}`}>
                {winRate !== null ? `${winRate.toFixed(0)}%` : '—'}
              </div>
              <div className="text-xs text-ink-faint mt-1">勝率</div>
            </div>
            <div className="bg-panel border border-rim rounded-xl p-4">
              <div className={`text-2xl font-bold font-mono ${avgPnl !== null ? pnlColor(avgPnl) : 'text-ink-dim'}`}>
                {avgPnl !== null ? `${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2)}%` : '—'}
              </div>
              <div className="text-xs text-ink-faint mt-1">平均損益</div>
              {totalPnlUsd !== 0 && (
                <div className={`text-xs mt-0.5 ${pnlColor(totalPnlUsd)}`}>
                  累計 {totalPnlUsd >= 0 ? '+' : ''}{totalPnlUsd.toFixed(2)} USDT
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 mb-6 text-red-400 text-sm">{error}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {([
            { key: 'open'   as Tab, label: '未決済',   count: openTrades.length },
            { key: 'closed' as Tab, label: '決済済み', count: closedTrades.length },
            { key: 'all'    as Tab, label: '全件',     count: trades.length },
          ]).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${
                tab === key
                  ? 'bg-amber-500 border-amber-400 text-white'
                  : 'bg-panel border-rim text-ink-dim hover:text-ink hover:bg-panel-raised'
              }`}
            >
              <span>{label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
                tab === key ? 'bg-white/20 text-white' : 'bg-panel-raised text-ink-faint'
              }`}>{count}</span>
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center py-24 text-ink-faint">読み込み中...</div>
        )}

        {!loading && displayedTrades.length === 0 && (
          <div className="text-center py-24 text-ink-faint">
            {tab === 'open' ? 'まだ未決済のトレードはありません' : 'まだトレード記録がありません'}
          </div>
        )}

        {!loading && displayedTrades.length > 0 && (
          <div className="bg-panel border border-rim rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-faint text-left border-b border-rim">
                    <th className="px-5 py-3 font-medium">銘柄 / 日時</th>
                    <th className="px-4 py-3 font-medium text-right">エントリー</th>
                    <th className="px-4 py-3 font-medium text-right">現在 / 決済</th>
                    <th className="px-4 py-3 font-medium text-right">損益</th>
                    <th className="px-4 py-3 font-medium">ステータス</th>
                    <th className="px-5 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedTrades
                    .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
                    .map((trade) => (
                      <TradeRow
                        key={trade.id}
                        trade={trade}
                        price={prices[trade.symbol] ?? null}
                        onExit={setExitTarget}
                        onDelete={setDeleteTarget}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        </>}

      </div>

      {exitTarget && (
        <ExitModal
          trade={exitTarget}
          currentPrice={prices[exitTarget.symbol] ?? null}
          onClose={() => setExitTarget(null)}
          onSaved={handleExitSaved}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          trade={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-900/80 border border-green-700 text-green-300 text-sm font-medium px-4 py-3 rounded-xl shadow-lg backdrop-blur-sm">
          {toast}
        </div>
      )}
    </div>
  )
}
