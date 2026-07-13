// [5-B] Regime strata, BOTH directions. IN-SAMPLE ONLY (t0 <= 2025-06-30).
//
// 5-A established:
//   - BTC regime barely separates the blow-ups (AUC 0.54-0.60)
//   - first-day behaviour separates them strongly (AUC 0.81-0.83)
//   - but removing the blow-ups leaves mean ~= 0, not an edge
// So 5-B tests regime, name-filters, and their interaction -- all on IS only.
// OOS (t0 >= 2025-07-01) is NOT read anywhere in this file.

import * as M from './regime.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const { f, mean, median, sd, se, tval, srt, pctile } = M;
const L = console.log;

const btc = await M.loadBtcDaily();
const regimeAt = M.makeRegime(btc);
const ALL = (await M.loadUniverse()).map((u) => ({ ...u, reg: regimeAt(u.t0ms) }));

// ---- HARD GATE: in-sample only ----
const IS = ALL.filter((u) => u.isIS);
const OOS_COUNT = ALL.length - IS.length;

L(`=== [5-B] REGIME STRATA — IN-SAMPLE ONLY ===`);
L(`IS  : t0 <= 2025-06-30   -> ${IS.length} listings   (this file uses ONLY these)`);
L(`OOS : t0 >= 2025-07-01   -> ${OOS_COUNT} listings   (untouched, reserved for 5-C)`);
L(`fee ${M.FEE}% round-trip, charged to BOTH directions. entry = open at t0+24h. no SL/TP.`);
L(`\n5-A recap: blow-ups are NOT a calendar phenomenon. They are cheap, wild, thick-book`);
L(`memecoins. Regime is tested here anyway, because that was the hypothesis to kill.`);

// ---------- regime definitions ----------
const REGIMES = {
  'R1 BTC 7d ret': (u) => (u.reg.btcRet7 <= -5 ? 'DOWN (<=-5%)' : u.reg.btcRet7 >= 5 ? 'UP (>=+5%)' : 'FLAT (-5..+5%)'),
  'R2 BTC 30d ret': (u) => (u.reg.btcRet30 <= -5 ? 'DOWN (<=-5%)' : u.reg.btcRet30 >= 5 ? 'UP (>=+5%)' : 'FLAT (-5..+5%)'),
  'R3 BTC vs 200SMA': (u) => (u.reg.aboveSma200 ? 'ABOVE 200SMA' : 'BELOW 200SMA'),
};
const RORDER = {
  'R1 BTC 7d ret': ['DOWN (<=-5%)', 'FLAT (-5..+5%)', 'UP (>=+5%)'],
  'R2 BTC 30d ret': ['DOWN (<=-5%)', 'FLAT (-5..+5%)', 'UP (>=+5%)'],
  'R3 BTC vs 200SMA': ['BELOW 200SMA', 'ABOVE 200SMA'],
};

// ---------- name filters found in 5-A (all observable at entry) ----------
// Thresholds are taken from 5-A's IS+OOS-pooled quartiles, which is a mild leak; they are
// coarse, round numbers chosen for that reason. Recomputed on IS below to show the drift.
const FILTERS = {
  'F0 no filter': () => true,
  'F1 price >= $1': (u) => u.firstOpen >= 1,
  'F2 day1 SD <= 2.5%': (u) => Number.isFinite(u.vol24) && u.vol24 <= 2.5,
  'F3 day1 range <= 25%': (u) => Number.isFinite(u.range24) && u.range24 <= 25,
  'F4 price>=$1 AND SD<=2.5%': (u) => u.firstOpen >= 1 && Number.isFinite(u.vol24) && u.vol24 <= 2.5,
};

const DIRS = ['short', 'long'];
const rows = [];

