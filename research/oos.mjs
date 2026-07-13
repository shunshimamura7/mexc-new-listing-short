// [5-C] OUT-OF-SAMPLE TEST.
//
// The condition was locked in at the end of 5-B, BEFORE any OOS data was read:
//
//     CRYPTO_NEW  x  first-24h 1h-log-return SD <= 2.5%  x  SHORT  x  hold +3d
//     entry = open at t0+24h, no SL, no TP, fee 0.04% round-trip
//
// ONE condition. No re-tuning. No "let's also try +7d and keep the better one".
// The extra horizons/variants below the headline are printed ONLY as context for the
// post-mortem; the verdict is decided by the headline cell and nothing else.

import * as M from './regime.mjs';
const { f, mean, median, sd, se, tval, srt, pctile, welch } = M;
const L = console.log;

// ---- the locked condition ----
const RULE = (u) => u.cat === 'CRYPTO_NEW' && Number.isFinite(u.vol24) && u.vol24 <= 2.5;
const DIR = 'short';
const HOLD = 3;
const RULE_NAME = 'CRYPTO_NEW & day1 1h-return SD <= 2.5% | SHORT | +3d';

const U = await M.loadUniverse();
const IS = U.filter((u) => u.isIS);
const OOS = U.filter((u) => !u.isIS);

function cell(g, H, dir) {
  const v = g.filter((u) => u.h[H]);
  if (!v.length) return null;
  const a = v.map((u) => u.h[H][dir]);
  const maes = srt(v.map((u) => u.h[H].mae));
  return {
    n: a.length, a,
    mean: mean(a), median: median(a), sd: sd(a), se: se(a), t: tval(a),
    win: (a.filter((x) => x > 0).length / a.length) * 100,
    maeP95: pctile(maes, 0.95), maeP99: pctile(maes, 0.99), maeMax: maes.at(-1),
    worst: [...v].sort((x, y) => x.h[H][dir] - y.h[H][dir]).slice(0, 5),
  };
}

L(`=== [5-C] OUT-OF-SAMPLE TEST ===`);
L(`\nCondition locked at end of 5-B, before any OOS number was looked at:`);
L(`   ${RULE_NAME}`);
L(`\nIS  = t0 <= 2025-06-30  (used to pick the rule)`);
L(`OOS = t0 >= 2025-07-01  (never touched until this line)`);

const isC = cell(IS.filter(RULE), HOLD, DIR);
const oosC = cell(OOS.filter(RULE), HOLD, DIR);

L(`\n\n${'='.repeat(96)}`);
L(`HEADLINE — the one cell that decides this`);
L('='.repeat(96));
L(`sample     n     mean   median      SD      SE       t    win%   MAEp95  MAEp99   MAEmax`);
for (const [nm, c] of [['IS ', isC], ['OOS', oosC]]) {
  L(`${nm}     ${String(c.n).padStart(4)} ${f(c.mean).padStart(8)} ${f(c.median).padStart(8)} ${f(c.sd).padStart(7)} ${f(c.se).padStart(7)} ${f(c.t).padStart(7)} ${(f(c.win, 1) + '%').padStart(7)} ${f(c.maeP95, 0).padStart(8)} ${f(c.maeP99, 0).padStart(7)} ${f(c.maeMax, 0).padStart(8)}`);
}
const w = welch(isC.a, oosC.a);
L(`\nIS vs OOS difference: Welch t=${f(w.t)}, p=${f(w.p, 4)}  (is the OOS mean distinguishable from the IS mean?)`);

