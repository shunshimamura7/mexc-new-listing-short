import { NextRequest, NextResponse } from 'next/server'
import { getContractList, getKline, getTickers, recentContracts } from '@/lib/mexc'
import { saveListing, loadListing } from '@/lib/storage'
import type { Kline, ListingData } from '@/types'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ── Cron用 GET ──────────────────────────────────────────────────────────
// Vercel Cron から毎日 UTC 0:00（JST 9:00）に呼ばれる
// Authorization: Bearer {CRON_SECRET} で保護
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const DAYS = 30
  const results: { symbol: string; status: string; error?: string }[] = []

  try {
    const contracts  = await getContractList()
    const candidates = recentContracts(contracts, DAYS)
    const tickers    = await getTickers()
    const tickerMap  = new Map(tickers.map((t) => [t.symbol, t]))

    for (const { symbol, createTime } of candidates) {
      // 収集済みはスキップ
      const existing = await loadListing(symbol)
      if (existing) { results.push({ symbol, status: 'skip' }); continue }

      await sleep(200)

      const startSec = Math.floor(createTime / 1000)
      const endSec   = startSec + 72 * 3600
      const { data: raw, error: fetchError } = await fetchKlineSafe(symbol, startSec, endSec)

      if (fetchError || !raw?.time?.length) {
        results.push({ symbol, status: 'error', error: fetchError ?? 'no data' })
        continue
      }

      const klines: Kline[] = raw.time.slice(0, 72).map((t, i) => ({
        time:   t,
        open:   Number(raw.open[i]),
        high:   Number(raw.high[i]),
        low:    Number(raw.low[i]),
        close:  Number(raw.close[i]),
        volume: Number(raw.vol[i]),
      }))

      const entryPrice = klines[0]?.open || klines[0]?.close || 0
      let peakHigh = entryPrice, peakIdx = 0
      for (let i = 0; i < klines.length; i++) {
        if (klines[i].high > peakHigh) { peakHigh = klines[i].high; peakIdx = i }
      }
      const initialPumpPct = entryPrice > 0 ? ((peakHigh - entryPrice) / entryPrice) * 100 : 0
      const ticker = tickerMap.get(symbol)

      await saveListing({
        symbol, listingTime: createTime, klines, initialPumpPct,
        peakTime: peakIdx, fdvMcRatio: 0,
        maxFR: ticker?.fundingRate ?? 0,
        maxOI: ticker?.holdVol    ?? 0,
      } satisfies ListingData)

      results.push({ symbol, status: 'done' })
    }

    const done  = results.filter((r) => r.status === 'done').length
    const skip  = results.filter((r) => r.status === 'skip').length
    const error = results.filter((r) => r.status === 'error').length

    return NextResponse.json({ success: true, total: candidates.length, done, skip, error, results })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

async function fetchKlineSafe(symbol: string, startSec: number, endSec: number) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await getKline(symbol, startSec, endSec)
      return { data }
    } catch (e) {
      const isRateLimit = (e as Error & { code?: number }).code === 510
      if (isRateLimit && attempt < 3) {
        await sleep(attempt * 1000)
        continue
      }
      return { data: undefined as never, error: String(e) }
    }
  }
  return { data: undefined as never, error: 'max retries exceeded' }
}

// POST { days } → 候補リストを返す（未収集 / 収集済みに分類）
// POST { symbol, createTime } → 1銘柄だけ収集して返す
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  // ── 候補リスト取得モード ──────────────────────────────
  if ('days' in body && !('symbol' in body)) {
    const days = Number(body.days ?? 30)
    try {
      const contracts = await getContractList()
      const candidates = recentContracts(contracts, days)
      const checks = await Promise.all(
        candidates.map(async (c) => ({ ...c, collected: !!(await loadListing(c.symbol)) }))
      )
      const toFetch = checks.filter((c) => !c.collected).map((c) => ({ symbol: c.symbol, createTime: c.createTime }))
      const toSkip  = checks.filter((c) =>  c.collected).map((c) => c.symbol)
      return NextResponse.json({ success: true, toFetch, toSkip, total: candidates.length })
    } catch (e) {
      return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
    }
  }

  // ── 1銘柄収集モード ──────────────────────────────────
  const symbol     = String(body.symbol ?? '')
  const createTime = Number(body.createTime ?? 0)
  if (!symbol || !createTime) {
    return NextResponse.json({ success: false, error: 'symbol と createTime が必要です' }, { status: 400 })
  }

  try {
    const [tickers] = await Promise.all([getTickers()])
    const tickerMap = new Map(tickers.map((t) => [t.symbol, t]))

    const startSec = Math.floor(createTime / 1000)
    const endSec   = startSec + 72 * 3600
    const { data: raw, error: fetchError } = await fetchKlineSafe(symbol, startSec, endSec)

    if (fetchError) {
      return NextResponse.json({ success: true, symbol, status: 'error', error: fetchError })
    }
    if (!raw?.time?.length) {
      return NextResponse.json({ success: true, symbol, status: 'skip', error: 'no kline data' })
    }

    const klines: Kline[] = raw.time.slice(0, 72).map((t, i) => ({
      time:   t,
      open:   Number(raw.open[i]),
      high:   Number(raw.high[i]),
      low:    Number(raw.low[i]),
      close:  Number(raw.close[i]),
      volume: Number(raw.vol[i]),
    }))

    const entryPrice = klines[0]?.open || klines[0]?.close || 0
    let peakHigh = entryPrice, peakIdx = 0
    for (let i = 0; i < klines.length; i++) {
      if (klines[i].high > peakHigh) { peakHigh = klines[i].high; peakIdx = i }
    }
    const initialPumpPct = entryPrice > 0 ? ((peakHigh - entryPrice) / entryPrice) * 100 : 0
    const ticker = tickerMap.get(symbol)

    await saveListing({
      symbol, listingTime: createTime, klines, initialPumpPct,
      peakTime: peakIdx, fdvMcRatio: 0,
      maxFR: ticker?.fundingRate ?? 0,
      maxOI: ticker?.holdVol    ?? 0,
    } satisfies ListingData)

    return NextResponse.json({ success: true, symbol, status: 'done' })
  } catch (e) {
    return NextResponse.json({ success: true, symbol, status: 'error', error: String(e) })
  }
}
