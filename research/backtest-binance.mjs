import { load, simulate, stats, line, BASE } from './binance-common.mjs';

const U = await load();
console.log(`=== 【A】ベースライン: entry=t0+${BASE.entryH}h SL=${BASE.SL}% TP=${BASE.TP}% hold=${BASE.hold}d fee=0.04% ===`);
console.log(`universe: ${U.length} symbols (フィルター無し)\n`);

const trades = U.map((s) => ({ s, r: simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold) }));
const skipped = trades.filter((x) => !x.r);
const st = stats(trades.map((x) => x.r));

console.log(`n (判定できた) : ${st.n}   スキップ: ${skipped.length}`);
if (skipped.length) console.log(`  skipped: ${skipped.map((x) => `${x.s.symbol}(${x.s.actualDays}d)`).slice(0, 10).join(', ')}`);

console.log(`\n--- performance ---`);
console.log(`勝率      : ${st.win.toFixed(1)}%  (${Math.round(st.win / 100 * st.n)}W / ${st.n - Math.round(st.win / 100 * st.n)}L)`);
console.log(`平均PnL   : ${st.avg.toFixed(2)}%   <- 期待値`);
console.log(`中央値PnL : ${st.med.toFixed(2)}%`);
console.log(`SD        : ${st.sd.toFixed(1)}   SE=${st.se.toFixed(2)}   t=${st.t.toFixed(2)} ${st.sig ? '★' : ''}`);
console.log(`合計PnL   : ${(st.avg * st.n).toFixed(1)}%  (等サイズ${st.n}トレード)`);

console.log(`\n--- 決着内訳 ---`);
const rs = trades.map((x) => x.r).filter(Boolean);
for (const k of ['TP', 'SL', 'TIMEOUT']) {
  const g = rs.filter((r) => r.o === k);
  if (!g.length) { console.log(`${k.padEnd(8)}: 0`); continue; }
  const sum = g.reduce((a, b) => a + b.pnl, 0);
  console.log(`${k.padEnd(8)}: ${String(g.length).padStart(3)} (${((g.length / st.n) * 100).toFixed(1)}%)  平均=${(sum / g.length).toFixed(2)}%  寄与=${sum.toFixed(1)}%`);
}
const to = rs.filter((r) => r.o === 'TIMEOUT');
console.log(`  時間切れ内訳: ${to.filter((r) => r.pnl > 0).length}勝 / ${to.filter((r) => r.pnl <= 0).length}敗`);

console.log(`\n最大負け: ${st.min.toFixed(2)}%   最大勝ち: ${st.max.toFixed(2)}%`);
console.log(`同一足でSL/TP両方に触れた: ${st.both}件 (SL優先で処理)`);

console.log(`\n--- カテゴリ別 ---`);
for (const c of ['CRYPTO_NEW', 'STOCK', 'ESTABLISHED', 'COMMODITY', 'ETF_INDEX']) {
  const m = U.filter((s) => s.category === c);
  if (!m.length) { console.log(`${c.padEnd(14)} n=0`); continue; }
  console.log(line(c, stats(m.map((s) => simulate(s, BASE.entryH, BASE.SL, BASE.TP, BASE.hold))), 14));
}

console.log(`\n--- status別（SETTLING = 上場廃止プロセス中） ---`);
for (const s of ['TRADING', 'SETTLING']) {
  const m = U.filter((x) => x.status === s);
  console.log(line(s, stats(m.map((x) => simulate(x, BASE.entryH, BASE.SL, BASE.TP, BASE.hold))), 14));
}
