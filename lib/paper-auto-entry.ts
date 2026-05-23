import type { PaperTrade } from '@/types'
import { ALL_PATTERNS, PATTERN_SPECS, calcSlPrice, calcTpPrice, calcLiqPrice } from '@/lib/trading-engine'
import { loadPaperSettings, savePaperTrade, wasPaperTraded, markPaperTraded, canEnterToday, incrementDailyEntryCount } from '@/lib/paper-storage'
import { getTickerPrice, isEstablishedCoin } from '@/lib/mexc'
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

  // ── 安全装置 1: 既存大型コイン除外 ────────────────────────────────────────
  if (isEstablishedCoin(symbol)) {
    return { skipped: true, reason: 'established_coin' }
  }

  // ── 安全装置 2: スイートスポット外除外（24〜48h のみ） ─────────────────────
  if (elapsedHours < 24 || elapsedHours > 48) {
    return { skipped: true, reason: `elapsed_out_of_range:${elapsedHours}h` }
  }

  // ── 安全装置 3: 初動ポンプ未達除外 ───────────────────────────────────────
  if (pumpPct < 50) {
    return { skipped: true, reason: `insufficient_pump:${pumpPct.toFixed(1)}%` }
  }

  // ── 安全装置 4: 重複エントリー防止 ───────────────────────────────────────
  if (await wasPaperTraded(symbol)) {
    return { skipped: true, reason: 'already_traded_24h' }
  }

  const settings = await loadPaperSettings()
  if (!settings.autoEntry) {
    return { skipped: true, reason: 'auto_entry_disabled' }
  }

  // ── 安全装置 5: 1日あたり上限（5銘柄/日）────────────────────────────────
  if (!(await canEnterToday())) {
    return { skipped: true, reason: 'daily_cap_reached' }
  }

  // ── 安全装置 6: エントリー価格を ticker.lastPrice で再取得 ─────────────────
  // score.ts の currentPrice は kline close を使っており stale な場合があるため
  // エントリー直前に必ず最新価格を ticker から取得する
  const freshPrice = await getTickerPrice(symbol)
  if (freshPrice === null || freshPrice <= 0) {
    return { skipped: true, reason: 'ticker_price_unavailable' }
  }

  // ── 安全装置 7: 異常価格検出（計算上の価格と ticker 価格が 10 倍以上乖離）──
  const priceRatio = Math.max(freshPrice, currentPrice) / Math.min(freshPrice, currentPrice)
  if (priceRatio > 10) {
    console.warn(`[paper-auto-entry] PRICE_ANOMALY ${symbol}: score_price=${currentPrice} ticker_price=${freshPrice} ratio=${priceRatio.toFixed(1)}x — skipping`)
    return { skipped: true, reason: `price_anomaly:ratio=${priceRatio.toFixed(1)}` }
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

      lot1Price: freshPrice,   // ticker.lastPrice（安全装置6で取得）
      lot1Time:  now,
      lot2Price:         null,
      lot2Time:          null,
      lot2ScheduledTime: lot2Scheduled,
      avgEntryPrice:     freshPrice,

      slPct:            spec.slPct,
      tpPct:            spec.tpPct,
      tp1Pct:           spec.tp1Pct,
      slPrice:          calcSlPrice(freshPrice, spec.slPct),
      tpPrice:          calcTpPrice(freshPrice, spec.tpPct),
      tp1Price:         spec.tp1Pct !== null ? calcTpPrice(freshPrice, spec.tp1Pct) : null,
      liquidationPrice: calcLiqPrice(freshPrice, settings.leverage),

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
    incrementDailyEntryCount(),
  ])

  const msg = buildEntryMessage(trades, score, pumpPct, elapsedHours, settings)
  sendPaperTelegram(msg).catch(() => {})

  return { skipped: false, created: trades.length, sessionId }
}
