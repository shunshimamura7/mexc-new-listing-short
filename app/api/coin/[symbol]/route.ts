import { NextResponse } from 'next/server'
import { loadListing } from '@/lib/storage'
import type { ScoreDetail } from '@/types'

function computeScore(listing: {
  listingTime: number
  klines: { open: number; high: number; low: number; close: number; volume: number }[]
  initialPumpPct: number
  maxFR: number
}) {
  const { listingTime, klines, initialPumpPct, maxFR } = listing

  const peakVol = klines.length > 0 ? Math.max(...klines.map((k) => k.volume)) : 0
  const lastVol = klines.length > 0 ? klines[klines.length - 1].volume : 0
  const volRatio = peakVol > 0 ? lastVol / peakVol : 1

  const detail: ScoreDetail = {
    initialPump:   initialPumpPct >= 50,
    volumeExhaust: volRatio <= 0.30,
    elapsed24h:    Date.now() - listingTime >= 24 * 3600 * 1000,
    frHigh:        Math.abs(maxFR) > 0.0005,
    btcBearish:    false, // ライブデータ不要なため省略
  }
  const total = Object.values(detail).filter(Boolean).length

  return { detail, total, volRatio }
}

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params
    const listing = await loadListing(symbol)
    if (!listing) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 })
    }
    const { detail, total, volRatio } = computeScore(listing)
    return NextResponse.json({ success: true, listing, score: { detail, total, volRatio } })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
