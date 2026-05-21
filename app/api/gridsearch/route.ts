import { NextRequest, NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { runGridSearch } from '@/lib/backtest'
import type { FilterParams } from '@/types'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  const filters: FilterParams = {
    minPumpPct:    Number(body.minPumpPct    ?? 0),
    minFdvMcRatio: Number(body.minFdvMcRatio ?? 0),
    minFR:         Number(body.minFR         ?? 0),
    excludeStock:  Boolean(body.excludeStock  ?? false),
    stockOnly:     Boolean(body.stockOnly     ?? false),
  }

  try {
    const listings = loadAllListings()
    if (listings.length === 0) {
      return NextResponse.json({ success: false, error: 'データなし。先にデータ収集してください。' }, { status: 400 })
    }

    const results = runGridSearch(filters, listings)
    return NextResponse.json({ success: true, results, listingCount: listings.length })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
