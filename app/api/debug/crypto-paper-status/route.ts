import { NextRequest, NextResponse } from 'next/server'
import { loadAllListings } from '@/lib/storage'
import { getSymbolCategory, isEstablishedCoin } from '@/lib/mexc'
import { wasPaperTraded, canEnterToday, getDailyEntryCount, loadPaperSettings } from '@/lib/paper-storage'

export const dynamic = 'force-dynamic'

const DAILY_CAP = 5
const PUMP_THRESHOLD = 50
const SWEET_MIN_H = 24
const SWEET_MAX_H = 48

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const now = Date.now()
    const all = await loadAllListings()

    const [settings, dailyCount, canEnter] = await Promise.all([
      loadPaperSettings(),
      getDailyEntryCount(),
      canEnterToday(),
    ])

    type CandidateRow = {
      symbol: string
      listingTime: number
      elapsedHours: number
      initialPumpPct: number
      category: string
      isEstablished: boolean
      isDeduped: boolean
      pass_naming: boolean
      pass_established: boolean
      pass_pump: boolean
      pass_time_window: boolean
      pass_dedup: boolean
      skip_reason: string | null
    }

    // Apply filters sequentially and collect per-listing detail
    const dedupResults = await Promise.allSettled(
      all.map(async (l) => {
        const category = getSymbolCategory(l.symbol)
        const established = isEstablishedCoin(l.symbol)
        const elapsedHours = (now - l.listingTime) / 3_600_000
        const isDeduped = await wasPaperTraded(l.symbol)

        const pass_naming        = category === 'crypto'
        const pass_established   = pass_naming && !established
        const pass_pump          = pass_established && l.initialPumpPct >= PUMP_THRESHOLD
        const pass_time_window   = pass_pump && elapsedHours >= SWEET_MIN_H && elapsedHours <= SWEET_MAX_H
        const pass_dedup         = pass_time_window && !isDeduped

        let skip_reason: string | null = null
        if (!pass_naming)       skip_reason = `カテゴリ除外 (${category})`
        else if (!pass_established) skip_reason = '既存大型コイン'
        else if (!pass_pump)    skip_reason = `ポンプ不足 (${l.initialPumpPct.toFixed(1)}% < ${PUMP_THRESHOLD}%)`
        else if (!pass_time_window) skip_reason = `時間窓外 (${elapsedHours.toFixed(1)}h, sweet=${SWEET_MIN_H}-${SWEET_MAX_H}h)`
        else if (!pass_dedup)   skip_reason = '24h重複エントリー防止'

        return {
          symbol:          l.symbol,
          listingTime:     l.listingTime,
          elapsedHours:    Math.round(elapsedHours * 10) / 10,
          initialPumpPct:  Math.round(l.initialPumpPct * 10) / 10,
          category,
          isEstablished:   established,
          isDeduped,
          pass_naming,
          pass_established,
          pass_pump,
          pass_time_window,
          pass_dedup,
          skip_reason,
        } satisfies CandidateRow
      })
    )

    const candidates: CandidateRow[] = dedupResults
      .filter((r): r is PromiseFulfilledResult<CandidateRow> => r.status === 'fulfilled')
      .map((r) => r.value)
      .sort((a, b) => b.listingTime - a.listingTime)

    // Filter breakdown counts (cumulative)
    const after_naming_filter  = candidates.filter((c) => c.pass_naming).length
    const after_established_coins = candidates.filter((c) => c.pass_established).length
    const after_pump_50pct     = candidates.filter((c) => c.pass_pump).length
    const after_time_window    = candidates.filter((c) => c.pass_time_window).length
    const after_dedup          = candidates.filter((c) => c.pass_dedup).length

    // Determine overall verdict
    let verdict: string
    if (after_time_window === 0) {
      verdict = 'ケース1: 正常 — スイートスポット(24-48h)内の対象銘柄なし'
    } else if (after_dedup === 0) {
      verdict = 'ケース1: 正常 — 時間窓内銘柄は重複エントリー済み'
    } else if (!settings.autoEntry) {
      verdict = 'ケース2: 要確認 — autoEntry=false (設定で無効化中)'
    } else if (!canEnter) {
      verdict = 'ケース1: 正常 — 日次上限達成 (daily_cap)'
    } else {
      verdict = 'ケース2: 要確認 — エントリー可能銘柄あり。score/recommendation フィルターで除外された可能性'
    }

    // Only show crypto candidates in recent_candidates detail (last 7 days)
    const cutoff7d = now - 7 * 24 * 3_600_000
    const recent_candidates = candidates
      .filter((c) => c.listingTime >= cutoff7d && c.category === 'crypto')

    return NextResponse.json({
      success: true,
      verdict,
      total_listings:  all.length,
      filter_breakdown: {
        total:                all.length,
        after_naming_filter,
        after_established_coins,
        after_pump_50pct,
        after_time_window,
        after_dedup,
      },
      config: {
        pump_threshold_pct: PUMP_THRESHOLD,
        sweet_window_h:     `${SWEET_MIN_H}-${SWEET_MAX_H}`,
        daily_cap:          DAILY_CAP,
        daily_used_today:   dailyCount,
        can_enter_today:    canEnter,
        auto_entry_enabled: settings.autoEntry,
      },
      recent_candidates,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
