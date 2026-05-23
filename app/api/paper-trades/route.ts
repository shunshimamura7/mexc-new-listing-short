import { NextResponse } from 'next/server'
import { loadAllPaperTrades } from '@/lib/paper-storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const trades = await loadAllPaperTrades()
    return NextResponse.json({ success: true, trades })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
