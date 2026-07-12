// Step 1 for funding: dump the real payload before designing anything.
const FAPI = 'https://fapi.binance.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(pathname, params = {}) {
  const qs = new URLSearchParams(params);
  const url = `${FAPI}${pathname}${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url);
  const weight = res.headers.get('x-mbx-used-weight-1m');
  const j = await res.json();
  await sleep(250);
  return { url, status: res.status, weight, j };
}

console.log('='.repeat(90));
console.log('1. /fapi/v1/fundingRate — レスポンス構造');
console.log('='.repeat(90));
{
  const { url, status, weight, j } = await get('/fapi/v1/fundingRate', { symbol: 'BTCUSDT', limit: '3' });
  console.log(`GET ${url}\nHTTP ${status}  used-weight-1m=${weight}`);
  console.log(`array? ${Array.isArray(j)}  length=${j.length}`);
  console.log(JSON.stringify(j[0], null, 2));
  if (j[0]) {
    console.log(`\nfundingTime ${j[0].fundingTime} -> ${new Date(j[0].fundingTime).toISOString()} (${String(j[0].fundingTime).length}桁 = ms)`);
    console.log(`fundingRate は文字列: ${JSON.stringify(j[0].fundingRate)} (${typeof j[0].fundingRate}) = ${Number(j[0].fundingRate) * 100}%`);
  }
}

console.log(`\n${'='.repeat(90)}`);
console.log('2. 1リクエストの上限本数');
console.log('='.repeat(90));
for (const lim of ['1000', '1001']) {
  const { status, weight, j } = await get('/fapi/v1/fundingRate', { symbol: 'BTCUSDT', limit: lim });
  console.log(`limit=${lim}: HTTP ${status} weight=${weight} -> ${Array.isArray(j) ? `${j.length} 件` : JSON.stringify(j)}`);
}
// how many days does one full request cover?
{
  const { j } = await get('/fapi/v1/fundingRate', { symbol: 'BTCUSDT', limit: '1000' });
  if (j.length > 1) {
    const span = (j.at(-1).fundingTime - j[0].fundingTime) / 86400_000;
    console.log(`\n1000件 = ${span.toFixed(1)} 日ぶん  (${new Date(j[0].fundingTime).toISOString().slice(0, 10)} .. ${new Date(j.at(-1).fundingTime).toISOString().slice(0, 10)})`);
    const gaps = new Set();
    for (let i = 1; i < Math.min(20, j.length); i++) gaps.add((j[i].fundingTime - j[i - 1].fundingTime) / 3600_000);
    console.log(`BTCUSDT の発生間隔: ${[...gaps].join(', ')} 時間`);
  }
}

console.log(`\n${'='.repeat(90)}`);
console.log('3. 遡れる期間（BTCUSDT の最古のFR）');
console.log('='.repeat(90));
{
  const { j } = await get('/fapi/v1/fundingRate', { symbol: 'BTCUSDT', startTime: '1500000000000', limit: '3' });
  console.log(`最古: ${j[0] ? new Date(j[0].fundingTime).toISOString() : 'なし'}  (kline最古は 2019-09-08)`);
}

console.log(`\n${'='.repeat(90)}`);
console.log('4. ファンディング間隔は銘柄ごとに違うか (/fapi/v1/fundingInfo)');
console.log('='.repeat(90));
{
  const { status, weight, j } = await get('/fapi/v1/fundingInfo');
  console.log(`HTTP ${status} weight=${weight}  -> ${Array.isArray(j) ? j.length : '?'} 件が「デフォルト以外」の設定を持つ`);
  if (Array.isArray(j) && j.length) {
    console.log(JSON.stringify(j[0], null, 2));
    const byInterval = new Map();
    for (const x of j) byInterval.set(x.fundingIntervalHours, (byInterval.get(x.fundingIntervalHours) ?? 0) + 1);
    console.log(`\nfundingIntervalHours の分布: ${JSON.stringify(Object.fromEntries(byInterval))}`);
    console.log(`(ここに載らない銘柄は 8時間간隔がデフォルト)`);
  }
}

console.log(`\n${'='.repeat(90)}`);
console.log('5. 符号の向きを実データで確認 — 新規上場銘柄のFRは何%になるか');
console.log('='.repeat(90));
console.log('Binance仕様: fundingRate > 0 なら「ロングがショートに払う」= ショートは受け取り(利益)');
console.log('             fundingRate < 0 なら「ショートがロングに払う」= ショートはコスト');
for (const sym of ['BTCUSDT', 'SKHYUSDT', 'PUMPUSDT']) {
  const { j } = await get('/fapi/v1/fundingRate', { symbol: sym, limit: '1000' });
  if (!Array.isArray(j) || !j.length) { console.log(`${sym.padEnd(12)}: データなし`); continue; }
  const rates = j.map((x) => Number(x.fundingRate));
  const first21 = rates.slice(0, 21); // 最初の7日ぶん(8h*21)
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const gaps = new Set();
  for (let i = 1; i < Math.min(10, j.length); i++) gaps.add((j[i].fundingTime - j[i - 1].fundingTime) / 3600_000);
  console.log(
    `${sym.padEnd(12)}: n=${String(j.length).padStart(4)} 間隔=${[...gaps].join('/')}h ` +
    `初回=${new Date(j[0].fundingTime).toISOString().slice(0, 10)} ` +
    `平均FR=${(sum(rates) / rates.length * 100).toFixed(4)}% ` +
    `最初の21回の合計=${(sum(first21) * 100).toFixed(3)}% ` +
    `min=${(Math.min(...rates) * 100).toFixed(3)}% max=${(Math.max(...rates) * 100).toFixed(3)}%`
  );
}
console.log(`\n※「最初の21回の合計」がプラス = 上場直後の7日間、ショートはFRを受け取る側だった`);
console.log(`  → その場合 FR はコストではなく利益になり、期待値は上がる`);
