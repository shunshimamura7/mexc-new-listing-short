import type {
  ListingData,
  BacktestParams,
  FilterParams,
  TradeResult,
  BacktestSummary,
  HeatmapCell,
  TimingPoint,
  GridSearchResult,
} from '@/types'

export const SL_RANGE = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
export const TP_RANGE = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]

// グリッドサーチ用（TP刻みを10%に粗くして組み合わせ数を抑える）
export const GS_SL_RANGE = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]       // 10通り
export const GS_TP_RANGE = [10, 20, 30, 40, 50, 60, 70]                   //  7通り
// entryHours: 1〜60 (60通り) → 合計 60×10×7 = 4,200通り

function applyFilters(listings: ListingData[], params: FilterParams): ListingData[] {
  return listings.filter((l) => {
    const isStock = l.symbol.includes('STOCK')
    if (params.excludeStock && isStock) return false
    if (params.stockOnly && !isStock) return false
    if (params.minPumpPct > 0 && l.initialPumpPct < params.minPumpPct) return false
    // fdvMcRatio は現状すべて0のためスキップ
    if (params.minFdvMcRatio > 0 && l.fdvMcRatio > 0 && l.fdvMcRatio < params.minFdvMcRatio) return false
    // maxFR は小数形式（0.001406 = 0.1406%）、params.minFR は % 単位 → /100 して比較
    if (params.minFR > 0 && Math.abs(l.maxFR) * 100 < params.minFR) return false
    return true
  })
}

function evaluateTrade(
  listing: ListingData,
  entryHours: number,
  slPct: number,
  tpPct: number
): TradeResult | null {
  const entryCandle = listing.klines[entryHours]
  if (!entryCandle) return null

  const entryPrice = entryCandle.close
  if (entryPrice <= 0) return null

  const slPrice = entryPrice * (1 + slPct / 100)
  const tpPrice = entryPrice * (1 - tpPct / 100)

  for (const candle of listing.klines.slice(entryHours + 1)) {
    // SL と TP が同一キャンドル内で両方ヒットする場合は先にSLを優先（不利側）
    if (candle.high >= slPrice && candle.low <= tpPrice) {
      return { symbol: listing.symbol, entryPrice, exitPrice: slPrice, pnlPct: -slPct, outcome: 'sl' }
    }
    if (candle.high >= slPrice) {
      return { symbol: listing.symbol, entryPrice, exitPrice: slPrice, pnlPct: -slPct, outcome: 'sl' }
    }
    if (candle.low <= tpPrice) {
      return { symbol: listing.symbol, entryPrice, exitPrice: tpPrice, pnlPct: tpPct, outcome: 'tp' }
    }
  }

  // 72h到達で強制決済
  const lastClose = listing.klines.at(-1)?.close ?? entryPrice
  const pnlPct = entryPrice > 0 ? ((entryPrice - lastClose) / entryPrice) * 100 : 0
  return { symbol: listing.symbol, entryPrice, exitPrice: lastClose, pnlPct, outcome: 'forced' }
}

function calcSummary(trades: TradeResult[]): BacktestSummary {
  if (trades.length === 0) {
    return { winRate: 0, avgPnl: 0, maxDrawdown: 0, tradeCount: 0, trades: [] }
  }
  const wins = trades.filter((t) => t.pnlPct > 0).length
  const winRate = (wins / trades.length) * 100
  const avgPnl = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length

  let peak = 0
  let cumPnl = 0
  let maxDrawdown = 0
  for (const t of trades) {
    cumPnl += t.pnlPct
    if (cumPnl > peak) peak = cumPnl
    const dd = peak - cumPnl
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return { winRate, avgPnl, maxDrawdown, tradeCount: trades.length, trades }
}

export function runBacktest(params: BacktestParams, allListings: ListingData[]): BacktestSummary {
  const listings = applyFilters(allListings, params)
  const trades: TradeResult[] = []
  for (const listing of listings) {
    const t = evaluateTrade(listing, params.entryHours, params.slPct, params.tpPct)
    if (t) trades.push(t)
  }
  return calcSummary(trades)
}

export function buildHeatmap(params: BacktestParams, allListings: ListingData[]): HeatmapCell[] {
  const listings = applyFilters(allListings, params)
  const cells: HeatmapCell[] = []

  for (const sl of SL_RANGE) {
    for (const tp of TP_RANGE) {
      const trades: TradeResult[] = []
      for (const listing of listings) {
        const t = evaluateTrade(listing, params.entryHours, sl, tp)
        if (t) trades.push(t)
      }
      const wins = trades.filter((t) => t.pnlPct > 0).length
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0
      const avgPnl = trades.length > 0 ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0
      cells.push({ sl, tp, winRate, tradeCount: trades.length, avgPnl })
    }
  }

  return cells
}

export function buildTimingChart(params: BacktestParams, allListings: ListingData[]): TimingPoint[] {
  const listings = applyFilters(allListings, params)
  const points: TimingPoint[] = []

  for (let hours = 1; hours <= 60; hours++) {
    const trades: TradeResult[] = []
    for (const listing of listings) {
      const t = evaluateTrade(listing, hours, params.slPct, params.tpPct)
      if (t) trades.push(t)
    }
    const wins = trades.filter((t) => t.pnlPct > 0).length
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0
    const avgPnl = trades.length > 0 ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0
    points.push({ hours, winRate, tradeCount: trades.length, avgPnl })
  }

  return points
}

export function runGridSearch(
  filters: FilterParams,
  allListings: ListingData[],
  opts?: { entryHours?: number[]; slRange?: number[]; tpRange?: number[] }
): GridSearchResult[] {
  const listings = applyFilters(allListings, filters)
  const results: GridSearchResult[] = []

  const hoursArr = opts?.entryHours ?? Array.from({ length: 60 }, (_, i) => i + 1)
  const slArr    = opts?.slRange    ?? GS_SL_RANGE
  const tpArr    = opts?.tpRange    ?? GS_TP_RANGE

  for (const hours of hoursArr) {
    for (const sl of slArr) {
      for (const tp of tpArr) {
        const trades: TradeResult[] = []
        for (const listing of listings) {
          const t = evaluateTrade(listing, hours, sl, tp)
          if (t) trades.push(t)
        }
        if (trades.length === 0) continue
        const wins = trades.filter((t) => t.pnlPct > 0).length
        const winRate = (wins / trades.length) * 100
        const avgPnl = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length
        results.push({ entryHours: hours, slPct: sl, tpPct: tp, winRate, avgPnl, expectedValue: avgPnl, tradeCount: trades.length })
      }
    }
  }

  return results
}
