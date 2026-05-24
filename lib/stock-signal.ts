import type { CoinAnalysis } from '@/app/api/long-research/route'
import {
  getEarningsInfo,
  getExtendedHoursPrice,
  getAnalystRating,
  extractTicker,
  type EarningsInfo,
  type ExtendedHoursPrice,
  type AnalystRating,
} from './yahoo-finance'

export const SIGNAL_THRESHOLD = 40   // minimum confidence to produce a direction signal

export interface StockSignal {
  symbol: string
  ticker: string
  direction: 'long' | 'short' | null
  confidence: number   // 0–100
  slPct: number
  tpPct: number
  reasons: string[]
  // extended hours
  regularPrice: number | null
  extendedPrice: number | null
  extendedChange: number | null   // % (positive = up from regular)
  extendedType: 'pre' | 'post' | null
  // analyst
  recommendation: string | null
  targetPrice: number | null
  targetUpside: number | null
  // earnings
  nextEarningsDate: string | null   // ISO string
  daysToEarnings: number | null
  lastEPS: number | null
  estimatedEPS: number | null
  epsSurprise: number | null
  updatedAt: string
}

function msToDay(ms: number): number { return Math.round(ms / 86_400_000) }

function scoreSignal(
  coin: CoinAnalysis,
  ext: ExtendedHoursPrice | null,
  analyst: AnalystRating | null,
  earnings: EarningsInfo | null,
  now: Date,
): { longScore: number; shortScore: number; reasons: string[] } {
  let longScore  = 0
  let shortScore = 0
  const reasons: string[] = []

  // ── Extended hours momentum (strongest signal) ──────────────────────────────
  const extChange =
    ext?.preMarketChange  != null ? ext.preMarketChange  :
    ext?.postMarketChange != null ? ext.postMarketChange : null
  if (extChange !== null) {
    if (extChange >= 3) {
      longScore += 30
      reasons.push(`時間外+${extChange.toFixed(1)}%（強い買い圧力）`)
    } else if (extChange >= 1) {
      longScore += 15
      reasons.push(`時間外+${extChange.toFixed(1)}%（買い圧力）`)
    } else if (extChange <= -3) {
      shortScore += 30
      reasons.push(`時間外${extChange.toFixed(1)}%（強い売り圧力）`)
    } else if (extChange <= -1) {
      shortScore += 15
      reasons.push(`時間外${extChange.toFixed(1)}%（売り圧力）`)
    }
  }

  // ── Analyst recommendation ─────────────────────────────────────────────────
  if (analyst?.recommendation) {
    const rec = analyst.recommendation.toLowerCase()
    if (rec === 'strongbuy' || rec === 'buy') {
      longScore += 20
      reasons.push(`アナリスト評価: ${rec}`)
    } else if (rec === 'strongsell' || rec === 'sell') {
      shortScore += 20
      reasons.push(`アナリスト評価: ${rec}`)
    }
  }
  if (analyst?.targetUpside != null) {
    if (analyst.targetUpside > 20) {
      longScore += 15
      reasons.push(`目標株価 +${analyst.targetUpside.toFixed(0)}% 上乗せ余地`)
    } else if (analyst.targetUpside < -10) {
      shortScore += 15
      reasons.push(`目標株価 ${analyst.targetUpside.toFixed(0)}% 割高`)
    }
  }

  // ── Earnings catalyst & history ────────────────────────────────────────────
  if (earnings?.nextEarningsDate) {
    const days = msToDay(earnings.nextEarningsDate.getTime() - now.getTime())
    if (days >= 0 && days <= 5) {
      const leading = longScore >= shortScore ? 'long' : 'short'
      if (leading === 'long')  longScore  += 10
      else                     shortScore += 10
      reasons.push(`決算まで${days}日（カタリスト）`)
    }
  }
  if (earnings?.epsSurprise != null) {
    if (earnings.epsSurprise > 10) {
      longScore += 20
      reasons.push(`EPSサプライズ +${earnings.epsSurprise.toFixed(1)}%`)
    } else if (earnings.epsSurprise < -10) {
      shortScore += 20
      reasons.push(`EPS未達 ${earnings.epsSurprise.toFixed(1)}%`)
    }
  }

  // ── Historical edge from long-research ────────────────────────────────────
  if (coin.longEdge) {
    longScore += 15
    reasons.push('過去乖離率・相関ロングエッジ')
  }
  if (coin.shortEdge) {
    shortScore += 15
    reasons.push('過去乖離率・相関ショートエッジ')
  }

  return { longScore, shortScore, reasons }
}

export async function calcStockSignal(coin: CoinAnalysis): Promise<StockSignal | null> {
  const ticker = extractTicker(coin.symbol)
  if (!ticker) return null

  const now = new Date()

  const [ext, analyst, earnings] = await Promise.all([
    getExtendedHoursPrice(ticker).catch(() => null),
    getAnalystRating(ticker).catch(() => null),
    getEarningsInfo(ticker).catch(() => null),
  ])

  const { longScore, shortScore, reasons } = scoreSignal(coin, ext, analyst, earnings, now)

  const THRESHOLD = SIGNAL_THRESHOLD
  let direction: 'long' | 'short' | null = null
  let confidence = 0

  if (longScore >= THRESHOLD && longScore >= shortScore) {
    direction  = 'long'
    confidence = Math.min(100, longScore)
  } else if (shortScore >= THRESHOLD && shortScore > longScore) {
    direction  = 'short'
    confidence = Math.min(100, shortScore)
  }

  // Extended price context
  const extType: 'pre' | 'post' | null =
    ext?.preMarketPrice  != null ? 'pre'  :
    ext?.postMarketPrice != null ? 'post' : null
  const extendedPrice =
    extType === 'pre'  ? (ext?.preMarketPrice  ?? null) :
    extType === 'post' ? (ext?.postMarketPrice ?? null) : null
  const extendedChange =
    extType === 'pre'  ? (ext?.preMarketChange  ?? null) :
    extType === 'post' ? (ext?.postMarketChange ?? null) : null

  let daysToEarnings: number | null = null
  if (earnings?.nextEarningsDate) {
    const d = msToDay(earnings.nextEarningsDate.getTime() - now.getTime())
    daysToEarnings = d >= 0 ? d : null
  }

  return {
    symbol:    coin.symbol,
    ticker,
    direction,
    confidence,
    slPct:  direction === 'long' ? 10 : 15,
    tpPct:  direction === 'long' ? 20 : 25,
    reasons,
    regularPrice:   ext?.regularPrice   ?? null,
    extendedPrice,
    extendedChange,
    extendedType: extType,
    recommendation: analyst?.recommendation  ?? null,
    targetPrice:    analyst?.targetPrice     ?? null,
    targetUpside:   analyst?.targetUpside    ?? null,
    nextEarningsDate: earnings?.nextEarningsDate?.toISOString() ?? null,
    daysToEarnings,
    lastEPS:       earnings?.lastEPS       ?? null,
    estimatedEPS:  earnings?.estimatedEPS  ?? null,
    epsSurprise:   earnings?.epsSurprise   ?? null,
    updatedAt: now.toISOString(),
  }
}
