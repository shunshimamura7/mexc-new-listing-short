import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'data', 'kline');
const OUT_DIR = path.join(HERE, 'out');

const HOUR = 3600;
const FEE = 0.04;

const ENTRY_H = [6, 12, 24, 48, 72];
const SLS = [10, 15, 20, 25, 30, 40, 50];
const TPS = [3, 5, 8, 10, 15, 20, 30];
const HOLDS = [3, 7, 14];

// ---- load all klines once ----
const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
const universe = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8'));
  const d = r.data;
  if (!d.time.length) continue;
  universe.push({
    symbol: r.symbol,
    t0: Math.floor(r.t0 / 1000),
    time: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  });
}
console.log(`universe: ${universe.length} symbols, ${ENTRY_H.length * SLS.length * TPS.length * HOLDS.length} cells\n`);

// entry index per (symbol, entryH) — precomputed, same for every SL/TP/hold
const entryIdx = new Map();
for (const h of ENTRY_H) {
  entryIdx.set(h, universe.map((s) => s.time.indexOf(s.t0 + h * HOUR)));
}

function simulate(s, ei, slPct, tpPct, holdDays) {
  const entry = s.open[ei];
  if (!(entry > 0)) return null;
  const slPrice = entry * (1 + slPct / 100);
  const tpPrice = entry * (1 - tpPct / 100);
  const deadline = s.time[ei] + holdDays * 24 * HOUR;

  let lastClose = null;
  let bothTouched = false;
  for (let i = ei + 1; i < s.time.length; i++) {
    if (s.time[i] > deadline) break;
    const hitSL = s.high[i] >= slPrice;
    const hitTP = s.low[i] <= tpPrice;
    if (hitSL && hitTP) bothTouched = true;
    if (hitSL) return { outcome: 'SL', pnl: ((entry - slPrice) / entry) * 100 - FEE, bothTouched };
    if (hitTP) return { outcome: 'TP', pnl: ((entry - tpPrice) / entry) * 100 - FEE, bothTouched };
    lastClose = s.close[i];
  }
  if (lastClose == null) return null; // no bars after entry
  return { outcome: 'TIMEOUT', pnl: ((entry - lastClose) / entry) * 100 - FEE, bothTouched };
}

const med = (a) => { const x = [...a].sort((p, q) => p - q); return x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2; };

const cells = [];
for (const entryH of ENTRY_H) {
  const idx = entryIdx.get(entryH);
  for (const SL of SLS) {
    for (const TP of TPS) {
      for (const maxHold of HOLDS) {
        const pnls = [];
        let tp = 0, sl = 0, to = 0, toW = 0, toL = 0, both = 0, skipped = 0;
        for (let k = 0; k < universe.length; k++) {
          const ei = idx[k];
          if (ei === -1) { skipped++; continue; }
          const r = simulate(universe[k], ei, SL, TP, maxHold);
          if (!r) { skipped++; continue; }
          pnls.push(r.pnl);
          if (r.bothTouched) both++;
          if (r.outcome === 'TP') tp++;
          else if (r.outcome === 'SL') sl++;
          else { to++; r.pnl > 0 ? toW++ : toL++; }
        }
        const n = pnls.length;
        if (!n) continue;
        cells.push({
          entryH, SL, TP, maxHold, n, skipped,
          winRate: (pnls.filter((p) => p > 0).length / n) * 100,
          avgPnL: pnls.reduce((a, b) => a + b, 0) / n,
          medPnL: med(pnls),
          tpCount: tp, slCount: sl, timeoutCount: to, timeoutWin: toW, timeoutLoss: toL,
          timeoutRate: (to / n) * 100,
          bothTouched: both,
        });
      }
    }
  }
}

await mkdir(OUT_DIR, { recursive: true });
const header = 'entryH,SL,TP,maxHold,n,skipped,winRate,avgPnL,medPnL,tpCount,slCount,timeoutCount,timeoutWin,timeoutLoss,timeoutRate,bothTouched';
const csv = [header, ...cells.map((c) => [
  c.entryH, c.SL, c.TP, c.maxHold, c.n, c.skipped,
  c.winRate.toFixed(2), c.avgPnL.toFixed(3), c.medPnL.toFixed(3),
  c.tpCount, c.slCount, c.timeoutCount, c.timeoutWin, c.timeoutLoss,
  c.timeoutRate.toFixed(1), c.bothTouched,
].join(','))].join('\n');
await writeFile(path.join(OUT_DIR, 'grid.csv'), csv);
console.log(`wrote ${cells.length} cells -> research/out/grid.csv\n`);

const row = (c) =>
  `entryH=${String(c.entryH).padStart(2)}h SL=${String(c.SL).padStart(2)}% TP=${String(c.TP).padStart(2)}% hold=${String(c.maxHold).padStart(2)}d | ` +
  `n=${String(c.n).padStart(3)} win=${c.winRate.toFixed(1).padStart(5)}% avg=${c.avgPnL.toFixed(2).padStart(6)}% med=${c.medPnL.toFixed(2).padStart(6)}% | ` +
  `TP=${String(c.tpCount).padStart(3)} SL=${String(c.slCount).padStart(3)} TO=${String(c.timeoutCount).padStart(3)}(${c.timeoutWin}W/${c.timeoutLoss}L) TOrate=${c.timeoutRate.toFixed(0)}%`;

const big = cells.filter((c) => c.n >= 100);

console.log(`=== 1. best expectancy (n>=100) — TOP 20 of ${big.length} cells ===`);
for (const c of [...big].sort((a, b) => b.avgPnL - a.avgPnL).slice(0, 20)) console.log(row(c));

console.log(`\n=== 2. worst expectancy (n>=100) — BOTTOM 10 ===`);
for (const c of [...big].sort((a, b) => a.avgPnL - b.avgPnL).slice(0, 10)) console.log(row(c));

const decisive = big.filter((c) => c.timeoutRate < 20);
console.log(`\n=== 3. decisive cells (timeout rate < 20%, n>=100): ${decisive.length} cells — TOP 10 by expectancy ===`);
for (const c of [...decisive].sort((a, b) => b.avgPnL - a.avgPnL).slice(0, 10)) console.log(row(c));
if (!decisive.length) console.log('(none)');

console.log(`\n=== 4. best cell per entryH (n>=100) ===`);
for (const h of ENTRY_H) {
  const g = big.filter((c) => c.entryH === h);
  if (!g.length) { console.log(`entryH=${h}h: no cell with n>=100`); continue; }
  const best = g.reduce((a, b) => (b.avgPnL > a.avgPnL ? b : a));
  console.log(row(best));
}

const posBig = big.filter((c) => c.avgPnL > 0);
console.log(`\n--- sanity ---`);
console.log(`cells with positive expectancy (n>=100): ${posBig.length} / ${big.length} (${((posBig.length / big.length) * 100).toFixed(0)}%)`);
console.log(`overall avgPnL across all n>=100 cells: ${(big.reduce((a, b) => a + b.avgPnL, 0) / big.length).toFixed(3)}%`);
console.log(`same-bar SL+TP hits (max across cells): ${Math.max(...cells.map((c) => c.bothTouched))}`);
