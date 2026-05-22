import { getContractList, getKline, getTickers, recentContracts } from './mexc'
import type { Kline, ScoreDetail, ScoreResult } from '@/types'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function fetchBtcChange(): Promise<number> {
  const now = Math.floor(Date.now() / 1000)
  const start = now - 25 * 3600
  try {
    const raw = await getKline('BTC_USDT', start, now, 'Min60')
    if (!raw?.time?.length || raw.time.length < 2) return 0
    const closes = raw.close.map(Number)
    const changeP = closes[0] > 0 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : 0
    return changeP
  } catch {
    return 0
  }
}

function scoreOneListing(
  listingTime: number,
  klines: Kline[],
  fundingRate: number,
  btcChangeP: number
): { score: number; detail: ScoreDetail; initialPumpPct: number; volRatio: number } {
  if (klines.length === 0) {
    return {
      score: 0,
      detail: { initialPump: false, volumeExhaust: false, elapsed24h: false, frHigh: false, btcBearish: false },
      initialPumpPct: 0,
      volRatio: 1,
    }
  }

  const entryPrice = klines[0].open || klines[0].close
  const peakHigh = Math.max(...klines.map((k) => k.high))
  const initialPumpPct = entryPrice > 0 ? ((peakHigh - entryPrice) / entryPrice) * 100 : 0

  const peakVol = Math.max(...klines.map((k) => k.volume))
  const lastVol = klines[klines.length - 1].volume
  const volRatio = peakVol > 0 ? lastVol / peakVol : 1

  const detail: ScoreDetail = {
    initialPump: initialPumpPct >= 50,
    volumeExhaust: volRatio <= 0.30,
    elapsed24h: Date.now() - listingTime >= 24 * 3600 * 1000,
    frHigh: fundingRate > 0.0005,
    btcBearish: btcChangeP <= 2,
  }

  return {
    score: Object.values(detail).filter(Boolean).length,
    detail,
    initialPumpPct,
    volRatio,
  }
}

export async function computeScores(days = 7): Promise<{
  results: ScoreResult[]
  btcChangeP: number
  fetchedAt: number
}> {
  const [contracts, tickers, btcChangeP] = await Promise.all([
    getContractList(),
    getTickers(),
    fetchBtcChange(),
  ])

  const candidates = recentContracts(contracts, days)
  const tickerMap = new Map(tickers.map((t) => [t.symbol, t]))
  const nowSec = Math.floor(Date.now() / 1000)
  const results: ScoreResult[] = []

  for (const { symbol, createTime } of candidates) {
    await sleep(150)

    let klines: Kline[] = []
    try {
      const raw = await getKline(symbol, Math.floor(createTime / 1000), nowSec, 'Min60')
      if (raw?.time?.length) {
        klines = raw.time.map((t, i) => ({
          time: t,
          open:   Number(raw.open[i]),
          high:   Number(raw.high[i]),
          low:    Number(raw.low[i]),
          close:  Number(raw.close[i]),
          volume: Number(raw.vol[i]),
        }))
      }
    } catch {
      continue
    }

    if (klines.length === 0) continue

    const fundingRate = tickerMap.get(symbol)?.fundingRate ?? 0
    const { score, detail, initialPumpPct, volRatio } = scoreOneListing(
      createTime, klines, fundingRate, btcChangeP
    )

    const currentPrice = klines[klines.length - 1].close

    results.push({
      symbol,
      listingTime: createTime,
      currentPrice,
      initialPumpPct,
      volRatio,
      fundingRate,
      score,
      detail,
      recommendation: score >= 4 ? 'short' : score === 3 ? 'consider' : 'pass',
      slPrice: currentPrice * 1.30,
      tpPrice: currentPrice * 0.80,
      elapsedHours: Math.floor((Date.now() - createTime) / 3_600_000),
    })
  }

  results.sort((a, b) => b.score - a.score)

  return { results, btcChangeP, fetchedAt: Date.now() }
}
