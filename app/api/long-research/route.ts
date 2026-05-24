import { NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { getSymbolCategory } from '@/lib/mexc'
import { extractTicker, extractCommodityTicker, getStockHistory, calcCorrelation } from '@/lib/yahoo-finance'
import type { SymbolCategory } from '@/types'

export interface CoinAnalysis {
  symbol: string
  listingTime: string
  category: SymbolCategory
  klineCount: number
  pump24h: number
  dump24h: number
  range24h: number
  range48h: number
  range72h: number
  trend: 'up' | 'down' | 'flat'
  initialPrice: number
  finalPrice: number
  ticker: string | null
  correlation: number | null
  stockTrend: 'up' | 'down' | 'flat' | null
  stockChange: number | null
  listingPriceMexc: number | null
  listingPriceStock: number | null
  listingPremium: number | null
  longEdge: boolean
  shortEdge: boolean
}

export interface CategorySummary {
  count: number
  avgRange24h: number
  avgRange48h: number
  avgPump24h: number
  avgDump24h: number
  trendUp: number
  trendDown: number
  trendFlat: number
  correlationCount: number
  strongCorrelation: number
  avgCorrelation: number | null
  avgListingPremium: number | null
  undervalued: number
  overvalued: number
  longEdgeCount: number
  shortEdgeCount: number
}

export interface LongResearchData {
  stock: CoinAnalysis[]
  commodity_metal: CoinAnalysis[]
  commodity_energy: CoinAnalysis[]
  summary: {
    stock: CategorySummary
    commodity_metal: CategorySummary
    commodity_energy: CategorySummary
  }
}

const METAL_PATTERNS = [
  /^XAU/i, /^XAG/i, /^XPT/i, /^XPD/i,
  /^ALUMINUM/i, /^COPPER_/i, /^NICKEL_/i, /^ZINC_/i, /^LEAD_/i, /^TIN_/i,
  /^(SILVER|GOLD|PLATINUM|PALLADIUM|ALUMINUM|NICKEL|COPPER|ZINC|LEAD|TIN|IRON|STEEL)/i,
]

function isMetal(symbol: string): boolean {
  return METAL_PATTERNS.some((p) => p.test(symbol))
}

function calcRange(
  klines: { high: number; low: number; open: number; close: number }[],
  from: number,
  to: number,
  basePrice: number
): { range: number; pump: number; dump: number } {
  const slice = klines.slice(from, to)
  if (!slice.length || basePrice <= 0) return { range: 0, pump: 0, dump: 0 }
  const maxHigh = Math.max(...slice.map((k) => k.high))
  const minLow  = Math.min(...slice.map((k) => k.low))
  const pump  = ((maxHigh - basePrice) / basePrice) * 100
  const dump  = ((basePrice - minLow)  / basePrice) * 100
  const range = ((maxHigh - minLow)    / basePrice) * 100
  return { range, pump: Math.max(pump, 0), dump: Math.max(dump, 0) }
}

const PREMIUM_ANOMALY_THRESHOLD = 500

function summarize(coins: CoinAnalysis[]): CategorySummary {
  const n = coins.length
  if (n === 0) {
    return {
      count: 0, avgRange24h: 0, avgRange48h: 0, avgPump24h: 0, avgDump24h: 0,
      trendUp: 0, trendDown: 0, trendFlat: 0,
      correlationCount: 0, strongCorrelation: 0, avgCorrelation: null,
      avgListingPremium: null, undervalued: 0, overvalued: 0,
      longEdgeCount: 0, shortEdgeCount: 0,
    }
  }
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  const withCorr    = coins.filter((c) => c.correlation !== null)
  const corrValues  = withCorr.map((c) => c.correlation as number)
  const withPremium = coins.filter(
    (c) => c.listingPremium !== null && Math.abs(c.listingPremium) <= PREMIUM_ANOMALY_THRESHOLD
  )
  const premValues = withPremium.map((c) => c.listingPremium as number)
  return {
    count:            n,
    avgRange24h:      avg(coins.map((c) => c.range24h)),
    avgRange48h:      avg(coins.map((c) => c.range48h)),
    avgPump24h:       avg(coins.map((c) => c.pump24h)),
    avgDump24h:       avg(coins.map((c) => c.dump24h)),
    trendUp:          coins.filter((c) => c.trend === 'up').length,
    trendDown:        coins.filter((c) => c.trend === 'down').length,
    trendFlat:        coins.filter((c) => c.trend === 'flat').length,
    correlationCount: withCorr.length,
    strongCorrelation: withCorr.filter((c) => Math.abs(c.correlation as number) >= 0.6).length,
    avgCorrelation:   corrValues.length > 0 ? avg(corrValues) : null,
    avgListingPremium: premValues.length > 0 ? avg(premValues) : null,
    undervalued:      withPremium.filter((c) => (c.listingPremium as number) <= -5).length,
    overvalued:       withPremium.filter((c) => (c.listingPremium as number) >= 5).length,
    longEdgeCount:    coins.filter((c) => c.longEdge).length,
    shortEdgeCount:   coins.filter((c) => c.shortEdge).length,
  }
}

const NULL_YAHOO: Pick<CoinAnalysis,
  'ticker' | 'correlation' | 'stockTrend' | 'stockChange' |
  'listingPriceMexc' | 'listingPriceStock' | 'listingPremium' |
  'longEdge' | 'shortEdge'
> = {
  ticker: null, correlation: null, stockTrend: null, stockChange: null,
  listingPriceMexc: null, listingPriceStock: null, listingPremium: null,
  longEdge: false, shortEdge: false,
}

type BaseFields = Omit<CoinAnalysis, keyof typeof NULL_YAHOO>

async function fetchYahooFields(
  listing: { listingTime: number; klines: { time: number; open: number; close: number }[] },
  ticker: string
): Promise<typeof NULL_YAHOO> {
  const from = new Date(listing.listingTime)
  const to   = new Date(listing.listingTime + 72 * 60 * 60 * 1000)
  const history = await getStockHistory(ticker, from, to)

  let correlation: number | null       = null
  let stockTrend: CoinAnalysis['stockTrend'] = null
  let stockChange: number | null       = null
  let listingPriceMexc: number | null  = null
  let listingPriceStock: number | null = null
  let listingPremium: number | null    = null

  if (history && history.length >= 1) {
    const firstClose = history[0].close
    const lastClose  = history[history.length - 1].close

    if (history.length >= 2) {
      correlation = calcCorrelation(
        listing.klines.map((k) => ({ time: k.time, close: k.close })),
        history
      )
      if (firstClose > 0) {
        stockChange = ((lastClose - firstClose) / firstClose) * 100
        stockTrend  = stockChange >= 2 ? 'up' : stockChange <= -2 ? 'down' : 'flat'
      }
    }

    const mexcOpen = listing.klines[0]?.open || listing.klines[0]?.close || 0
    if (mexcOpen > 0 && firstClose > 0) {
      listingPriceMexc  = mexcOpen
      listingPriceStock = firstClose
      listingPremium    = ((mexcOpen - firstClose) / firstClose) * 100
    }
  }

  const corr = correlation ?? 0
  const prem = listingPremium ?? 0
  return {
    ticker,
    correlation,
    stockTrend,
    stockChange,
    listingPriceMexc,
    listingPriceStock,
    listingPremium,
    longEdge:  prem < -5  && corr >= 0.6,
    shortEdge: prem > 10  && corr >= 0.6,
  }
}

export async function GET() {
  try {
    const all = await loadAllListings()

    const stockRaw:     { listing: typeof all[0]; base: BaseFields }[] = []
    const commMetalRaw: { listing: typeof all[0]; base: BaseFields }[] = []
    const commEnergyRaw:{ listing: typeof all[0]; base: BaseFields }[] = []

    for (const listing of all) {
      const category = getSymbolCategory(listing.symbol)
      if (category === 'crypto') continue

      const klines = listing.klines
      if (!klines.length) continue

      const initialPrice = klines[0]?.open || klines[0]?.close || 0
      const finalPrice   = klines[Math.min(71, klines.length - 1)]?.close || initialPrice

      const { range: range24h, pump: pump24h, dump: dump24h } = calcRange(klines, 0, 24, initialPrice)
      const { range: range48h } = calcRange(klines, 0, 48, initialPrice)
      const { range: range72h } = calcRange(klines, 0, 72, initialPrice)

      const trendPct = initialPrice > 0 ? ((finalPrice - initialPrice) / initialPrice) * 100 : 0
      const trend: 'up' | 'down' | 'flat' =
        trendPct >= 2 ? 'up' : trendPct <= -2 ? 'down' : 'flat'

      const base: BaseFields = {
        symbol: listing.symbol, listingTime: new Date(listing.listingTime).toISOString(),
        category, klineCount: klines.length,
        pump24h, dump24h, range24h, range48h, range72h,
        trend, initialPrice, finalPrice,
      }

      if (category === 'stock') {
        stockRaw.push({ listing, base })
      } else if (isMetal(listing.symbol)) {
        commMetalRaw.push({ listing, base })
      } else {
        commEnergyRaw.push({ listing, base })
      }
    }

    // Yahoo Finance 並列取得（失敗しても止めない）
    const [stockResults, metalResults, energyResults] = await Promise.all([
      Promise.allSettled(
        stockRaw.map(({ listing, base }) => {
          const ticker = extractTicker(listing.symbol)
          if (!ticker) return Promise.resolve({ ...base, ...NULL_YAHOO } as CoinAnalysis)
          return fetchYahooFields(listing, ticker).then((yf) => ({ ...base, ...yf } as CoinAnalysis))
        })
      ),
      Promise.allSettled(
        commMetalRaw.map(({ listing, base }) => {
          const ticker = extractCommodityTicker(listing.symbol)
          if (!ticker) return Promise.resolve({ ...base, ...NULL_YAHOO } as CoinAnalysis)
          return fetchYahooFields(listing, ticker).then((yf) => ({ ...base, ...yf } as CoinAnalysis))
        })
      ),
      Promise.allSettled(
        commEnergyRaw.map(({ listing, base }) => {
          const ticker = extractCommodityTicker(listing.symbol)
          if (!ticker) return Promise.resolve({ ...base, ...NULL_YAHOO } as CoinAnalysis)
          return fetchYahooFields(listing, ticker).then((yf) => ({ ...base, ...yf } as CoinAnalysis))
        })
      ),
    ])

    const resolve = (results: PromiseSettledResult<CoinAnalysis>[], raws: { base: BaseFields }[]): CoinAnalysis[] =>
      results.map((r, i) => r.status === 'fulfilled' ? r.value : { ...raws[i].base, ...NULL_YAHOO })

    const stock           = resolve(stockResults,  stockRaw)
    const commodity_metal  = resolve(metalResults,  commMetalRaw)
    const commodity_energy = resolve(energyResults, commEnergyRaw)

    const data: LongResearchData = {
      stock,
      commodity_metal,
      commodity_energy,
      summary: {
        stock:            summarize(stock),
        commodity_metal:  summarize(commodity_metal),
        commodity_energy: summarize(commodity_energy),
      },
    }

    return NextResponse.json({ success: true, data })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
