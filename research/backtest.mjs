import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'data', 'kline');

const HOUR = 3600;
const FEE = 0.04; // round-trip, in % of notional

// ---- params (A) ----
const P = { entryH: 24, SL: 0.30, TP: 0.20, maxHoldDays: 7 };

// ---- load ----
const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
const recs = [];
for (const f of files) recs.push(JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8')));
recs.sort((a, b) => a.t0 - b.t0);

// bar accessor: rows are column arrays, time is unix seconds
const rows = (r) =>
  r.data.time.map((t, i) => ({
    t,
    open: r.data.open[i],
    high: r.data.high[i],
    low: r.data.low[i],
    close: r.data.close[i],
    vol: r.data.vol[i],
  }));

function features(bars, t0) {
  const firstOpen = bars[0].open;
  const maxHighWithin = (h) => {
    const cut = t0 + h * HOUR;
    let m = -Infinity;
    for (const b of bars) {
      if (b.t >= cut) break;
      if (b.high > m) m = b.high;
    }
    return m;
  };
  return {
    firstOpen,
    pump6: maxHighWithin(6) / firstOpen - 1,
    pump12: maxHighWithin(12) / firstOpen - 1,
    pump24: maxHighWithin(24) / firstOpen - 1,
  };
}

function simulateShort(bars, t0, { entryH, SL, TP, maxHoldDays }) {
  const entryT = t0 + entryH * HOUR;
  const ei = bars.findIndex((b) => b.t === entryT);
  if (ei === -1) return { skipped: true, reason: 'no bar at entry time' };
  const entry = bars[ei].open;
  if (!(entry > 0)) return { skipped: true, reason: 'entry open is not positive' };

  const slPrice = entry * (1 + SL);
  const tpPrice = entry * (1 - TP);
  const deadline = entryT + maxHoldDays * 24 * HOUR;

  let bothTouched = false;
  for (let i = ei + 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.t > deadline) break;
    const hitSL = b.high >= slPrice;
    const hitTP = b.low <= tpPrice;
    if (hitSL && hitTP) bothTouched = true;
    if (hitSL) return mk('SL', slPrice, b, entry, bothTouched, i - ei);   // pessimistic: SL wins ties
    if (hitTP) return mk('TP', tpPrice, b, entry, bothTouched, i - ei);
  }

  // no touch within the window -> settle at the last bar we have inside it
  let last = null;
  for (let i = ei + 1; i < bars.length; i++) {
    if (bars[i].t > deadline) break;
    last = bars[i];
  }
  if (!last) return { skipped: true, reason: 'no bars after entry' };
  const heldFull = last.t >= deadline - HOUR;
  return { ...mk('TIMEOUT', last.close, last, entry, bothTouched, null), heldFull };
}

function mk(outcome, exit, bar, entry, bothTouched, barsHeld) {
  const pnl = ((entry - exit) / entry) * 100 - FEE;
  return { skipped: false, outcome, entry, exit, pnl, exitT: bar.t, bothTouched, barsHeld };
}

// ---- run ----
const results = [];
const skipped = [];
for (const r of recs) {
  const bars = rows(r);
  if (!bars.length) { skipped.push({ symbol: r.symbol, reason: 'no bars' }); continue; }
  const t0 = Math.floor(r.t0 / 1000);
  const f = features(bars, t0);
  const s = simulateShort(bars, t0, P);
  if (s.skipped) { skipped.push({ symbol: r.symbol, reason: s.reason, bars: bars.length, actualDays: r.actualDays }); continue; }
  results.push({ symbol: r.symbol, t0Iso: r.t0Iso, ...f, ...s });
}

// ---- report ----
const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

console.log(`=== [A] short, entry=t0+${P.entryH}h, SL=${P.SL * 100}%, TP=${P.TP * 100}%, maxHold=${P.maxHoldDays}d, fee=${FEE}% ===`);
console.log(`universe: ${recs.length} symbols (no filters)`);
console.log(`n (traded): ${results.length}   skipped: ${skipped.length}`);
if (skipped.length) {
  const byReason = new Map();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  for (const [k, v] of byReason) console.log(`   skip [${v}] ${k}`);
  console.log(`   e.g. ${skipped.slice(0, 8).map((s) => s.symbol).join(', ')}`);
}

const pnls = results.map((r) => r.pnl);
const wins = results.filter((r) => r.pnl > 0);
const total = pnls.reduce((a, b) => a + b, 0);

console.log(`\n--- performance ---`);
console.log(`win rate     : ${pct(wins.length, results.length)}  (${wins.length}W / ${results.length - wins.length}L)`);
console.log(`mean PnL     : ${(total / results.length).toFixed(2)}%  <- expectancy per trade`);
console.log(`median PnL   : ${med(pnls).toFixed(2)}%`);
console.log(`total PnL    : ${total.toFixed(1)}%  (sum over ${results.length} equal-size trades)`);

const byOutcome = { TP: [], SL: [], TIMEOUT: [] };
for (const r of results) byOutcome[r.outcome].push(r);
console.log(`\n--- outcomes ---`);
for (const k of ['TP', 'SL', 'TIMEOUT']) {
  const g = byOutcome[k];
  if (!g.length) { console.log(`${k.padEnd(8)}: 0`); continue; }
  const s = g.reduce((a, b) => a + b.pnl, 0);
  console.log(`${k.padEnd(8)}: ${String(g.length).padStart(3)} (${pct(g.length, results.length)})  mean=${(s / g.length).toFixed(2)}%  contrib=${s.toFixed(1)}%`);
}
const to = byOutcome.TIMEOUT;
const toW = to.filter((r) => r.pnl > 0);
console.log(`  timeout breakdown: ${toW.length} profitable / ${to.length - toW.length} losing`);
console.log(`  (of those, ${to.filter((r) => r.heldFull).length} held the full ${P.maxHoldDays}d; ${to.filter((r) => !r.heldFull).length} ran out of data early)`);

const sorted = [...results].sort((a, b) => a.pnl - b.pnl);
console.log(`\n--- extremes ---`);
console.log(`worst 5:`);
for (const r of sorted.slice(0, 5)) console.log(`  ${r.symbol.padEnd(22)} ${r.pnl.toFixed(2).padStart(8)}%  ${r.outcome}  pump24=${(r.pump24 * 100).toFixed(0)}%`);
console.log(`best 5:`);
for (const r of sorted.slice(-5).reverse()) console.log(`  ${r.symbol.padEnd(22)} ${r.pnl.toFixed(2).padStart(8)}%  ${r.outcome}  pump24=${(r.pump24 * 100).toFixed(0)}%`);

const both = results.filter((r) => r.bothTouched);
console.log(`\n--- same-bar SL+TP (resolved as SL, pessimistic) ---`);
console.log(`${both.length} trades (${pct(both.length, results.length)})`);
if (both.length) console.log(`  ${both.map((r) => r.symbol).slice(0, 12).join(', ')}${both.length > 12 ? ` ... (+${both.length - 12})` : ''}`);
