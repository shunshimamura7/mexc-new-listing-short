import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BN = path.join(HERE, 'data', 'kline-binance');
const MEXC_KLINE = path.join(HERE, 'data', 'kline');
const SPOT_CACHE = path.join(HERE, 'data', 'spot-first.json');
const OUT = path.join(HERE, 'out', 'binance-origin.csv');

const DAY = 86400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// ---------- Binance perp universe ----------
const files = (await readdir(BN)).filter((f) => f.endsWith('.json'));
const U = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(BN, f), 'utf8'));
  delete r.data;
  U.push(r);
}
U.sort((a, b) => a.t0 - b.t0);
const perp = U.filter((r) => r.contractType === 'PERPETUAL');
const tradfi = U.filter((r) => r.contractType === 'TRADIFI_PERPETUAL');
console.log(`Binance: ${U.length} (PERPETUAL ${perp.length} / TRADIFI ${tradfi.length})`);

// ---------- signal 1: Binance SPOT first candle ----------
const spotInfo = await (await fetch('https://api.binance.com/api/v3/exchangeInfo')).json();
const spotPairs = new Set(spotInfo.symbols.filter((s) => s.status === 'TRADING').map((s) => s.symbol));

let spotFirst = {};
if (await exists(SPOT_CACHE)) spotFirst = JSON.parse(await readFile(SPOT_CACHE, 'utf8'));

