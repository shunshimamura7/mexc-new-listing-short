import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FAPI = 'https://fapi.binance.com';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const CACHE = path.join(DATA, 'kline-binance');
const OUT = path.join(HERE, 'out');

const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;
const PRE = 6 * HOUR_MS;
const SPAN = 30 * DAY_MS;
const LIMIT = 1500;   // hard cap (limit=2000 -> HTTP 400). 1500 bars = 62.5d, covers PRE+SPAN.
const SLEEP = 300;    // weight 10/req * 200 req/min = 2000/min, under the 2400/min budget

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

let lastWeight = 0;

async function klines(symbol, startTime, attempt = 0) {
  const qs = new URLSearchParams({ symbol, interval: '1h', startTime: String(startTime), limit: String(LIMIT) });
  try {
    const res = await fetch(`${FAPI}/fapi/v1/klines?${qs}`);
    const w = res.headers.get('x-mbx-used-weight-1m');
    if (w) lastWeight = Number(w);
    if (res.status === 429 || res.status === 418 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!Array.isArray(j)) throw new Error(`api error: ${JSON.stringify(j).slice(0, 160)}`);
    return j;
  } catch (err) {
    if (attempt >= 3) throw new Error(`${err.message} (after ${attempt} retries)`);
    await sleep(1000 * 2 ** attempt);
    return klines(symbol, startTime, attempt + 1);
  } finally {
    await sleep(SLEEP);
  }
}

// ---------- 1. universe ----------
const infoRes = await fetch(`${FAPI}/fapi/v1/exchangeInfo`);
const info = await infoRes.json();
await mkdir(DATA, { recursive: true });
await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });
await writeFile(path.join(DATA, 'exchange-info.json'), JSON.stringify(info, null, 2));

// PERPETUAL + TRADIFI_PERPETUAL, every status. Quarterly futures excluded (different instrument).
const universe = info.symbols
  .filter((s) => s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL')
  .sort((a, b) => a.onboardDate - b.onboardDate);

console.log(`universe: ${universe.length} symbols (PERPETUAL + TRADIFI_PERPETUAL, all statuses)`);
console.log(`oldest onboardDate: ${new Date(universe[0].onboardDate).toISOString()} (${universe[0].symbol})`);
console.log(`newest onboardDate: ${new Date(universe.at(-1).onboardDate).toISOString()} (${universe.at(-1).symbol})\n`);

const now = Date.now();
const failed = [];
let ok = 0, cached = 0, done = 0;

for (const s of universe) {
  const file = path.join(CACHE, `${s.symbol}.json`);
  if (await exists(file)) {
    cached++; ok++; done++;
    if (done % 10 === 0) console.log(`[${done}/${universe.length}] ok=${ok} failed=${failed.length} cached=${cached}  ${s.symbol} (cached)`);
    continue;
  }

  try {
    // startTime only: Binance returns the first bars at/after it, so a listing that started
    // trading late still lands its real first bar at index 0. No forward scan needed.
    const raw = await klines(s.symbol, s.onboardDate - PRE);

    if (!raw.length) {
      failed.push({ symbol: s.symbol, contractType: s.contractType, status: s.status,
        onboardDate: new Date(s.onboardDate).toISOString(), reason: 'no bars returned' });
      done++;
      continue;
    }

    const t0 = raw[0][0];
    const deadline = t0 + SPAN;
    const inWindow = raw.filter((r) => r[0] <= deadline);
    const kept = inWindow.filter((r) => r[0] <= now);
    const futureDropped = inWindow.length - kept.length;

    if (!kept.length) {
      failed.push({ symbol: s.symbol, contractType: s.contractType, status: s.status,
        onboardDate: new Date(s.onboardDate).toISOString(), reason: 'all bars in the future' });
      done++;
      continue;
    }

    const lastT = kept.at(-1)[0];
    const rec = {
      symbol: s.symbol,
      contractType: s.contractType,
      status: s.status,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      onboardDate: s.onboardDate,
      onboardIso: new Date(s.onboardDate).toISOString(),
      t0,
      t0Iso: new Date(t0).toISOString(),
      diffDays: +((t0 - s.onboardDate) / DAY_MS).toFixed(3),
      bars: kept.length,
      actualDays: +((lastT - t0) / DAY_MS).toFixed(3),
      futureDropped,
      interval: '1h',
      // columns, numeric — [openTime, open, high, low, close, volume, quoteVolume, trades]
      data: {
        time: kept.map((r) => r[0]),
        open: kept.map((r) => Number(r[1])),
        high: kept.map((r) => Number(r[2])),
        low: kept.map((r) => Number(r[3])),
        close: kept.map((r) => Number(r[4])),
        vol: kept.map((r) => Number(r[5])),
        quoteVol: kept.map((r) => Number(r[7])),
        trades: kept.map((r) => Number(r[8])),
      },
    };
    await writeFile(file, JSON.stringify(rec));
    ok++;
  } catch (err) {
    failed.push({ symbol: s.symbol, contractType: s.contractType, status: s.status,
      onboardDate: new Date(s.onboardDate).toISOString(), reason: err.message });
  }
  done++;
  if (done % 10 === 0) {
    console.log(`[${done}/${universe.length}] ok=${ok} failed=${failed.length}  ${s.symbol}  weight=${lastWeight}/2400`);
  }
}

await writeFile(path.join(DATA, 'failed-binance.json'), JSON.stringify(failed, null, 2));

const csv = ['symbol,contractType,status,baseAsset,quoteAsset,onboardDate,onboardIso'];
for (const s of universe) {
  csv.push([s.symbol, s.contractType, s.status, s.baseAsset, s.quoteAsset, s.onboardDate,
    new Date(s.onboardDate).toISOString()].join(','));
}
await writeFile(path.join(OUT, 'binance-symbols.csv'), csv.join('\n'));

console.log(`\ndone. ok=${ok} failed=${failed.length} (cached=${cached})`);
