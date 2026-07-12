import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'data', 'kline-binance');

const files = (await readdir(CACHE)).filter((f) => f.endsWith('.json'));
const recs = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(CACHE, f), 'utf8'));
  delete r.data;
  recs.push(r);
}
recs.sort((a, b) => a.t0 - b.t0);

let failed = [];
try { failed = JSON.parse(await readFile(path.join(HERE, 'data', 'failed-binance.json'), 'utf8')); } catch {}

const info = JSON.parse(await readFile(path.join(HERE, 'data', 'exchange-info.json'), 'utf8'));
const universe = info.symbols.filter((s) => s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL');

const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;
const stats = (v) => { const s = [...v].sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `min=${s[0].toFixed(2)} p25=${q(.25).toFixed(2)} median=${q(.5).toFixed(2)} p75=${q(.75).toFixed(2)} p95=${q(.95).toFixed(2)} max=${s.at(-1).toFixed(2)}`; };
const bucket = (vals, edges, label) => {
  console.log(`\n${label}`);
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i], hi = edges[i + 1] ?? Infinity;
    const n = vals.filter((v) => v >= lo && v < hi).length;
    console.log(`  ${String(lo).padStart(6)} .. ${(hi === Infinity ? 'inf' : String(hi)).padStart(6)} : ${String(n).padStart(4)}  ${'#'.repeat(Math.round((n / vals.length) * 50))}`);
  }
};

console.log(`=== 1. 母数 ===`);
console.log(`universe (PERPETUAL + TRADIFI_PERPETUAL): ${universe.length}`);
console.log(`kline取得成功 : ${recs.length}`);
console.log(`失敗          : ${failed.length}`);
if (failed.length) {
  const by = new Map();
  for (const f of failed) by.set(f.reason.replace(/\d+/g, 'N'), [...(by.get(f.reason.replace(/\d+/g, 'N')) ?? []), f]);
  for (const [reason, fs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  [${fs.length}] ${reason}`);
    console.log(`      ${fs.slice(0, 12).map((f) => `${f.symbol}(${f.status})`).join(', ')}${fs.length > 12 ? ` ...+${fs.length - 12}` : ''}`);
  }
}
const byType = new Map(), byStatus = new Map();
for (const r of recs) {
  byType.set(r.contractType, (byType.get(r.contractType) ?? 0) + 1);
  byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
}
console.log(`\n取得成功の内訳:`);
console.log(`  contractType: ${JSON.stringify(Object.fromEntries(byType))}`);
console.log(`  status      : ${JSON.stringify(Object.fromEntries(byStatus))}`);

console.log(`\n\n=== 2. diffDays (t0 - onboardDate) — Binance にも createTime バグはあるか ===`);
const diff = recs.map((r) => r.diffDays);
console.log(stats(diff));
bucket(diff, [-1, 0, 0.042, 0.25, 1, 3, 7, 30, 90, 180], '分布:');
const d1 = recs.filter((r) => r.diffDays >= 1);
console.log(`\n>>> diffDays >= 1日 : ${d1.length} / ${recs.length} (${pct(d1.length, recs.length)})   [MEXC: 109/788 = 13.8%]`);
console.log(`>>> diffDays >= 7日 : ${recs.filter((r) => r.diffDays >= 7).length}   [MEXC: 16]`);
if (d1.length) {
  console.log(`\nズレが大きい順 TOP15:`);
  for (const r of [...recs].sort((a, b) => b.diffDays - a.diffDays).slice(0, 15)) {
    console.log(`  ${r.symbol.padEnd(16)} ${r.contractType.padEnd(20)} diffDays=${String(r.diffDays).padStart(8)}  onboard=${r.onboardIso.slice(0, 10)} t0=${r.t0Iso.slice(0, 10)}`);
  }
}

console.log(`\n\n=== 3. actualDays (t0からの実データ日数) ===`);
const act = recs.map((r) => r.actualDays);
console.log(stats(act));
bucket(act, [0, 1, 3, 7, 14, 21, 29, 29.9], '分布:');
const full = recs.filter((r) => r.actualDays >= 29.9);
console.log(`\n>>> 30日フル取得 : ${full.length} / ${recs.length} (${pct(full.length, recs.length)})   [MEXC: 72.4%]`);
console.log(`>>> 7日未満      : ${recs.filter((r) => r.actualDays < 7).length}`);
const fut = recs.filter((r) => r.futureDropped > 0);
console.log(`>>> 未来行を切った銘柄: ${fut.length} (計${fut.reduce((a, b) => a + b.futureDropped, 0)}本)   [MEXC: 35銘柄/8512本]`);

console.log(`\n\n=== 4. 上場日レンジ ===`);
console.log(`最古 t0 : ${recs[0].t0Iso}  (${recs[0].symbol})`);
console.log(`最新 t0 : ${recs.at(-1).t0Iso}  (${recs.at(-1).symbol})`);
console.log(`\n半期ごとの上場件数 (t0基準):`);
const coh = new Map();
for (const r of recs) {
  const d = new Date(r.t0);
  const c = `${d.getUTCFullYear()}H${d.getUTCMonth() < 6 ? 1 : 2}`;
  if (!coh.has(c)) coh.set(c, { n: 0, tradfi: 0 });
  coh.get(c).n++;
  if (r.contractType === 'TRADIFI_PERPETUAL') coh.get(c).tradfi++;
}
for (const c of [...coh.keys()].sort()) {
  const { n, tradfi } = coh.get(c);
  console.log(`  ${c}  ${String(n).padStart(4)}  ${'#'.repeat(Math.round(n / 3))}${tradfi ? `  (TRADIFI ${tradfi} = ${pct(tradfi, n)})` : ''}`);
}
