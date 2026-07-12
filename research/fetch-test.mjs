import { writeFile } from 'node:fs/promises';

const URL = 'https://contract.mexc.com/api/v1/contract/detail';
const OUT = new global.URL('./detail.json', import.meta.url);

const res = await fetch(URL);
const json = await res.json();
await writeFile(OUT, JSON.stringify(json, null, 2));
console.log(`saved -> ${OUT.pathname}`);

const data = json.data;
const now = Date.now();
const DAY = 86400_000;

const sorted = [...data].sort((a, b) => a.createTime - b.createTime);
const iso = (ms) => new Date(ms).toISOString();

console.log(`\ntotal: ${sorted.length}`);
console.log('\n=== 1. oldest / newest createTime ===');
const oldest = sorted[0];
const newest = sorted[sorted.length - 1];
console.log(`oldest: ${oldest.symbol} ${oldest.createTime} ${iso(oldest.createTime)}`);
console.log(`newest: ${newest.symbol} ${newest.createTime} ${iso(newest.createTime)}`);

const last365 = sorted.filter((c) => now - c.createTime <= 365 * DAY);
console.log('\n=== 2. created within last 365 days ===');
console.log(`${last365.length} / ${sorted.length}`);

console.log('\n=== 3. last-365d by month (YYYY-MM) ===');
const byMonth = new Map();
for (const c of last365) {
  const m = iso(c.createTime).slice(0, 7);
  byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
}
for (const m of [...byMonth.keys()].sort()) {
  console.log(`${m}  ${String(byMonth.get(m)).padStart(4)}`);
}

console.log('\n=== 4. last-365d symbols containing STOCK ===');
const stock = last365.filter((c) => c.symbol.toUpperCase().includes('STOCK'));
console.log(`${stock.length} / ${last365.length}`);

console.log('\n=== 5. symbols created within last 30 days ===');
const last30 = sorted.filter((c) => now - c.createTime <= 30 * DAY);
console.log(`${last30.length} symbols`);
for (const c of last30) {
  console.log(`${iso(c.createTime)}  ${c.symbol}`);
}
