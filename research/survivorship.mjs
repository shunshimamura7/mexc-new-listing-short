// [5-D] Survivorship bias — how much of the LONG's apparent edge is an artefact?
//
// /contract/detail returns ONLY currently-listed contracts. A coin that listed, went to
// -99% and got delisted is simply ABSENT from the 788. Those are exactly the coins a long
// would have died on. So the long numbers are structurally inflated.
//
// This file does three things:
//   1. Counts the delist history we actually have.        (spoiler: we have none)
//   2. Measures the censoring that IS visible inside the surviving universe.
//   3. Computes, algebraically, how many missing coins it would TAKE to erase the long
//      edge. That is a requirement, not a guess.

import * as M from './regime.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { f, mean, median, se, tval, srt, pctile } = M;
const L = console.log;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = Date.now();
const DAY_MS = 86400_000;

L(`=== [5-D] SURVIVORSHIP BIAS ===`);

// ---------------------------------------------------------------
// 1. what delist history do we actually have?
// ---------------------------------------------------------------
L(`\n${'='.repeat(90)}`);
L(`1. DELIST HISTORY FROM SNAPSHOTS`);
L('='.repeat(90));
const snapDir = path.join(HERE, 'snapshots');
const snaps = existsSync(snapDir) ? (await readdir(snapDir)).filter((x) => x.startsWith('detail-')).sort() : [];
L(`snapshot files found: ${snaps.length}`);
for (const s of snaps) L(`   ${s}`);

if (snaps.length < 2) {
  L(`\n>>> CANNOT BE MEASURED.`);
  L(`    .github/workflows/snapshot.yml records contract/detail daily, but it only started`);
  L(`    running on 2026-07-12. There is exactly ONE snapshot. Detecting a delist requires`);
  L(`    comparing TWO snapshots taken at different times. With one, the set of "symbols that`);
  L(`    existed before and are gone now" is EMPTY BY CONSTRUCTION -- not because nothing was`);
  L(`    delisted, but because we were not watching.`);
  L(`\n    The number of delisted MEXC futures over 2023-07..2026-07 is NOT RETRIEVABLE from`);
  L(`    anything in this repo. I am not going to estimate it. It is unknown.`);
  L(`\n    (This will fix itself: with the daily snapshot now running, a rerun of this script`);
  L(`     in ~6 months will have real delist counts. Today it does not.)`);
} else {
  const sets = [];
  for (const s of snaps) {
    const raw = await readFile(path.join(snapDir, s));
    const { gunzipSync } = await import('node:zlib');
    const j = JSON.parse(gunzipSync(raw).toString('utf8'));
    sets.push({ date: s.slice(7, 17), syms: new Set(j.data.map((c) => c.symbol)) });
  }
  const first = sets[0], last = sets.at(-1);
  const gone = [...first.syms].filter((x) => !last.syms.has(x));
  L(`\nsymbols in ${first.date} but not in ${last.date}: ${gone.length}`);
  for (const g of gone) L(`   ${g}`);
}

// ---------------------------------------------------------------
// 2. censoring visible INSIDE the surviving universe
// ---------------------------------------------------------------
L(`\n\n${'='.repeat(90)}`);
L(`2. CENSORING VISIBLE INSIDE THE 788 SURVIVORS`);
L('='.repeat(90));
L(`A surviving contract whose candles STOP even though calendar time kept running is a coin`);
L(`that stopped trading (halt / zero volume / effective death) without being formally removed`);
L(`from the contract list. That IS measurable, and it is a floor on the true dead-coin count.`);

const U = await M.loadUniverse();
const stalled = [];
for (const u of U) {
  const elapsedD = (NOW - u.t0ms) / DAY_MS;
  // it has had time to produce 30d of candles, but produced materially fewer
  if (elapsedD > 33 && u.spanDays < 29.5) stalled.push({ ...u, elapsedD });
}
L(`\nlistings older than 33 days: ${U.filter((u) => (NOW - u.t0ms) / DAY_MS > 33).length}`);
L(`   of those, candles stop before t0+29.5d: ${stalled.length}`);
if (stalled.length) {
  L(`\nsymbol             t0          candles end at   elapsed   last-known short PnL (longest horizon)`);
  for (const s of srt(stalled.map((x) => x.spanDays)).length ? [...stalled].sort((a, b) => a.spanDays - b.spanDays) : []) {
    const H = [29, 14, 7, 3, 1].find((h) => s.h[h]);
    L(`${s.symbol.padEnd(18)} ${s.t0Iso.slice(0, 10)}  t0+${f(s.spanDays, 1).padStart(5)}d       ${f(s.elapsedD, 0).padStart(4)}d   ${H ? `${M.HLABEL(H)}: ${f(s.h[H].short)}%` : 'no exit bar at all'}`);
  }
}
L(`\n(these ${stalled.length} are still IN the dataset. The ones that were formally delisted are NOT,`);
L(` and they are not in this table either. This is a floor, not the answer.)`);

