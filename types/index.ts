export type Kline = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type ListingData = {
  symbol: string
  listingTime: number
  klines: Kline[]
  initialPumpPct: number
  peakTime: number
  fdvMcRatio: number
  maxFR: number
  maxOI: number
}

export type CollectStatus = 'pending' | 'fetching' | 'done' | 'error'

export type CollectEntry = {
  symbol: string
  listingTime: number
  status: CollectStatus
  error?: string
}

export type BacktestParams = {
  entryHours: number
  slPct: number
  tpPct: number
  minPumpPct: number
  minFdvMcRatio: number
  minFR: number          // % 単位 (e.g., 0.1 = 0.1%)。保存値は小数なので比較時に /100 する
  excludeStock: boolean  // シンボル名に "STOCK" を含む銘柄を除外
  stockOnly: boolean     // STOCK銘柄のみ対象
}

export type TradeOutcome = 'tp' | 'sl' | 'forced'

export type TradeResult = {
  symbol: string
  entryPrice: number
  exitPrice: number
  pnlPct: number
  outcome: TradeOutcome
}

export type BacktestSummary = {
  winRate: number
  avgPnl: number
  maxDrawdown: number
  tradeCount: number
  trades: TradeResult[]
}

export type HeatmapCell = {
  sl: number
  tp: number
  winRate: number
  tradeCount: number
  avgPnl: number
}

export type TimingPoint = {
  hours: number
  winRate: number
  tradeCount: number
  avgPnl: number
}

export type BacktestResponse = {
  summary: BacktestSummary
  heatmap: HeatmapCell[]
  timing: TimingPoint[]
}

export type GridSearchResult = {
  entryHours: number
  slPct: number
  tpPct: number
  winRate: number
  avgPnl: number
  expectedValue: number  // winRate/100 * tpPct - (1-winRate/100) * slPct
  tradeCount: number
}

export type FilterParams = Pick<BacktestParams, 'minPumpPct' | 'minFdvMcRatio' | 'minFR' | 'excludeStock' | 'stockOnly'>

export type MexcContract = {
  symbol: string
  createTime: number  // ms — ドキュメント未記載だが実レスポンスに存在
  state: number       // 0: enabled, 1: delivery, 2: completed, 3: offline, 4: pause
  isNew: boolean
}

export type MexcKlineResponse = {
  success: boolean
  data: {
    time: number[]
    open: number[]
    high: number[]
    low: number[]
    close: number[]
    vol: number[]
  }
}

export type MexcTickerItem = {
  symbol: string
  holdVol: number
  fundingRate: number
}
