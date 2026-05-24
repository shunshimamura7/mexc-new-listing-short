import { NextRequest, NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { getSymbolCategory } from '@/lib/mexc'
import { extractTicker, getExtendedHoursPrice } from '@/lib/yahoo-finance'
import { calcStockSignal } from '@/lib/stock-signal'
import { runStockPaperEntry } from '@/lib/stock-paper-entry'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { symbol } = body as { symbol?: string }

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'symbol required' }, { status: 400 })
    }

    const all = await loadAllListings()
    const listing = all.find((l) => l.symbol === symbol && getSymbolCategory(l.symbol) === 'stock')
    if (!listing) {
      return NextResponse.json({ success: false, error: 'STOCK listing not found' }, { status: 404 })
    }

    const ticker = extractTicker(symbol)
    if (!ticker) {
      return NextResponse.json({ success: false, error: 'Could not extract ticker' }, { status: 400 })
    }

    const coinLike = {
      symbol,
      longEdge:       false,
      shortEdge:      false,
      correlation:    null,
      listingPremium: null,
    } as Parameters<typeof calcStockSignal>[0]

    const signal = await calcStockSignal(coinLike)
    if (!signal || !signal.direction) {
      return NextResponse.json({
        success: false,
        error: 'シグナルなし — 信頼度が閾値未満です',
        signal,
      }, { status: 422 })
    }

    // Use current Yahoo price as entry price
    const priceData = await getExtendedHoursPrice(ticker)
    const entryPrice =
      priceData?.preMarketPrice  ??
      priceData?.postMarketPrice ??
      priceData?.regularPrice    ?? 0

    if (entryPrice <= 0) {
      return NextResponse.json({ success: false, error: 'Yahoo価格取得失敗' }, { status: 502 })
    }

    const trade = await runStockPaperEntry(signal, entryPrice)
    if (!trade) {
      return NextResponse.json({
        success: false,
        error: '重複またはデイリーキャップ超過',
      }, { status: 409 })
    }

    return NextResponse.json({ success: true, trade, signal })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
