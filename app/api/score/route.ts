import { NextResponse } from 'next/server'
import { computeScores } from '@/lib/score'
import { sendTelegramAlert } from '@/lib/telegram'
import { wasRecentlyNotified, markNotified } from '@/lib/notified'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await computeScores(7)

    // short / consider の銘柄を抽出し、24h未通知のものだけ送信
    const targets = data.results.filter(
      (r) => r.recommendation === 'short' || r.recommendation === 'consider'
    )

    const newAlerts = []
    for (const r of targets) {
      if (!(await wasRecentlyNotified(r.symbol))) {
        await markNotified(r.symbol)
        newAlerts.push(r)
      }
    }

    if (newAlerts.length > 0) {
      // レスポンスをブロックしない
      sendTelegramAlert(newAlerts).catch(() => {})
    }

    return NextResponse.json({ success: true, ...data })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
