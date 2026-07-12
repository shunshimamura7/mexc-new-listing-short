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

// ---------- load + featurize ----------
const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
const U = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8'));
  const d = r.data;
  if (!d.time.length) continue;
  const t0 = Math.floor(r.t0 / 1000);
  const cut = t0 + 24 * HOUR;

  // window [t0, t0+24h) — strictly before the entry bar, so no lookahead
  let hi = -Infinity, lo = Infinity, volSum = 0, k = 0;
  for (let i = 0; i < d.time.length && d.time[i] < cut; i++) {
    if (d.high[i] > hi) hi = d.high[i];
    if (d.low[i] < lo) lo = d.low[i];
    volSum += d.vol[i] ?? 0;
    k++;
  }
  if (!k) continue;
  const firstOpen = d.open[0];
  if (!(firstOpen > 0)) continue;

  U.push({
    symbol: r.symbol,
    t0,
    time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
    firstOpen,
    pump24: hi / firstOpen - 1,
    range24: (hi - lo) / firstOpen,
    vol24: volSum,
    isStock: /STOCK/i.test(r.symbol.split('_')[0]),
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

// baseline trade result per symbol (cached)
const baseTrade = new Map();
for (const s of U) baseTrade.set(s.symbol, simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold));

function stats(trades) {
  const t = trades.filter(Boolean);
  const n = t.length;
  if (!n) return null;
  const pnls = t.map((x) => x.pnl);
  const avg = pnls.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(pnls.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  return {
    n, avg, sd, se,
    t: avg / se,
    sig: Math.abs(avg) > 2 * se,
    win: (pnls.filter((p) => p > 0).length / n) * 100,
    tp: (t.filter((x) => x.o === 'TP').length / n) * 100,
    sl: (t.filter((x) => x.o === 'SL').length / n) * 100,
    to: (t.filter((x) => x.o === 'TIMEOUT').length / n) * 100,
  };
}

const line = (label, st, skipped) => {
  if (!st) return `${label.padEnd(20)} n=0`;
  const flag = st.sig ? '★' : ' ';
  const note = st.n < 30 ? '  <-- n<30, reference only' : '';
  return (
    `${label.padEnd(20)} n=${String(st.n).padStart(3)}${skipped ? `(-${skipped})` : '    '} ` +
    `win=${st.win.toFixed(1).padStart(5)}% avg=${st.avg.toFixed(2).padStart(6)}% ` +
    `sd=${st.sd.toFixed(1).padStart(5)} se=${st.se.toFixed(2).padStart(5)} t=${st.t.toFixed(2).padStart(6)} ${flag} | ` +
    `TP=${st.tp.toFixed(0).padStart(2)}% SL=${st.sl.toFixed(0).padStart(2)}% TO=${st.to.toFixed(0).padStart(2)}%${note}`
  );
};

const header = (s) => console.log(`\n${'='.repeat(110)}\n${s}\n${'='.repeat(110)}`);

console.log(`baseline: entryH=${BASE.entryH}h SL=${BASE.SL}% TP=${BASE.TP}% hold=${BASE.hold}d  fee=${FEE}%`);
console.log(`universe: ${U.length} symbols`);
console.log(`★ = |avg| > 2*SE  (expectancy outside the noise band)`);

const groupStats = (members) => {
  const trades = members.map((s) => baseTrade.get(s.symbol));
  const skipped = trades.filter((x) => !x).length;
  return [stats(trades), skipped];
};

// ---------- 1. pump24 ----------
const PUMP_EDGES = [0, 0.05, 0.10, 0.20, 0.30, 0.50, 1.0, 2.0, Infinity];
const PUMP_LABELS = ['0-5%', '5-10%', '10-20%', '20-30%', '30-50%', '50-100%', '100-200%', '200%+'];
header('1. by pump24  = max(high in first 24h) / firstOpen - 1');
const pumpBuckets = [];
for (let i = 0; i < PUMP_LABELS.length; i++) {
  const members = U.filter((s) => s.pump24 >= PUMP_EDGES[i] && s.pump24 < PUMP_EDGES[i + 1]);
  pumpBuckets.push({ label: PUMP_LABELS[i], members });
  const [st, sk] = groupStats(members);
  console.log(line(PUMP_LABELS[i], st, sk));
}
const neg = U.filter((s) => s.pump24 < 0);
if (neg.length) { const [st, sk] = groupStats(neg); console.log(line('(pump24 < 0)', st, sk)); }

// ---------- quartile helper ----------
function quartiles(arr, key) {
  const s = [...arr].sort((a, b) => a[key] - b[key]);
  const q = (p) => s[Math.floor(p * s.length)][key];
  return [q(0.25), q(0.5), q(0.75)];
}
function byQuartile(label, key, fmt) {
  const [q1, q2, q3] = quartiles(U, key);
  header(`${label} (quartiles: q1=${fmt(q1)} q2=${fmt(q2)} q3=${fmt(q3)})`);
  const groups = [
    ['Q1 (lowest)', U.filter((s) => s[key] < q1)],
    ['Q2', U.filter((s) => s[key] >= q1 && s[key] < q2)],
    ['Q3', U.filter((s) => s[key] >= q2 && s[key] < q3)],
    ['Q4 (highest)', U.filter((s) => s[key] >= q3)],
  ];
  for (const [lab, members] of groups) {
    const [st, sk] = groupStats(members);
    console.log(line(lab, st, sk));
  }
}

// ---------- 2. volatility ----------
byQuartile('2. by range24 = (max(high) - min(low)) / firstOpen over first 24h', 'range24', (v) => `${(v * 100).toFixed(1)}%`);

// ---------- 3. STOCK vs rest ----------
header('3. by symbol name (reference only — the point is that data should decide, not the name)');
{
  const [stS, skS] = groupStats(U.filter((s) => s.isStock));
  const [stO, skO] = groupStats(U.filter((s) => !s.isStock));
  console.log(line('STOCK in name', stS, skS));
  console.log(line('everything else', stO, skO));
}

// ---------- 4. volume ----------
byQuartile('4. by vol24 = sum of vol over first 24h', 'vol24', (v) => v.toExponential(2));

// ---------- 5. per-pump-bucket SL/TP grid ----------
header('5. best SL/TP cell per pump24 bucket (entryH=24h, hold=7d; SL x TP grid = 49 cells per bucket)');
console.log('NOTE: "best of 49" is a cherry-pick. Its ★ ignores that multiple-testing penalty — read it as a hint, not proof.\n');
for (const { label, members } of pumbucketsOrEmpty()) {
  if (!members.length) { console.log(`${label.padEnd(10)} n=0`); continue; }
  let best = null;
  for (const SL of SLS) {
    for (const TP of TPS) {
      const st = stats(members.map((s) => simulate(s, BASE.entryH, SL, TP, BASE.hold)));
      if (!st) continue;
      if (!best || st.avg > best.st.avg) best = { SL, TP, st };
    }
  }
  if (!best) { console.log(`${label.padEnd(10)} no tradable cell`); continue; }
  const b = best.st;
  const note = b.n < 30 ? '  <-- n<30, reference only' : '';
  console.log(
    `${label.padEnd(10)} best: SL=${String(best.SL).padStart(2)}% TP=${String(best.TP).padStart(2)}% | ` +
    `n=${String(b.n).padStart(3)} win=${b.win.toFixed(1).padStart(5)}% avg=${b.avg.toFixed(2).padStart(6)}% ` +
    `sd=${b.sd.toFixed(1).padStart(5)} se=${b.se.toFixed(2).padStart(5)} t=${b.t.toFixed(2).padStart(5)} ${b.sig ? '★' : ' '} | ` +
    `TP=${b.tp.toFixed(0)}% SL=${b.sl.toFixed(0)}% TO=${b.to.toFixed(0)}%${note}`
  );
}
function pumbucketsOrEmpty() { return pumpBuckets; }
