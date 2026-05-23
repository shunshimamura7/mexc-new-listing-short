import { NextResponse } from 'next/server'
import { runPaperAutoEntry } from '@/lib/paper-auto-entry'
import type { AutoEntryParams } from '@/lib/paper-auto-entry'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json() as AutoEntryParams
    if (!body.symbol || !body.currentPrice) {
      return NextResponse.json({ success: false, error: 'symbol and currentPrice required' }, { status: 400 })
    }
    const result = await runPaperAutoEntry(body)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
