import { NextResponse } from 'next/server'
import { getTickers } from '@/lib/mexc'

export async function GET() {
  try {
    const data = await getTickers()
    return NextResponse.json({ success: true, data })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
