import { NextRequest, NextResponse } from 'next/server'
import { getContractList, getKline, getTickers, recentContracts } from '@/lib/mexc'
import { saveListing, loadListing } from '@/lib/storage'
import type { Kline, ListingData } from '@/types'

// POST /api/collect  body: { days: number }
export async function POST(req: NextRequest) {
  const { days = 30 } = await req.json().catch(() => ({}))

  try {
    const [contracts, tickers] = await Promise.all([getContractList(), getTickers()])
    const recent = recentContracts(contracts, days)

    const tickerMap = new Map(tickers.map((t) => [t.symbol, t]))

    const results: { symbol: string; status: 'done' | 'skip' | 'error'; error?: string }[] = []

    for (const contract of recent) {
      const { symbol, createTime } = contract

      // 既取得済みはスキップ
      if (loadListing(symbol)) {
        results.push({ symbol, status: 'skip' })
        continue
      }

      try {
        // 上場後72時間分のKline（秒単位）
        const startSec = Math.floor(createTime / 1000)
        const endSec = startSec + 72 * 3600

        const raw = await getKline(symbol, startSec, endSec)

        if (!raw?.time?.length) {
          results.push({ symbol, status: 'error', error: 'no kline data' })
          continue
        }

        const klines: Kline[] = raw.time.map((t, i) => ({
          time: t,
          open: Number(raw.open[i]),
          high: Number(raw.high[i]),
          low: Number(raw.low[i]),
          close: Number(raw.close[i]),
          volume: Number(raw.vol[i]),
        }))

        // 初動ポンプ率とピーク時刻を計算
        const entryPrice = klines[0]?.open ?? klines[0]?.close ?? 0
        let peakHigh = entryPrice
        let peakIdx = 0
        for (let i = 0; i < klines.length; i++) {
          if (klines[i].high > peakHigh) {
            peakHigh = klines[i].high
            peakIdx = i
          }
        }
        const initialPumpPct = entryPrice > 0 ? ((peakHigh - entryPrice) / entryPrice) * 100 : 0
        const peakTime = peakIdx

        // FR・OI（ティッカーから）
        const ticker = tickerMap.get(symbol)
        const maxFR = ticker?.fundingRate ?? 0
        const maxOI = ticker?.holdVol ?? 0

        const listing: ListingData = {
          symbol,
          listingTime: createTime,
          klines,
          initialPumpPct,
          peakTime,
          fdvMcRatio: 0,
          maxFR,
          maxOI,
        }

        saveListing(listing)
        results.push({ symbol, status: 'done' })
      } catch (e) {
        results.push({ symbol, status: 'error', error: String(e) })
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
