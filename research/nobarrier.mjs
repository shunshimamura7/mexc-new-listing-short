// [A/B] No-barrier, long-hold SHORT on MEXC new listings.
// No SL, no TP, no forced exit. Just enter at t0+24h and hold.
//
// Data constraint: cached klines span at most 30.00d from t0, so a +30d hold
// (which would end at t0+31d) does not exist. The longest available is +29d.
// We do NOT fetch more data (per instructions); +29d is labelled as such.

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'data', 'kline');
const OUT_DIR = path.join(HERE, 'out');

const HOUR = 3600;
const DAY = 24 * HOUR;
const FEE = 0.04; // round-trip, % of notional
const ENTRY_H = 24; // entry at t0 + 24h (open)
const GAP_TOL_H = 6; // accept an exit bar up to 6h late if the exact hour is missing

// +30d is impossible (see header). +29d is the max the cache supports.
const HORIZONS = [1, 3, 7, 14, 29];
const HLABEL = (d) => (d === 29 ? '+29d*' : `+${d}d`);

// ---------- stats ----------
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => sum(a) / a.length;
const sd = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};
const se = (a) => sd(a) / Math.sqrt(a.length);
const tval = (a) => mean(a) / se(a);
const sorted = (a) => [...a].sort((x, y) => x - y);
const pctile = (srt, q) => {
  if (!srt.length) return NaN;
  const i = (srt.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? srt[lo] : srt[lo] + (srt[hi] - srt[lo]) * (i - lo);
};
const median = (a) => pctile(sorted(a), 0.5);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

// ---------- classification (mirrors classify.mjs) ----------
const ETF_INDEX = new Set(['SPY','QQQ','TQQQ','SQQQ','SOXL','SOXS','SOXX','SMH','ARKK','ARKG','NAS100','SPX500','DJ30','US30','RUSSELL2000','IWM','DIA','VOO','VTI','NVDL','NVDS','TSLL','TSLQ','MSTU','MSTX','MSTZ','CONL','AMDL','AAPU','XLU','XLK','XLE','XLF','XLV','XLP','XLI','XLY','XBI','IBIT','USO','UNG','GLD','SLV','INDA','EWJ','FXI','KWEB','KORU','MVLL','UVXY','VIX','VXX','TLT','HYG','GDX','YINN','YANG','LABU','LABD']);
const COMMODITY = new Set(['XAU','XAG','XPT','XPD','GOLD','SILVER','PLATINUM','PALLADIUM','OIL','WTI','BRENT','CRUDE','NATGAS','GAS','ALUMINUM','ALUMINIUM','COPPER','NICKEL','ZINC','LEAD','TIN','IRON','WHEAT','CORN','SOYBEAN','SUGAR','COFFEE','COCOA']);
const ESTABLISHED = new Set(['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','TRX','AVAX','LINK','DOT','MATIC','POL','LTC','BCH','SHIB','TON','UNI','ATOM','XLM','ETC','FIL','APT','ARB','OP','NEAR','ICP','HBAR','VET','AAVE','SUI','PEPE','XMR','ALGO','INJ']);
const CATS = ['ALL', 'CRYPTO_NEW', 'STOCK', 'ETF_INDEX', 'COMMODITY', 'ESTABLISHED'];

function categorize(symbol) {
  const base = symbol.split('_')[0].toUpperCase();
  if (base.includes('STOCK')) return 'STOCK';
  if (ETF_INDEX.has(base)) return 'ETF_INDEX';
  if (COMMODITY.has(base)) return 'COMMODITY';
  if (ESTABLISHED.has(base)) return 'ESTABLISHED';
  return 'CRYPTO_NEW';
}

const cohortOf = (tMs) => {
  const d = new Date(tMs);
  return `${d.getUTCFullYear()}H${d.getUTCMonth() < 6 ? 1 : 2}`;
};

// ---------- load ----------
const files = (await readdir(CACHE_DIR)).filter((x) => x.endsWith('.json'));
const recs = [];
for (const x of files) recs.push(JSON.parse(await readFile(path.join(CACHE_DIR, x), 'utf8')));
recs.sort((a, b) => a.t0 - b.t0);

const bars = (r) =>
  r.data.time.map((t, i) => ({
    t, open: r.data.open[i], high: r.data.high[i], low: r.data.low[i], close: r.data.close[i],
    vol: r.data.vol[i], amount: r.data.amount?.[i] ?? null,
  }));

// ---------- simulate ----------
// rows: one per (symbol, horizon). Short PnL and Long PnL both recorded (Long is Step 4).
const rows = [];
const skipEntry = [];
const skipByH = new Map(HORIZONS.map((h) => [h, 0]));
let lateExitBars = 0;

for (const r of recs) {
  const b = bars(r);
  if (!b.length) { skipEntry.push({ symbol: r.symbol, reason: 'no bars' }); continue; }

  const t0 = Math.floor(r.t0 / 1000);
  const entryT = t0 + ENTRY_H * HOUR;
  const ei = b.findIndex((x) => x.t === entryT);
  if (ei === -1) { skipEntry.push({ symbol: r.symbol, reason: 'no bar at t0+24h', spanD: +((b.at(-1).t - t0) / DAY).toFixed(1) }); continue; }
  const entry = b[ei].open;
  if (!(entry > 0)) { skipEntry.push({ symbol: r.symbol, reason: 'entry open <= 0' }); continue; }

  const cat = categorize(r.symbol);
  const cohort = cohortOf(r.t0);

  for (const h of HORIZONS) {
    const target = entryT + h * DAY;
    // exact bar, else first bar within GAP_TOL_H after target
    let xi = -1;
    for (let i = ei + 1; i < b.length; i++) {
      if (b[i].t === target) { xi = i; break; }
      if (b[i].t > target) { if (b[i].t <= target + GAP_TOL_H * HOUR) { xi = i; lateExitBars++; } break; }
    }
    if (xi === -1) { skipByH.set(h, skipByH.get(h) + 1); continue; }

    const exit = b[xi].open;
    if (!(exit > 0)) { skipByH.set(h, skipByH.get(h) + 1); continue; }

    // excursions while in position: entry bar through exit bar inclusive
    let hi = -Infinity, lo = Infinity;
    for (let i = ei; i <= xi; i++) { if (b[i].high > hi) hi = b[i].high; if (b[i].low < lo) lo = b[i].low; }

    rows.push({
      symbol: r.symbol, cat, cohort, t0Iso: r.t0Iso, h,
      entry, exit,
      pnlShort: ((entry - exit) / entry) * 100 - FEE,
      pnlLong: ((exit - entry) / entry) * 100 - FEE,
      // MAE/MFE from the SHORT's point of view
      mae: ((hi - entry) / entry) * 100, // max squeeze against us
      mfe: ((entry - lo) / entry) * 100, // max drawdown in our favour
      retRaw: ((exit - entry) / entry) * 100, // underlying price move, no fee
    });
  }
}

const byH = new Map(HORIZONS.map((h) => [h, rows.filter((r) => r.h === h)]));

// symbols present at EVERY horizon -> balanced panel, so horizon comparison isn't
// confounded by short-lived symbols dropping out of the long holds.
const perSym = new Map();
for (const r of rows) perSym.set(r.symbol, (perSym.get(r.symbol) ?? 0) + 1);
const balanced = new Set([...perSym].filter(([, c]) => c === HORIZONS.length).map(([s]) => s));

// ---------- report ----------
const L = console.log;
L(`=== [A/B] NO-BARRIER SHORT — entry = open at t0+${ENTRY_H}h, no SL, no TP, no forced exit ===`);
L(`fee ${FEE}% round-trip | leverage 1x assumed (never liquidated)`);
L(`universe: ${recs.length} symbols, no filters applied at load`);
L(`entry-stage skips: ${skipEntry.length}`);
{
  const m = new Map();
  for (const s of skipEntry) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
  for (const [k, v] of m) L(`   [${v}] ${k}`);
}
L(`\n!! +30d IS NOT AVAILABLE: klines span at most 30.00d from t0, and entry is at t0+24h,`);
L(`   so a +30d hold would need a bar at t0+31d. It does not exist. NOT fetched (per instructions).`);
L(`   Longest hold reported is +29d ("+29d*"), which exits on the last available bar (t0+30d).`);
if (lateExitBars) L(`   (${lateExitBars} exit bars were taken up to ${GAP_TOL_H}h late due to hourly gaps in the cache)`);

L(`\n--- coverage per horizon ---`);
L(`horizon   n      dropped(no exit bar)   balanced-panel n`);
for (const h of HORIZONS) {
  const g = byH.get(h);
  L(`${HLABEL(h).padEnd(9)} ${String(g.length).padStart(4)}   ${String(skipByH.get(h)).padStart(6)}                 ${String(g.filter((r) => balanced.has(r.symbol)).length).padStart(4)}`);
}
L(`balanced panel = ${balanced.size} symbols that have an exit bar at ALL horizons (incl. +29d).`);
L(`NOTE: the unbalanced n shrinks with horizon because short-lived/thin symbols run out of`);
L(`      candles. Composition therefore changes across horizons — read the balanced panel to`);
L(`      compare horizons like-for-like.`);

function statLine(label, a, pad = 10) {
  if (!a.length) return `${label.padEnd(pad)}     0`;
  const t = tval(a), w = a.filter((x) => x > 0).length;
  return [
    label.padEnd(pad),
    String(a.length).padStart(5),
    f(mean(a)).padStart(9),
    f(median(a)).padStart(9),
    f(sd(a)).padStart(8),
    f(se(a)).padStart(7),
    f(t).padStart(7),
    `${f((w / a.length) * 100, 1)}%`.padStart(8),
  ].join(' ');
}
const HEAD = (c1 = 'group') => `${c1.padEnd(10)}     n      mean    median       SD      SE       t   down%`;

L(`\n\n=== 1. MAIN: no-barrier SHORT, all symbols with an exit bar at that horizon ===`);
L(`("down%" = share of trades with PnL > 0, i.e. the coin actually fell — this is the win rate)`);
L(HEAD('horizon'));
for (const h of HORIZONS) L(statLine(HLABEL(h), byH.get(h).map((r) => r.pnlShort)));

L(`\n=== 1b. BALANCED PANEL (same ${balanced.size} symbols at every horizon) ===`);
L(HEAD('horizon'));
for (const h of HORIZONS) L(statLine(HLABEL(h), byH.get(h).filter((r) => balanced.has(r.symbol)).map((r) => r.pnlShort)));

L(`\n\n=== 2. RETURN DISTRIBUTION (short PnL %, net of fee) ===`);
L(`horizon       p1       p5      p25      p50      p75      p95      p99      min      max`);
for (const h of HORIZONS) {
  const s = sorted(byH.get(h).map((r) => r.pnlShort));
  L([HLABEL(h).padEnd(9), ...[0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99].map((q) => f(pctile(s, q)).padStart(8)),
    f(s[0]).padStart(8), f(s.at(-1)).padStart(8)].join(' '));
}

L(`\n=== 3. MAE — max squeeze AGAINST the short, % above entry (higher = worse) ===`);
L(`horizon      p50      p75      p90      p95      p99      max`);
for (const h of HORIZONS) {
  const s = sorted(byH.get(h).map((r) => r.mae));
  L([HLABEL(h).padEnd(9), ...[0.5, 0.75, 0.9, 0.95, 0.99].map((q) => f(pctile(s, q)).padStart(8)), f(s.at(-1)).padStart(8)].join(' '));
}

L(`\n=== 4. MFE — max move IN FAVOUR of the short, % below entry ===`);
L(`horizon      p50      p75      p90      p95      p99      max`);
for (const h of HORIZONS) {
  const s = sorted(byH.get(h).map((r) => r.mfe));
  L([HLABEL(h).padEnd(9), ...[0.5, 0.75, 0.9, 0.95, 0.99].map((q) => f(pctile(s, q)).padStart(8)), f(s.at(-1)).padStart(8)].join(' '));
}

L(`\n\n=== 5. TRIMMED MEANS — is the result carried by a handful of names? ===`);
L(`  "drop best k%"  removes the most profitable shorts (biggest crashes).`);
L(`                  -> if the mean flips negative, the edge was a few lottery wins. Fake.`);
L(`  "drop worst k%" removes the biggest squeezes.`);
L(`                  -> if the mean flips positive, a few moonshots are eating everything.`);
L(`horizon        mean   drop-best1%   drop-best5%   drop-worst1%   drop-worst5%`);
for (const h of HORIZONS) {
  const s = sorted(byH.get(h).map((r) => r.pnlShort));
  const n = s.length;
  const cut = (k, side) => {
    const c = Math.max(1, Math.round(n * k));
    return side === 'best' ? s.slice(0, n - c) : s.slice(c);
  };
  L([HLABEL(h).padEnd(9), f(mean(s)).padStart(10),
    f(mean(cut(0.01, 'best'))).padStart(13), f(mean(cut(0.05, 'best'))).padStart(13),
    f(mean(cut(0.01, 'worst'))).padStart(14), f(mean(cut(0.05, 'worst'))).padStart(14)].join(' '));
}

L(`\n\n=== 6. THE SQUEEZE TAIL — "one name takes the whole book" ===`);
for (const h of [7, 29]) {
  const g = byH.get(h);
  L(`\n  --- horizon ${HLABEL(h)} (n=${g.length}) ---`);
  for (const thr of [100, 200, 500]) {
    const hitMae = g.filter((r) => r.mae >= thr);
    const hitEnd = g.filter((r) => -r.pnlShort >= thr);
    L(`  MAE >= +${thr}% (squeezed intra-hold): ${String(hitMae.length).padStart(3)} (${f((hitMae.length / g.length) * 100, 1)}%)   |   still >= +${thr}% at exit: ${hitEnd.length}`);
  }
  const top = [...g].sort((a, b) => b.mae - a.mae).slice(0, 10);
  L(`  top-10 squeezes by MAE:`);
  L(`     symbol                 t0            MAE       PnL@exit   final move`);
  for (const r of top) {
    L(`     ${r.symbol.padEnd(20)} ${r.t0Iso.slice(0, 10)}  ${(f(r.mae, 0) + '%').padStart(8)}  ${(f(r.pnlShort) + '%').padStart(10)}  ${(f(r.retRaw, 0) + '%').padStart(9)}`);
  }
  const totalMean = mean(g.map((r) => r.pnlShort));
  const worst = [...g].sort((a, b) => a.pnlShort - b.pnlShort);
  for (const k of [1, 5, 10]) {
    const exK = mean(g.filter((r) => !worst.slice(0, k).includes(r)).map((r) => r.pnlShort));
    L(`  mean excl. worst ${String(k).padStart(2)} name(s): ${f(exK).padStart(7)}%   (vs ${f(totalMean)}% with them)`);
  }
}

L(`\n\n=== 7. BY CATEGORY (short) ===`);
for (const h of HORIZONS) {
  L(`\n  --- horizon ${HLABEL(h)} ---`);
  L(`  ${HEAD('category')}`);
  for (const c of CATS) {
    const a = byH.get(h).filter((r) => c === 'ALL' || r.cat === c).map((r) => r.pnlShort);
    if (a.length) L(`  ${statLine(c, a)}`);
  }
}

L(`\n\n=== 8. BY COHORT (half-year of t0) — does the sign hold up over time? ===`);
const cohorts = [...new Set(rows.map((r) => r.cohort))].sort();
for (const h of [1, 7, 29]) {
  L(`\n  --- horizon ${HLABEL(h)} ---`);
  L(`  ${HEAD('cohort')}`);
  for (const c of cohorts) {
    const a = byH.get(h).filter((r) => r.cohort === c).map((r) => r.pnlShort);
    if (a.length) L(`  ${statLine(c, a)}`);
  }
}

L(`\n\n=== 9. LONG side, same conditions (Step 4 preview) ===`);
L(`  ${HEAD('horizon')}`);
for (const h of HORIZONS) L(`  ${statLine(HLABEL(h), byH.get(h).map((r) => r.pnlLong))}`);
L(`  (note: "down%" column here is the LONG's win rate, i.e. share with long PnL > 0)`);

L(`\n\n=== 10. SURVIVORSHIP ===`);
L(`  The detail API only returns contracts that are still live on MEXC. Coins that were`);
L(`  listed, collapsed and then DELISTED are absent from this universe. Delisted coins are`);
L(`  overwhelmingly the ones that went to zero -- i.e. the ones a short would have WON on.`);
L(`  Every short number above is therefore biased PESSIMISTIC (true short edge >= measured),`);
L(`  and every long number is biased OPTIMISTIC. Magnitude is not estimable from this data.`);

// ---------- csv ----------
await mkdir(OUT_DIR, { recursive: true });
const head = 'symbol,category,cohort,t0Iso,holdDays,entry,exit,pnlShortPct,pnlLongPct,maePct,mfePct,rawMovePct';
const body = rows.map((r) => [r.symbol, r.cat, r.cohort, r.t0Iso, r.h, r.entry, r.exit,
  r.pnlShort.toFixed(4), r.pnlLong.toFixed(4), r.mae.toFixed(4), r.mfe.toFixed(4), r.retRaw.toFixed(4)].join(','));
await writeFile(path.join(OUT_DIR, 'nobarrier.csv'), [head, ...body].join('\n') + '\n');
L(`\nwrote out/nobarrier.csv (${rows.length} rows)`);
