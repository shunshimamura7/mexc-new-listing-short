import crypto from 'crypto'
import type { MexcContract, MexcKlineResponse, MexcTickerItem } from '@/types'

const BASE_URL = 'https://futures.mexc.com/api/v1'

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

async function get<T>(path: string, params?: Record<string, string | number>, requireAuth = false): Promise<T> {
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
    throw new Error(`MEXC API error: ${res.status} ${res.statusText} (${path})`)
  }
  return res.json() as Promise<T>
}

export async function getContractList(): Promise<MexcContract[]> {
  const data = await get<{ success: boolean; data: MexcContract[] }>('/contract/list')
  return data.data
}

export async function getKline(
  symbol: string,
  start: number,
  end: number,
  interval = 'Hour1'
): Promise<MexcKlineResponse['data']> {
  const data = await get<MexcKlineResponse>(`/contract/kline/${symbol}`, {
    interval,
    start,
    end,
  })
  return data.data
}

export async function getTickers(): Promise<MexcTickerItem[]> {
  const data = await get<{ success: boolean; data: MexcTickerItem[] }>('/contract/ticker')
  return data.data
}

export function recentContracts(contracts: MexcContract[], days: number): MexcContract[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return contracts.filter((c) => c.createTime >= cutoff)
}
