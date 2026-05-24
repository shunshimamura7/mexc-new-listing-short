import { NextRequest, NextResponse } from 'next/server'
import { getExtendedHoursPrice } from '@/lib/yahoo-finance'
import { loadOpenStockTrades, updateStockTrade } from '@/lib/stock-paper-entry'
import type { StockPaperTrade } from '@/lib/stock-paper-entry'
import { sendPaperTelegram } from '@/lib/paper-telegram'

export const dynamic = 'force-dynamic'

function calcPnl(trade: StockPaperTrade, exitPrice: number): number {
  if (trade.direction === 'long') {
    return ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
  }
  return ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const now = new Date()

  try {
    const openTrades = await loadOpenStockTrades()
    if (!openTrades.length) {
      return NextResponse.json({ success: true, checked: 0, closed: 0 })
    }

    // Fetch Yahoo prices for all open trades in parallel
    const priceResults = await Promise.allSettled(
      openTrades.map((t) => getExtendedHoursPrice(t.ticker))
    )

    let closed = 0

    for (let i = 0; i < openTrades.length; i++) {
      const trade    = openTrades[i]
      const priceRes = priceResults[i]
      if (priceRes.status !== 'fulfilled' || !priceRes.value) continue

      const pd = priceRes.value
      const currentPrice =
        pd.preMarketPrice  ??
        pd.postMarketPrice ??
        pd.regularPrice    ?? 0
      if (currentPrice <= 0) continue

      const t: StockPaperTrade = { ...trade, updatedAt: now.toISOString() }
      let hit = false

      if (trade.direction === 'long') {
        if (currentPrice <= trade.slPrice) {
          t.exitReason = 'sl'; t.exitPrice = trade.slPrice; hit = true
        } else if (currentPrice >= trade.tpPrice) {
          t.exitReason = 'tp'; t.exitPrice = trade.tpPrice; hit = true
        }
      } else {
        if (currentPrice >= trade.slPrice) {
          t.exitReason = 'sl'; t.exitPrice = trade.slPrice; hit = true
        } else if (currentPrice <= trade.tpPrice) {
          t.exitReason = 'tp'; t.exitPrice = trade.tpPrice; hit = true
        }
      }

      if (hit && t.exitPrice !== null) {
        t.status   = 'closed'
        t.pnlPct   = calcPnl(trade, t.exitPrice)
        t.closedAt = now.toISOString()
        closed++

        const icon   = t.exitReason === 'tp' ? '✅' : '🛑'
        const reason = t.exitReason === 'tp' ? 'TP到達' : 'SL到達'
        const dirLabel = trade.direction === 'long' ? '📈 ロング' : '📉 ショート'
        const msg = [
          `${icon} <b>STOCK決済</b>: <code>${t.symbol}</code> ($${t.ticker}) ${dirLabel}`,
          '',
          `決済理由: ${reason}`,
          `エントリー: $${trade.entryPrice.toFixed(4)} → 決済: $${t.exitPrice.toFixed(4)}`,
          `<b>PnL: ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%</b>`,
        ].join('\n')
        sendPaperTelegram(msg).catch(() => {})
      }

      await updateStockTrade(t)
    }

    return NextResponse.json({ success: true, checked: openTrades.length, closed })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
