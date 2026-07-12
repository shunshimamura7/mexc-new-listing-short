import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { load, simulate, stats, OUT, SLS, TPS } from './binance-common.mjs';

const ENTRY_H = [6, 12, 24, 48, 72];
const HOLDS = [3, 7, 14];

const U = await load();
console.log(`universe: ${U.length}   cells: ${ENTRY_H.length * SLS.length * TPS.length * HOLDS.length}\n`);

const cells = [];
for (const entryH of ENTRY_H) {
  for (const SL of SLS) {
    for (const TP of TPS) {
      for (const maxHold of HOLDS) {
        const trades = U.map((s) => simulate(s, entryH, SL, TP, maxHold));
        const st = stats(trades);
        if (!st) continue;
        cells.push({
          entryH, SL, TP, maxHold, n: st.n, skipped: U.length - st.n,
          winRate: st.win, avgPnL: st.avg, medPnL: st.med, se: st.se, t: st.t,
          tpCount: st.tp, slCount: st.sl, timeoutCount: st.to,
          timeoutWin: trades.filter((r) => r && r.o === 'TIMEOUT' && r.pnl > 0).length,
          timeoutLoss: trades.filter((r) => r && r.o === 'TIMEOUT' && r.pnl <= 0).length,
          timeoutRate: (st.to / st.n) * 100,
          bothTouched: st.both,
        });
      }
    }
  }
}

await mkdir(OUT, { recursive: true });
const header = 'entryH,SL,TP,maxHold,n,skipped,winRate,avgPnL,medPnL,se,t,tpCount,slCount,timeoutCount,timeoutWin,timeoutLoss,timeoutRate,bothTouched';
await writeFile(path.join(OUT, 'binance-grid.csv'), [header, ...cells.map((c) => [
  c.entryH, c.SL, c.TP, c.maxHold, c.n, c.skipped, c.winRate.toFixed(2), c.avgPnL.toFixed(3),
  c.medPnL.toFixed(3), c.se.toFixed(3), c.t.toFixed(2), c.tpCount, c.slCount, c.timeoutCount,
  c.timeoutWin, c.timeoutLoss, c.timeoutRate.toFixed(1), c.bothTouched,
].join(','))].join('\n'));
console.log(`wrote ${cells.length} cells -> out/binance-grid.csv\n`);

const row = (c) =>
  `entryH=${String(c.entryH).padStart(2)}h SL=${String(c.SL).padStart(2)}% TP=${String(c.TP).padStart(2)}% hold=${String(c.maxHold).padStart(2)}d | ` +
  `n=${String(c.n).padStart(3)} win=${c.winRate.toFixed(1).padStart(5)}% avg=${c.avgPnL.toFixed(2).padStart(6)}% t=${c.t.toFixed(2).padStart(5)}${c.t > 2 ? '★' : ' '} | ` +
  `TP=${String(c.tpCount).padStart(3)} SL=${String(c.slCount).padStart(3)} TO=${String(c.timeoutCount).padStart(3)} TOrate=${c.timeoutRate.toFixed(0).padStart(2)}%`;

const big = cells.filter((c) => c.n >= 100);
const pos = big.filter((c) => c.avgPnL > 0);

console.log(`=== 符号安定性（★これが本物のエッジ指標） ===`);
console.log(`プラスのセル : ${pos.length} / ${big.length} (${((pos.length / big.length) * 100).toFixed(0)}%)   [MEXC: 46%]`);
console.log(`t>2 のセル   : ${big.filter((c) => c.t > 2).length} / ${big.length}   [MEXC: 全体グリッドでは計測せず]`);
console.log(`全セル平均期待値: ${(big.reduce((a, b) => a + b.avgPnL, 0) / big.length).toFixed(3)}%   [MEXC: +0.004%]`);
console.log(`最良 ${Math.max(...big.map((c) => c.avgPnL)).toFixed(2)}%  最悪 ${Math.min(...big.map((c) => c.avgPnL)).toFixed(2)}%   [MEXC: +1.44% / -1.56%]`);

console.log(`\n=== 期待値 TOP20 (n>=100) ===`);
for (const c of [...big].sort((a, b) => b.avgPnL - a.avgPnL).slice(0, 20)) console.log(row(c));

console.log(`\n=== 期待値 ワースト10 (n>=100) ===`);
for (const c of [...big].sort((a, b) => a.avgPnL - b.avgPnL).slice(0, 10)) console.log(row(c));

console.log(`\n=== entryH別の最良セル ===`);
for (const h of ENTRY_H) {
  const g = big.filter((c) => c.entryH === h);
  const best = g.reduce((a, b) => (b.avgPnL > a.avgPnL ? b : a));
  const posH = g.filter((c) => c.avgPnL > 0).length;
  console.log(`${row(best)}   [entryH=${h}h のプラス率 ${posH}/${g.length} = ${((posH / g.length) * 100).toFixed(0)}%]`);
}
