import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { kv } = await import('@vercel/kv')
    const lastRun = await kv.get<string>('stock_signal:last_run')
    return NextResponse.json({ success: true, lastRun: lastRun ?? null })
  } catch {
    return NextResponse.json({ success: true, lastRun: null })
  }
}
