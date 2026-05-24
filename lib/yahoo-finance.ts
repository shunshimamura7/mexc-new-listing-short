import YahooFinance from 'yahoo-finance2'
const yahooFinance = new YahooFinance()

// IONQSTOCK_USDT → 'IONQ'
export function extractTicker(mexcSymbol: string): string | null {
  const match = mexcSymbol.match(/^([A-Z0-9]+)STOCK_USDT$/i)
  return match ? match[1].toUpperCase() : null
}

// コモディティのMEXCシンボル → Yahoo Financeティッカー変換
const COMMODITY_TICKER_MAP: Record<string, string> = {
  // 貴金属
  'XAU': 'GC=F', 'XAG': 'SI=F', 'XPT': 'PL=F', 'XPD': 'PA=F',
  'GOLD': 'GC=F', 'SILVER': 'SI=F', 'PLATINUM': 'PL=F', 'PALLADIUM': 'PA=F',
  // エネルギー
  'OIL': 'CL=F', 'WTI': 'CL=F', 'CRUDEOIL': 'CL=F',
  'BRENT': 'BZ=F', 'NATURALGAS': 'NG=F',
  // 産業金属
  'COPPER': 'HG=F', 'ALUMINUM': 'ALI=F',
  'NICKEL': 'NI=F', 'ZINC': 'ZNC=F', 'LEAD': 'LL=F', 'TIN': 'SN=F',
  // 農産物
  'CORN': 'ZC=F', 'WHEAT': 'ZW=F', 'SOYBEAN': 'ZS=F',
  'SUGAR': 'SB=F', 'COFFEE': 'KC=F', 'COTTON': 'CT=F',
  'COCOA': 'CC=F', 'LUMBER': 'LBR=F',
  // 株価指数
  'US30': 'YM=F', 'US500': 'ES=F', 'US100': 'NQ=F',
  'JP225': 'NIY=F', 'UK100': 'Z=F', 'DE40': 'FDAX',
  'FR40': 'FCE=F', 'HK50': 'HSI=F',
}

export function extractCommodityTicker(mexcSymbol: string): string | null {
  const base = mexcSymbol.replace(/_USDT$/i, '').replace(/_USD1$/i, '')
  return COMMODITY_TICKER_MAP[base.toUpperCase()] ?? null
}

export async function getStockHistory(
  ticker: string,
  from: Date,
  to: Date
): Promise<{ date: Date; close: number }[] | null> {
  try {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), 5000)
    const result = await yahooFinance.historical(ticker, {
      period1: from,
      period2: to,
      interval: '1d',
    })
    clearTimeout(tid)
    return (result as { date: Date; close: number }[]).map((r) => ({ date: r.date, close: r.close }))
  } catch {
    return null
  }
}

// ── Real-time data ─────────────────────────────────────────────────────────────

export interface EarningsInfo {
  nextEarningsDate: Date | null
  lastEPS: number | null
  estimatedEPS: number | null
  epsSurprise: number | null   // % (positive = beat)
  revenueActual: number | null
  revenueEstimate: number | null
}

export async function getEarningsInfo(ticker: string): Promise<EarningsInfo | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (yahooFinance.quoteSummary as any)(ticker, {
      modules: ['calendarEvents', 'earningsHistory'],
    }) as any
    if (!result) return null

    const cal = result.calendarEvents
    let nextEarningsDate: Date | null = null
    const rawDate = cal?.earnings?.earningsDate?.[0]
    if (rawDate instanceof Date) nextEarningsDate = rawDate
    else if (rawDate) nextEarningsDate = new Date(rawDate)

    const hist   = result.earningsHistory?.history
    const latest = Array.isArray(hist) && hist.length > 0 ? hist[0] : null
    // surprisePercent is stored as decimal in yahoo-finance2 (0.042 = 4.2%)
    const surprise = latest?.surprisePercent != null ? latest.surprisePercent * 100 : null

    return {
      nextEarningsDate,
      lastEPS:         latest?.epsActual   ?? null,
      estimatedEPS:    latest?.epsEstimate ?? null,
      epsSurprise:     surprise,
      revenueActual:   null,
      revenueEstimate: null,
    }
  } catch {
    return null
  }
}

export interface ExtendedHoursPrice {
  regularPrice: number | null
  preMarketPrice: number | null
  postMarketPrice: number | null
  preMarketChange: number | null    // % (positive = up)
  postMarketChange: number | null   // %
}

export async function getExtendedHoursPrice(ticker: string): Promise<ExtendedHoursPrice | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (yahooFinance.quoteSummary as any)(ticker, {
      modules: ['price'],
    }) as any
    if (!result?.price) return null

    const p = result.price
    // changePercent fields are decimals (0.03 = 3%)
    return {
      regularPrice:    p.regularMarketPrice  ?? null,
      preMarketPrice:  p.preMarketPrice       ?? null,
      postMarketPrice: p.postMarketPrice      ?? null,
      preMarketChange:  p.preMarketChangePercent  != null ? p.preMarketChangePercent  * 100 : null,
      postMarketChange: p.postMarketChangePercent != null ? p.postMarketChangePercent * 100 : null,
    }
  } catch {
    return null
  }
}

export interface AnalystRating {
  recommendation: string | null   // 'buy' | 'strongBuy' | 'hold' | 'sell' | 'strongSell'
  targetPrice: number | null
  targetUpside: number | null     // % vs current price
}

export async function getAnalystRating(ticker: string): Promise<AnalystRating | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (yahooFinance.quoteSummary as any)(ticker, {
      modules: ['financialData'],
    }) as any
    if (!result?.financialData) return null

    const fd           = result.financialData
    const currentPrice = fd.currentPrice as number | null
    const targetPrice  = fd.targetMeanPrice as number | null
    const targetUpside =
      currentPrice && currentPrice > 0 && targetPrice
        ? ((targetPrice - currentPrice) / currentPrice) * 100
        : null

    return {
      recommendation: fd.recommendationKey ?? null,
      targetPrice:    targetPrice,
      targetUpside,
    }
  } catch {
    return null
  }
}

// ── ピアソン相関係数 ────────────────────────────────────────────────────────────
export function calcCorrelation(
  klines: { time: number; close: number }[],
  stockHistory: { date: Date; close: number }[]
): number | null {
  // klineをUTC日付ごとにグループ化し、その日の最終closeを使う
  const dayMap = new Map<string, number>()
  for (const k of klines) {
    const day = new Date(k.time * 1000).toISOString().slice(0, 10)
    dayMap.set(day, k.close)
  }

  // 株価と日付を合わせてペアを作る
  const pairs: { mexc: number; stock: number }[] = []
  for (const s of stockHistory) {
    const day = s.date.toISOString().slice(0, 10)
    const mexcClose = dayMap.get(day)
    if (mexcClose !== undefined && mexcClose > 0 && s.close > 0) {
      pairs.push({ mexc: mexcClose, stock: s.close })
    }
  }

  if (pairs.length < 3) return null

  const n = pairs.length
  const meanMexc  = pairs.reduce((s, p) => s + p.mexc, 0) / n
  const meanStock = pairs.reduce((s, p) => s + p.stock, 0) / n

  let num = 0, denMexc = 0, denStock = 0
  for (const p of pairs) {
    const dm = p.mexc  - meanMexc
    const ds = p.stock - meanStock
    num      += dm * ds
    denMexc  += dm * dm
    denStock += ds * ds
  }

  const den = Math.sqrt(denMexc * denStock)
  if (den === 0) return null
  return Math.max(-1, Math.min(1, num / den))
}
