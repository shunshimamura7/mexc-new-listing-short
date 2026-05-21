import { NextRequest, NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { runBacktest, buildHeatmap, buildTimingChart } from '@/lib/backtest'
import type { BacktestParams, BacktestResponse } from '@/types'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  const params: BacktestParams = {
    entryHours:     Number(body.entryHours     ?? 1),
    slPct:          Number(body.slPct          ?? 20),
    tpPct:          Number(body.tpPct          ?? 30),
    minPumpPct:     Number(body.minPumpPct     ?? 0),
    minFdvMcRatio:  Number(body.minFdvMcRatio  ?? 0),
    minFR:          Number(body.minFR          ?? 0),
    excludeStock:   Boolean(body.excludeStock  ?? false),
    stockOnly:      Boolean(body.stockOnly     ?? false),
  }

  try {
    const listings = loadAllListings()
    if (listings.length === 0) {
      return NextResponse.json({ success: false, error: 'データなし。先にデータ収集してください。' }, { status: 400 })
    }

    const summary = runBacktest(params, listings)
    const heatmap = buildHeatmap(params, listings)
    const timing  = buildTimingChart(params, listings)

    const result: BacktestResponse = { summary, heatmap, timing }
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
