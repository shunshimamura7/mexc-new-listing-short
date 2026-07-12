import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BN = path.join(HERE, 'data', 'kline-binance');
const FR = path.join(HERE, 'data', 'funding');
const MEXC_KLINE = path.join(HERE, 'data', 'kline');

const HOUR = 3600_000;
const DAY = 86400_000;
const FEE = 0.04;
const BASE = { entryH: 24, SL: 30, TP: 20, hold: 7 };
const SLS = [10, 15, 20, 25, 30, 40, 50];
const TPS = [3, 5, 8, 10, 15, 20, 30];
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// ---------------- load klines + funding ----------------
const files = (await readdir(BN)).filter((f) => f.endsWith('.json'));
const U = [];
let noFR = 0;
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(BN, f), 'utf8'));
  const d = r.data;
  if (!d.time.length || !(d.open[0] > 0)) continue;

  const frPath = path.join(FR, `${r.symbol}.json`);
  let events = null;
  if (await exists(frPath)) events = JSON.parse(await readFile(frPath, 'utf8')).events;
  else noFR++;

  const cut = r.t0 + 24 * HOUR;
  let hi = -Infinity, k = 0;
  for (let i = 0; i < d.time.length && d.time[i] < cut; i++) { if (d.high[i] > hi) hi = d.high[i]; k++; }
  if (!k) continue;
  const dt = new Date(r.t0);
  U.push({
    symbol: r.symbol, contractType: r.contractType, baseAsset: r.baseAsset, t0: r.t0,
    cohort: `${dt.getUTCFullYear()}H${dt.getUTCMonth() < 6 ? 1 : 2}`,
    pump24: hi / d.open[0] - 1,
    time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
    fr: events, // null if we could not fetch it
  });
}
U.sort((a, b) => a.t0 - b.t0);

// ---------------- origin classification (same logic as classify-origin.mjs) ----------------
const spotFirst = JSON.parse(await readFile(path.join(HERE, 'data', 'spot-first.json'), 'utf8'));
const mexcT0 = new Map();
for (const f of (await readdir(MEXC_KLINE)).filter((x) => x.endsWith('.json'))) {
  const r = JSON.parse(await readFile(path.join(MEXC_KLINE, f), 'utf8'));
  const b = r.symbol.split('_')[0].toUpperCase();
  if (!mexcT0.has(b) || r.t0 < mexcT0.get(b)) mexcT0.set(b, r.t0);
}
const mexcDetail = JSON.parse(await readFile(path.join(HERE, 'detail.json'), 'utf8'));
const mexcCreate = new Map();
for (const c of mexcDetail.data) {
  const b = c.symbol.split('_')[0].toUpperCase();
  if (!mexcCreate.has(b) || c.createTime < mexcCreate.get(b)) mexcCreate.set(b, c.createTime);
}
const mexcEvidence = (b) => mexcT0.get(b) ?? mexcCreate.get(b) ?? null;

function origin(s, bDays, cDays = 30) {
  if (s.contractType === 'TRADIFI_PERPETUAL') return 'D';
  const b = (s.baseAsset ?? '').toUpperCase();
  const sp = spotFirst[`${b}USDT`] ?? null;
  const mx = mexcEvidence(b);
  if (sp != null && sp <= s.t0 - cDays * DAY) return 'C';
  if (mx != null && mx <= s.t0 - bDays * DAY) return 'B';
  if (sp == null && mx == null) return 'U';
  return 'A';
}

// ---------------- simulation, with and without funding ----------------
// Binance sign convention: fundingRate > 0 => longs pay shorts => a SHORT RECEIVES it.
// So for a short, funding PnL = + sum(rate) over events inside the holding window.
function fundingPnL(s, fromMs, toMs) {
  if (!s.fr) return null;
  let sum = 0, n = 0;
  for (const e of s.fr) {
    if (e.t > fromMs && e.t <= toMs) { sum += e.rate; n++; }
  }
  return { pct: sum * 100, n };
}

function simulate(s, entryH, slPct, tpPct, holdDays) {
  const ei = s.time.indexOf(s.t0 + entryH * HOUR);
  if (ei === -1) return null;
  const entry = s.open[ei];
  if (!(entry > 0)) return null;
  const slPrice = entry * (1 + slPct / 100);
  const tpPrice = entry * (1 - tpPct / 100);
  const deadline = s.time[ei] + holdDays * DAY;
  const entryT = s.time[ei];

  let exitT = null, gross = null, o = null, lastClose = null;
  for (let i = ei + 1; i < s.time.length; i++) {
    if (s.time[i] > deadline) break;
    if (s.high[i] >= slPrice) { o = 'SL'; gross = ((entry - slPrice) / entry) * 100; exitT = s.time[i]; break; }
    if (s.low[i] <= tpPrice) { o = 'TP'; gross = ((entry - tpPrice) / entry) * 100; exitT = s.time[i]; break; }
    lastClose = s.close[i]; exitT = s.time[i];
  }
  if (o === null) {
    if (lastClose == null) return null;
    o = 'TIMEOUT';
    gross = ((entry - lastClose) / entry) * 100;
  }
  const f = fundingPnL(s, entryT, exitT);
  return {
    o,
    pnlNoFR: gross - FEE,
    pnlFR: f ? gross - FEE + f.pct : null,   // null when funding data is missing
    frPct: f ? f.pct : null,
    frCount: f ? f.n : null,
  };
}

