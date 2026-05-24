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
  excludeCommodity?: boolean      // コモディティ銘柄を除外
  categoryFilter?: SymbolCategory // 指定カテゴリのみ対象（crypto/stock/commodity）
}

export type TradeOutcome = 'tp' | 'sl' | 'forced'

export type TradeResult = {
  symbol: string
  listingTime: number
  entryPrice: number
  exitPrice: number
  pnlPct: number
  outcome: TradeOutcome
}

export type CoinGeckoData = {
  fdvUsd: number | null
  marketCapUsd: number | null
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

export type FilterParams = Pick<BacktestParams, 'minPumpPct' | 'minFdvMcRatio' | 'minFR' | 'excludeStock' | 'stockOnly' | 'excludeCommodity' | 'categoryFilter'>

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
  lastPrice?: string       // MEXC レスポンスに含まれる現在価格（文字列）
  priceChangeRate?: string // 24h変化率
}

export type ScoreDetail = {
  initialPump: boolean    // ① 初動ポンプ +50%以上
  volumeExhaust: boolean  // ② 出来高枯渇（ピーク比30%以下）
  elapsed24h: boolean     // ③ 上場から24時間以上経過
  frHigh: boolean         // ④ FR > +0.3%
  btcBearish: boolean     // ⑤ BTC環境（横ばい・下落）
}

export type ElapsedCategory = 'waiting' | 'sweet' | 'late'
export type SymbolCategory  = 'crypto'  | 'stock' | 'commodity'

export type ScoreResult = {
  symbol: string
  listingTime: number
  currentPrice: number
  initialPumpPct: number
  volRatio: number        // latestVol / peakVol
  fundingRate: number     // 小数形式（0.003 = 0.3%）
  score: number           // 0–5
  detail: ScoreDetail
  recommendation: 'short' | 'consider' | 'pass' | 'excluded'
  slPrice: number         // currentPrice * 1.30
  tpPrice: number         // currentPrice * 0.80
  elapsedHours: number
  elapsedCategory: ElapsedCategory  // waiting <24h / sweet 24-48h / late >48h
  symbolCategory: SymbolCategory    // crypto / stock / commodity
}

export type GridsearchLatestData = {
  results: GridSearchResult[]
  listingCount: number
  params: {
    entryHours: number[]
    slRange: number[]
    tpRange: number[]
    minPumpPct: number
    excludeStock: boolean
  }
  savedAt: number
}

// ── Paper Trade ───────────────────────────────────────────────────────────────
export type PatternName = 'A1' | 'A2' | 'A3' | 'A4' | 'B1' | 'B2' | 'B3' | 'B4'
export type PaperTradeStatus = 'pending_lot2' | 'open' | 'closed'
export type PaperExitReason  = 'tp' | 'sl' | 'liquidation'

export type PaperTrade = {
  id:         string
  symbol:     string
  sessionId:  string          // symbol + daily bucket — dedup key
  pattern:    PatternName
  leverage:   number
  capitalUsdt: number         // virtual capital per pattern (USDT)

  // Lot 1 (always)
  lot1Price: number
  lot1Time:  string           // ISO
  // Lot 2 (B-style only; entered 2 h after lot1)
  lot2Price:         number | null
  lot2Time:          string | null
  lot2ScheduledTime: string | null

  avgEntryPrice: number       // lot1Price for A; (lot1+lot2)/2 for B after lot2

  // Exit levels (all based on lot1Price)
  slPct:  number
  tpPct:  number
  tp1Pct: number | null       // pattern 2: first partial TP (10 %)
  slPrice:          number
  tpPrice:          number
  tp1Price:         number | null
  liquidationPrice: number

  status: PaperTradeStatus

  // Pattern 2 partial close
  tp1Closed:     boolean
  tp1CloseTime:  string | null
  tp1ClosePrice: number | null

  // Accumulated
  totalFRPct: number          // total FR benefit as % of capital (positive = received)
  lastFRTime: string | null   // ISO

  // Close
  exitPrice:   number | null
  exitTime:    string | null
  exitReason:  PaperExitReason | null
  netPnlPct:   number | null
  netPnlUsdt:  number | null

  // Snapshot at entry
  pumpPct:    number
  score:      number
  snapshotFR: number

  createdAt: string
  updatedAt: string
}

export type PaperSettings = {
  autoEntry:   boolean
  capitalUsdt: number
  leverage:    number
  slippage:    number    // % round-trip total (default 0.20)
}

// ── Real Trade ────────────────────────────────────────────────────────────────
export type TradeStatus = 'open' | 'closed_tp' | 'closed_sl' | 'closed_manual'

export type Trade = {
  id: string
  symbol: string
  entryDate: string        // ISO string
  entryPrice: number
  slPrice: number
  tpPrice: number
  positionSize: number     // USDT
  snapshot: {
    pumpPct: number
    hoursElapsed: number
    volumeRatio: number
    fundingRate: number
    btcChange24h: number
    score: number
  }
  exitDate: string | null  // ISO string
  exitPrice: number | null
  status: TradeStatus
  pnlPct: number | null    // positive = profit for short
  pnlUsd: number | null
  notes: string
}
