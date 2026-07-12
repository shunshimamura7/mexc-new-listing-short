import { load, simulate, stats, line, gridScan, BASE } from './binance-common.mjs';

const U = await load();
const sim = (m) => stats(m.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold)));

console.log(`baseline: entryH=${BASE.entryH}h SL=${BASE.SL}% TP=${BASE.TP}% hold=${BASE.hold}d  n_universe=${U.length}`);
console.log(`★ = |avg| > 2*SE\n`);

console.log('='.repeat(118));
console.log('【B】pump24 バケット');
console.log('='.repeat(118));
const EDGES = [0, 0.05, 0.10, 0.20, 0.30, 0.50, 1.0, 2.0, Infinity];
const LABELS = ['0-5%', '5-10%', '10-20%', '20-30%', '30-50%', '50-100%', '100-200%', '200%+'];
for (let i = 0; i < LABELS.length; i++) {
  const m = U.filter((s) => s.pump24 >= EDGES[i] && s.pump24 < EDGES[i + 1]);
  console.log(line(LABELS[i], sim(m), 12));
}
const neg = U.filter((s) => s.pump24 < 0);
if (neg.length) console.log(line('(pump24<0)', sim(neg), 12));

console.log(`\n各バケットの符号安定性（SL/TP 49セル。最良セルではなくプラス割合を見る）:`);
console.log(`${'bucket'.padEnd(12)}${'n'.padStart(5)}${'plus cells'.padStart(12)}${'cellMean'.padStart(10)}${'best'.padStart(8)}${'worst'.padStart(8)}${'t>2'.padStart(6)}`);
for (let i = 0; i < LABELS.length; i++) {
  const m = U.filter((s) => s.pump24 >= EDGES[i] && s.pump24 < EDGES[i + 1]);
  if (!m.length) continue;
  const g = gridScan(m);
  if (!g) continue;
  console.log(`${LABELS[i].padEnd(12)}${String(g.cells[0].n).padStart(5)}${(g.posPct.toFixed(0) + '%').padStart(12)}${(g.cellMean.toFixed(2) + '%').padStart(10)}${(g.best.toFixed(1) + '%').padStart(8)}${(g.worst.toFixed(1) + '%').padStart(8)}${String(g.sig).padStart(6)}`);
}

console.log(`\n${'='.repeat(118)}`);
console.log('【C】カテゴリ除外の効果');
console.log('='.repeat(118));
console.log(line('全銘柄', sim(U), 24));
console.log(line('CRYPTO_NEW のみ', sim(U.filter((s) => s.category === 'CRYPTO_NEW')), 24));
console.log(line('非STOCK', sim(U.filter((s) => s.category !== 'STOCK')), 24));
console.log(line('非STOCK 非ESTABLISHED', sim(U.filter((s) => s.category !== 'STOCK' && s.category !== 'ESTABLISHED')), 24));

console.log(`\n符号安定性:`);
for (const [lab, m] of [
  ['全銘柄', U],
  ['CRYPTO_NEW のみ', U.filter((s) => s.category === 'CRYPTO_NEW')],
  ['非STOCK', U.filter((s) => s.category !== 'STOCK')],
]) {
  const g = gridScan(m);
  console.log(`  ${lab.padEnd(18)} plus=${g.posPct.toFixed(0)}%  cellMean=${g.cellMean.toFixed(2)}%  t>2=${g.sig}/49`);
}

console.log(`\n${'='.repeat(118)}`);
console.log('ボラティリティ四分位 (range24)');
console.log('='.repeat(118));
const byQ = (key, fmt) => {
  const s = [...U].sort((a, b) => a[key] - b[key]);
  const q = (p) => s[Math.floor(p * s.length)][key];
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  console.log(`quartiles: q1=${fmt(q1)} q2=${fmt(q2)} q3=${fmt(q3)}`);
  console.log(line('Q1 (lowest)', sim(U.filter((x) => x[key] < q1)), 14));
  console.log(line('Q2', sim(U.filter((x) => x[key] >= q1 && x[key] < q2)), 14));
  console.log(line('Q3', sim(U.filter((x) => x[key] >= q2 && x[key] < q3)), 14));
  console.log(line('Q4 (highest)', sim(U.filter((x) => x[key] >= q3)), 14));
};
byQ('range24', (v) => `${(v * 100).toFixed(1)}%`);

console.log(`\n${'='.repeat(118)}`);
console.log('初動出来高四分位 (vol24 = quote volume)');
console.log('='.repeat(118));
byQ('vol24', (v) => v.toExponential(2));
