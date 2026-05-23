import type { PaperTrade, PaperSettings } from '@/types'
import { PATTERN_SPECS, formatHoldTime, formatPrice, roundTripCostPct } from '@/lib/trading-engine'

const TELEGRAM_API = 'https://api.telegram.org'

function pnlStr(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

export function buildEntryMessage(
  trades:       PaperTrade[],
  score:        number,
  pumpPct:      number,
  elapsedHours: number,
  settings:     PaperSettings,
): string {
  if (!trades.length) return ''
  const first = trades[0]

  const lines: string[] = [
    `📋 <b>ペーパーエントリー</b>: <code>${first.symbol}</code>`,
    '',
    `スコア: ${score}/5 | 初動ポンプ: +${pumpPct.toFixed(1)}%`,
    `現在価格: $${formatPrice(first.lot1Price)} | 上場後: ${elapsedHours}h`,
    `レバレッジ: ${settings.leverage}x | 仮想資金: ${settings.capitalUsdt.toLocaleString()} USDT/パターン`,
    '',
    '<b>パターン別 SL/TP</b>',
    '─────────────────────',
  ]

  for (const t of trades) {
    const spec = PATTERN_SPECS[t.pattern]
    const entryDesc = spec.entryStyle === 'B' ? '24h後50%+26h後50%' : '即時'
    let exitDesc: string
    if (spec.tp1Pct !== null && t.tp1Price !== null) {
      exitDesc = `TP1: $${formatPrice(t.tp1Price)}(${spec.tp1Pct}%) → TP2: $${formatPrice(t.tpPrice)}(${spec.tpPct}%)`
    } else {
      exitDesc = `SL $${formatPrice(t.slPrice)} / TP $${formatPrice(t.tpPrice)}`
    }
    lines.push(`<b>${t.pattern}</b> [${entryDesc}] SL${spec.slPct}%/TP${spec.tpPct}%`)
    lines.push(`  ${exitDesc}`)
  }

  lines.push('─────────────────────')
  lines.push(`💥 清算価格: $${formatPrice(first.liquidationPrice)} (${settings.leverage}x)`)

  return lines.join('\n')
}

export function buildCloseMessage(t: PaperTrade): string {
  const spec = PATTERN_SPECS[t.pattern]
  const icon =
    t.exitReason === 'tp'          ? '✅' :
    t.exitReason === 'liquidation' ? '💥' : '🛑'
  const reason =
    t.exitReason === 'tp'          ? 'TP到達' :
    t.exitReason === 'sl'          ? 'SL到達' : '強制ロスカット'

  const holdTime  = formatHoldTime(t.lot1Time, t.exitTime ?? new Date().toISOString())
  const exitPrice = t.exitPrice ?? 0
  const gross     = (t.avgEntryPrice - exitPrice) / t.avgEntryPrice * 100 * t.leverage
  const cost      = roundTripCostPct(t.leverage)
  const net       = t.netPnlPct ?? 0
  const netUsdt   = t.netPnlUsdt ?? 0

  return [
    `${icon} <b>ペーパー決済</b>: <code>${t.symbol}</code> [${t.pattern}]`,
    '',
    `決済理由: ${reason}`,
    `エントリー: $${formatPrice(t.avgEntryPrice)} → 決済: $${formatPrice(exitPrice)}`,
    `保有時間: ${holdTime}`,
    '─────────────────────',
    `粗PnL:  ${pnlStr(gross)}`,
    `手数料: ${pnlStr(-cost)}`,
    `FR利益: ${pnlStr(t.totalFRPct)}`,
    `<b>純PnL: ${pnlStr(net)} (${netUsdt >= 0 ? '+' : ''}${netUsdt.toFixed(2)} USDT)</b>`,
    '',
    `パターン: ${spec.entryStyle}[${spec.exitStyle}] SL${spec.slPct}%/TP${spec.tpPct}%`,
  ].join('\n')
}

export async function sendPaperTelegram(text: string): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId || !text) return
  try {
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
  } catch { /* silent */ }
}
