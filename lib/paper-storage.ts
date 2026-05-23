import type { PaperTrade, PaperSettings } from '@/types'

const IS_KV = !!process.env.KV_REST_API_URL

const DEFAULT_PAPER_SETTINGS: PaperSettings = {
  autoEntry:   true,
  capitalUsdt: 1000,
  leverage:    10,
  slippage:    0.20,
}

async function db() {
  const { kv } = await import('@vercel/kv')
  return kv
}

// ── Settings ──────────────────────────────────────────────────────────────────
export async function loadPaperSettings(): Promise<PaperSettings> {
  if (!IS_KV) return DEFAULT_PAPER_SETTINGS
  const kv = await db()
  return (await kv.get<PaperSettings>('paper_settings')) ?? DEFAULT_PAPER_SETTINGS
}

export async function savePaperSettings(s: PaperSettings): Promise<void> {
  if (!IS_KV) return
  const kv = await db()
  await kv.set('paper_settings', s)
}

// ── 24 h dedup (same symbol → skip) ──────────────────────────────────────────
const dedupMem = new Map<string, number>()

export async function wasPaperTraded(symbol: string): Promise<boolean> {
  if (!IS_KV) {
    const t = dedupMem.get(symbol)
    return t !== undefined && Date.now() - t < 86_400_000
  }
  const kv = await db()
  return (await kv.exists(`paper_dedup:${symbol}`)) === 1
}

export async function markPaperTraded(symbol: string): Promise<void> {
  if (!IS_KV) { dedupMem.set(symbol, Date.now()); return }
  const kv = await db()
  await kv.set(`paper_dedup:${symbol}`, '1', { ex: 86400 })
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function savePaperTrade(t: PaperTrade): Promise<void> {
  if (!IS_KV) return
  const kv = await db()
  await Promise.all([
    kv.set(`paper_trade:${t.id}`, t),
    kv.sadd('paper_trades:all',  t.id),
    kv.sadd('paper_trades:open', t.id),
  ])
}

export async function updatePaperTrade(t: PaperTrade): Promise<void> {
  if (!IS_KV) return
  const kv   = await db()
  const ops: Promise<unknown>[] = [kv.set(`paper_trade:${t.id}`, t)]
  if (t.status === 'closed') ops.push(kv.srem('paper_trades:open', t.id))
  await Promise.all(ops)
}

export async function loadAllPaperTrades(): Promise<PaperTrade[]> {
  if (!IS_KV) return []
  const kv  = await db()
  const ids = (await kv.smembers('paper_trades:all')) as string[]
  if (!ids.length) return []
  const items = await Promise.all(ids.map((id) => kv.get<PaperTrade>(`paper_trade:${id}`)))
  return items.filter((i): i is PaperTrade => i !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function loadOpenPaperTrades(): Promise<PaperTrade[]> {
  if (!IS_KV) return []
  const kv  = await db()
  const ids = (await kv.smembers('paper_trades:open')) as string[]
  if (!ids.length) return []
  const items = await Promise.all(ids.map((id) => kv.get<PaperTrade>(`paper_trade:${id}`)))
  return items.filter((i): i is PaperTrade => i !== null)
}

// ── Delete ────────────────────────────────────────────────────────────────────
export async function deletePaperTrade(id: string): Promise<void> {
  if (!IS_KV) return
  const kv = await db()
  await Promise.all([
    kv.del(`paper_trade:${id}`),
    kv.srem('paper_trades:all',  id),
    kv.srem('paper_trades:open', id),
  ])
}

export async function deletePaperTradesBySymbol(symbol: string): Promise<number> {
  if (!IS_KV) return 0
  const kv   = await db()
  const all  = await loadAllPaperTrades()
  const targets = all.filter((t) => t.symbol === symbol)
  if (!targets.length) return 0
  await Promise.all(targets.map((t) => deletePaperTrade(t.id)))
  return targets.length
}

// ── 1日あたり自動エントリー上限（JST 0時リセット） ──────────────────────────
const DAILY_CAP = 5

function todayKey(): string {
  // UTC+9 の日付文字列をキーに使う
  const d = new Date(Date.now() + 9 * 3_600_000)
  return `paper_daily:${d.toISOString().slice(0, 10)}`
}

export async function getDailyEntryCount(): Promise<number> {
  if (!IS_KV) return 0
  const kv = await db()
  const v  = await kv.get<number>(todayKey())
  return v ?? 0
}

export async function canEnterToday(): Promise<boolean> {
  const count = await getDailyEntryCount()
  return count < DAILY_CAP
}

export async function incrementDailyEntryCount(): Promise<number> {
  if (!IS_KV) return 0
  const kv  = await db()
  const key = todayKey()
  const n   = await kv.incr(key)
  // 初回のみTTLを48hに設定（翌日になっても当日分が消えないよう余裕を持つ）
  if (n === 1) await kv.expire(key, 48 * 3600)
  return n
}
