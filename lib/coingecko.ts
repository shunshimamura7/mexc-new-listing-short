import type { CoinGeckoData } from '@/types'

const BASE = 'https://api.coingecko.com/api/v3'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// シンボル（例: BTC_USDT, ETH_USD1）からベースティッカーを抽出
function extractTicker(symbol: string): string {
  return symbol
    .replace(/_USDT$/i, '')
    .replace(/_USD1$/i, '')
    .replace(/_USDC$/i, '')
    .toLowerCase()
}

async function searchCoinId(ticker: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/search?query=${encodeURIComponent(ticker)}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const json = await res.json()
    const coins = (json.coins ?? []) as { id: string; symbol: string }[]
    const exact = coins.find((c) => c.symbol.toLowerCase() === ticker.toLowerCase())
    return exact?.id ?? coins[0]?.id ?? null
  } catch {
    return null
  }
}

async function fetchCoinData(coinId: string): Promise<CoinGeckoData> {
  try {
    const res = await fetch(
      `${BASE}/coins/${encodeURIComponent(coinId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 3600 } }
    )
    if (!res.ok) return { fdvUsd: null, marketCapUsd: null }
    const json = await res.json()
    return {
      fdvUsd:       json.market_data?.fdv_usd         ?? null,
      marketCapUsd: json.market_data?.market_cap?.usd ?? null,
    }
  } catch {
    return { fdvUsd: null, marketCapUsd: null }
  }
}

// シンボルからFDV・時価総額を取得（失敗時は null を返す）
export async function getCoinGeckoData(symbol: string): Promise<CoinGeckoData> {
  const ticker = extractTicker(symbol)
  const coinId = await searchCoinId(ticker)
  if (!coinId) return { fdvUsd: null, marketCapUsd: null }

  await sleep(500)

  return fetchCoinData(coinId)
}
