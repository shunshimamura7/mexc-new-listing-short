import type { ListingData, GridsearchLatestData } from '@/types'

// ローカル環境: fs / 本番環境(Vercel): @vercel/blob
const IS_VERCEL = !!process.env.BLOB_READ_WRITE_TOKEN

// ===== Vercel Blob 実装 =====
async function blobList(): Promise<string[]> {
  const { list } = await import('@vercel/blob')
  const { blobs } = await list({ prefix: 'listings/' })
  return blobs.map((b) => b.pathname.replace('listings/', '').replace('.json', ''))
}

async function blobFetch(url: string): Promise<ListingData | null> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN ?? ''}` },
  })
  if (!res.ok) return null
  return res.json() as Promise<ListingData>
}

async function blobLoad(symbol: string): Promise<ListingData | null> {
  const { list } = await import('@vercel/blob')
  const { blobs } = await list({ prefix: `listings/${symbol}.json` })
  if (blobs.length === 0) return null
  return blobFetch(blobs[0].url)
}

async function blobLoadAll(): Promise<ListingData[]> {
  const { list } = await import('@vercel/blob')
  const { blobs } = await list({ prefix: 'listings/' })
  const results = await Promise.all(blobs.map((b) => blobFetch(b.url)))
  return results.filter((r): r is ListingData => r !== null)
}

async function blobSave(data: ListingData): Promise<void> {
  const { put } = await import('@vercel/blob')
  await put(`listings/${data.symbol}.json`, JSON.stringify(data), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}

async function blobDelete(symbol: string): Promise<void> {
  const { list, del } = await import('@vercel/blob')
  const { blobs } = await list({ prefix: `listings/${symbol}.json` })
  if (blobs.length > 0) await del(blobs[0].url)
}

async function blobDeleteAll(): Promise<void> {
  const { list, del } = await import('@vercel/blob')
  const { blobs } = await list({ prefix: 'listings/' })
  await Promise.all(blobs.map((b) => del(b.url)))
}

// ===== ローカル fs 実装 =====
function fsImpl() {
  // Dynamic require to avoid bundling fs in edge runtime
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs   = require('fs')   as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path')
  const DATA_DIR = path.join(process.cwd(), 'data')
  const ensure = () => { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }) }
  const fp = (s: string) => path.join(DATA_DIR, `${s}.json`)
  return { fs, path, DATA_DIR, ensure, fp }
}

// ===== 公開 API (同期/非同期を統一して async に) =====
export async function saveListing(data: ListingData): Promise<void> {
  if (IS_VERCEL) return blobSave(data)
  const { fs, ensure, fp } = fsImpl()
  ensure()
  fs.writeFileSync(fp(data.symbol), JSON.stringify(data, null, 2), 'utf-8')
}

export async function loadListing(symbol: string): Promise<ListingData | null> {
  if (IS_VERCEL) return blobLoad(symbol)
  const { fs, ensure, fp } = fsImpl()
  ensure()
  const p = fp(symbol)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as ListingData
}

export async function loadAllListings(): Promise<ListingData[]> {
  if (IS_VERCEL) return blobLoadAll()
  const { fs, path, DATA_DIR, ensure } = fsImpl()
  ensure()
  return fs
    .readdirSync(DATA_DIR)
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')) as ListingData)
}

export async function listSymbols(): Promise<string[]> {
  if (IS_VERCEL) return blobList()
  const { fs, DATA_DIR, ensure } = fsImpl()
  ensure()
  return fs.readdirSync(DATA_DIR).filter((f: string) => f.endsWith('.json')).map((f: string) => f.replace('.json', ''))
}

export async function deleteListing(symbol: string): Promise<void> {
  if (IS_VERCEL) return blobDelete(symbol)
  const { fs, ensure, fp } = fsImpl()
  ensure()
  const p = fp(symbol)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

export async function deleteAll(): Promise<void> {
  if (IS_VERCEL) return blobDeleteAll()
  const { fs, path, DATA_DIR, ensure } = fsImpl()
  ensure()
  for (const f of fs.readdirSync(DATA_DIR).filter((f: string) => f.endsWith('.json'))) {
    fs.unlinkSync(path.join(DATA_DIR, f))
  }
}

export async function saveGridsearchLatest(data: GridsearchLatestData): Promise<void> {
  if (IS_VERCEL) {
    const { put } = await import('@vercel/blob')
    await put('gridsearch/latest.json', JSON.stringify(data), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return
  }
  const { fs, ensure, fp } = fsImpl()
  ensure()
  fs.writeFileSync(fp('gridsearch-latest'), JSON.stringify(data, null, 2), 'utf-8')
}

export async function loadGridsearchLatest(): Promise<GridsearchLatestData | null> {
  if (IS_VERCEL) {
    const { list } = await import('@vercel/blob')
    const { blobs } = await list({ prefix: 'gridsearch/latest.json' })
    if (blobs.length === 0) return null
    const res = await fetch(blobs[0].url, {
      headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN ?? ''}` },
    })
    if (!res.ok) return null
    return res.json() as Promise<GridsearchLatestData>
  }
  const { fs, ensure, fp } = fsImpl()
  ensure()
  const p = fp('gridsearch-latest')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as GridsearchLatestData
}

export async function storageStats(): Promise<{ count: number; bytes: number }> {
  if (IS_VERCEL) {
    const { list } = await import('@vercel/blob')
    const { blobs } = await list({ prefix: 'listings/' })
    const bytes = blobs.reduce((s, b) => s + (b.size ?? 0), 0)
    return { count: blobs.length, bytes }
  }
  const { fs, path, DATA_DIR, ensure } = fsImpl()
  ensure()
  const files = fs.readdirSync(DATA_DIR).filter((f: string) => f.endsWith('.json'))
  const bytes = files.reduce((acc: number, f: string) => acc + fs.statSync(path.join(DATA_DIR, f)).size, 0)
  return { count: files.length, bytes }
}
