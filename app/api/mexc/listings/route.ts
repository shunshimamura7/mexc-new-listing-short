import { NextRequest, NextResponse } from 'next/server'
import { getContractList, recentContracts } from '@/lib/mexc'

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get('days') ?? '30')

  try {
    const contracts = await getContractList()
    const recent = recentContracts(contracts, days)
    return NextResponse.json({ success: true, data: recent })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
