import { readFile } from 'node:fs/promises';

const json = JSON.parse(await readFile(new URL('./detail.json', import.meta.url), 'utf8'));
const now = Date.now();
const DAY = 86400_000;

const last365 = json.data.filter((c) => now - c.createTime <= 365 * DAY);

const ETF_INDEX = new Set([
  'SPY', 'QQQ', 'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'SOXX', 'SMH', 'ARKK', 'ARKG',
  'NAS100', 'SPX500', 'DJ30', 'US30', 'RUSSELL2000', 'IWM', 'DIA', 'VOO', 'VTI',
  'NVDL', 'NVDS', 'TSLL', 'TSLQ', 'MSTU', 'MSTX', 'MSTZ', 'CONL', 'AMDL', 'AAPU',
  'XLU', 'XLK', 'XLE', 'XLF', 'XLV', 'XLP', 'XLI', 'XLY', 'XBI', 'IBIT',
  'USO', 'UNG', 'GLD', 'SLV', 'INDA', 'EWJ', 'FXI', 'KWEB', 'KORU', 'MVLL',
  'UVXY', 'VIX', 'VXX', 'TLT', 'HYG', 'GDX', 'YINN', 'YANG', 'LABU', 'LABD',
]);

const COMMODITY = new Set([
  'XAU', 'XAG', 'XPT', 'XPD', 'GOLD', 'SILVER', 'PLATINUM', 'PALLADIUM',
  'OIL', 'WTI', 'BRENT', 'CRUDE', 'NATGAS', 'GAS',
  'ALUMINUM', 'ALUMINIUM', 'COPPER', 'NICKEL', 'ZINC', 'LEAD', 'TIN', 'IRON',
  'WHEAT', 'CORN', 'SOYBEAN', 'SUGAR', 'COFFEE', 'COCOA',
]);

const ESTABLISHED = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK',
  'DOT', 'MATIC', 'POL', 'LTC', 'BCH', 'SHIB', 'TON', 'UNI', 'ATOM', 'XLM',
  'ETC', 'FIL', 'APT', 'ARB', 'OP', 'NEAR', 'ICP', 'HBAR', 'VET', 'AAVE',
  'SUI', 'PEPE', 'XMR', 'ALGO', 'INJ',
]);

const baseOf = (symbol) => symbol.split('_')[0];

function categorize(symbol) {
  const base = baseOf(symbol).toUpperCase();
  if (base.includes('STOCK')) return 'STOCK';
  if (ETF_INDEX.has(base)) return 'ETF_INDEX';
  if (COMMODITY.has(base)) return 'COMMODITY';
  if (ESTABLISHED.has(base)) return 'ESTABLISHED';
  return 'CRYPTO_NEW';
}

const ORDER = ['STOCK', 'ETF_INDEX', 'COMMODITY', 'ESTABLISHED', 'CRYPTO_NEW'];

// --- 1. per-contract counts ---
const counts = new Map(ORDER.map((k) => [k, 0]));
for (const c of last365) counts.set(categorize(c.symbol), counts.get(categorize(c.symbol)) + 1);

console.log(`=== 1. contracts (last 365d) : ${last365.length} ===`);
for (const k of ORDER) console.log(`${k.padEnd(12)} ${String(counts.get(k)).padStart(4)}`);

// --- 2. unique by base coin ---
const uniq = new Map(); // base -> { base, cat, quotes[] }
for (const c of last365) {
  const base = baseOf(c.symbol).toUpperCase();
  if (!uniq.has(base)) uniq.set(base, { base, cat: categorize(c.symbol), quotes: [] });
  uniq.get(base).quotes.push(c.symbol.split('_').slice(1).join('_'));
}

const uCounts = new Map(ORDER.map((k) => [k, 0]));
for (const u of uniq.values()) uCounts.set(u.cat, uCounts.get(u.cat) + 1);

console.log(`\n=== 2. unique base coins (last 365d) : ${uniq.size} ===`);
for (const k of ORDER) console.log(`${k.padEnd(12)} ${String(uCounts.get(k)).padStart(4)}`);
const dupes = [...uniq.values()].filter((u) => u.quotes.length > 1);
console.log(`\n(bases listed with >1 quote currency: ${dupes.length})`);
for (const d of dupes) console.log(`  ${d.base}: ${d.quotes.join(', ')}`);

// --- 3. CRYPTO_NEW list ---
const cryptoNew = [...uniq.values()].filter((u) => u.cat === 'CRYPTO_NEW').map((u) => u.base).sort();
console.log(`\n=== 3. CRYPTO_NEW unique bases : ${cryptoNew.length} ===`);
console.log(cryptoNew.join('\n'));
