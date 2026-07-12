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

const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
const U = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8'));
  const d = r.data;
  if (!d.time.length) continue;
  const t0 = Math.floor(r.t0 / 1000);
  const cut = t0 + 24 * HOUR;
  let hi = -Infinity, k = 0;
  for (let i = 0; i < d.time.length && d.time[i] < cut; i++) { if (d.high[i] > hi) hi = d.high[i]; k++; }
  const firstOpen = d.open[0];
  if (!k || !(firstOpen > 0)) continue;
  const dt = new Date(r.t0);
  const cohort = `${dt.getUTCFullYear()}H${dt.getUTCMonth() < 6 ? 1 : 2}`;
  U.push({
    symbol: r.symbol, t0, cohort, createTime: r.createTime,
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
  return { n, avg, sd, se, t: avg / se, win: (p.filter((x) => x > 0).length / n) * 100 };
}

function gridScan(members) {
  const cells = [];
  for (const SL of SLS) for (const TP of TPS) {
    const s = stats(members.map((x) => simulate(x, BASE.entryH, SL, TP, BASE.hold)));
    if (s) cells.push({ SL, TP, ...s });
  }
  if (!cells.length) return null;
  return {
    posPct: (cells.filter((c) => c.avg > 0).length / cells.length) * 100,
    cellMean: cells.reduce((a, b) => a + b.avg, 0) / cells.length,
    best: Math.max(...cells.map((c) => c.avg)),
    worst: Math.min(...cells.map((c) => c.avg)),
    sig: cells.filter((c) => c.t > 2).length,
  };
}

const COHORTS = ['2023H2', '2024H1', '2024H2', '2025H1', '2025H2', '2026H1'];
const groups = COHORTS.map((c) => ({ cohort: c, members: U.filter((s) => s.cohort === c) }));
const other = U.filter((s) => !COHORTS.includes(s.cohort));

console.log(`universe: ${U.length} symbols with bars (cohort by t0, not createTime)`);
if (other.length) console.log(`outside the 6 cohorts: ${other.length} (${[...new Set(other.map((s) => s.cohort))].join(', ')})`);

console.log(`\n${'='.repeat(112)}`);
console.log(`1-2. baseline  entryH=${BASE.entryH}h SL=${BASE.SL}% TP=${BASE.TP}% hold=${BASE.hold}d      ★ = |t| > 2`);
console.log('='.repeat(112));
console.log(`${'cohort'.padEnd(9)}${'n'.padStart(5)}${'win'.padStart(8)}${'avgPnL'.padStart(9)}${'SD'.padStart(7)}${'SE'.padStart(7)}${'t'.padStart(7)}`);
for (const g of groups) {
  const s = stats(g.members.map((m) => simulate(m, BASE.entryH, BASE.SL, BASE.TP, BASE.hold)));
  if (!s) { console.log(`${g.cohort.padEnd(9)}${String(g.members.length).padStart(5)}  (no trades)`); continue; }
  console.log(
    `${g.cohort.padEnd(9)}${String(s.n).padStart(5)}${(s.win.toFixed(1) + '%').padStart(8)}${(s.avg.toFixed(2) + '%').padStart(9)}` +
    `${s.sd.toFixed(1).padStart(7)}${s.se.toFixed(2).padStart(7)}${s.t.toFixed(2).padStart(7)} ${Math.abs(s.t) > 2 ? '★' : ''}${s.n < 30 ? '  <-- n<30' : ''}`
  );
}

console.log(`\n${'='.repeat(112)}`);
console.log(`3. SL/TP grid (49 cells) per cohort  —  positive-cell share is the real edge indicator`);
console.log('='.repeat(112));
console.log(`${'cohort'.padEnd(9)}${'n'.padStart(5)}${'positive cells'.padStart(16)}${'cellMean'.padStart(10)}${'best'.padStart(8)}${'worst'.padStart(8)}${'t>2'.padStart(6)}`);
for (const g of groups) {
  const gs = gridScan(g.members);
  if (!gs) { console.log(`${g.cohort.padEnd(9)}${String(g.members.length).padStart(5)}  (no cells)`); continue; }
  const n = stats(g.members.map((m) => simulate(m, BASE.entryH, BASE.SL, BASE.TP, BASE.hold)))?.n ?? 0;
  console.log(
    `${g.cohort.padEnd(9)}${String(n).padStart(5)}${(gs.posPct.toFixed(0) + '%').padStart(16)}` +
    `${(gs.cellMean.toFixed(2) + '%').padStart(10)}${(gs.best.toFixed(1) + '%').padStart(8)}${(gs.worst.toFixed(1) + '%').padStart(8)}${String(gs.sig).padStart(6)}`
  );
}
const all = gridScan(U);
console.log(`${'ALL'.padEnd(9)}${String(U.length).padStart(5)}${(all.posPct.toFixed(0) + '%').padStart(16)}${(all.cellMean.toFixed(2) + '%').padStart(10)}${(all.best.toFixed(1) + '%').padStart(8)}${(all.worst.toFixed(1) + '%').padStart(8)}${String(all.sig).padStart(6)}`);

console.log(`\n${'='.repeat(112)}`);
console.log(`4. pump24 distribution per cohort  (share of "dead" listings = pump24 < 5%)`);
console.log('='.repeat(112));
const EDGES = [0, 0.05, 0.10, 0.20, 0.50, 1.0, Infinity];
const LAB = ['<5%', '5-10%', '10-20%', '20-50%', '50-100%', '100%+'];
console.log(`${'cohort'.padEnd(9)}${'n'.padStart(5)}  ${LAB.map((l) => l.padStart(9)).join('')}   | STOCK-named`);
for (const g of groups) {
  const m = g.members;
  if (!m.length) continue;
  const cells = LAB.map((_, i) => m.filter((s) => s.pump24 >= EDGES[i] && s.pump24 < EDGES[i + 1]).length);
  const stock = m.filter((s) => /STOCK/i.test(s.symbol.split('_')[0])).length;
  console.log(
    `${g.cohort.padEnd(9)}${String(m.length).padStart(5)}  ` +
    cells.map((c) => `${((c / m.length) * 100).toFixed(0)}%`.padStart(9)).join('') +
    `   | ${((stock / m.length) * 100).toFixed(0)}% (${stock})`
  );
}

console.log(`\n${'='.repeat(112)}`);
console.log(`5. SURVIVORSHIP: how many contracts from each cohort are still listed today?`);
console.log(`   detail.json only contains CURRENTLY-LISTED contracts. Delisted ones are invisible.`);
console.log('='.repeat(112));
console.log(`${'cohort'.padEnd(9)}${'surviving'.padStart(11)}${'months ago'.padStart(12)}   (bar = surviving listings)`);
const now = Date.now();
for (const g of groups) {
  const n = g.members.length;
  const mid = g.members.length ? g.members.reduce((a, b) => a + b.t0, 0) / g.members.length : 0;
  const monthsAgo = mid ? (now / 1000 - mid) / (30.44 * 86400) : 0;
  console.log(`${g.cohort.padEnd(9)}${String(n).padStart(11)}${monthsAgo.toFixed(0).padStart(12)}   ${'#'.repeat(Math.round(n / 4))}`);
}
console.log(`\nMEXC listed roughly 20-100 perp contracts per month over this period (see the monthly table from`);
console.log(`the earlier detail.json pass). If the true listing rate was flat, a flat survivor count would be`);
console.log(`expected too. A declining count as you go back in time = contracts that were delisted and erased.`);
