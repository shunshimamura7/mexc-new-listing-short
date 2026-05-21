import fs from 'fs'
import path from 'path'
import type { ListingData } from '@/types'

const DATA_DIR = path.join(process.cwd(), 'data')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function filePath(symbol: string): string {
  return path.join(DATA_DIR, `${symbol}.json`)
}

export function saveListing(data: ListingData): void {
  ensureDir()
  fs.writeFileSync(filePath(data.symbol), JSON.stringify(data, null, 2), 'utf-8')
}

export function loadListing(symbol: string): ListingData | null {
  const p = filePath(symbol)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as ListingData
}

export function loadAllListings(): ListingData[] {
  ensureDir()
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')) as ListingData)
}

export function listSymbols(): string[] {
  ensureDir()
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
}

export function deleteListing(symbol: string): void {
  const p = filePath(symbol)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

export function deleteAll(): void {
  ensureDir()
  for (const f of fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))) {
    fs.unlinkSync(path.join(DATA_DIR, f))
  }
}

export function storageStats(): { count: number; bytes: number } {
  ensureDir()
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))
  const bytes = files.reduce((acc, f) => acc + fs.statSync(path.join(DATA_DIR, f)).size, 0)
  return { count: files.length, bytes }
}
