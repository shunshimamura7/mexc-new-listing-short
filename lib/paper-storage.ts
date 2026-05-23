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
