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

export function recentContracts(contracts: MexcContract[], days: number): MexcContract[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return contracts.filter((c) => c.state === 0 && c.createTime >= cutoff)
}
