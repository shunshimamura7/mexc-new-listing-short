import { NextResponse } from 'next/server'
import { computeScores } from '@/lib/score'
import { sendTelegramAlert } from '@/lib/telegram'
import { wasRecentlyNotified, markNotified } from '@/lib/notified'
import { runPaperAutoEntry } from '@/lib/paper-auto-entry'

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
      sendTelegramAlert(newAlerts).catch(() => {})
    }

    // ペーパートレード自動エントリー（推奨対象 × スイートスポット24〜48h のみ）
    for (const r of data.results) {
      if (
        r.elapsedCategory === 'sweet' &&
        (r.recommendation === 'short' || r.recommendation === 'consider')
      ) {
        runPaperAutoEntry({
          symbol:       r.symbol,
          currentPrice: r.currentPrice,
          score:        r.score,
          pumpPct:      r.initialPumpPct,
          snapshotFR:   r.fundingRate,
          elapsedHours: r.elapsedHours,
        }).catch(() => {})
      }
    }

    return NextResponse.json({ success: true, ...data })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
