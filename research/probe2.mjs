import { readFile } from 'node:fs/promises';

const BASE = 'https://contract.mexc.com/api/v1/contract/kline';
const detail = JSON.parse(await readFile(new URL('./detail.json', import.meta.url), 'utf8'));
const bySym = new Map(detail.data.map((c) => [c.symbol, c]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(symbol, qs, label) {
  const url = `${BASE}/${symbol}?interval=Min60${qs}`;
  const res = await fetch(url);
  const j = await res.json();
  const n = j?.data?.time?.length ?? -1;
  const t = j?.data?.time;
  const fmt = (v) => new Date(v * (v > 1e12 ? 1 : 1000)).toISOString();
  console.log(
    `${symbol.padEnd(18)} ${label.padEnd(22)} http=${res.status} success=${j.success} code=${j.code} n=${n}` +
      (n > 0 ? `  ${fmt(t[0])} .. ${fmt(t[n - 1])}` : '') +
      (j.message ? `  msg=${j.message}` : '')
  );
  await sleep(300);
  return n;
}

const SYMS = ['BTC_USDT', 'KLACSTOCK_USDT', 'HYPE_USDT', 'ASTER_USDT', 'SPY_USDT', 'GRAM_USDT'];

for (const s of SYMS) {
  const c = bySym.get(s);
  console.log(`\n--- ${s}  createTime=${c ? new Date(c.createTime).toISOString() : '?'} ---`);
  await probe(s, '', 'no start/end');
  if (c) {
    const t = Math.floor(c.createTime / 1000);
    await probe(s, `&start=${t - 6 * 3600}&end=${t + 30 * 86400}`, 'create-6h .. +30d');
    await probe(s, `&start=${t - 6 * 3600}&end=${t + 2 * 86400}`, 'create-6h .. +2d');
  }
  const nowS = Math.floor(Date.now() / 1000);
  await probe(s, `&start=${nowS - 7 * 86400}&end=${nowS}`, 'last 7d');
  await probe(s, `&start=${nowS - 200 * 86400}&end=${nowS}`, 'last 200d (cap test)');
}
