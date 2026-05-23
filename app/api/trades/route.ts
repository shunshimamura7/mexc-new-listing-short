import { NextResponse } from 'next/server'
import { getAllTrades, createTrade } from '@/lib/storage'
import type { Trade } from '@/types'

export async function GET() {
  try {
    const trades = await getAllTrades()
    return NextResponse.json({ success: true, trades })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Trade
    if (!body.id || !body.symbol || !body.entryPrice) {
      return NextResponse.json({ success: false, error: 'missing required fields' }, { status: 400 })
    }
    await createTrade(body)
    return NextResponse.json({ success: true, trade: body })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
