// Step 1 only: dump exchangeInfo structure, identify the listing-date field and its unit.
// No design decisions yet — look at the real payload first.
const FAPI = 'https://fapi.binance.com';

const res = await fetch(`${FAPI}/fapi/v1/exchangeInfo`);
console.log(`GET ${FAPI}/fapi/v1/exchangeInfo -> HTTP ${res.status}`);
console.log(`rate-limit headers: ${JSON.stringify(
  Object.fromEntries([...res.headers].filter(([k]) => /weight|order-count|retry/i.test(k)))
)}`);

const info = await res.json();

console.log(`\n=== 1. top-level keys ===`);
console.log(Object.keys(info));

console.log(`\n=== 2. rateLimits (declared by the API) ===`);
for (const r of info.rateLimits ?? []) console.log(`  ${JSON.stringify(r)}`);

console.log(`\n=== 3. symbols count ===`);
console.log(`${info.symbols?.length} entries`);

const byType = new Map();
const byStatus = new Map();
for (const s of info.symbols ?? []) {
  byType.set(s.contractType, (byType.get(s.contractType) ?? 0) + 1);
  byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
}
console.log(`contractType: ${JSON.stringify(Object.fromEntries(byType))}`);
console.log(`status      : ${JSON.stringify(Object.fromEntries(byStatus))}`);

console.log(`\n=== 4. symbols[0] (full dump) ===`);
console.log(JSON.stringify(info.symbols[0], null, 2));

console.log(`\n=== 5. date-like fields in symbols[0] ===`);
for (const [k, v] of Object.entries(info.symbols[0])) {
  if (!/time|date|onboard|deliver|listing/i.test(k)) continue;
  let note = '';
  if (typeof v === 'number') {
    if (v > 1e12) note = `-> ms  ${new Date(v).toISOString()}`;
    else if (v > 1e9) note = `-> sec ${new Date(v * 1000).toISOString()}`;
    else note = '(too small for an epoch)';
  }
  console.log(`  ${k}: ${JSON.stringify(v)} (${typeof v}) ${note}`);
}

// How far back does the universe go, and is onboardDate plausible?
const perp = (info.symbols ?? []).filter((s) => s.contractType === 'PERPETUAL');
const withDate = perp.filter((s) => s.onboardDate > 0).sort((a, b) => a.onboardDate - b.onboardDate);
console.log(`\n=== 6. onboardDate range across PERPETUAL (${perp.length} symbols) ===`);
if (withDate.length) {
  const o = withDate[0];
  const n = withDate[withDate.length - 1];
  console.log(`  oldest: ${o.symbol.padEnd(14)} ${o.onboardDate} ${new Date(o.onboardDate).toISOString()}`);
  console.log(`  newest: ${n.symbol.padEnd(14)} ${n.onboardDate} ${new Date(n.onboardDate).toISOString()}`);
  console.log(`  onboardDate == 0 or missing: ${perp.length - withDate.length}`);
}

// Kline: what does one look like, and what is the real per-request cap?
const probeSym = withDate[withDate.length - 1]?.symbol ?? 'BTCUSDT';
const onboard = withDate[withDate.length - 1]?.onboardDate;
console.log(`\n=== 7. kline probe on the newest listing: ${probeSym} ===`);
console.log(`onboardDate = ${onboard} (${new Date(onboard).toISOString()})`);

async function kline(symbol, params) {
  const qs = new URLSearchParams({ symbol, interval: '1h', ...params });
  const r = await fetch(`${FAPI}/fapi/v1/klines?${qs}`);
  const used = r.headers.get('x-mbx-used-weight-1m');
  const j = await r.json();
  return { status: r.status, used, j };
}

// 7a. shape
{
  const { status, used, j } = await kline(probeSym, { limit: '3' });
  console.log(`\n-- shape (limit=3) -- HTTP ${status}  used-weight-1m=${used}`);
  console.log(`array of arrays? ${Array.isArray(j) && Array.isArray(j[0])}`);
  console.log(`row length: ${j[0]?.length}`);
  console.log(JSON.stringify(j[0], null, 2));
  if (Array.isArray(j[0])) {
    console.log(`  [0] openTime  = ${j[0][0]} -> ${new Date(j[0][0]).toISOString()}  (${String(j[0][0]).length} digits = ms)`);
    console.log(`  [6] closeTime = ${j[0][6]} -> ${new Date(j[0][6]).toISOString()}`);
    console.log(`  fields are STRINGS, not numbers: open=${JSON.stringify(j[0][1])} (${typeof j[0][1]})`);
  }
}

// 7b. actual per-request cap
for (const lim of ['1500', '2000']) {
  const { status, used, j } = await kline(probeSym, { limit: lim });
  console.log(`\n-- limit=${lim} -- HTTP ${status} used-weight-1m=${used} -> ${Array.isArray(j) ? `${j.length} bars` : JSON.stringify(j)}`);
}

// 7c. does the window anchored on onboardDate actually contain bars?  (the MEXC trap)
{
  const start = onboard - 6 * 3600_000;
  const end = onboard + 30 * 86400_000;
  const { status, j } = await kline(probeSym, { startTime: String(start), endTime: String(end), limit: '1500' });
  console.log(`\n-- window [onboard-6h, onboard+30d] -- HTTP ${status} -> ${Array.isArray(j) ? j.length : '?'} bars`);
  if (Array.isArray(j) && j.length) {
    const t0 = j[0][0];
    console.log(`  first bar : ${new Date(t0).toISOString()}`);
    console.log(`  last  bar : ${new Date(j[j.length - 1][0]).toISOString()}`);
    console.log(`  diff vs onboardDate: ${((t0 - onboard) / 86400_000).toFixed(3)} days`);
    const now = Date.now();
    console.log(`  bars stamped in the future: ${j.filter((r) => r[0] > now).length}`);
  }
}
