// [5-A] Anatomy of the blow-ups.
// The 63 names with MAE >= +100% at the +7d horizon are what killed the short.
// Question: are they a TIME phenomenon (Kenji: BTC regime) or a NAME phenomenon
// (price level / volume / first-day behaviour)? Or neither -> unidentifiable -> retreat.
//
// Every feature used here is observable at entry (t0+24h). No supply/mcap/FDV
// (only "today's" supply is retrievable -> that would be look-ahead).

import * as M from './regime.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const { f, mean, median, sd, se, tval, srt, pctile, welch, mannWhitney } = M;
const L = console.log;
const H = 7; // the horizon the 63 were defined on
const THR = 100; // MAE >= +100%

const btc = await M.loadBtcDaily();
const regimeAt = M.makeRegime(btc);
const U = (await M.loadUniverse()).filter((u) => u.h[H]);

for (const u of U) u.reg = regimeAt(u.t0ms);

const bomb = U.filter((u) => u.h[H].mae >= THR);
const rest = U.filter((u) => u.h[H].mae < THR);

L(`=== [5-A] BLOW-UP ANATOMY — MAE >= +${THR}% at ${M.HLABEL(H)} ===`);
L(`BTC regime source: ${btc.source} (${btc.n} daily bars)`);
L(`universe with a ${M.HLABEL(H)} exit bar: ${U.length}`);
L(`blow-ups: ${bomb.length}   rest: ${rest.length}   (blow-up rate ${f((bomb.length / U.length) * 100, 1)}%)`);
L(`\nreminder: these ${bomb.length} names are the SHORT's disasters and the LONG's jackpots.`);
L(`the mean short PnL on them is ${f(mean(bomb.map((u) => u.h[H].short)))}%; on the rest it is ${f(mean(rest.map((u) => u.h[H].short)))}%.`);

// ---------------- 1. TIME: monthly blow-up rate ----------------
L(`\n\n=== 1. TIME DISTRIBUTION — is the blow-up a calendar phenomenon? ===`);
const months = [...new Set(U.map((u) => u.month))].sort();
L(`month     listings  blowups   rate    BTC 30d ret at mid-month   bar`);
const rows = [];
for (const m of months) {
  const all = U.filter((u) => u.month === m);
  const bl = all.filter((u) => u.h[H].mae >= THR);
  const rate = (bl.length / all.length) * 100;
  const btcR30 = median(all.map((u) => u.reg.btcRet30));
  rows.push({ m, n: all.length, b: bl.length, rate, btcR30 });
  const bar = '#'.repeat(Math.round(rate / 2));
  L(`${m}   ${String(all.length).padStart(6)}  ${String(bl.length).padStart(6)}  ${(f(rate, 1) + '%').padStart(6)}   ${(f(btcR30, 1) + '%').padStart(10)}                ${bar}`);
}

// concentration: how few months hold most of the blow-ups?
const byMonthDesc = [...rows].sort((a, b) => b.b - a.b);
let acc = 0;
L(`\nconcentration of the ${bomb.length} blow-ups by month:`);
for (let i = 0; i < byMonthDesc.length && acc < bomb.length; i++) {
  const r = byMonthDesc[i];
  if (!r.b) break;
  acc += r.b;
  L(`  ${r.m}: ${String(r.b).padStart(2)} blow-ups of ${String(r.n).padStart(3)} listings (${f(r.rate, 1)}%)   cumulative ${acc}/${bomb.length} (${f((acc / bomb.length) * 100, 0)}%)`);
}
const monthsWithBlowups = rows.filter((r) => r.b > 0).length;
L(`  -> blow-ups appear in ${monthsWithBlowups} of ${months.length} months.`);

// ---------------- 2. BTC REGIME: 63 vs rest ----------------
L(`\n\n=== 2. BTC REGIME AT t0 — blow-ups vs rest ===`);
L(`(regime is computed from the last CLOSED BTC daily bar before t0. no look-ahead.)`);
const REGVARS = [
  ['BTC 7d return %', (u) => u.reg.btcRet7],
  ['BTC 30d return %', (u) => u.reg.btcRet30],
  ['BTC vs 200d SMA, gap %', (u) => u.reg.sma200Gap],
];
L(`\nvariable                  group     n     mean   median      SD    | Welch t      p   | MW z      p    AUC`);
for (const [name, get] of REGVARS) {
  const a = bomb.map(get).filter(Number.isFinite);
  const b = rest.map(get).filter(Number.isFinite);
  const w = welch(a, b), mw = mannWhitney(a, b);
  L(`${name.padEnd(25)} blowup ${String(a.length).padStart(4)} ${f(mean(a)).padStart(8)} ${f(median(a)).padStart(8)} ${f(sd(a)).padStart(7)}    | ${f(w.t).padStart(7)} ${f(w.p, 4).padStart(6)} | ${f(mw.z).padStart(6)} ${f(mw.p, 4).padStart(6)} ${f(mw.auc, 3).padStart(6)}`);
  L(`${''.padEnd(25)} rest   ${String(b.length).padStart(4)} ${f(mean(b)).padStart(8)} ${f(median(b)).padStart(8)} ${f(sd(b)).padStart(7)}`);
}

