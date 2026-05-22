import { NextResponse } from 'next/server'
import { computeScores } from '@/lib/score'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await computeScores(7)
    return NextResponse.json({ success: true, ...data })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
