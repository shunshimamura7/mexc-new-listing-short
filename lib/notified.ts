// 24時間以内に通知済みの銘柄を管理（重複通知防止）
// 本番: Vercel KV（TTL 86400s で自動失効）
// ローカル: プロセスメモリ（サーバー再起動でリセット）

const IS_KV = !!process.env.KV_REST_API_URL

const memCache = new Map<string, number>()
const TTL_MS   = 24 * 3600 * 1000

export async function wasRecentlyNotified(symbol: string): Promise<boolean> {
  if (IS_KV) {
    const { kv } = await import('@vercel/kv')
    return (await kv.exists(`notified:${symbol}`)) === 1
  }
  const ts = memCache.get(symbol)
  return ts !== undefined && Date.now() - ts < TTL_MS
}

export async function markNotified(symbol: string): Promise<void> {
  if (IS_KV) {
    const { kv } = await import('@vercel/kv')
    await kv.set(`notified:${symbol}`, Date.now(), { ex: 86400 })
    return
  }
  memCache.set(symbol, Date.now())
}
