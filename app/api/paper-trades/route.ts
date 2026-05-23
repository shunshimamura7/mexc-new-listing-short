import { NextRequest, NextResponse } from 'next/server'
import { loadAllPaperTrades, deletePaperTrade, deletePaperTradesBySymbol } from '@/lib/paper-storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const trades = await loadAllPaperTrades()
    return NextResponse.json({ success: true, trades })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

// DELETE /api/paper-trades?id=xxx           → 1件削除
// DELETE /api/paper-trades?symbol=SOL_USDT  → 銘柄の全件削除
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id     = searchParams.get('id')
  const symbol = searchParams.get('symbol')

  try {
    if (id) {
      await deletePaperTrade(id)
      return NextResponse.json({ success: true, deleted: 1 })
    }
    if (symbol) {
      const n = await deletePaperTradesBySymbol(symbol.toUpperCase())
      return NextResponse.json({ success: true, deleted: n })
    }
    return NextResponse.json({ success: false, error: 'id or symbol required' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
