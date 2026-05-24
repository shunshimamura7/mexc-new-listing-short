import { NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { getSymbolCategory } from '@/lib/mexc'
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

const ENERGY_PATTERNS = [
  /OIL_/i, /^WTI/i, /^BRENT/i,
  /^(NATURALGAS|CRUDE)/i,
  /^(CORN|WHEAT|SOYBEAN|SUGAR|COTTON|COFFEE|COCOA|LUMBER)/i,
  /^(JP225|US30|US500|US100|UK100|DE40|FR40|HK50|SOXX|XLE|EWJ|EWY)_/i,
]

function isMetal(symbol: string): boolean {
  return METAL_PATTERNS.some((p) => p.test(symbol))
}

function calcRange(klines: { high: number; low: number; open: number; close: number }[], from: number, to: number, basePrice: number): { range: number; pump: number; dump: number } {
  const slice = klines.slice(from, to)
  if (!slice.length || basePrice <= 0) return { range: 0, pump: 0, dump: 0 }
  const maxHigh = Math.max(...slice.map((k) => k.high))
  const minLow  = Math.min(...slice.map((k) => k.low))
  const pump = ((maxHigh - basePrice) / basePrice) * 100
  const dump = ((basePrice - minLow)  / basePrice) * 100
  const range = ((maxHigh - minLow)   / basePrice) * 100
  return { range, pump: Math.max(pump, 0), dump: Math.max(dump, 0) }
}

function summarize(coins: CoinAnalysis[]): CategorySummary {
  const n = coins.length
  if (n === 0) return { count: 0, avgRange24h: 0, avgRange48h: 0, avgPump24h: 0, avgDump24h: 0, trendUp: 0, trendDown: 0, trendFlat: 0 }
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  return {
    count: n,
    avgRange24h: avg(coins.map((c) => c.range24h)),
    avgRange48h: avg(coins.map((c) => c.range48h)),
    avgPump24h:  avg(coins.map((c) => c.pump24h)),
    avgDump24h:  avg(coins.map((c) => c.dump24h)),
    trendUp:     coins.filter((c) => c.trend === 'up').length,
    trendDown:   coins.filter((c) => c.trend === 'down').length,
    trendFlat:   coins.filter((c) => c.trend === 'flat').length,
  }
}

export async function GET() {
  try {
    const all = await loadAllListings()

    const stock: CoinAnalysis[]          = []
    const commodity_metal: CoinAnalysis[] = []
    const commodity_energy: CoinAnalysis[] = []

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

      const trendThreshold = 2
      const trendPct = initialPrice > 0 ? ((finalPrice - initialPrice) / initialPrice) * 100 : 0
      const trend: 'up' | 'down' | 'flat' =
        trendPct >= trendThreshold ? 'up' : trendPct <= -trendThreshold ? 'down' : 'flat'

      const coin: CoinAnalysis = {
        symbol:      listing.symbol,
        listingTime: new Date(listing.listingTime).toISOString(),
        category,
        klineCount:  klines.length,
        pump24h,
        dump24h,
        range24h,
        range48h,
        range72h,
        trend,
        initialPrice,
        finalPrice,
      }

      if (category === 'stock') {
        stock.push(coin)
      } else if (isMetal(listing.symbol)) {
        commodity_metal.push(coin)
      } else {
        commodity_energy.push(coin)
      }
    }

    const data: LongResearchData = {
      stock,
      commodity_metal,
      commodity_energy,
      summary: {
        stock:           summarize(stock),
        commodity_metal: summarize(commodity_metal),
        commodity_energy: summarize(commodity_energy),
      },
    }

    return NextResponse.json({ success: true, data })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