// above/below 200d SMA — 2x2
const above = U.filter((u) => u.reg.aboveSma200);
const below = U.filter((u) => !u.reg.aboveSma200);
L(`\nBTC vs 200d SMA (2x2):`);
L(`                listings   blowups   blow-up rate`);
for (const [nm, g] of [['BTC ABOVE 200SMA', above], ['BTC BELOW 200SMA', below]]) {
  const b = g.filter((u) => u.h[H].mae >= THR).length;
  L(`  ${nm.padEnd(18)} ${String(g.length).padStart(5)}   ${String(b).padStart(6)}   ${(f((b / g.length) * 100, 1) + '%').padStart(8)}`);
}

// blow-up rate by BTC 30d return bucket
L(`\nblow-up rate by BTC 30d return at t0:`);
const R30 = [[-1e9, -10, 'BTC 30d <= -10%'], [-10, 0, '-10% .. 0%'], [0, 10, '0% .. +10%'], [10, 25, '+10% .. +25%'], [25, 1e9, 'BTC 30d >= +25%']];
L(`bucket               listings  blowups   rate     mean short PnL   mean long PnL`);
for (const [lo, hi, nm] of R30) {
  const g = U.filter((u) => u.reg.btcRet30 > lo && u.reg.btcRet30 <= hi);
  if (!g.length) continue;
  const b = g.filter((u) => u.h[H].mae >= THR).length;
  L(`${nm.padEnd(20)} ${String(g.length).padStart(6)}  ${String(b).padStart(6)}  ${(f((b / g.length) * 100, 1) + '%').padStart(6)}   ${(f(mean(g.map((u) => u.h[H].short))) + '%').padStart(12)}   ${(f(mean(g.map((u) => u.h[H].long))) + '%').padStart(12)}`);
}

// ---------------- 3. NAME FEATURES: 63 vs rest ----------------
L(`\n\n=== 3. PRE-ENTRY NAME FEATURES — blow-ups vs rest ===`);
L(`(all computed from candles between t0 and t0+24h. no supply / mcap / FDV: only "today's"`);
L(` supply is retrievable from the API, which would be look-ahead. price LEVEL is used instead.)`);
const NAMEVARS = [
  ['first open (price, log10)', (u) => Math.log10(u.firstOpen)],
  ['24h quote volume (log10 USDT)', (u) => (u.quote24 > 0 ? Math.log10(u.quote24) : null)],
  ['first-24h high/low range %', (u) => u.range24],
  ['pump24 (max high / first open) %', (u) => u.pump24],
  ['first-24h 1h-return SD %', (u) => u.vol24],
];
L(`\nvariable                          group     n     mean   median      SD    | Welch t      p   | MW z      p    AUC`);
for (const [name, get] of NAMEVARS) {
  const a = bomb.map(get).filter(Number.isFinite);
  const b = rest.map(get).filter(Number.isFinite);
  const w = welch(a, b), mw = mannWhitney(a, b);
  L(`${name.padEnd(33)} blowup ${String(a.length).padStart(4)} ${f(mean(a)).padStart(8)} ${f(median(a)).padStart(8)} ${f(sd(a)).padStart(7)}    | ${f(w.t).padStart(7)} ${f(w.p, 4).padStart(6)} | ${f(mw.z).padStart(6)} ${f(mw.p, 4).padStart(6)} ${f(mw.auc, 3).padStart(6)}`);
  L(`${''.padEnd(33)} rest   ${String(b.length).padStart(4)} ${f(mean(b)).padStart(8)} ${f(median(b)).padStart(8)} ${f(sd(b)).padStart(7)}`);
}

// price-level buckets
L(`\nblow-up rate by price level at t0 (first open):`);
const PB = [[0, 0.001, '< $0.001'], [0.001, 0.01, '$0.001 - $0.01'], [0.01, 0.1, '$0.01 - $0.1'], [0.1, 1, '$0.1 - $1'], [1, 1e12, '>= $1']];
L(`bucket               listings  blowups   rate     mean short PnL`);
for (const [lo, hi, nm] of PB) {
  const g = U.filter((u) => u.firstOpen >= lo && u.firstOpen < hi);
  if (!g.length) continue;
  const b = g.filter((u) => u.h[H].mae >= THR).length;
  L(`${nm.padEnd(20)} ${String(g.length).padStart(6)}  ${String(b).padStart(6)}  ${(f((b / g.length) * 100, 1) + '%').padStart(6)}   ${(f(mean(g.map((u) => u.h[H].short))) + '%').padStart(12)}`);
}

