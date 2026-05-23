import { NextResponse } from 'next/server'
import { getCoinGeckoData } from '@/lib/coingecko'

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params
    const data = await getCoinGeckoData(symbol)
    return NextResponse.json({ success: true, ...data })
  } catch (e) {
    return NextResponse.json({ success: false, fdvUsd: null, marketCapUsd: null, error: String(e) })
  }
}
