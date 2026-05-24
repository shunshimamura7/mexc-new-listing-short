import { NextResponse } from 'next/server'
import yahooFinance from 'yahoo-finance2'

export async function GET() {
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const to   = new Date()

  console.log('[test-yahoo] start', { from, to })

  try {
    const result = await yahooFinance.historical('IONQ', {
      period1: from,
      period2: to,
      interval: '1d',
    })
    console.log('[test-yahoo] success', result.length, 'rows')
    return NextResponse.json({ success: true, count: result.length, data: result })
  } catch (e) {
    const err = e as Error
    console.error('[test-yahoo] error', err.message, err.stack)
    return NextResponse.json({
      success: false,
      message: err.message,
      stack: err.stack,
    }, { status: 500 })
  }
}