// volume quartiles
L(`\nblow-up rate by 24h quote volume quartile (Q1 = thinnest):`);
const withVol = U.filter((u) => u.quote24 > 0).sort((a, b) => a.quote24 - b.quote24);
const q = Math.floor(withVol.length / 4);
L(`quartile   listings  blowups   rate    median vol (USDT)   mean short PnL`);
for (let k = 0; k < 4; k++) {
  const g = withVol.slice(k * q, k === 3 ? withVol.length : (k + 1) * q);
  const b = g.filter((u) => u.h[H].mae >= THR).length;
  L(`Q${k + 1}         ${String(g.length).padStart(6)}  ${String(b).padStart(6)}  ${(f((b / g.length) * 100, 1) + '%').padStart(6)}   ${median(g.map((u) => u.quote24)).toExponential(2).padStart(12)}   ${(f(mean(g.map((u) => u.h[H].short))) + '%').padStart(12)}`);
}
L(`(${U.length - withVol.length} symbols had no quote-volume field and are excluded from this table)`);

// category
L(`\nblow-up rate by category:`);
for (const c of ['CRYPTO_NEW', 'STOCK', 'ETF_INDEX', 'COMMODITY', 'ESTABLISHED']) {
  const g = U.filter((u) => u.cat === c);
  if (!g.length) continue;
  const b = g.filter((u) => u.h[H].mae >= THR).length;
  L(`  ${c.padEnd(12)} ${String(g.length).padStart(4)} listings, ${String(b).padStart(2)} blow-ups (${f((b / g.length) * 100, 1)}%)`);
}

// ---------------- 4. the 63, listed ----------------
L(`\n\n=== 4. THE ${bomb.length} BLOW-UPS ===`);
L(`symbol             t0          MAE%    short%    long%   BTC7d  BTC30d  >200SMA   1stOpen     vol24h(USDT)`);
for (const u of [...bomb].sort((a, b) => b.h[H].mae - a.h[H].mae)) {
  L([
    u.symbol.padEnd(18),
    u.t0Iso.slice(0, 10),
    f(u.h[H].mae, 0).padStart(7),
    f(u.h[H].short, 0).padStart(8),
    f(u.h[H].long, 0).padStart(8),
    f(u.reg.btcRet7, 1).padStart(7),
    f(u.reg.btcRet30, 1).padStart(7),
    (u.reg.aboveSma200 ? 'YES' : 'no').padStart(8),
    u.firstOpen.toPrecision(3).padStart(10),
    (u.quote24 ? u.quote24.toExponential(1) : 'n/a').padStart(12),
  ].join(' '));
}

// ---------------- 5. IS/OOS sanity ----------------
L(`\n\n=== 5. IS / OOS SPLIT (fixed now, never moved) ===`);
L(`IS  = t0 <= 2025-06-30 : ${U.filter((u) => u.isIS).length} listings, ${bomb.filter((u) => u.isIS).length} blow-ups (${f((bomb.filter((u) => u.isIS).length / U.filter((u) => u.isIS).length) * 100, 1)}%)`);
L(`OOS = t0 >= 2025-07-01 : ${U.filter((u) => !u.isIS).length} listings, ${bomb.filter((u) => !u.isIS).length} blow-ups (${f((bomb.filter((u) => !u.isIS).length / U.filter((u) => !u.isIS).length) * 100, 1)}%)`);
L(`(OOS is NOT used to design anything. Reported here only so the split is on the record.)`);

// ---------------- csv ----------------
await M.ensureOut();
const head = 'symbol,t0Iso,month,cohort,isIS,category,isBlowup,maePct,shortPct,longPct,btcRet7,btcRet30,btcSma200Gap,aboveSma200,firstOpen,quote24hUSDT,range24Pct,pump24Pct,vol24Pct';
const body = U.map((u) => [
  u.symbol, u.t0Iso, u.month, u.cohort, u.isIS ? 'IS' : 'OOS', u.cat,
  u.h[H].mae >= THR ? 1 : 0,
  u.h[H].mae.toFixed(3), u.h[H].short.toFixed(3), u.h[H].long.toFixed(3),
  f(u.reg.btcRet7, 3), f(u.reg.btcRet30, 3), f(u.reg.sma200Gap, 3), u.reg.aboveSma200 ? 1 : 0,
  u.firstOpen, u.quote24.toFixed(0), f(u.range24, 3), f(u.pump24, 3), f(u.vol24, 3),
].join(','));
await writeFile(path.join(M.OUT_DIR, 'blowup.csv'), [head, ...body].join('\n') + '\n');
L(`\nwrote out/blowup.csv (${U.length} rows)`);