// ---------------------------------------------------------------
// 3. how many missing coins would it TAKE?
// ---------------------------------------------------------------
L(`\n\n${'='.repeat(90)}`);
L(`3. HOW MANY MISSING COINS WOULD IT TAKE TO ERASE THE LONG EDGE?`);
L('='.repeat(90));
L(`This is algebra, not an estimate. If the observed universe has n survivors with mean long`);
L(`return m, and there were additionally k delisted coins each returning r, the true mean is`);
L(`   (n*m + k*r) / (n + k).`);
L(`Setting that to 0 and solving:  k = -n*m / r.`);

for (const H of [7, 29]) {
  const g = U.filter((u) => u.h[H]);
  const a = g.map((u) => u.h[H].long);
  const n = a.length, m = mean(a);
  L(`\n--- LONG, hold ${M.HLABEL(H)} ---`);
  L(`observed: n=${n}, mean=${f(m)}%, median=${f(median(a))}%, t=${f(tval(a))}, win rate=${f((a.filter((x) => x > 0).length / n) * 100, 1)}%`);
  if (m <= 0) { L(`  mean is already <= 0. survivorship can only make it worse. nothing to solve.`); continue; }
  L(`  delisted coins needed to drive the true mean to zero:`);
  L(`     assumed return of a delisted coin      k needed    that is this share of the true universe`);
  for (const r of [-99, -95, -90, -75, -50]) {
    const k = (-n * m) / r;
    L(`     ${(r + '%').padStart(6)}                              ${f(k, 1).padStart(7)}      ${(f((k / (n + k)) * 100, 1) + '%').padStart(6)}`);
  }
  L(`  -> i.e. if roughly ${f(((-n * m) / -90 / (n + (-n * m) / -90)) * 100, 0)}% of all coins ever listed went to -90% and got delisted,`);
  L(`     the entire observed +${f(m)}% long "edge" at ${M.HLABEL(H)} is an artefact of not seeing them.`);
}

// ---------------------------------------------------------------
// 4. the lottery check on the long
// ---------------------------------------------------------------
L(`\n\n${'='.repeat(90)}`);
L(`4. IS THE LONG A LOTTERY? (win rate + median, not just the mean)`);
L('='.repeat(90));
L(`hold        n     mean   median      SE       t    win%   share of total profit from top 5 names`);
for (const H of M.HORIZONS) {
  const g = U.filter((u) => u.h[H]);
  const a = g.map((u) => u.h[H].long);
  const s = srt(a);
  const top5 = s.slice(-5);
  const winners = s.filter((x) => x > 0);
  const shareTop5 = winners.length ? (top5.filter((x) => x > 0).reduce((x, y) => x + y, 0) / winners.reduce((x, y) => x + y, 0)) * 100 : NaN;
  L(`${M.HLABEL(H).padEnd(6)} ${String(a.length).padStart(4)} ${f(mean(a)).padStart(8)} ${f(median(a)).padStart(8)} ${f(se(a)).padStart(7)} ${f(tval(a)).padStart(7)} ${(f((a.filter((x) => x > 0).length / a.length) * 100, 1) + '%').padStart(7)} ${(f(shareTop5, 1) + '%').padStart(10)}`);
}
L(`\nRead the median and the win rate, not the mean. A strategy whose mean is positive while its`);
L(`median is negative and its win rate is ~40% is a lottery ticket: it loses on most trades and`);
L(`is bailed out by a handful of moonshots. That is the opposite of the ~80% win rate target.`);
L(`And the moonshots are precisely the names most exposed to survivorship: they are still listed`);
L(`BECAUSE they mooned.`);
