import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = 'https://contract.mexc.com/api/v1/contract/kline';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'data', 'kline');
const FAILED_PATH = path.join(HERE, 'data', 'failed.json');

const HOUR = 3600;
const DAY = 86400;
const MAX_BARS = 2000;      // hard per-request cap observed on this endpoint
const SCAN_CHUNK = 1990 * HOUR; // stay just under the cap when scanning forward
const PRE = 6 * HOUR;       // lead-in before listing
const SPAN = 30 * DAY;      // how much post-listing history we want

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = Math.floor(Date.now() / 1000);

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// --- one HTTP call, with backoff on 429/5xx ---
async function rawKline(symbol, start, end, attempt = 0) {
  const url = `${API}/${symbol}?interval=Min60&start=${start}&end=${end}`;
  let status = 0;
  try {
    const res = await fetch(url);
    status = res.status;
    if (status === 429 || status >= 500) throw new Error(`HTTP ${status}`);
    const json = await res.json();
    if (json.success === false) throw new Error(`api code=${json.code} ${json.message ?? ''}`);
    return json.data ?? null;
  } catch (err) {
    if (attempt >= 3) throw new Error(`${err.message} (after ${attempt} retries)`);
    const wait = 500 * 2 ** attempt;
    await sleep(wait);
    return rawKline(symbol, start, end, attempt + 1);
  } finally {
    await sleep(250);
  }
}

const barCount = (d) => (Array.isArray(d?.time) ? d.time.length : 0);

// Drop any bar stamped in the future (the API pads the window past `now`).
function dropFuture(d) {
  const keep = d.time.filter((t) => t <= nowSec).length;
  const dropped = d.time.length - keep;
  if (dropped === 0) return { data: d, dropped: 0 };
  const out = {};
  for (const [k, v] of Object.entries(d)) out[k] = Array.isArray(v) ? v.slice(0, keep) : v;
  return { data: out, dropped };
}

// Walk forward from createTime in <2000-bar chunks until bars appear.
// Handles contracts created long before trading actually opened.
async function findFirstBarTime(symbol, fromSec) {
  let cursor = fromSec;
  while (cursor < nowSec) {
    const end = Math.min(cursor + SCAN_CHUNK, nowSec);
    const d = await rawKline(symbol, cursor, end);
    if (barCount(d) > 0) return d.time[0];
    cursor = end + HOUR;
  }
  return null;
}

async function fetchSymbol(c) {
  const symbol = c.symbol;
  const createSec = Math.floor(c.createTime / 1000);

  // 1st attempt: window anchored on createTime
  let start = createSec - PRE;
  let end = createSec + SPAN;
  let d = await rawKline(symbol, start, end);

  // Contract existed but no trading in that window -> scan forward for the real open
  if (barCount(d) === 0) {
    const t0 = await findFirstBarTime(symbol, createSec - PRE);
    if (t0 == null) return { ok: false, reason: 'no kline data anywhere between createTime and now' };
    start = t0 - PRE;
    end = Math.min(t0 + SPAN, nowSec);
    d = await rawKline(symbol, start, end);
    if (barCount(d) === 0) return { ok: false, reason: `first bar found at ${t0} but re-fetch returned 0 bars` };
  } else {
    // Trading opened later than createTime -> re-anchor so we still get a full 30d
    const t0 = d.time[0];
    if (t0 + SPAN > end) {
      start = t0 - PRE;
      end = Math.min(t0 + SPAN, nowSec);
      const d2 = await rawKline(symbol, start, end);
      if (barCount(d2) > 0) d = d2;
    }
  }

  const requestedBars = barCount(d);
  const { data, dropped } = dropFuture(d);
  const bars = barCount(data);
  if (bars === 0) return { ok: false, reason: `all ${requestedBars} bars were in the future` };

  const t0 = data.time[0];
  const tN = data.time[bars - 1];
  const diffDays = (t0 - createSec) / DAY;
  const actualDays = (tN - t0) / DAY;

  return {
    ok: true,
    record: {
      symbol,
      createTime: c.createTime,
      createTimeIso: new Date(c.createTime).toISOString(),
      t0: t0 * 1000,
      t0Iso: new Date(t0 * 1000).toISOString(),
      diffDays: +diffDays.toFixed(3),
      lastTime: tN * 1000,
      bars,
      actualDays: +actualDays.toFixed(3),
      futureDropped: dropped,
      fetchedWindow: { start, end },
      interval: 'Min60',
      data,
    },
  };
}

// ---------------- main ----------------
const detail = JSON.parse(await readFile(path.join(HERE, 'detail.json'), 'utf8'));
const now = Date.now();
const arg = process.argv.find((a) => a.startsWith('--days='));
const LOOKBACK_DAYS = arg ? Number(arg.split('=')[1]) : 365;
const targets = detail.data
  .filter((c) => now - c.createTime <= LOOKBACK_DAYS * 86400_000)
  .sort((a, b) => a.createTime - b.createTime);
console.log(`lookback: ${LOOKBACK_DAYS} days (createTime >= ${new Date(now - LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10)})`);

await mkdir(CACHE_DIR, { recursive: true });

const failed = [];
let done = 0, cached = 0, ok = 0;

console.log(`targets: ${targets.length}`);
for (const c of targets) {
  const file = path.join(CACHE_DIR, `${c.symbol}.json`);
  if (await exists(file)) {
    cached++; ok++; done++;
    if (done % 10 === 0) console.log(`[${done}/${targets.length}] ok=${ok} failed=${failed.length} cached=${cached}  last=${c.symbol} (cached)`);
    continue;
  }
  try {
    const r = await fetchSymbol(c);
    if (r.ok) {
      await writeFile(file, JSON.stringify(r.record));
      ok++;
    } else {
      failed.push({ symbol: c.symbol, createTimeIso: new Date(c.createTime).toISOString(), reason: r.reason });
    }
  } catch (err) {
    failed.push({ symbol: c.symbol, createTimeIso: new Date(c.createTime).toISOString(), reason: err.message });
  }
  done++;
  if (done % 10 === 0) console.log(`[${done}/${targets.length}] ok=${ok} failed=${failed.length}  last=${c.symbol}`);
}

await writeFile(FAILED_PATH, JSON.stringify(failed, null, 2));
console.log(`\ndone. ok=${ok} failed=${failed.length} (cached=${cached})`);
console.log(`failed.json -> ${FAILED_PATH}`);
