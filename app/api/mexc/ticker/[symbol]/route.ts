import { NextResponse } from 'next/server'
import { getTickerPrice } from '@/lib/mexc'

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params
    const price = await getTickerPrice(symbol)
    if (price === null) return NextResponse.json({ success: false, error: 'price unavailable' }, { status: 404 })
    return NextResponse.json({ success: true, symbol, price })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
