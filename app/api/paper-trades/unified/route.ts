import { NextResponse } from 'next/server'
import { loadAllPaperTrades } from '@/lib/paper-storage'
import { loadAllStockTrades } from '@/lib/stock-paper-entry'
import type { PaperTrade } from '@/types'
import type { StockPaperTrade } from '@/lib/stock-paper-entry'

export const dynamic = 'force-dynamic'

export type UnifiedTrade = {
  id: string
  category: 'crypto_meme' | 'stock'
  symbol: string
  side: 'long' | 'short'
  entryPrice: number
  entryTime: string
  slPrice: number
  tpPrice: number
  status: 'open' | 'closed'
  exitPrice: number | null
  exitTime: string | null
  exitReason: string | null
  pnlPct: number | null
  // crypto_meme only
  pattern?: string
  pumpPct?: number
  // stock only
  ticker?: string
  confidence?: number
  reasons?: string[]
}

export type UnifiedSummary = {
  total: number
  open: number
  closed: number
  winRate: number | null
  avgPnlPct: number | null
}

function summarize(trades: UnifiedTrade[]): UnifiedSummary {
  const closed   = trades.filter((t) => t.status === 'closed')
  const withPnl  = closed.filter((t) => t.pnlPct !== null)
  const wins     = withPnl.filter((t) => (t.pnlPct ?? 0) > 0).length
  const winRate  = withPnl.length > 0 ? (wins / withPnl.length) * 100 : null
  const avgPnlPct =
    withPnl.length > 0
      ? withPnl.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / withPnl.length
      : null
  return {
    total:    trades.length,
    open:     trades.filter((t) => t.status === 'open').length,
    closed:   closed.length,
    winRate,
    avgPnlPct,
  }
}

function fromPaperTrade(t: PaperTrade): UnifiedTrade {
  return {
    id:          t.id,
    category:    'crypto_meme',
    symbol:      t.symbol,
    side:        'short',
    entryPrice:  t.avgEntryPrice,
    entryTime:   t.lot1Time,
    slPrice:     t.slPrice,
    tpPrice:     t.tpPrice,
    status:      t.status === 'closed' ? 'closed' : 'open',
    exitPrice:   t.exitPrice,
    exitTime:    t.exitTime,
    exitReason:  t.exitReason,
    pnlPct:      t.netPnlPct,
    pattern:     t.pattern,
    pumpPct:     t.pumpPct,
  }
}

function fromStockTrade(t: StockPaperTrade): UnifiedTrade {
  return {
    id:          t.id,
    category:    'stock',
    symbol:      t.symbol,
    side:        t.direction,
    entryPrice:  t.entryPrice,
    entryTime:   t.createdAt,
    slPrice:     t.slPrice,
    tpPrice:     t.tpPrice,
    status:      t.status,
    exitPrice:   t.exitPrice,
    exitTime:    t.closedAt,
    exitReason:  t.exitReason,
    pnlPct:      t.pnlPct,
    ticker:      t.ticker,
    confidence:  t.confidence,
    reasons:     t.reasons,
  }
}

export async function GET() {
  try {
    const [cryptoTrades, stockTrades] = await Promise.all([
      loadAllPaperTrades(),
      loadAllStockTrades(),
    ])

    const unified: UnifiedTrade[] = [
      ...cryptoTrades.map(fromPaperTrade),
      ...stockTrades.map(fromStockTrade),
    ].sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())

    const cryptoUnified = unified.filter((t) => t.category === 'crypto_meme')
    const stockUnified  = unified.filter((t) => t.category === 'stock')

    return NextResponse.json({
      success: true,
      trades:  unified,
      summary: {
        all:        summarize(unified),
        crypto_meme: summarize(cryptoUnified),
        stock:      summarize(stockUnified),
      },
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
