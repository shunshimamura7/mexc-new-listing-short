import { NextRequest, NextResponse } from 'next/server'
import { loadAllListings, saveGridsearchLatest } from '@/lib/storage'
import { runGridSearch, GS_SL_RANGE, GS_TP_RANGE } from '@/lib/backtest'
import type { FilterParams, GridsearchLatestData } from '@/types'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  const filters: FilterParams = {
    minPumpPct:    Number(body.minPumpPct    ?? 0),
    minFdvMcRatio: Number(body.minFdvMcRatio ?? 0),
    minFR:         Number(body.minFR         ?? 0),
    excludeStock:  Boolean(body.excludeStock  ?? false),
    stockOnly:     Boolean(body.stockOnly     ?? false),
  }

  const customRanges = {
    entryHours: Array.isArray(body.entryHours) ? (body.entryHours as number[]) : undefined,
    slRange:    Array.isArray(body.slRange)    ? (body.slRange    as number[]) : undefined,
    tpRange:    Array.isArray(body.tpRange)    ? (body.tpRange    as number[]) : undefined,
  }

  const saveLatest = body.saveLatest === true

  try {
    const listings = await loadAllListings()
    if (listings.length === 0) {
      return NextResponse.json({ success: false, error: 'データなし。先にデータ収集してください。' }, { status: 400 })
    }

    const results = runGridSearch(filters, listings, customRanges)
    results.sort((a, b) => b.expectedValue - a.expectedValue)

    if (saveLatest) {
      const latestData: GridsearchLatestData = {
        results,
        listingCount: listings.length,
        params: {
          entryHours: customRanges.entryHours ?? Array.from({ length: 60 }, (_, i) => i + 1),
          slRange:    customRanges.slRange    ?? GS_SL_RANGE,
          tpRange:    customRanges.tpRange    ?? GS_TP_RANGE,
          minPumpPct:   filters.minPumpPct,
          excludeStock: filters.excludeStock,
        },
        savedAt: Date.now(),
      }
      await saveGridsearchLatest(latestData)
    }

    return NextResponse.json({ success: true, results, listingCount: listings.length })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
