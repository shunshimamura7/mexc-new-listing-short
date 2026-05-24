import type { StockSignal } from './stock-signal'
import { sendPaperTelegram } from './paper-telegram'

export interface StockPaperTrade {
  id: string
  symbol: string
  ticker: string
  direction: 'long' | 'short'
  entryPrice: number
  slPct: number
  tpPct: number
  slPrice: number
  tpPrice: number
  confidence: number
  reasons: string[]
  status: 'open' | 'closed'
  exitPrice: number | null
  exitReason: 'tp' | 'sl' | 'forced' | null
  pnlPct: number | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

const IS_KV = !!process.env.KV_REST_API_URL
export const DAILY_CAP_STOCK = 3

async function db() {
  const { kv } = await import('@vercel/kv')
  return kv
}

function todayKeyStock(): string {
  const d = new Date(Date.now() + 9 * 3_600_000)
  return `stock_daily:${d.toISOString().slice(0, 10)}`
}

// ── Dedup ─────────────────────────────────────────────────────────────────────
export async function wasStockTraded(symbol: string): Promise<boolean> {
  if (!IS_KV) return false
  const kv = await db()
  return (await kv.exists(`stock_dedup:${symbol}`)) === 1
}

export async function markStockTraded(symbol: string): Promise<void> {
  if (!IS_KV) return
  const kv = await db()
  await kv.set(`stock_dedup:${symbol}`, '1', { ex: 86400 })
}

// ── Daily cap ─────────────────────────────────────────────────────────────────
export async function canStockEnterToday(): Promise<boolean> {
  if (!IS_KV) return true
  const kv = await db()
  const v  = await kv.get<number>(todayKeyStock())
  return (v ?? 0) < DAILY_CAP_STOCK
}

async function incrementStockDaily(): Promise<void> {
  if (!IS_KV) return
  const kv  = await db()
  const key = todayKeyStock()
  const n   = await kv.incr(key)
  if (n === 1) await kv.expire(key, 48 * 3600)
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
export async function saveStockTrade(t: StockPaperTrade): Promise<void> {
  if (!IS_KV) return
  const kv = await db()
  await Promise.all([
    kv.set(`stock_trade:${t.id}`, t),
    kv.sadd('stock_trades:all',  t.id),
    kv.sadd('stock_trades:open', t.id),
  ])
}

export async function updateStockTrade(t: StockPaperTrade): Promise<void> {
  if (!IS_KV) return
  const kv   = await db()
  const ops: Promise<unknown>[] = [kv.set(`stock_trade:${t.id}`, t)]
  if (t.status === 'closed') ops.push(kv.srem('stock_trades:open', t.id))
  await Promise.all(ops)
}

export async function loadAllStockTrades(): Promise<StockPaperTrade[]> {
  if (!IS_KV) return []
  const kv  = await db()
  const ids = (await kv.smembers('stock_trades:all')) as string[]
  if (!ids.length) return []
  const items = await Promise.all(ids.map((id) => kv.get<StockPaperTrade>(`stock_trade:${id}`)))
  return items.filter((i): i is StockPaperTrade => i !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function loadOpenStockTrades(): Promise<StockPaperTrade[]> {
  if (!IS_KV) return []
  const kv  = await db()
  const ids = (await kv.smembers('stock_trades:open')) as string[]
  if (!ids.length) return []
  const items = await Promise.all(ids.map((id) => kv.get<StockPaperTrade>(`stock_trade:${id}`)))
  return items.filter((i): i is StockPaperTrade => i !== null)
}

export async function deleteStockTrade(id: string): Promise<void> {
  if (!IS_KV) return
  const kv = await db()
  await Promise.all([
    kv.del(`stock_trade:${id}`),
    kv.srem('stock_trades:all',  id),
    kv.srem('stock_trades:open', id),
  ])
}

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function runStockPaperEntry(
  signal: StockSignal,
  entryPrice: number,
): Promise<StockPaperTrade | null> {
  if (!signal.direction) return null
  if (!(await canStockEnterToday())) return null
  if (await wasStockTraded(signal.symbol)) return null

  const now = new Date().toISOString()
  const dir = signal.direction

  // Long: SL below entry, TP above entry
  // Short: SL above entry, TP below entry
  const slPrice =
    dir === 'long'
      ? entryPrice * (1 - signal.slPct / 100)
      : entryPrice * (1 + signal.slPct / 100)
  const tpPrice =
    dir === 'long'
      ? entryPrice * (1 + signal.tpPct / 100)
      : entryPrice * (1 - signal.tpPct / 100)

  const id = `stock_${signal.symbol}_${Date.now()}`
  const trade: StockPaperTrade = {
    id,
    symbol:     signal.symbol,
    ticker:     signal.ticker,
    direction:  dir,
    entryPrice,
    slPct:      signal.slPct,
    tpPct:      signal.tpPct,
    slPrice,
    tpPrice,
    confidence: signal.confidence,
    reasons:    signal.reasons,
    status:     'open',
    exitPrice:  null,
    exitReason: null,
    pnlPct:     null,
    createdAt:  now,
    updatedAt:  now,
    closedAt:   null,
  }

  await saveStockTrade(trade)
  await markStockTraded(signal.symbol)
  await incrementStockDaily()

  const dirLabel = dir === 'long' ? '📈 ロング' : '📉 ショート'
  const msg = [
    `📋 <b>STOCKペーパーエントリー</b>: <code>${signal.symbol}</code> ($${signal.ticker})`,
    '',
    `方向: ${dirLabel} | 信頼度: ${signal.confidence}`,
    `エントリー: $${entryPrice.toFixed(4)} | SL: $${slPrice.toFixed(4)} | TP: $${tpPrice.toFixed(4)}`,
    `SL${signal.slPct}% / TP${signal.tpPct}%`,
    '',
    signal.reasons.map((r) => `• ${r}`).join('\n'),
  ].join('\n')
  sendPaperTelegram(msg).catch(() => {})

  return trade
}