// verdict per the pre-agreed table
L(`\n--- VERDICT (per the rule table agreed before the test) ---`);
const signMatch = Math.sign(oosC.mean) === Math.sign(isC.mean);
let verdict;
if (oosC.n < 30) verdict = 'n < 30 -> INCONCLUSIVE';
else if (!signMatch) verdict = 'SIGN FLIPPED -> OVERFIT. FULL RETREAT. No excuses.';
else if (oosC.t > 2) verdict = 'sign held AND t > 2 AND n >= 30 -> POSSIBLY REAL. proceed to further validation.';
else verdict = 'sign held but t < 2 -> INCONCLUSIVE. HOLD. (this is NOT a win)';
L(`  n        = ${oosC.n}      (need >= 30)`);
L(`  sign     = ${signMatch ? 'HELD' : 'FLIPPED'}   (IS mean ${f(isC.mean)}%, OOS mean ${f(oosC.mean)}%)`);
L(`  t        = ${f(oosC.t)}    (need > 2)`);
L(`\n  >>> ${verdict}`);

L(`\n  worst 5 OOS trades in the cell:`);
for (const u of oosC.worst) L(`    ${u.symbol.padEnd(18)} ${u.t0Iso.slice(0, 10)}  short ${f(u.h[HOLD].short).padStart(8)}%   MAE ${f(u.h[HOLD].mae, 0).padStart(5)}%   day1 SD ${f(u.vol24)}%`);

// ---------------------------------------------------------------
// Context only. Does NOT change the verdict above.
// ---------------------------------------------------------------
L(`\n\n${'='.repeat(96)}`);
L(`CONTEXT (post-mortem only — none of this can revise the verdict)`);
L('='.repeat(96));

L(`\n-- the same filter at other horizons, OOS --`);
L(`hold        IS n   IS mean    IS t  |  OOS n  OOS mean   OOS t   OOS med  OOS win%  OOS MAEp99`);
for (const H of M.HORIZONS) {
  const i = cell(IS.filter(RULE), H, DIR), o = cell(OOS.filter(RULE), H, DIR);
  if (!i || !o) continue;
  const flag = H === HOLD ? '  <== the locked cell' : '';
  L(`${M.HLABEL(H).padEnd(6)} ${String(i.n).padStart(6)} ${f(i.mean).padStart(9)} ${f(i.t).padStart(7)}  | ${String(o.n).padStart(6)} ${f(o.mean).padStart(9)} ${f(o.t).padStart(7)} ${f(o.median).padStart(9)} ${(f(o.win, 1) + '%').padStart(8)} ${f(o.maeP99, 0).padStart(11)}${flag}`);
}

L(`\n-- unfiltered CRYPTO_NEW short, IS vs OOS (the baseline the filter is supposed to beat) --`);
L(`hold        IS n   IS mean    IS t  |  OOS n  OOS mean   OOS t   OOS med  OOS win%`);
for (const H of M.HORIZONS) {
  const base = (u) => u.cat === 'CRYPTO_NEW';
  const i = cell(IS.filter(base), H, DIR), o = cell(OOS.filter(base), H, DIR);
  if (!i || !o) continue;
  L(`${M.HLABEL(H).padEnd(6)} ${String(i.n).padStart(6)} ${f(i.mean).padStart(9)} ${f(i.t).padStart(7)}  | ${String(o.n).padStart(6)} ${f(o.mean).padStart(9)} ${f(o.t).padStart(7)} ${f(o.median).padStart(9)} ${(f(o.win, 1) + '%').padStart(8)}`);
}

L(`\n-- OOS by half-year cohort, locked cell (${M.HLABEL(HOLD)}) --`);
L(`cohort      n     mean   median      SE       t    win%`);
const g = OOS.filter(RULE).filter((u) => u.h[HOLD]);
for (const c of [...new Set(g.map((u) => u.cohort))].sort()) {
  const a = g.filter((u) => u.cohort === c).map((u) => u.h[HOLD][DIR]);
  L(`${c.padEnd(8)} ${String(a.length).padStart(4)} ${f(mean(a)).padStart(8)} ${f(median(a)).padStart(8)} ${f(se(a)).padStart(7)} ${f(tval(a)).padStart(7)} ${(f((a.filter((x) => x > 0).length / a.length) * 100, 1) + '%').padStart(7)}`);
}
L(`\n(a cohort with n < 20 is noise. read n before reading t.)`);
