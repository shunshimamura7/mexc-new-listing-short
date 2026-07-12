import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'data', 'kline');

const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
const recs = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8'));
  delete r.data; // don't hold all the candles in memory
  recs.push(r);
}

let failed = [];
try {
  failed = JSON.parse(await readFile(path.join(HERE, 'data', 'failed.json'), 'utf8'));
} catch {}

console.log(`=== 1. success / failure ===`);
console.log(`success: ${recs.length}`);
console.log(`failed : ${failed.length}`);
if (failed.length) {
  const byReason = new Map();
  for (const f of failed) {
    const key = f.reason.replace(/\d+/g, 'N');
    byReason.set(key, [...(byReason.get(key) ?? []), f.symbol]);
  }
  for (const [reason, syms] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  [${syms.length}] ${reason}`);
    console.log(`      ${syms.slice(0, 15).join(', ')}${syms.length > 15 ? ` ... (+${syms.length - 15})` : ''}`);
  }
}

const bucketize = (vals, edges, label) => {
  console.log(`\n${label}`);
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i];
    const hi = edges[i + 1] ?? Infinity;
    const n = vals.filter((v) => v >= lo && v < hi).length;
    const bar = '#'.repeat(Math.round((n / vals.length) * 50));
    console.log(`  ${String(lo).padStart(5)} .. ${(hi === Infinity ? 'inf' : String(hi)).padStart(5)} : ${String(n).padStart(4)}  ${bar}`);
  }
};

const stats = (vals) => {
  const s = [...vals].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `min=${s[0].toFixed(2)} p25=${q(0.25).toFixed(2)} median=${q(0.5).toFixed(2)} p75=${q(0.75).toFixed(2)} p95=${q(0.95).toFixed(2)} max=${s[s.length - 1].toFixed(2)}`;
};

// --- 2. diffDays ---
const diff = recs.map((r) => r.diffDays);
console.log(`\n\n=== 2. diffDays (t0 - createTime, in days) ===`);
console.log(stats(diff));
bucketize(diff, [-1, 0, 0.042, 0.25, 1, 3, 7, 30, 90, 180], 'distribution:');
const off1 = recs.filter((r) => r.diffDays >= 1);
console.log(`\n>>> diffDays >= 1 day : ${off1.length} / ${recs.length} (${((off1.length / recs.length) * 100).toFixed(1)}%)`);
console.log(`>>> diffDays >= 7 days: ${recs.filter((r) => r.diffDays >= 7).length}`);
console.log(`\nworst 20 (largest gap between contract creation and first traded bar):`);
for (const r of [...recs].sort((a, b) => b.diffDays - a.diffDays).slice(0, 20)) {
  console.log(`  ${r.symbol.padEnd(22)} diffDays=${String(r.diffDays).padStart(8)}  create=${r.createTimeIso.slice(0, 10)} t0=${r.t0Iso.slice(0, 10)}`);
}

// --- 3. actualDays ---
const act = recs.map((r) => r.actualDays);
console.log(`\n\n=== 3. actualDays (span of real bars from t0) ===`);
console.log(stats(act));
bucketize(act, [0, 1, 3, 7, 14, 21, 29, 29.9], 'distribution:');
const full = recs.filter((r) => r.actualDays >= 29.9);
console.log(`\n>>> full 30d available : ${full.length} / ${recs.length} (${((full.length / recs.length) * 100).toFixed(1)}%)`);
console.log(`>>> < 7d available     : ${recs.filter((r) => r.actualDays < 7).length}`);

const futured = recs.filter((r) => r.futureDropped > 0);
console.log(`\nfuture bars dropped: ${futured.length} symbols, ${futured.reduce((s, r) => s + r.futureDropped, 0)} bars total`);
const zeroish = recs.filter((r) => r.bars < 24);
console.log(`symbols with < 24 real bars: ${zeroish.length}${zeroish.length ? ` (${zeroish.map((r) => r.symbol).slice(0, 10).join(', ')})` : ''}`);
