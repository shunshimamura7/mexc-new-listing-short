import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'data', 'kline');

const HOUR = 3600;
const FEE = 0.04;
const BASE = { entryH: 24, SL: 30, TP: 20, hold: 7 };
const SLS = [10, 15, 20, 25, 30, 40, 50];
const TPS = [3, 5, 8, 10, 15, 20, 30];

const detail = JSON.parse(await readFile(path.join(HERE, 'detail.json'), 'utf8'));
const createMap = new Map(detail.data.map((c) => [c.symbol, c.createTime]));

const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
const U = [];
let bigDiff = 0;
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8'));
  const d = r.data;
  if (!d.time.length) continue;
  if (r.diffDays >= 1) bigDiff++;
  const t0 = Math.floor(r.t0 / 1000);
  const cut = t0 + 24 * HOUR;
  let hi = -Infinity, k = 0;
  for (let i = 0; i < d.time.length && d.time[i] < cut; i++) { if (d.high[i] > hi) hi = d.high[i]; k++; }
  const firstOpen = d.open[0];
  if (!k || !(firstOpen > 0)) continue;
  U.push({
    symbol: r.symbol, t0, createTime: r.createTime, diffDays: r.diffDays,
    time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
    pump24: hi / firstOpen - 1,
  });
}

function simulate(s, entryH, slPct, tpPct, holdDays) {
  const ei = s.time.indexOf(s.t0 + entryH * HOUR);
  if (ei === -1) return null;
  const entry = s.open[ei];
  if (!(entry > 0)) return null;
  const slPrice = entry * (1 + slPct / 100);
  const tpPrice = entry * (1 - tpPct / 100);
  const deadline = s.time[ei] + holdDays * 24 * HOUR;
  let lastClose = null;
  for (let i = ei + 1; i < s.time.length; i++) {
    if (s.time[i] > deadline) break;
    if (s.high[i] >= slPrice) return { o: 'SL', pnl: ((entry - slPrice) / entry) * 100 - FEE };
    if (s.low[i] <= tpPrice) return { o: 'TP', pnl: ((entry - tpPrice) / entry) * 100 - FEE };
    lastClose = s.close[i];
  }
  if (lastClose == null) return null;
  return { o: 'TIMEOUT', pnl: ((entry - lastClose) / entry) * 100 - FEE };
}

function stats(trades) {
  const t = trades.filter(Boolean);
  const n = t.length;
  if (!n) return null;
  const p = t.map((x) => x.pnl);
  const avg = p.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(p.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  return { n, avg, sd, se, t: avg / se, win: (p.filter((x) => x > 0).length / n) * 100,
    tp: t.filter((x) => x.o === 'TP').length, sl: t.filter((x) => x.o === 'SL').length, to: t.filter((x) => x.o === 'TIMEOUT').length };
}

// ---- 1 ----
console.log(`=== 1. universe ===`);
console.log(`cached symbols with bars : ${U.length}`);
const oldest = U.reduce((a, b) => (a.createTime < b.createTime ? a : b));
console.log(`oldest createTime        : ${new Date(oldest.createTime).toISOString().slice(0, 10)} (${oldest.symbol})`);
console.log(`diffDays >= 1 day        : ${bigDiff} (${((bigDiff / U.length) * 100).toFixed(1)}%)`);

// ---- 2 ----
const EDGES = [0, 0.05, 0.10, 0.20, 0.30, 0.50, 1.0, 2.0, Infinity];
const LABELS = ['0-5%', '5-10%', '10-20%', '20-30%', '30-50%', '50-100%', '100-200%', '200%+'];
console.log(`\n=== 2. pump24 buckets ===`);
for (let i = 0; i < LABELS.length; i++) {
  const m = U.filter((s) => s.pump24 >= EDGES[i] && s.pump24 < EDGES[i + 1]);
  console.log(`${LABELS[i].padEnd(10)} ${String(m.length).padStart(4)}`);
}
const negp = U.filter((s) => s.pump24 < 0).length;
if (negp) console.log(`${'(<0)'.padEnd(10)} ${String(negp).padStart(4)}`);
const BIG = U.filter((s) => s.pump24 >= 1.0);
console.log(`\n>>> pump24 >= 100% : ${BIG.length} symbols (was 23 in the 365d universe)`);

// ---- 3 ----
console.log(`\n=== 3. pump24 >= 100%, baseline entryH=${BASE.entryH}h SL=${BASE.SL} TP=${BASE.TP} hold=${BASE.hold}d ===`);
const st = stats(BIG.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold)));
if (st) {
  console.log(`n=${st.n}  win=${st.win.toFixed(1)}%  avg=${st.avg.toFixed(2)}%  sd=${st.sd.toFixed(1)}  se=${st.se.toFixed(2)}  t=${st.t.toFixed(2)}  ${Math.abs(st.t) > 2 ? '★' : ''}`);
  console.log(`outcomes: TP=${st.tp} SL=${st.sl} TIMEOUT=${st.to}`);
}

// ---- 4 ----
function gridScan(members, label) {
  const cells = [];
  for (const SL of SLS) for (const TP of TPS) {
    const s = stats(members.map((x) => simulate(x, BASE.entryH, SL, TP, BASE.hold)));
    if (s) cells.push({ SL, TP, ...s });
  }
  const pos = cells.filter((c) => c.avg > 0);
  const sig = cells.filter((c) => c.t > 2);
  const mean = cells.reduce((a, b) => a + b.avg, 0) / cells.length;
  console.log(`\n--- ${label} ---`);
  console.log(`cells: ${cells.length}   positive: ${pos.length} (${((pos.length / cells.length) * 100).toFixed(0)}%)   t>2: ${sig.length}`);
  console.log(`mean expectancy across cells: ${mean.toFixed(2)}%   best=${Math.max(...cells.map((c) => c.avg)).toFixed(2)}%  worst=${Math.min(...cells.map((c) => c.avg)).toFixed(2)}%`);
  return cells;
}

console.log(`\n=== 4. SL/TP grid (49 cells) — is the sign STABLE, not just best-cell? ===`);
const bigCells = gridScan(BIG, `pump24 >= 100%  (n≈${st?.n})`);
gridScan(U, `CONTROL: whole universe (n≈${U.length})`);
gridScan(U.filter((s) => s.pump24 < 1.0), `CONTROL: pump24 < 100%`);

console.log(`\nheatmap of avgPnL for pump24 >= 100% (rows=SL, cols=TP):`);
console.log(`      ${TPS.map((t) => String(t).padStart(7)).join('')}`);
for (const SL of SLS) {
  const row = TPS.map((TP) => {
    const c = bigCells.find((x) => x.SL === SL && x.TP === TP);
    return (c ? c.avg.toFixed(1) : '-').padStart(7);
  }).join('');
  console.log(`SL=${String(SL).padStart(2)} ${row}`);
}
console.log(`\n(n per cell = ${bigCells[0]?.n})`);
