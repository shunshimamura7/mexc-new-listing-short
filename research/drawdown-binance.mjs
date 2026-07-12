import { load, HOUR, DAY } from './binance-common.mjs';

const U = await load();
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const HORIZONS = [['+1d', 24], ['+3d', 72], ['+7d', 168], ['+14d', 336], ['+30d', 720]];

function printPath(title, members) {
  console.log(`\n--- ${title} (n_max=${members.length}, アンカー=t0+24h の open) ---`);
  console.log(`  horizon      n     mean   median      p25      p75   下落率`);
  for (const [label, h] of HORIZONS) {
    const rets = [];
    for (const s of members) {
      const ei = s.time.indexOf(s.t0 + 24 * HOUR);
      if (ei === -1) continue;
      const entry = s.open[ei];
      const i = s.time.indexOf(s.time[ei] + h * HOUR);
      if (i === -1) continue;
      rets.push(((entry - s.close[i]) / entry) * 100);
    }
    if (!rets.length) { console.log(`  ${label.padEnd(8)} ${String(0).padStart(5)}      --`); continue; }
    console.log(
      `  ${label.padEnd(8)} ${String(rets.length).padStart(5)} ${mean(rets).toFixed(2).padStart(8)}% ${q(rets, 0.5).toFixed(2).padStart(7)}% ` +
      `${q(rets, 0.25).toFixed(1).padStart(8)}% ${q(rets, 0.75).toFixed(1).padStart(8)}% ${((rets.filter((r) => r > 0).length / rets.length) * 100).toFixed(0).padStart(6)}%`
    );
  }
}

function printExc(title, members, holdH) {
  const e = [];
  for (const s of members) {
    const ei = s.time.indexOf(s.t0 + 24 * HOUR);
    if (ei === -1) continue;
    const entry = s.open[ei];
    const dl = s.time[ei] + holdH * HOUR;
    let minLow = Infinity, maxHigh = -Infinity, troughT = null, last = null;
    for (let i = ei + 1; i < s.time.length; i++) {
      if (s.time[i] > dl) break;
      if (s.low[i] < minLow) { minLow = s.low[i]; troughT = s.time[i]; }
      if (s.high[i] > maxHigh) maxHigh = s.high[i];
      last = s.close[i];
    }
    if (last == null) continue;
    e.push({ mfe: ((entry - minLow) / entry) * 100, mae: ((maxHigh - entry) / entry) * 100, troughH: (troughT - s.time[ei]) / HOUR });
  }
  if (!e.length) return;
  console.log(`\n--- ${title} (n=${e.length}, hold=${holdH / 24}d) ---`);
  console.log(`  MFE 最大下落  : median=${q(e.map((x) => x.mfe), 0.5).toFixed(1)}%  p75=${q(e.map((x) => x.mfe), 0.75).toFixed(1)}%  p90=${q(e.map((x) => x.mfe), 0.9).toFixed(1)}%`);
  console.log(`  MAE 最大踏上げ: median=${q(e.map((x) => x.mae), 0.5).toFixed(1)}%  p75=${q(e.map((x) => x.mae), 0.75).toFixed(1)}%  p90=${q(e.map((x) => x.mae), 0.9).toFixed(1)}%   <- 尾の太さ`);
  console.log(`  下落トリガー到達率:`);
  for (const lvl of [5, 10, 15, 20, 30, 40, 50]) {
    const hit = e.filter((x) => x.mfe >= lvl);
    console.log(`    -${String(lvl).padStart(2)}%: ${String(hit.length).padStart(3)}/${e.length} = ${((hit.length / e.length) * 100).toFixed(0).padStart(3)}%  ${'#'.repeat(Math.round((hit.length / e.length) * 40))}`);
  }
  console.log(`  最安値までの時間: median=${q(e.map((x) => x.troughH), 0.5).toFixed(0)}h  p75=${q(e.map((x) => x.troughH), 0.75).toFixed(0)}h`);
}

console.log(`【D】下落プロファイル (Binance, n=${U.length}). 手数料抜き。正の値=価格下落=ショート利益`);
console.log(`※ MEXCでは「中央値プラス・平均マイナス」= 踏み上げの尾が太く期待値を食う構造だった。ここを見る。`);

console.log(`\n${'='.repeat(80)}\nD-1. 経過別リターン\n${'='.repeat(80)}`);
printPath('ALL', U);
printPath('CRYPTO_NEW', U.filter((s) => s.category === 'CRYPTO_NEW'));
printPath('2026H1 (現レジーム)', U.filter((s) => s.cohort === '2026H1'));
printPath('2025H2 (現レジーム)', U.filter((s) => s.cohort === '2025H2'));

console.log(`\n${'='.repeat(80)}\nD-2. MFE / MAE\n${'='.repeat(80)}`);
printExc('ALL / 7日', U, 168);
printExc('ALL / 30日', U, 720);
printExc('CRYPTO_NEW / 7日', U.filter((s) => s.category === 'CRYPTO_NEW'), 168);
printExc('2026H1 / 7日', U.filter((s) => s.cohort === '2026H1'), 168);
