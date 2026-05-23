import { NextRequest, NextResponse } from 'next/server'
import type { PaperTrade } from '@/types'
import {
  calcNetPnlPct, frBenefitPerPeriod,
} from '@/lib/trading-engine'
import { loadOpenPaperTrades, updatePaperTrade } from '@/lib/paper-storage'
import { buildCloseMessage, sendPaperTelegram } from '@/lib/paper-telegram'
import { getTickers } from '@/lib/mexc'

export const dynamic = 'force-dynamic'

const FR_INTERVAL_MS = 8 * 3_600_000

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
    const [openTrades, tickers] = await Promise.all([
      loadOpenPaperTrades(),
      getTickers(),
    ])

    if (!openTrades.length) {
      return NextResponse.json({ success: true, checked: 0, closed: 0, lot2Added: 0 })
    }

    const priceMap = new Map<string, number>(
      tickers
        .filter((t) => t.lastPrice)
        .map((t) => [t.symbol, parseFloat(t.lastPrice!)])
    )

    const summary = { checked: openTrades.length, closed: 0, lot2Added: 0, frApplied: 0 }

    for (const trade of openTrades) {
      const currentPrice = priceMap.get(trade.symbol) ?? 0
      if (currentPrice <= 0) continue

      const t: PaperTrade = { ...trade, updatedAt: now.toISOString() }

      // ── Lot2 entry for B-style patterns ───────────────────────────────
      if (t.status === 'pending_lot2' && t.lot2ScheduledTime) {
        if (now >= new Date(t.lot2ScheduledTime)) {
          t.lot2Price       = currentPrice
          t.lot2Time        = now.toISOString()
          t.avgEntryPrice   = (t.lot1Price + currentPrice) / 2
          t.status          = 'open'
          summary.lot2Added++
        }
      }

      if (t.status !== 'open') {
        await updatePaperTrade(t)
        continue
      }

      // ── FR accrual (every 8 h) ────────────────────────────────────────
      const lastFR   = new Date(t.lastFRTime ?? t.lot1Time)
      const periods  = Math.floor((now.getTime() - lastFR.getTime()) / FR_INTERVAL_MS)
      if (periods > 0) {
        t.totalFRPct += frBenefitPerPeriod(t.snapshotFR, t.leverage) * periods
        t.lastFRTime  = now.toISOString()
        summary.frApplied++
      }

      // ── Exit condition checks ─────────────────────────────────────────
      let closed     = false
      let exitReason: PaperTrade['exitReason'] = null
      let exitPrice  = currentPrice

      if (currentPrice >= t.liquidationPrice) {
        // Forced liquidation
        exitReason = 'liquidation'
        exitPrice  = t.liquidationPrice
        closed     = true
      } else if (currentPrice >= t.slPrice) {
        // Stop loss
        exitReason = 'sl'
        exitPrice  = t.slPrice
        closed     = true
      } else if (t.tp1Pct !== null && !t.tp1Closed && t.tp1Price !== null && currentPrice <= t.tp1Price) {
        // Pattern 2: first partial TP hit → stay open, mark tp1
        t.tp1Closed     = true
        t.tp1CloseTime  = now.toISOString()
        t.tp1ClosePrice = t.tp1Price
      } else if (currentPrice <= t.tpPrice) {
        // Full TP (or pattern 2 second TP)
        exitReason = 'tp'
        exitPrice  = t.tpPrice
        closed     = true
      }

      if (closed) {
        const netPnl = calcNetPnlPct(
          t.avgEntryPrice,
          exitPrice,
          t.leverage,
          t.totalFRPct,
          t.tp1Closed,
          t.tp1ClosePrice,
        )
        t.status      = 'closed'
        t.exitPrice   = exitPrice
        t.exitTime    = now.toISOString()
        t.exitReason  = exitReason
        t.netPnlPct   = netPnl
        t.netPnlUsdt  = t.capitalUsdt * netPnl / 100
        summary.closed++

        const msg = buildCloseMessage(t)
        sendPaperTelegram(msg).catch(() => {})
      }

      await updatePaperTrade(t)
    }

    return NextResponse.json({ success: true, ...summary })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
