import crypto from 'crypto'
import type { MexcContract, MexcKlineResponse, MexcTickerItem } from '@/types'

const BASE_URL = 'https://contract.mexc.com/api/v1'

function buildHeaders(requireAuth = false): HeadersInit {
  if (!requireAuth) return { 'Content-Type': 'application/json' }

  const apiKey = process.env.MEXC_API_KEY ?? ''
  const apiSecret = process.env.MEXC_API_SECRET ?? ''
  const timestamp = Date.now().toString()
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(timestamp)
    .digest('hex')

  return {
    'Content-Type': 'application/json',
    'ApiKey': apiKey,
    'Request-Time': timestamp,
    'Signature': signature,
  }
}

type MexcEnvelope<T> = { success: boolean; code?: number; message?: string; data: T }

async function get<T>(path: string, params?: Record<string, string | number>, requireAuth = false): Promise<MexcEnvelope<T>> {
  const url = new URL(`${BASE_URL}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    headers: buildHeaders(requireAuth),
    next: { revalidate: 0 },
  })
  if (!res.ok) {
    throw new Error(`MEXC HTTP ${res.status} ${res.statusText} (${path})`)
  }
  const json = await res.json() as MexcEnvelope<T>
  if (!json.success) {
    const err = new Error(`MEXC code=${json.code ?? '?'}: ${json.message ?? 'unknown error'} (${path})`)
    // code=510 はレート制限。呼び出し側でリトライできるよう識別できるプロパティを付与
    ;(err as Error & { code?: number }).code = json.code
    throw err
  }
  return json
}

export async function getContractList(): Promise<MexcContract[]> {
  const res = await get<MexcContract[]>('/contract/detail')
  return res.data
}

export async function getKline(
  symbol: string,
  start: number,
  end: number,
  interval = 'Min60'
): Promise<MexcKlineResponse['data']> {
  const res = await get<MexcKlineResponse['data']>(`/contract/kline/${symbol}`, {
    interval,
    start,
    end,
  })
  return res.data
}

export async function getTickers(): Promise<MexcTickerItem[]> {
  const res = await get<MexcTickerItem[]>('/contract/ticker')
  return res.data
}

export async function getTickerPrice(symbol: string): Promise<number | null> {
  try {
    const res = await get<MexcTickerItem>('/contract/ticker', { symbol })
    const item = Array.isArray(res.data) ? res.data[0] : res.data
    if (!item?.lastPrice) return null
    return parseFloat(item.lastPrice)
  } catch {
    return null
  }
}

export function recentContracts(contracts: MexcContract[], days: number): MexcContract[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return contracts.filter((c) => c.state === 0 && c.createTime >= cutoff)
}

// STOCK銘柄: SAMSUNGSTOCK_USDT のように "STOCK_USDT" で終わる
const STOCK_PATTERN = /STOCK_USDT$/i

// コモディティ銘柄: 貴金属・原油・産業金属など
// 新しい銘柄が現れたらここに追記する
const COMMODITY_PATTERNS: RegExp[] = [
  /^XAU/i,       // 金
  /^XAG/i,       // 銀
  /^XPT/i,       // プラチナ
  /^XPD/i,       // パラジウム
  /OIL_/i,       // 原油 (CRUDEOIL_USDT 等)
  /^WTI/i,       // WTI原油
  /^BRENT/i,     // ブレント原油
  /^ALUMINUM/i,  // アルミニウム
  /^COPPER_/i,   // 銅
  /^NICKEL_/i,   // ニッケル
  /^ZINC_/i,     // 亜鉛
  /^LEAD_/i,     // 鉛
  /^TIN_/i,      // スズ
  /_USD1$/i,     // USD1ペア (USDT 以外の別建てペア)
]

export function getSymbolCategory(symbol: string): 'crypto' | 'stock' | 'commodity' {
  if (STOCK_PATTERN.test(symbol)) return 'stock'
  if (COMMODITY_PATTERNS.some((p) => p.test(symbol))) return 'commodity'
  return 'crypto'
}
