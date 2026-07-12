import { load, simulate, stats, gridScan, BASE } from './binance-common.mjs';

const U = await load();
const sim = (m) => stats(m.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold)));

const cohorts = [...new Set(U.map((s) => s.cohort))].sort();
console.log(`universe: ${U.length}   baseline: entryH=${BASE.entryH}h SL=${BASE.SL}% TP=${BASE.TP}% hold=${BASE.hold}d`);
console.log(`★ = |t| > 2\n`);

console.log('='.repeat(120));
console.log(`${'cohort'.padEnd(9)}${'n'.padStart(5)}${'win'.padStart(8)}${'avgPnL'.padStart(9)}${'SD'.padStart(7)}${'SE'.padStart(7)}${'t'.padStart(7)}  ` +
  `${'plus cells'.padStart(11)}${'cellMean'.padStart(10)}${'t>2'.padStart(5)}   ${'STOCK%'.padStart(7)}${'pump<5%'.padStart(9)}`);
console.log('='.repeat(120));

for (const c of cohorts) {
  const m = U.filter((s) => s.cohort === c);
  const st = sim(m);
  const g = gridScan(m);
  const stockPct = (m.filter((s) => s.category === 'STOCK').length / m.length) * 100;
  const deadPct = (m.filter((s) => s.pump24 < 0.05).length / m.length) * 100;
  if (!st) { console.log(`${c.padEnd(9)}${String(m.length).padStart(5)}  (no trades)`); continue; }
  console.log(
    `${c.padEnd(9)}${String(st.n).padStart(5)}${(st.win.toFixed(1) + '%').padStart(8)}${(st.avg.toFixed(2) + '%').padStart(9)}` +
    `${st.sd.toFixed(1).padStart(7)}${st.se.toFixed(2).padStart(7)}${st.t.toFixed(2).padStart(7)}${Math.abs(st.t) > 2 ? ' ★' : '  '}` +
    `${(g ? g.posPct.toFixed(0) + '%' : '-').padStart(11)}${(g ? g.cellMean.toFixed(2) + '%' : '-').padStart(10)}${String(g ? g.sig : '-').padStart(5)}   ` +
    `${(stockPct.toFixed(0) + '%').padStart(7)}${(deadPct.toFixed(0) + '%').padStart(9)}` +
    (st.n < 30 ? '  <-- n<30' : '')
  );
}

const all = sim(U); const ag = gridScan(U);
console.log('-'.repeat(120));
console.log(`${'ALL'.padEnd(9)}${String(all.n).padStart(5)}${(all.win.toFixed(1) + '%').padStart(8)}${(all.avg.toFixed(2) + '%').padStart(9)}` +
  `${all.sd.toFixed(1).padStart(7)}${all.se.toFixed(2).padStart(7)}${all.t.toFixed(2).padStart(7)}${Math.abs(all.t) > 2 ? ' ★' : '  '}` +
  `${(ag.posPct.toFixed(0) + '%').padStart(11)}${(ag.cellMean.toFixed(2) + '%').padStart(10)}${String(ag.sig).padStart(5)}`);

// CRYPTO_NEW only — strip the stock tokens that dominate 2026
console.log(`\n${'='.repeat(120)}`);
console.log('CRYPTO_NEW のみ（株式トークンを除いた素の暗号新規上場）');
console.log('='.repeat(120));
console.log(`${'cohort'.padEnd(9)}${'n'.padStart(5)}${'win'.padStart(8)}${'avgPnL'.padStart(9)}${'SE'.padStart(7)}${'t'.padStart(7)}  ${'plus cells'.padStart(11)}${'cellMean'.padStart(10)}${'t>2'.padStart(5)}`);
for (const c of cohorts) {
  const m = U.filter((s) => s.cohort === c && s.category === 'CRYPTO_NEW');
  if (!m.length) continue;
  const st = sim(m);
  const g = gridScan(m);
  if (!st) continue;
  console.log(
    `${c.padEnd(9)}${String(st.n).padStart(5)}${(st.win.toFixed(1) + '%').padStart(8)}${(st.avg.toFixed(2) + '%').padStart(9)}` +
    `${st.se.toFixed(2).padStart(7)}${st.t.toFixed(2).padStart(7)}${Math.abs(st.t) > 2 ? ' ★' : '  '}` +
    `${(g ? g.posPct.toFixed(0) + '%' : '-').padStart(11)}${(g ? g.cellMean.toFixed(2) + '%' : '-').padStart(10)}${String(g ? g.sig : '-').padStart(5)}` +
    (st.n < 30 ? '  <-- n<30' : '')
  );
}

// survivorship probe: SETTLING vs TRADING per cohort
console.log(`\n${'='.repeat(120)}`);
console.log('生存者バイアスの直接観測: SETTLING（上場廃止プロセス中）はショートに有利か');
console.log('='.repeat(120));
for (const s of ['TRADING', 'SETTLING']) {
  const m = U.filter((x) => x.status === s);
  const st = sim(m); const g = gridScan(m);
  console.log(`${s.padEnd(10)} n=${String(st.n).padStart(4)} win=${st.win.toFixed(1)}% avg=${st.avg.toFixed(2)}% t=${st.t.toFixed(2)}${Math.abs(st.t) > 2 ? ' ★' : ''}  plus=${g.posPct.toFixed(0)}% cellMean=${g.cellMean.toFixed(2)}%`);
}
console.log(`\n注: 完全に上場廃止された契約は exchangeInfo から消えるため、ここには現れない。`);
console.log(`    SETTLING は「消えかけ」であって「消えたもの」ではない。バイアスの下限を示すに過ぎない。`);
