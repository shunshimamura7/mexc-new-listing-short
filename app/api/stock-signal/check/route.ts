import { NextRequest, NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { getSymbolCategory } from '@/lib/mexc'
import { extractTicker, getExtendedHoursPrice } from '@/lib/yahoo-finance'
import { calcStockSignal } from '@/lib/stock-signal'
import {
  loadOpenStockTrades,
  updateStockTrade,
  runStockPaperEntry,
  wasStockTraded,
  canStockEnterToday,
} from '@/lib/stock-paper-entry'
import type { StockPaperTrade } from '@/lib/stock-paper-entry'
import { sendPaperTelegram } from '@/lib/paper-telegram'

export const dynamic = 'force-dynamic'

function calcPnl(trade: StockPaperTrade, exitPrice: number): number {
  if (trade.direction === 'long') {
    return ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
  }
  return ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100
}

async function recordLastRun(now: Date): Promise<void> {
  try {
    const { kv } = await import('@vercel/kv')
    await kv.set('stock_signal:last_run', now.toISOString())
  } catch { /* non-critical */ }
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
    // ── 1. Record last run timestamp ──────────────────────────────────────────
    await recordLastRun(now)

    // ── 2. Check open stock trades (SL/TP monitor) ───────────────────────────
    const openTrades = await loadOpenStockTrades()
    let closed = 0

    if (openTrades.length > 0) {
      const priceResults = await Promise.allSettled(
        openTrades.map((t) => getExtendedHoursPrice(t.ticker))
      )

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

          const icon      = t.exitReason === 'tp' ? '✅' : '🛑'
          const reason    = t.exitReason === 'tp' ? 'TP到達' : 'SL到達'
          const dirLabel  = trade.direction === 'long' ? '📈 ロング' : '📉 ショート'
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
    }

    // ── 3. Auto-entry: scan for new signal opportunities ─────────────────────
    let entered = 0
    let skipped = 0

    if (await canStockEnterToday()) {
      const all = await loadAllListings()

      // Deduplicate by ticker
      const seenTickers = new Map<string, typeof all[0]>()
      for (const l of all) {
        if (getSymbolCategory(l.symbol) !== 'stock') continue
        const ticker = extractTicker(l.symbol)
        if (!ticker) continue
        const existing = seenTickers.get(ticker)
        if (!existing || l.listingTime > existing.listingTime) {
          seenTickers.set(ticker, l)
        }
      }

      const autoEntryResults = await Promise.allSettled(
        Array.from(seenTickers.values()).map(async (l) => {
          // Layer 1: dedup guard
          if (await wasStockTraded(l.symbol)) { skipped++; return null }

          const coinLike = {
            symbol: l.symbol,
            longEdge: false, shortEdge: false,
            correlation: null, listingPremium: null,
          } as Parameters<typeof calcStockSignal>[0]

          // Layer 2: signal threshold guard
          const signal = await calcStockSignal(coinLike)
          if (!signal || !signal.direction) { skipped++; return null }

          // Layer 3: get current price, require valid price
          const priceData = await getExtendedHoursPrice(signal.ticker)
          const entryPrice =
            priceData?.preMarketPrice  ??
            priceData?.postMarketPrice ??
            priceData?.regularPrice    ?? 0
          if (entryPrice <= 0) { skipped++; return null }

          // Fire entry (runStockPaperEntry has its own dedup + daily cap guards)
          const trade = await runStockPaperEntry(signal, entryPrice)
          if (trade) entered++
          return trade
        })
      )

      // Log any unexpected errors
      for (const r of autoEntryResults) {
        if (r.status === 'rejected') {
          console.error('[stock-signal/check] auto-entry error:', r.reason)
        }
      }
    }

    return NextResponse.json({
      success:  true,
      checked:  openTrades.length,
      closed,
      entered,
      skipped,
      lastRun:  now.toISOString(),
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
