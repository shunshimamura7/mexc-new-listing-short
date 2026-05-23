import type { ListingData, GridsearchLatestData, Trade } from '@/types'

// Vercel 上（VERCEL=1）または KV_REST_API_URL が設定されている場合は KV を使う
// ローカル開発時のみ fs にフォールバック
const IS_KV = !!process.env.KV_REST_API_URL || process.env.VERCEL === '1'

// ===== Vercel KV 実装 =====
// キー設計:
//   listing:{symbol}    → ListingData (JSON object)
//   listings:symbols    → Redis Set of all symbols
//   gridsearch:latest   → GridsearchLatestData
//   trades              → Trade[]

async function kvSaveListing(data: ListingData): Promise<void> {
  const { kv } = await import('@vercel/kv')
  await kv.set(`listing:${data.symbol}`, data)
  await kv.sadd('listings:symbols', data.symbol)
}

async function kvLoadListing(symbol: string): Promise<ListingData | null> {
  const { kv } = await import('@vercel/kv')
  return kv.get<ListingData>(`listing:${symbol}`)
}

async function kvLoadAll(): Promise<ListingData[]> {
  const { kv } = await import('@vercel/kv')
  const symbols = (await kv.smembers('listings:symbols')) as string[]
  if (!symbols.length) return []
  const items = await Promise.all(symbols.map((s) => kv.get<ListingData>(`listing:${s}`)))
  return items.filter((i): i is ListingData => i !== null)
}

async function kvListSymbols(): Promise<string[]> {
  const { kv } = await import('@vercel/kv')
  return (await kv.smembers('listings:symbols')) as string[]
}

async function kvDeleteListing(symbol: string): Promise<void> {
  const { kv } = await import('@vercel/kv')
  await kv.del(`listing:${symbol}`)
  await kv.srem('listings:symbols', symbol)
}

async function kvDeleteAll(): Promise<void> {
  const { kv } = await import('@vercel/kv')
  const symbols = (await kv.smembers('listings:symbols')) as string[]
  if (symbols.length > 0) {
    await Promise.all(symbols.map((s) => kv.del(`listing:${s}`)))
  }
  await kv.del('listings:symbols')
}

// ===== ローカル fs 実装 =====
function fsImpl() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs   = require('fs')   as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path')
  const DATA_DIR = path.join(process.cwd(), 'data')
  const ensure = () => { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }) }
  const fp = (s: string) => path.join(DATA_DIR, `${s}.json`)
  return { fs, path, DATA_DIR, ensure, fp }
}

// ===== 公開 API =====
export async function saveListing(data: ListingData): Promise<void> {
  if (IS_KV) return kvSaveListing(data)
  const { fs, ensure, fp } = fsImpl()
  ensure()
  fs.writeFileSync(fp(data.symbol), JSON.stringify(data, null, 2), 'utf-8')
}

export async function loadListing(symbol: string): Promise<ListingData | null> {
  if (IS_KV) return kvLoadListing(symbol)
  const { fs, ensure, fp } = fsImpl()
  ensure()
  const p = fp(symbol)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as ListingData
}

