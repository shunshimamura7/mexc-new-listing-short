import { NextRequest, NextResponse } from 'next/server'
import { getContractList, getKline, getTickers, recentContracts } from '@/lib/mexc'
import { saveListing, loadListing } from '@/lib/storage'
import type { Kline, ListingData } from '@/types'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// レート制限(code=510)の場合だけリトライ
async function fetchKlineSafe(
  symbol: string,
  startSec: number,
  endSec: number
): Promise<{ data: ReturnType<typeof getKline> extends Promise<infer U> ? U : never; error?: string }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await getKline(symbol, startSec, endSec)
      return { data }
    } catch (e) {
      const isRateLimit = (e as Error & { code?: number }).code === 510
      if (isRateLimit && attempt < 3) {
        console.log(`[collect] ${symbol} rate limited, retry ${attempt}/3 after ${attempt * 1000}ms`)
        await sleep(attempt * 1000)
        continue
      }
      return { data: undefined as never, error: String(e) }
    }
  }
  return { data: undefined as never, error: 'max retries exceeded' }
}

// POST /api/collect  body: { days: number }
export async function POST(req: NextRequest) {
  const { days = 30 } = await req.json().catch(() => ({}))

  try {
    const [contracts, tickers] = await Promise.all([getContractList(), getTickers()])

    const candidates = recentContracts(contracts, days)
    const tickerMap = new Map(tickers.map((t) => [t.symbol, t]))

    console.log(`[collect] 対象: ${candidates.length} 件 (直近 ${days} 日)`)

    const results: { symbol: string; status: 'done' | 'skip' | 'error'; error?: string }[] = []

    for (const contract of candidates) {
      const { symbol, createTime } = contract

      if (loadListing(symbol)) {
        results.push({ symbol, status: 'skip' })
        continue
      }

      // リクエスト間隔 200ms（レート制限対策）
      await sleep(200)

      const startSec = Math.floor(createTime / 1000)
      const endSec = startSec + 72 * 3600
      const { data: raw, error: fetchError } = await fetchKlineSafe(symbol, startSec, endSec)

      if (fetchError) {
        console.warn(`[collect] ${symbol} SKIP (fetch error): ${fetchError}`)
        results.push({ symbol, status: 'error', error: fetchError })
        continue
      }

      if (!raw?.time?.length) {
        console.warn(`[collect] ${symbol} SKIP (no kline data)`)
        results.push({ symbol, status: 'skip', error: 'no kline data' })
        continue
      }

      const klines: Kline[] = raw.time.slice(0, 72).map((t, i) => ({
        time: t,
        open:   Number(raw.open[i]),
        high:   Number(raw.high[i]),
        low:    Number(raw.low[i]),
        close:  Number(raw.close[i]),
        volume: Number(raw.vol[i]),
      }))

      const entryPrice = klines[0]?.open || klines[0]?.close || 0
      let peakHigh = entryPrice
      let peakIdx = 0
      for (let i = 0; i < klines.length; i++) {
        if (klines[i].high > peakHigh) { peakHigh = klines[i].high; peakIdx = i }
      }
      const initialPumpPct = entryPrice > 0 ? ((peakHigh - entryPrice) / entryPrice) * 100 : 0

      const ticker = tickerMap.get(symbol)

      saveListing({
        symbol,
        listingTime: createTime,
        klines,
        initialPumpPct,
        peakTime: peakIdx,
        fdvMcRatio: 0,
        maxFR:  ticker?.fundingRate ?? 0,
        maxOI:  ticker?.holdVol    ?? 0,
      } satisfies ListingData)

      console.log(`[collect] ${symbol} DONE (${klines.length} candles, pump=${initialPumpPct.toFixed(1)}%)`)
      results.push({ symbol, status: 'done' })
    }

    const summary = {
      done:  results.filter(r => r.status === 'done').length,
      skip:  results.filter(r => r.status === 'skip').length,
      error: results.filter(r => r.status === 'error').length,
    }
    console.log(`[collect] 完了: done=${summary.done} skip=${summary.skip} error=${summary.error}`)

    return NextResponse.json({ success: true, results, summary, total: candidates.length })
  } catch (e) {
    console.error(`[collect] fatal error:`, e)
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
