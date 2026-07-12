import { readFile, readdir, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FAPI = 'https://fapi.binance.com';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KLINE = path.join(HERE, 'data', 'kline-binance');
const OUTDIR = path.join(HERE, 'data', 'funding');

const SLEEP = 600;          // 300ms tripped Binance's WAF (403, not 429). Back off.
const LIMIT = 500;          // real cap — limit=1000 silently returns 500
const PRE = 6 * 3600_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

async function fundingRate(symbol, startTime, attempt = 0) {
  const qs = new URLSearchParams({ symbol, startTime: String(startTime), limit: String(LIMIT) });
  try {
    const res = await fetch(`${FAPI}/fapi/v1/fundingRate?${qs}`);
    // 403 = WAF ban from sending too fast. It clears on its own, so wait it out rather than fail.
    if (res.status === 403) throw new Error('HTTP 403 (WAF ban)');
    if (res.status === 429 || res.status === 418 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!Array.isArray(j)) throw new Error(`api error: ${JSON.stringify(j).slice(0, 140)}`);
    return j;
  } catch (err) {
    if (attempt >= 5) throw new Error(`${err.message} (after ${attempt} retries)`);
    const banned = /403|429|418/.test(err.message);
    await sleep(banned ? 30_000 * (attempt + 1) : 1000 * 2 ** attempt);
    return fundingRate(symbol, startTime, attempt + 1);
  } finally {
    await sleep(SLEEP);
  }
}

await mkdir(OUTDIR, { recursive: true });
const files = (await readdir(KLINE)).filter((f) => f.endsWith('.json'));
console.log(`targets: ${files.length}`);

const failed = [];
let ok = 0, cached = 0, done = 0, empty = 0;

for (const f of files) {
  const r = JSON.parse(await readFile(path.join(KLINE, f), 'utf8'));
  const out = path.join(OUTDIR, `${r.symbol}.json`);
  if (await exists(out)) {
    cached++; ok++; done++;
    if (done % 25 === 0) console.log(`[${done}/${files.length}] ok=${ok} failed=${failed.length} cached=${cached}`);
    continue;
  }
  try {
    // one request covers 31 days even at a 4h interval (186 events < 500)
    const raw = await fundingRate(r.symbol, r.t0 - PRE);
    const events = raw.map((x) => ({ t: x.fundingTime, rate: Number(x.fundingRate) }))
      .sort((a, b) => a.t - b.t);
    // observed interval, derived from the data itself — do NOT trust fundingInfo (it is the CURRENT setting)
    const gaps = [];
    for (let i = 1; i < events.length; i++) gaps.push(Math.round((events[i].t - events[i - 1].t) / 3600_000));
    const gapCounts = {};
    for (const g of gaps) gapCounts[g] = (gapCounts[g] ?? 0) + 1;
    if (!events.length) empty++;
    await writeFile(out, JSON.stringify({
      symbol: r.symbol, t0: r.t0, count: events.length,
      firstFunding: events[0]?.t ?? null,
      lastFunding: events.at(-1)?.t ?? null,
      intervalHoursObserved: gapCounts,
      events,
    }));
    ok++;
  } catch (err) {
    failed.push({ symbol: r.symbol, reason: err.message });
  }
  done++;
  if (done % 25 === 0) console.log(`[${done}/${files.length}] ok=${ok} failed=${failed.length} empty=${empty}`);
}

await writeFile(path.join(HERE, 'data', 'failed-funding.json'), JSON.stringify(failed, null, 2));
console.log(`\ndone. ok=${ok} failed=${failed.length} empty=${empty} (cached=${cached})`);
