import type { PaperTrade } from '@/types'
import { ALL_PATTERNS, PATTERN_SPECS, calcSlPrice, calcTpPrice, calcLiqPrice } from '@/lib/trading-engine'
import { loadPaperSettings, savePaperTrade, wasPaperTraded, markPaperTraded } from '@/lib/paper-storage'
import { buildEntryMessage, sendPaperTelegram } from '@/lib/paper-telegram'

function makeId(): string {
  return `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export type AutoEntryParams = {
  symbol:       string
  currentPrice: number
  score:        number
  pumpPct:      number
  snapshotFR:   number
  elapsedHours: number
}

export type AutoEntryResult =
  | { skipped: true;  reason: string }
  | { skipped: false; created: number; sessionId: string }

export async function runPaperAutoEntry(params: AutoEntryParams): Promise<AutoEntryResult> {
  const { symbol, currentPrice, score, pumpPct, snapshotFR, elapsedHours } = params

  if (await wasPaperTraded(symbol)) {
    return { skipped: true, reason: 'already_traded_24h' }
  }

  const settings = await loadPaperSettings()
  if (!settings.autoEntry) {
    return { skipped: true, reason: 'auto_entry_disabled' }
  }

  const now       = new Date().toISOString()
  const sessionId = `${symbol}:${Math.floor(Date.now() / 86_400_000)}`

  const trades: PaperTrade[] = ALL_PATTERNS.map((pattern) => {
    const spec  = PATTERN_SPECS[pattern]
    const isB   = spec.entryStyle === 'B'
    const lot2Scheduled = isB
      ? new Date(Date.now() + 2 * 3_600_000).toISOString()
      : null

    return {
      id:        makeId(),
      symbol,
      sessionId,
      pattern,
      leverage:    settings.leverage,
      capitalUsdt: settings.capitalUsdt,

      lot1Price: currentPrice,
      lot1Time:  now,
      lot2Price:         null,
      lot2Time:          null,
      lot2ScheduledTime: lot2Scheduled,
      avgEntryPrice:     currentPrice,

      slPct:            spec.slPct,
      tpPct:            spec.tpPct,
      tp1Pct:           spec.tp1Pct,
      slPrice:          calcSlPrice(currentPrice, spec.slPct),
      tpPrice:          calcTpPrice(currentPrice, spec.tpPct),
      tp1Price:         spec.tp1Pct !== null ? calcTpPrice(currentPrice, spec.tp1Pct) : null,
      liquidationPrice: calcLiqPrice(currentPrice, settings.leverage),

      status: isB ? 'pending_lot2' : 'open',

      tp1Closed:     false,
      tp1CloseTime:  null,
      tp1ClosePrice: null,

      totalFRPct: 0,
      lastFRTime: now,

      exitPrice:  null,
      exitTime:   null,
      exitReason: null,
      netPnlPct:  null,
      netPnlUsdt: null,

      pumpPct,
      score,
      snapshotFR,

      createdAt: now,
      updatedAt: now,
    } satisfies PaperTrade
  })

  await Promise.all([
    ...trades.map((t) => savePaperTrade(t)),
    markPaperTraded(symbol),
  ])

  const msg = buildEntryMessage(trades, score, pumpPct, elapsedHours, settings)
  sendPaperTelegram(msg).catch(() => {})

  return { skipped: false, created: trades.length, sessionId }
}
