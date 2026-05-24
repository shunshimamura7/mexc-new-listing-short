import { NextRequest, NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { getSymbolCategory } from '@/lib/mexc'
import { extractTicker } from '@/lib/yahoo-finance'
import { calcStockSignal, SIGNAL_THRESHOLD } from '@/lib/stock-signal'
import { wasStockTraded, canStockEnterToday } from '@/lib/stock-paper-entry'
import { DAILY_CAP_STOCK } from '@/lib/stock-paper-entry'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
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
    const listings = Array.from(seenTickers.values())

    const canEnter = await canStockEnterToday()

    // Compute signals dry-run (no saving, no entry)
    const signalResults = await Promise.allSettled(
      listings.map(async (l) => {
        const coinLike = {
          symbol: l.symbol,
          longEdge: false,
          shortEdge: false,
          correlation: null,
          listingPremium: null,
        } as Parameters<typeof calcStockSignal>[0]

        const signal    = await calcStockSignal(coinLike)
        const isDuped   = await wasStockTraded(l.symbol)
        const hasSignal = signal?.direction !== null && signal !== null

        let skip_reason: string | undefined
        if (!signal)                      skip_reason = 'シグナル計算失敗'
        else if (!signal.direction)       skip_reason = `信頼度不足 (${signal.confidence}/${SIGNAL_THRESHOLD})`
        else if (isDuped)                 skip_reason = '24h重複エントリー防止'
        else if (!canEnter)               skip_reason = '日次上限達成'

        return {
          symbol:            l.symbol,
          ticker:            extractTicker(l.symbol) ?? '',
          side:              signal?.direction ?? null,
          confidence:        signal?.confidence ?? 0,
          reasons:           signal?.reasons ?? [],
          would_auto_entry:  hasSignal && !isDuped && canEnter,
          skip_reason,
        }
      })
    )

    type SignalRow = {
      symbol: string; ticker: string; side: string | null; confidence: number
      reasons: string[]; would_auto_entry: boolean; skip_reason: string | undefined
    }
    const signals: SignalRow[] = signalResults
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value as SignalRow)
      .sort((a, b) => b.confidence - a.confidence)

    const dailyUsed = listings.length > 0
      ? (await import('@vercel/kv').then(async ({ kv }) => {
          const d = new Date(Date.now() + 9 * 3_600_000)
          const key = `stock_daily:${d.toISOString().slice(0, 10)}`
          return (await kv.get<number>(key)) ?? 0
        }))
      : 0

    return NextResponse.json({
      success: true,
      scanned:                listings.length,
      auto_entry_threshold:   SIGNAL_THRESHOLD,
      daily_limit:            DAILY_CAP_STOCK,
      daily_used_today:       dailyUsed,
      can_enter_today:        canEnter,
      signals,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
