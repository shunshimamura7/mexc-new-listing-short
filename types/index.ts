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

export type MexcContract = {
  symbol: string
  createTime: number
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
