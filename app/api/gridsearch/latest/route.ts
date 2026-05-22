import { NextResponse } from 'next/server'
import { loadGridsearchLatest } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await loadGridsearchLatest()
    return NextResponse.json({ success: true, data: data ?? null })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