function cell(g, H, dir) {
  const v = g.filter((u) => u.h[H]);
  if (v.length < 2) return null;
  const a = v.map((u) => u.h[H][dir]);
  const maes = srt(v.map((u) => u.h[H].mae)); // MAE is always defined from the short's side
  const worst = srt(a).slice(10); // drop the 10 worst trades for this direction
  return {
    n: a.length,
    mean: mean(a), median: median(a), sd: sd(a), se: se(a), t: tval(a),
    win: (a.filter((x) => x > 0).length / a.length) * 100,
    maeP95: pctile(maes, 0.95), maeP99: pctile(maes, 0.99),
    exWorst10: worst.length ? mean(worst) : NaN,
  };
}

const HD = `stratum                          hold     n     mean   median      SE       t    win%   MAEp95  MAEp99  ex-worst10`;
function line(name, H, c) {
  if (!c) return `${name.padEnd(32)} ${M.HLABEL(H).padEnd(5)}    <2 obs`;
  return [
    name.padEnd(32), M.HLABEL(H).padEnd(5),
    String(c.n).padStart(4), f(c.mean).padStart(8), f(c.median).padStart(8),
    f(c.se).padStart(7), f(c.t).padStart(7),
    (f(c.win, 1) + '%').padStart(7),
    f(c.maeP95, 0).padStart(8), f(c.maeP99, 0).padStart(7),
    f(c.exWorst10).padStart(11),
  ].join(' ');
}

// ============================================================
// BLOCK 1 — regime strata, no name filter
// ============================================================
for (const universe of ['CRYPTO_NEW', 'ALL']) {
  const base = universe === 'ALL' ? IS : IS.filter((u) => u.cat === 'CRYPTO_NEW');
  L(`\n\n${'='.repeat(110)}`);
  L(`BLOCK 1 — REGIME ONLY, universe = ${universe} (IS n=${base.length})`);
  L('='.repeat(110));
  for (const [rname, fn] of Object.entries(REGIMES)) {
    for (const dir of DIRS) {
      L(`\n--- ${rname} | ${dir.toUpperCase()} ---`);
      L(HD);
      for (const b of RORDER[rname]) {
        const g = base.filter((u) => fn(u) === b);
        for (const H of M.HORIZONS) {
          const c = cell(g, H, dir);
          L(line(`${b}`, H, c));
          if (c) rows.push({ block: 'regime', universe, regime: rname, bucket: b, filter: 'F0 no filter', dir, H, ...c });
        }
        L('');
      }
    }
  }
}

// ============================================================
// BLOCK 2 — name filters only (the thing 5-A said actually works)
// ============================================================
{
  const base = IS.filter((u) => u.cat === 'CRYPTO_NEW');
  L(`\n\n${'='.repeat(110)}`);
  L(`BLOCK 2 — NAME FILTERS ONLY, universe = CRYPTO_NEW (IS n=${base.length})`);
  L(`(these are the separators 5-A found: cheap + wild first day = bomb)`);
  L('='.repeat(110));
  for (const dir of DIRS) {
    L(`\n--- ${dir.toUpperCase()} ---`);
    L(HD);
    for (const [fname, ffn] of Object.entries(FILTERS)) {
      const g = base.filter(ffn);
      for (const H of M.HORIZONS) {
        const c = cell(g, H, dir);
        L(line(fname, H, c));
        if (c) rows.push({ block: 'filter', universe: 'CRYPTO_NEW', regime: 'none', bucket: 'all', filter: fname, dir, H, ...c });
      }
      L('');
    }
  }
}

// ============================================================
// BLOCK 3 — interaction: best name filter x regime
// ============================================================
{
  const base = IS.filter((u) => u.cat === 'CRYPTO_NEW');
  L(`\n\n${'='.repeat(110)}`);
  L(`BLOCK 3 — INTERACTION: name filter x R3 (BTC vs 200SMA), CRYPTO_NEW`);
  L(`(R3 was the only regime with any separating power in 5-A. Cells get small -- read n.)`);
  L('='.repeat(110));
  for (const [fname, ffn] of Object.entries(FILTERS)) {
    if (fname === 'F0 no filter') continue;
    for (const dir of DIRS) {
      L(`\n--- ${fname} | ${dir.toUpperCase()} ---`);
      L(HD);
      for (const b of RORDER['R3 BTC vs 200SMA']) {
        const g = base.filter((u) => ffn(u) && REGIMES['R3 BTC vs 200SMA'](u) === b);
        for (const H of [3, 7, 14]) {
          const c = cell(g, H, dir);
          L(line(b, H, c));
          if (c) rows.push({ block: 'interaction', universe: 'CRYPTO_NEW', regime: 'R3 BTC vs 200SMA', bucket: b, filter: fname, dir, H, ...c });
        }
        L('');
      }
    }
  }
}

