import { NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { getSymbolCategory } from '@/lib/mexc'
import { extractTicker } from '@/lib/yahoo-finance'
import { calcStockSignal } from '@/lib/stock-signal'
import type { StockSignal } from '@/lib/stock-signal'

export const dynamic = 'force-dynamic'

export interface StockSignalData {
  signals: StockSignal[]
  updatedAt: string
}

export async function GET() {
  try {
    const all = await loadAllListings()

    // Deduplicate STOCK listings by ticker (keep most recent)
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

    const results = await Promise.allSettled(
      listings.map((l) => {
        // Minimal CoinAnalysis fields — real-time signal relies on Yahoo data
        // Historical longEdge/shortEdge left false here (no circular fetch)
        const coinLike = {
          symbol:         l.symbol,
          longEdge:       false,
          shortEdge:      false,
          correlation:    null,
          listingPremium: null,
        } as Parameters<typeof calcStockSignal>[0]
        return calcStockSignal(coinLike)
      })
    )

    const signals: StockSignal[] = results
      .map((r) => (r.status === 'fulfilled' ? r.value : null))
      .filter((s): s is StockSignal => s !== null)

    return NextResponse.json({
      success: true,
      data: { signals, updatedAt: new Date().toISOString() } satisfies StockSignalData,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
