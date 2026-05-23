import type { ScoreResult } from '@/types'

const TELEGRAM_API = 'https://api.telegram.org'

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 1)    return p.toFixed(4)
  if (p >= 0.001) return p.toFixed(6)
  return p.toFixed(8)
}

function buildMessage(r: ScoreResult): string {
  const icon  = r.recommendation === 'short' ? '🔴' : '🟡'
  const label = r.recommendation === 'short' ? 'ショート推奨' : '要検討'
  const stars = '⭐'.repeat(r.score) + '☆'.repeat(5 - r.score)
  const fr    = r.fundingRate !== 0
    ? `${r.fundingRate >= 0 ? '+' : ''}${(r.fundingRate * 100).toFixed(4)}%`
    : 'N/A'

  return [
    `${icon} <b>${label}</b>: <code>${r.symbol}</code>`,
    '',
    `スコア: ${stars} ${r.score}/5`,
    `初動ポンプ: +${r.initialPumpPct.toFixed(1)}%`,
    `上場からの経過: ${r.elapsedHours}時間`,
    `FR: ${fr}`,
    '',
    `現在価格: $${formatPrice(r.currentPrice)}`,
    `SL (+30%): $${formatPrice(r.slPrice)}`,
    `TP (−20%): $${formatPrice(r.tpPrice)}`,
  ].join('\n')
}

export async function sendTelegramAlert(results: ScoreResult[]): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  for (const r of results) {
    try {
      await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    chatId,
          text:       buildMessage(r),
          parse_mode: 'HTML',
        }),
      })
    } catch {
      // 送信失敗はサイレントに無視
    }
    // Telegram レートリミット対策
    await new Promise((r) => setTimeout(r, 300))
  }
}
