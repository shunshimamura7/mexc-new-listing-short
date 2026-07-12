import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'data', 'kline');
const HOUR = 3600;

const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
const U = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8'));
  const d = r.data;
  if (!d.time.length) continue;
  const t0 = Math.floor(r.t0 / 1000);
  const dt = new Date(r.t0);
  const cohort = `${dt.getUTCFullYear()}H${dt.getUTCMonth() < 6 ? 1 : 2}`;
  const cut = t0 + 24 * HOUR;
  let hi = -Infinity, k = 0;
  for (let i = 0; i < d.time.length && d.time[i] < cut; i++) { if (d.high[i] > hi) hi = d.high[i]; k++; }
  const firstOpen = d.open[0];
  if (!k || !(firstOpen > 0)) continue;
  const ei = d.time.indexOf(cut);
  U.push({
    symbol: r.symbol, t0, cohort, firstOpen,
    pump24: hi / firstOpen - 1,
    isStock: /STOCK/i.test(r.symbol.split('_')[0]),
    ei, entry: ei === -1 ? null : d.open[ei],
    time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
  });
}

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const HORIZONS = [
  ['+1h', 1], ['+6h', 6], ['+12h', 12], ['+1d', 24], ['+2d', 48], ['+3d', 72],
  ['+5d', 120], ['+7d', 168], ['+14d', 336], ['+30d', 720],
];

// short PnL from entry, ignoring fees: positive = price fell
function pathStats(members, anchorKey) {
  const rows = [];
  for (const [label, h] of HORIZONS) {
    const rets = [];
    for (const s of members) {
      const base = anchorKey === 'entry' ? s.entry : s.firstOpen;
      const t0ref = anchorKey === 'entry' ? s.t0 + 24 * HOUR : s.t0;
      if (!base) continue;
      const i = s.time.indexOf(t0ref + h * HOUR);
      if (i === -1) continue; // horizon not reached in the data we have
      rets.push(((base - s.close[i]) / base) * 100);
    }
    if (!rets.length) { rows.push([label, 0, null, null, null, null, null]); continue; }
    rows.push([label, rets.length, mean(rets), q(rets, 0.5), q(rets, 0.25), q(rets, 0.75), (rets.filter((r) => r > 0).length / rets.length) * 100]);
  }
  return rows;
}

function printPath(title, members, anchorKey) {
  console.log(`\n--- ${title} (n_max=${members.length}, anchor=${anchorKey === 'entry' ? 't0+24h open' : 't0 open'}) ---`);
  console.log(`  horizon      n     mean    median      p25      p75   %down`);
  for (const [label, n, m, md, p25, p75, pd] of pathStats(members, anchorKey)) {
    if (!n) { console.log(`  ${label.padEnd(8)} ${String(n).padStart(5)}       --`); continue; }
    console.log(
      `  ${label.padEnd(8)} ${String(n).padStart(5)} ${m.toFixed(2).padStart(8)}% ${md.toFixed(2).padStart(8)}% ` +
      `${p25.toFixed(1).padStart(8)}% ${p75.toFixed(1).padStart(8)}% ${pd.toFixed(0).padStart(6)}%`
    );
  }
}

// excursions from entry within a horizon
function excursions(members, holdH) {
  const out = [];
  for (const s of members) {
    if (s.ei === -1 || !s.entry) continue;
    const dl = s.time[s.ei] + holdH * HOUR;
    let minLow = Infinity, maxHigh = -Infinity, troughT = null, last = null;
    for (let i = s.ei + 1; i < s.time.length; i++) {
      if (s.time[i] > dl) break;
      if (s.low[i] < minLow) { minLow = s.low[i]; troughT = s.time[i]; }
      if (s.high[i] > maxHigh) maxHigh = s.high[i];
      last = s.close[i];
    }
    if (last == null) continue;
    out.push({
      symbol: s.symbol,
      mfe: ((s.entry - minLow) / s.entry) * 100,          // best short profit reachable
      mae: ((maxHigh - s.entry) / s.entry) * 100,         // worst adverse move
      troughH: (troughT - s.time[s.ei]) / HOUR,
      final: ((s.entry - last) / s.entry) * 100,
    });
  }
  return out;
}

function printExc(title, members, holdH) {
  const e = excursions(members, holdH);
  if (!e.length) { console.log(`\n--- ${title}: n=0 ---`); return; }
  const mfe = e.map((x) => x.mfe);
  console.log(`\n--- ${title} (n=${e.length}, hold=${holdH / 24}d from entry) ---`);
  console.log(`  MFE (最大どこまで下がったか)  median=${q(mfe, 0.5).toFixed(1)}%  p75=${q(mfe, 0.75).toFixed(1)}%  p90=${q(mfe, 0.9).toFixed(1)}%`);
  console.log(`  MAE (最大どこまで踏まれたか)  median=${q(e.map((x) => x.mae), 0.5).toFixed(1)}%  p75=${q(e.map((x) => x.mae), 0.75).toFixed(1)}%  p90=${q(e.map((x) => x.mae), 0.9).toFixed(1)}%`);
  console.log(`  下落トリガー到達率:`);
  for (const lvl of [3, 5, 8, 10, 15, 20, 25, 30, 40, 50]) {
    const hit = e.filter((x) => x.mfe >= lvl);
    // of those that reached lvl, how much further did they go?
    const further = hit.length ? mean(hit.map((x) => x.mfe)) : 0;
    const bar = '#'.repeat(Math.round((hit.length / e.length) * 40));
    console.log(
      `    -${String(lvl).padStart(2)}% 到達: ${String(hit.length).padStart(3)}/${e.length} = ${((hit.length / e.length) * 100).toFixed(0).padStart(3)}%  ` +
      `${bar.padEnd(40)} (到達組の平均MFE ${further.toFixed(1)}%)`
    );
  }
  const troughs = e.map((x) => x.troughH);
  console.log(`  最安値までの時間: median=${q(troughs, 0.5).toFixed(0)}h  p25=${q(troughs, 0.25).toFixed(0)}h  p75=${q(troughs, 0.75).toFixed(0)}h`);
}

console.log(`universe: ${U.length} symbols (3y). fees excluded — these are raw price moves.`);
console.log(`短期PnL基準: 正の値 = 価格が下がった = ショートの利益`);

console.log(`\n${'='.repeat(80)}\nD-1. 上場後の値動き（エントリー = t0+24h の open）\n${'='.repeat(80)}`);
printPath('ALL', U, 'entry');
printPath('非STOCK', U.filter((s) => !s.isStock), 'entry');
printPath('2026H1のみ（現レジーム）', U.filter((s) => s.cohort === '2026H1'), 'entry');
printPath('pump24 >= 50%', U.filter((s) => s.pump24 >= 0.5), 'entry');

console.log(`\n${'='.repeat(80)}\nD-2. 上場そのもの（アンカー = t0 の open）— 「新規上場は下がる」は本当か\n${'='.repeat(80)}`);
printPath('ALL', U, 'first');
printPath('非STOCK', U.filter((s) => !s.isStock), 'first');

console.log(`\n${'='.repeat(80)}\nD-3. MFE/MAE — TP20% は妥当か、もっと引っ張れるか\n${'='.repeat(80)}`);
printExc('ALL / 7日保有', U, 168);
printExc('ALL / 30日保有', U, 720);
printExc('非STOCK / 7日保有', U.filter((s) => !s.isStock), 168);
printExc('非STOCK / 30日保有', U.filter((s) => !s.isStock), 720);
printExc('pump24>=50% / 30日保有', U.filter((s) => s.pump24 >= 0.5), 720);