function stats(trades, key) {
  const t = trades.filter((x) => x && x[key] != null);
  const n = t.length;
  if (!n) return null;
  const p = t.map((x) => x[key]);
  const avg = p.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(p.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  return { n, avg, sd, se, t: avg / se, win: (p.filter((x) => x > 0).length / n) * 100,
    tp: t.filter((x) => x.o === 'TP').length, sl: t.filter((x) => x.o === 'SL').length, to: t.filter((x) => x.o === 'TIMEOUT').length };
}

function gridScan(members, key) {
  const cells = [];
  for (const SL of SLS) for (const TP of TPS) {
    const st = stats(members.map((s) => simulate(s, BASE.entryH, SL, TP, BASE.hold)), key);
    if (st) cells.push(st);
  }
  if (!cells.length) return null;
  return {
    posPct: (cells.filter((c) => c.avg > 0).length / cells.length) * 100,
    cellMean: cells.reduce((a, b) => a + b.avg, 0) / cells.length,
    best: Math.max(...cells.map((c) => c.avg)),
    worst: Math.min(...cells.map((c) => c.avg)),
    sig: cells.filter((c) => c.t > 2).length,
    n: cells[0].n,
  };
}

// ---------------- 0. funding coverage + SIGN CHECK ----------------
const withFR = U.filter((s) => s.fr);
console.log(`universe: ${U.length}   FR取得済み: ${withFR.length}   FR欠損: ${U.length - withFR.length}`);

console.log(`\n${'='.repeat(100)}`);
console.log('0. 符号の検算 — FRプラス = ショートの利益 になっているか');
console.log('='.repeat(100));
console.log('Binance仕様: fundingRate > 0 → ロングがショートに払う → ショートは受け取る（PnLに加算）');
{
  const samples = withFR.filter((s) => s.fr.length >= 5).slice(-3);
  for (const s of samples) {
    const r = simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold);
    if (!r || r.frPct == null) continue;
    const sign = r.frPct > 0 ? 'ショート受取(+)' : r.frPct < 0 ? 'ショート支払(-)' : 'ゼロ';
    console.log(
      `  ${s.symbol.padEnd(14)} FR回数=${String(r.frCount).padStart(3)} ΣFR=${r.frPct.toFixed(4).padStart(9)}%  ${sign}\n` +
      `      価格PnL(手数料込)=${r.pnlNoFR.toFixed(2).padStart(7)}%  →  FR込み=${r.pnlFR.toFixed(2).padStart(7)}%  ` +
      `(差 ${(r.pnlFR - r.pnlNoFR >= 0 ? '+' : '') + (r.pnlFR - r.pnlNoFR).toFixed(4)}%)`
    );
  }
  const allTrades = withFR.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold)).filter((x) => x && x.frPct != null);
  const frs = allTrades.map((x) => x.frPct);
  const pos = frs.filter((x) => x > 0).length;
  const sorted = [...frs].sort((a, b) => a - b);
  console.log(`\n  全${frs.length}トレードの ΣFR:`);
  console.log(`    プラス(ショート受取): ${pos} (${((pos / frs.length) * 100).toFixed(1)}%)   マイナス(ショート支払): ${frs.length - pos}`);
  console.log(`    平均=${(frs.reduce((a, b) => a + b, 0) / frs.length).toFixed(4)}%  中央値=${sorted[Math.floor(sorted.length / 2)].toFixed(4)}%  min=${sorted[0].toFixed(3)}%  max=${sorted.at(-1).toFixed(3)}%`);
  const cnt = allTrades.map((x) => x.frCount);
  console.log(`    保有中のFR発生回数: 中央値=${[...cnt].sort((a, b) => a - b)[Math.floor(cnt.length / 2)]}回  最大=${Math.max(...cnt)}回`);
}

// ---------------- 2. baseline A ----------------
const line = (lab, st, w = 26) => st
  ? `${lab.padEnd(w)} n=${String(st.n).padStart(4)} win=${st.win.toFixed(1).padStart(5)}% avg=${st.avg.toFixed(2).padStart(7)}% se=${st.se.toFixed(2).padStart(5)} t=${st.t.toFixed(2).padStart(6)} ${Math.abs(st.t) > 2 ? '★' : ' '}${st.n < 30 ? '  <-- n<30 判断不能' : ''}`
  : `${lab.padEnd(w)} n=0`;

