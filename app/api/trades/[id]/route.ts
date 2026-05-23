import { NextResponse } from 'next/server'
import { getAllTrades, updateTrade, deleteTrade } from '@/lib/storage'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const trades = await getAllTrades()
    const trade = trades.find((t) => t.id === id)
    if (!trade) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 })
    return NextResponse.json({ success: true, trade })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const patch = await req.json()
    const trade = await updateTrade(id, patch)
    if (!trade) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 })
    return NextResponse.json({ success: true, trade })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ok = await deleteTrade(id)
    if (!ok) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