// ============================================================
// SIGN STABILITY — the actual decision rule (no cherry-picking best cells)
// ============================================================
L(`\n\n${'='.repeat(110)}`);
L(`SIGN STABILITY — share of cells with a POSITIVE mean, and share with t > 2`);
L(`(the rule: an edge must show up as a MAJORITY of cells, not one lucky cell)`);
L('='.repeat(110));
L(`\ngroup                                          cells   mean>0   t>2   t<-2   best t   worst t`);
const groups = new Map();
for (const r of rows) {
  const k = `${r.block} | ${r.universe} | ${r.dir}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
for (const [k, g] of groups) {
  const pos = g.filter((r) => r.mean > 0).length;
  const t2 = g.filter((r) => r.t > 2).length;
  const tm2 = g.filter((r) => r.t < -2).length;
  const ts = g.map((r) => r.t).filter(Number.isFinite);
  L(`${k.padEnd(46)} ${String(g.length).padStart(5)}  ${(f((pos / g.length) * 100, 0) + '%').padStart(6)} ${String(t2).padStart(5)} ${String(tm2).padStart(6)}  ${f(Math.max(...ts)).padStart(7)}  ${f(Math.min(...ts)).padStart(8)}`);
}

L(`\n\n--- every IS cell with t > 2 (short OR long), sorted by t ---`);
const strong = rows.filter((r) => r.t > 2).sort((a, b) => b.t - a.t);
if (!strong.length) L(`  NONE. No cell in the entire in-sample grid reaches t > 2.`);
else {
  L(`  ${'block'.padEnd(12)} ${'dir'.padEnd(6)} ${'filter'.padEnd(26)} ${'regime bucket'.padEnd(16)} hold     n     mean   median   t     win%   MAEp99`);
  for (const r of strong) {
    L(`  ${r.block.padEnd(12)} ${r.dir.padEnd(6)} ${r.filter.padEnd(26)} ${r.bucket.padEnd(16)} ${M.HLABEL(r.H).padEnd(5)} ${String(r.n).padStart(4)} ${f(r.mean).padStart(8)} ${f(r.median).padStart(8)} ${f(r.t).padStart(5)} ${(f(r.win, 0) + '%').padStart(6)} ${f(r.maeP99, 0).padStart(7)}`);
  }
}

L(`\n\nNOTE ON MULTIPLE TESTING: this grid contains ${rows.length} cells. At a 5% level you would`);
L(`expect ~${Math.round(rows.length * 0.025)} cells with t > 2 BY CHANCE ALONE, and the cells are heavily overlapping`);
L(`(same trades reused across horizons/regimes), so they are not independent tests. A single`);
L(`t > 2 cell here is NOT evidence. That is exactly why 5-C exists: pick ONE, test it on OOS.`);

await M.ensureOut();
const head = 'block,universe,regime,bucket,filter,dir,holdDays,n,mean,median,sd,se,t,winPct,maeP95,maeP99,exWorst10';
const body = rows.map((r) => [r.block, r.universe, r.regime, r.bucket, r.filter, r.dir, r.H, r.n,
  f(r.mean, 4), f(r.median, 4), f(r.sd, 4), f(r.se, 4), f(r.t, 4), f(r.win, 2), f(r.maeP95, 3), f(r.maeP99, 3), f(r.exWorst10, 4)].join(','));
await writeFile(path.join(M.OUT_DIR, 'regime-strata.csv'), [head, ...body].join('\n') + '\n');
L(`\nwrote out/regime-strata.csv (${rows.length} cells)`);
