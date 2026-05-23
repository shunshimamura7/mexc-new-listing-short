import type { PatternName } from '@/types'

export type PatternSpec = {
  entryStyle: 'A' | 'B'   // A: single at 24h, B: 50% at 24h + 50% at 26h
  exitStyle:  '1' | '2' | '3' | '4'
  slPct:  number
  tpPct:  number
  tp1Pct: number | null    // style 2 only: first partial TP (closes 50%)
}

export const ALL_PATTERNS: PatternName[] = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4']

export const PATTERN_SPECS: Record<PatternName, PatternSpec> = {
  A1: { entryStyle: 'A', exitStyle: '1', slPct: 30, tpPct: 20, tp1Pct: null },
  A2: { entryStyle: 'A', exitStyle: '2', slPct: 30, tpPct: 20, tp1Pct: 10  },
  A3: { entryStyle: 'A', exitStyle: '3', slPct: 20, tpPct: 15, tp1Pct: null },
  A4: { entryStyle: 'A', exitStyle: '4', slPct: 40, tpPct: 25, tp1Pct: null },
  B1: { entryStyle: 'B', exitStyle: '1', slPct: 30, tpPct: 20, tp1Pct: null },
  B2: { entryStyle: 'B', exitStyle: '2', slPct: 30, tpPct: 20, tp1Pct: 10  },
  B3: { entryStyle: 'B', exitStyle: '3', slPct: 20, tpPct: 15, tp1Pct: null },
  B4: { entryStyle: 'B', exitStyle: '4', slPct: 40, tpPct: 25, tp1Pct: null },
}

// ── Short price levels ────────────────────────────────────────────────────────
// Short: SL is above entry, TP is below entry
export const calcSlPrice  = (price: number, pct: number): number => price * (1 + pct / 100)
export const calcTpPrice  = (price: number, pct: number): number => price * (1 - pct / 100)
// Isolated margin liquidation for short; maintenance margin ~0.5% of notional
export const calcLiqPrice = (price: number, lev: number): number =>
  price * (1 + (1 / lev) * 0.9)

// ── PnL ───────────────────────────────────────────────────────────────────────
// Short gross PnL% as % of capital (positive = profit)
export const grossPnlPct = (entry: number, exit: number, lev: number): number =>
  (entry - exit) / entry * 100 * lev

// Costs: MEXC taker 0.02% × 2 sides + slippage (round-trip)
// All expressed as % of notional; multiply by leverage for % of capital
export const TAKER_FEE_PCT = 0.02   // % per side
export const SLIPPAGE_PCT  = 0.20   // % round-trip total

export const roundTripCostPct = (lev: number, slippage = SLIPPAGE_PCT): number =>
  (TAKER_FEE_PCT * 2 + slippage) * lev

// FR benefit for shorts per 8 h period: positive FR → short receives
// frDecimal: e.g. 0.0001 = 0.01%
export const frBenefitPerPeriod = (frDecimal: number, lev: number): number =>
  frDecimal * 100 * lev

// Net PnL%: gross − costs + accumulated FR
// For pattern 2: if tp1 was partially closed, average of tp1 leg and remaining leg
export function calcNetPnlPct(
  entry:        number,
  exit:         number,
  lev:          number,
  accFRPct:     number,
  tp1Closed    = false,
  tp1Price:     number | null = null,
  slippage     = SLIPPAGE_PCT,
): number {
  const cost = roundTripCostPct(lev, slippage)
  if (tp1Closed && tp1Price !== null) {
    const tp1Gross = grossPnlPct(entry, tp1Price, lev)
    const tp2Gross = grossPnlPct(entry, exit,     lev)
    return (tp1Gross + tp2Gross) / 2 - cost + accFRPct
  }
  return grossPnlPct(entry, exit, lev) - cost + accFRPct
}

// ── Utilities ─────────────────────────────────────────────────────────────────
export function formatHoldTime(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const h  = Math.floor(ms / 3_600_000)
  const m  = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}時間${m}分`
}

export function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 1)    return p.toFixed(4)
  if (p >= 0.001) return p.toFixed(6)
  return p.toFixed(8)
}
