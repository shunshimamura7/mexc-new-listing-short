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
  /^(SILVER|GOLD|PLATINUM|PALLADIUM|ALUMINUM|NICKEL|COPPER|ZINC|LEAD|TIN|IRON|STEEL|CORN|WHEAT|SOYBEAN|SUGAR|COTTON|COFFEE|COCOA|LUMBER|NATURALGAS|CRUDE)/i,
  /^(JP225|US30|US500|US100|UK100|DE40|FR40|HK50|SOXX|XLE|EWJ|EWY)_/i,  // 株価指数ETF
]

// 既存大型コイン（新規上場短期ショート戦略の対象外）
const ESTABLISHED_BASE_COINS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'MATIC',
  'POL', 'LINK', 'UNI', 'AAVE', 'LTC', 'BCH', 'ETC', 'FIL', 'ATOM', 'ALGO',
  'ICP', 'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'SEI', 'TIA', 'PYTH', 'JUP',
  'WIF', 'BONK', 'PEPE', 'SHIB', 'FLOKI', 'INJ', 'RUNE', 'EGLD', 'HBAR',
  'VET', 'IOTA', 'ZIL', 'THETA', 'FTM', 'ONE', 'SAND', 'MANA', 'AXS',
  'CHZ', 'ENJ', 'GALA', 'GMT', 'APE', 'LDO', 'RPL', 'SUSHI', 'CAKE',
  'BAL', 'CRV', 'SNX', 'GRT', '1INCH', 'DYDX', 'GMX', 'PENDLE',
  'MKR', 'COMP', 'YFI', 'BAT', 'ZRX', 'KNC', 'BAND', 'REN', 'STORJ',
  'LUNA', 'LUNC', 'TRX', 'XLM', 'XMR', 'ZEC', 'DASH', 'WAVES', 'ICX',
  'QTUM', 'ONT', 'ZEN', 'DCR', 'EOS', 'NANO', 'DGB', 'RVN', 'DENT',
  'HOT', 'WIN', 'BTT', 'JST', 'SUN', 'KAVA', 'CELO', 'SKL', 'OCEAN',
  'ANKR', 'CKB', 'CELR', 'CTSI', 'IOTX', 'OXT', 'NMR', 'AUDIO',
  'RAY', 'OKB', 'HT', 'CRO', 'FTT', 'LEO', 'GT', 'MX', 'KCS',
  'NEXO', 'WBTC', 'WETH', 'STETH', 'PAXG', 'XAUT',
  'TAO', 'HYPE', 'WLD', 'BLUR', 'CFX', 'MINA', 'SSV', 'STX',
  'ROSE', 'ACH', 'HIGH', 'T', 'GLMR', 'MOVR', 'ACA', 'PARA',
  'ENA', 'ETHFI', 'REZ', 'BB', 'OMNI', 'ZK', 'STRK', 'ALT',
  'MANTA', 'DYM', 'PIXEL', 'PORTAL', 'MEME', 'BOME', 'SLERF',
  'TNSR', 'SAGA', 'AEVO', 'W', 'SAFE', 'SUPER', 'DRIFT',
])

export function isEstablishedCoin(symbol: string): boolean {
  const base = symbol.replace(/_USDT$/, '').replace(/_USD1$/, '')
  return ESTABLISHED_BASE_COINS.has(base.toUpperCase())
}

export function getSymbolCategory(symbol: string): 'crypto' | 'stock' | 'commodity' {
  if (STOCK_PATTERN.test(symbol)) return 'stock'
  if (COMMODITY_PATTERNS.some((p) => p.test(symbol))) return 'commodity'
  return 'crypto'
}
