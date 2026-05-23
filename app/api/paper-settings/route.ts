import { NextResponse } from 'next/server'
import { loadPaperSettings, savePaperSettings } from '@/lib/paper-storage'
import type { PaperSettings } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = await loadPaperSettings()
    return NextResponse.json({ success: true, settings })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Partial<PaperSettings>
    const current = await loadPaperSettings()
    const next: PaperSettings = {
      autoEntry:   body.autoEntry   ?? current.autoEntry,
      capitalUsdt: body.capitalUsdt ?? current.capitalUsdt,
      leverage:    body.leverage    ?? current.leverage,
      slippage:    body.slippage    ?? current.slippage,
    }
    await savePaperSettings(next)
    return NextResponse.json({ success: true, settings: next })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
