import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function db() {
  const { kv } = await import('@vercel/kv')
  return kv
}

// Iterate SCAN until cursor returns to 0
async function scanAllKeys(
  kv: Awaited<ReturnType<typeof db>>,
  pattern: string,
): Promise<string[]> {
  const keys: string[] = []
  let cursor = 0
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [next, batch] = await (kv as any).scan(cursor, { match: pattern, count: 1000 })
    keys.push(...(batch as string[]))
    cursor = typeof next === 'string' ? parseInt(next, 10) : (next as number)
  } while (cursor !== 0)
  return keys
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const kv = await db()

    // Use index sets for trade counts (reliable)
    const [paperIds, stockIds] = await Promise.all([
      kv.smembers('paper_trades:all') as Promise<string[]>,
      kv.smembers('stock_trades:all') as Promise<string[]>,
    ])

    // SCAN for dedup / daily / listing keys
    const [dedupKeys, stockDedupKeys, stockDailyKeys, listingKeys, notifiedKeys, allKeys] =
      await Promise.all([
        scanAllKeys(kv, 'paper_dedup:*'),
        scanAllKeys(kv, 'stock_dedup:*'),
        scanAllKeys(kv, 'stock_daily:*'),
        scanAllKeys(kv, 'listing:*'),
        scanAllKeys(kv, 'notified:*'),
        scanAllKeys(kv, '*'),
      ])

    return NextResponse.json({
      success: true,
      paper_trade_count:    paperIds.length,
      paper_trade_samples:  paperIds.slice(0, 5),
      stock_trade_count:    stockIds.length,
      stock_trade_samples:  stockIds.slice(0, 5),
      paper_dedup_count:    dedupKeys.length,
      stock_dedup_count:    stockDedupKeys.length,
      stock_daily_keys:     stockDailyKeys,
      listings_count:       listingKeys.length,
      notified_count:       notifiedKeys.length,
      total_keys:           allKeys.length,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
