import { NextResponse } from 'next/server'
import { loadAllListings, storageStats, deleteAll } from '@/lib/storage'

export async function GET() {
  try {
    const [listings, stats] = await Promise.all([loadAllListings(), storageStats()])
    return NextResponse.json({ success: true, listings, stats })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    await deleteAll()
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