let fetched = 0;
for (const r of perp) {
  const pair = `${r.baseAsset}USDT`;
  if (!spotPairs.has(pair)) { spotFirst[pair] ??= null; continue; }
  if (pair in spotFirst && spotFirst[pair] !== undefined) continue;
  try {
    const j = await (await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&startTime=0&limit=1`)).json();
    spotFirst[pair] = Array.isArray(j) && j[0] ? j[0][0] : null;
  } catch { spotFirst[pair] = null; }
  fetched++;
  if (fetched % 50 === 0) { console.log(`  spot first-candle: ${fetched} fetched`); await writeFile(SPOT_CACHE, JSON.stringify(spotFirst)); }
  await sleep(250);
}
await writeFile(SPOT_CACHE, JSON.stringify(spotFirst));
const spotKnown = perp.filter((r) => spotFirst[`${r.baseAsset}USDT`]).length;
console.log(`signal-1 (Binance SPOT): ${spotKnown}/${perp.length} で現物の初値を取得`);

// ---------- signal 2: MEXC first trade (our own cache) ----------
// t0 (actual first candle) is the real "it traded somewhere" evidence.
// createTime is only a fallback for MEXC symbols older than our 3y kline pull.
const mexcT0 = new Map();   // base -> ms
const mexcFiles = (await readdir(MEXC_KLINE)).filter((f) => f.endsWith('.json'));
for (const f of mexcFiles) {
  const r = JSON.parse(await readFile(path.join(MEXC_KLINE, f), 'utf8'));
  const base = r.symbol.split('_')[0].toUpperCase();
  if (!mexcT0.has(base) || r.t0 < mexcT0.get(base)) mexcT0.set(base, r.t0);
}
const mexcDetail = JSON.parse(await readFile(path.join(HERE, 'detail.json'), 'utf8'));
const mexcCreate = new Map();
for (const c of mexcDetail.data) {
  const base = c.symbol.split('_')[0].toUpperCase();
  if (!mexcCreate.has(base) || c.createTime < mexcCreate.get(base)) mexcCreate.set(base, c.createTime);
}
const mexcEvidence = (base) => mexcT0.get(base) ?? mexcCreate.get(base) ?? null;
const mexcHit = perp.filter((r) => mexcEvidence(r.baseAsset.toUpperCase()) != null).length;
console.log(`signal-2 (MEXC):        ${mexcHit}/${perp.length} で MEXC 側の存在時刻を取得\n`);

// ---------- classification ----------
function classify(r, cDays, bDays) {
  if (r.contractType === 'TRADIFI_PERPETUAL') return 'D';
  const base = r.baseAsset.toUpperCase();
  const sp = spotFirst[`${base}USDT`] ?? null;
  const mx = mexcEvidence(base);

  if (sp != null && sp <= r.t0 - cDays * DAY) return 'C';               // long-lived on Binance spot -> perp-ization
  if (mx != null && mx <= r.t0 - bDays * DAY) return 'B';               // traded on MEXC first -> listed elsewhere before
  if (sp == null && mx == null) return 'U';                             // no evidence available at all -> unknown
  return 'A';                                                            // evidence exists and shows nothing earlier
}

const C_DAYS = 30, B_DAYS = 7;
const labeled = U.map((r) => ({ ...r, origin: classify(r, C_DAYS, B_DAYS) }));

const count = (arr) => {
  const m = new Map();
  for (const r of arr) m.set(r.origin, (m.get(r.origin) ?? 0) + 1);
  return m;
};
const NAMES = {
  A: 'A: Binance初上場（先行の形跡なし）',
  B: 'B: 他所で先に流通（MEXC先行）',
  C: 'C: Perp化（Binance現物が先行）',
  U: 'U: 判定不能（現物にもMEXCにも無い）',
  D: 'D: TRADIFI（株式トークン）',
};

console.log('='.repeat(96));
console.log(`分類結果  (C閾値=${C_DAYS}日 / B閾値=${B_DAYS}日)`);
console.log('='.repeat(96));
const c = count(labeled);
for (const k of ['A', 'B', 'C', 'U', 'D']) {
  const n = c.get(k) ?? 0;
  console.log(`${NAMES[k].padEnd(40)} n=${String(n).padStart(4)}  (${((n / labeled.length) * 100).toFixed(1)}%)  ${'#'.repeat(Math.round(n / 8))}`);
}
console.log(`${'合計'.padEnd(40)} n=${String(labeled.length).padStart(4)}`);

console.log(`\n--- A+U（Binance初上場の候補 + 判定不能）= ${(c.get('A') ?? 0) + (c.get('U') ?? 0)} 件 ---`);
console.log(`※ U は「形跡が無い」ではなく「調べる手段が無い」。A に畳み込んでいない。`);

console.log(`\n--- 各クラスのサンプル ---`);
for (const k of ['A', 'B', 'C', 'U']) {
  const g = labeled.filter((r) => r.origin === k).slice(-8);
  console.log(`${k}: ${g.map((r) => r.symbol).join(', ') || '(なし)'}`);
}

// ---------- sensitivity ----------
console.log(`\n${'='.repeat(96)}`);
console.log('閾値の感度分析 — 分類は閾値にどれだけ依存するか');
console.log('='.repeat(96));
console.log(`${'C閾値'.padStart(7)}${'B閾値'.padStart(7)}  ${'A'.padStart(5)}${'B'.padStart(5)}${'C'.padStart(5)}${'U'.padStart(5)}${'D'.padStart(5)}`);
for (const cd of [7, 14, 30, 60, 90]) {
  for (const bd of [1, 3, 7, 14, 30]) {
    const cc = count(U.map((r) => ({ origin: classify(r, cd, bd) })));
    console.log(
      `${String(cd).padStart(7)}${String(bd).padStart(7)}  ` +
      ['A', 'B', 'C', 'U', 'D'].map((k) => String(cc.get(k) ?? 0).padStart(5)).join('') +
      (cd === C_DAYS && bd === B_DAYS ? '   <-- 採用値' : '')
    );
  }
}

// ---------- cohort x origin (do we have enough n per cohort?) ----------
console.log(`\n${'='.repeat(96)}`);
console.log('コホート × 分類（各セルの n）');
console.log('='.repeat(96));
const cohorts = [...new Set(labeled.map((r) => { const d = new Date(r.t0); return `${d.getUTCFullYear()}H${d.getUTCMonth() < 6 ? 1 : 2}`; }))].sort();
console.log(`${'cohort'.padEnd(9)}${['A', 'B', 'C', 'U', 'D'].map((k) => k.padStart(6)).join('')}${'計'.padStart(7)}`);
for (const co of cohorts) {
  const g = labeled.filter((r) => { const d = new Date(r.t0); return `${d.getUTCFullYear()}H${d.getUTCMonth() < 6 ? 1 : 2}` === co; });
  const cc = count(g);
  console.log(`${co.padEnd(9)}${['A', 'B', 'C', 'U', 'D'].map((k) => String(cc.get(k) ?? 0).padStart(6)).join('')}${String(g.length).padStart(7)}`);
}

await writeFile(OUT, ['symbol,contractType,status,baseAsset,t0Iso,origin,spotFirstIso,mexcFirstIso',
  ...labeled.map((r) => {
    const sp = spotFirst[`${r.baseAsset?.toUpperCase()}USDT`] ?? null;
    const mx = mexcEvidence(r.baseAsset?.toUpperCase() ?? '');
    return [r.symbol, r.contractType, r.status, r.baseAsset, r.t0Iso, r.origin,
      sp ? new Date(sp).toISOString().slice(0, 10) : '',
      mx ? new Date(mx).toISOString().slice(0, 10) : ''].join(',');
  })].join('\n'));
console.log(`\nwrote -> out/binance-origin.csv`);
