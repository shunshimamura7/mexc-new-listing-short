import { NextRequest, NextResponse } from 'next/server'
import { getKline } from '@/lib/mexc'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const symbol = searchParams.get('symbol')
  const start = Number(searchParams.get('start'))
  const end = Number(searchParams.get('end'))
  const interval = searchParams.get('interval') ?? 'Hour1'

  if (!symbol || !start || !end) {
    return NextResponse.json({ success: false, error: 'symbol, start, end are required' }, { status: 400 })
  }

  try {
    const data = await getKline(symbol, start, end, interval)
    return NextResponse.json({ success: true, data })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