export async function loadAllListings(): Promise<ListingData[]> {
  if (IS_KV) return kvLoadAll()
  const { fs, path, DATA_DIR, ensure } = fsImpl()
  ensure()
  return fs
    .readdirSync(DATA_DIR)
    .filter((f: string) => f.endsWith('.json') && !f.startsWith('gridsearch-') && !f.startsWith('trades'))
    .map((f: string) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')) as ListingData)
}

export async function listSymbols(): Promise<string[]> {
  if (IS_KV) return kvListSymbols()
  const { fs, DATA_DIR, ensure } = fsImpl()
  ensure()
  return fs
    .readdirSync(DATA_DIR)
    .filter((f: string) => f.endsWith('.json') && !f.startsWith('gridsearch-') && !f.startsWith('trades'))
    .map((f: string) => f.replace('.json', ''))
}

export async function deleteListing(symbol: string): Promise<void> {
  if (IS_KV) return kvDeleteListing(symbol)
  const { fs, ensure, fp } = fsImpl()
  ensure()
  const p = fp(symbol)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

export async function deleteAll(): Promise<void> {
  if (IS_KV) return kvDeleteAll()
  const { fs, path, DATA_DIR, ensure } = fsImpl()
  ensure()
  for (const f of fs.readdirSync(DATA_DIR).filter((f: string) => f.endsWith('.json'))) {
    fs.unlinkSync(path.join(DATA_DIR, f))
  }
}

export async function saveGridsearchLatest(data: GridsearchLatestData): Promise<void> {
  if (IS_KV) {
    const { kv } = await import('@vercel/kv')
    await kv.set('gridsearch:latest', data)
    return
  }
  const { fs, ensure, fp } = fsImpl()
  ensure()
  fs.writeFileSync(fp('gridsearch-latest'), JSON.stringify(data, null, 2), 'utf-8')
}

export async function loadGridsearchLatest(): Promise<GridsearchLatestData | null> {
  if (IS_KV) {
    const { kv } = await import('@vercel/kv')
    return kv.get<GridsearchLatestData>('gridsearch:latest')
  }
  const { fs, ensure, fp } = fsImpl()
  ensure()
  const p = fp('gridsearch-latest')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as GridsearchLatestData
}

// ===== Trade DB =====
async function kvLoadTrades(): Promise<Trade[]> {
  const { kv } = await import('@vercel/kv')
  return (await kv.get<Trade[]>('trades')) ?? []
}

async function kvSaveTrades(trades: Trade[]): Promise<void> {
  const { kv } = await import('@vercel/kv')
  await kv.set('trades', trades)
}

export async function getAllTrades(): Promise<Trade[]> {
  if (IS_KV) return kvLoadTrades()
  const { fs, ensure, fp } = fsImpl()
  ensure()
  const p = fp('trades')
  if (!fs.existsSync(p)) return []
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as Trade[]
}

export async function createTrade(trade: Trade): Promise<void> {
  const trades = await getAllTrades()
  trades.push(trade)
  if (IS_KV) { await kvSaveTrades(trades); return }
  const { fs, ensure, fp } = fsImpl()
  ensure()
  fs.writeFileSync(fp('trades'), JSON.stringify(trades, null, 2), 'utf-8')
}

export async function updateTrade(id: string, patch: Partial<Trade>): Promise<Trade | null> {
  const trades = await getAllTrades()
  const idx = trades.findIndex((t) => t.id === id)
  if (idx === -1) return null
  trades[idx] = { ...trades[idx], ...patch }
  if (IS_KV) { await kvSaveTrades(trades); return trades[idx] }
  const { fs, ensure, fp } = fsImpl()
  ensure()
  fs.writeFileSync(fp('trades'), JSON.stringify(trades, null, 2), 'utf-8')
  return trades[idx]
}

export async function deleteTrade(id: string): Promise<boolean> {
  const trades = await getAllTrades()
  const next = trades.filter((t) => t.id !== id)
  if (next.length === trades.length) return false
  if (IS_KV) { await kvSaveTrades(next); return true }
  const { fs, ensure, fp } = fsImpl()
  ensure()
  fs.writeFileSync(fp('trades'), JSON.stringify(next, null, 2), 'utf-8')
  return true
}

export async function storageStats(): Promise<{ count: number; bytes: number }> {
  if (IS_KV) {
    const { kv } = await import('@vercel/kv')
    const count = await kv.scard('listings:symbols')
    return { count: count ?? 0, bytes: 0 }
  }
  const { fs, path, DATA_DIR, ensure } = fsImpl()
  ensure()
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f: string) => f.endsWith('.json') && !f.startsWith('gridsearch-') && !f.startsWith('trades'))
  const bytes = files.reduce((acc: number, f: string) => acc + fs.statSync(path.join(DATA_DIR, f)).size, 0)
  return { count: files.length, bytes }
}