console.log(`\n${'='.repeat(100)}`);
console.log(`2. 【A】ベースライン FR込み  (entryH=${BASE.entryH}h SL=${BASE.SL} TP=${BASE.TP} hold=${BASE.hold}d)`);
console.log('='.repeat(100));
const trAll = withFR.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold));
console.log(line('FR無し（前回の数字）', stats(trAll, 'pnlNoFR')));
console.log(line('FR込み', stats(trAll, 'pnlFR')));
{
  const a = stats(trAll, 'pnlNoFR'), b = stats(trAll, 'pnlFR');
  console.log(`\n  → FRによる期待値の変化: ${(b.avg - a.avg >= 0 ? '+' : '') + (b.avg - a.avg).toFixed(3)}%`);
}

// ---------------- 3. grid E ----------------
console.log(`\n${'='.repeat(100)}`);
console.log('3. 【E】グリッド 49セル (SL×TP, entryH=24h, hold=7d) — 符号安定性');
console.log('='.repeat(100));
for (const [lab, key] of [['FR無し', 'pnlNoFR'], ['FR込み', 'pnlFR']]) {
  const g = gridScan(withFR, key);
  console.log(`${lab.padEnd(8)} n=${g.n}  プラスのセル=${g.posPct.toFixed(0)}%  セル平均=${g.cellMean.toFixed(2)}%  最良=${g.best.toFixed(2)}%  最悪=${g.worst.toFixed(2)}%  t>2=${g.sig}/49`);
}

// ---------------- 4. cohort ----------------
console.log(`\n${'='.repeat(100)}`);
console.log('4. コホート推移（FR込み vs FR無し）');
console.log('='.repeat(100));
const cohorts = [...new Set(withFR.map((s) => s.cohort))].sort();
console.log(`${'cohort'.padEnd(9)}${'n'.padStart(5)}  ${'FR無し'.padStart(9)}${'FR込み'.padStart(11)}${'差(FR)'.padStart(10)}${'t(FR込)'.padStart(9)}  ${'plus%'.padStart(7)}`);
for (const c of cohorts) {
  const m = withFR.filter((s) => s.cohort === c);
  const tr = m.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold));
  const a = stats(tr, 'pnlNoFR'), b = stats(tr, 'pnlFR');
  if (!a || !b) continue;
  const g = gridScan(m, 'pnlFR');
  console.log(
    `${c.padEnd(9)}${String(b.n).padStart(5)}  ${(a.avg.toFixed(2) + '%').padStart(9)}${(b.avg.toFixed(2) + '%').padStart(11)}` +
    `${((b.avg - a.avg >= 0 ? '+' : '') + (b.avg - a.avg).toFixed(2) + '%').padStart(10)}${b.t.toFixed(2).padStart(9)}${Math.abs(b.t) > 2 ? '★' : ' '} ${(g ? g.posPct.toFixed(0) + '%' : '-').padStart(6)}` +
    (b.n < 30 ? '  <-- n<30 判断不能' : '')
  );
}

// ---------------- 5. origin classes x B-threshold ----------------
console.log(`\n${'='.repeat(100)}`);
console.log('5. 出自クラス別（FR込み） — B閾値を 1日 / 7日 / 30日 で振る');
console.log('   ★ A（Binance初上場）の直近コホートが生きているかが本丸');
console.log('='.repeat(100));

for (const bDays of [1, 7, 30]) {
  console.log(`\n---------- B閾値 = ${bDays}日 ----------`);
  const cls = new Map();
  for (const s of withFR) {
    const k = origin(s, bDays);
    if (!cls.has(k)) cls.set(k, []);
    cls.get(k).push(s);
  }
  for (const k of ['A', 'B', 'C', 'U', 'D']) {
    const m = cls.get(k) ?? [];
    if (!m.length) { console.log(line(`${k} (全期間)`, null)); continue; }
    const tr = m.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold));
    const g = gridScan(m, 'pnlFR');
    const st = stats(tr, 'pnlFR');
    const noFR = stats(tr, 'pnlNoFR');
    console.log(`${line(`${k} (全期間)`, st, 14)}  | FR無し=${noFR.avg.toFixed(2)}%  グリッドplus=${g ? g.posPct.toFixed(0) + '%' : '-'}`);
  }

  console.log(`\n  直近コホート × クラス（FR込み平均PnL / n / t）:`);
  console.log(`  ${'cohort'.padEnd(9)}${['A', 'B', 'C'].map((k) => k.padStart(26)).join('')}`);
  for (const c of ['2024H2', '2025H1', '2025H2', '2026H1']) {
    let row = `  ${c.padEnd(9)}`;
    for (const k of ['A', 'B', 'C']) {
      const m = withFR.filter((s) => s.cohort === c && origin(s, bDays) === k);
      const st = stats(m.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold)), 'pnlFR');
      if (!st) { row += '           n=0            '.padStart(26); continue; }
      const flag = st.n < 30 ? '?' : (Math.abs(st.t) > 2 ? '★' : ' ');
      row += `${(st.avg.toFixed(2) + '% n=' + st.n + ' t=' + st.t.toFixed(2) + flag)}`.padStart(26);
    }
    console.log(row);
  }
  console.log(`  （? = n<30 で判断不能。★ = |t|>2）`);
}
