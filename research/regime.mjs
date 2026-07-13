// BTC regime utility. Fetches (once, then caches) a BTC daily series long enough to
// cover every t0 in the MEXC universe PLUS 200 days of lead-in for the 200d SMA.
//
// Everything here is computed from bars STRICTLY BEFORE t0 -- no look-ahead.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(HERE, 'data', 'kline');
export const OUT_DIR = path.join(HERE, 'out');
const BTC_CACHE = path.join(HERE, 'data', 'btc-daily.json');

export const HOUR = 3600;
export const DAY = 86400;
export const FEE = 0.04;
export const ENTRY_H = 24;

// IS / OOS split — FIXED NOW, never moved.
export const IS_END = Date.UTC(2025, 5, 30, 23, 59, 59); // t0 <= 2025-06-30 => In-Sample
export const isIS = (t0ms) => t0ms <= IS_END;

// ---------- BTC daily ----------
export async function loadBtcDaily() {
  if (existsSync(BTC_CACHE)) return JSON.parse(await readFile(BTC_CACHE, 'utf8'));

  // Binance USDⓈ-M futures daily klines. 1500/req; we need ~2022-06 .. now.
  const start = Date.UTC(2022, 5, 1);
  const out = [];
  let cursor = start;
  for (let guard = 0; guard < 10; guard++) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&startTime=${cursor}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`binance ${res.status}: ${await res.text()}`);
    const j = await res.json();
    if (!j.length) break;
    for (const k of j) out.push({ t: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] });
    if (j.length < 1500) break;
    cursor = j.at(-1)[0] + DAY * 1000;
  }
  // drop any bar whose day is not yet closed (future / in-progress)
  const nowDay = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const clean = out.filter((b) => b.t < nowDay);
  const series = { source: 'binance fapi BTCUSDT 1d', n: clean.length, bars: clean };
  await writeFile(BTC_CACHE, JSON.stringify(series));
  return series;
}

// Build a regime lookup keyed by UTC day.
export function makeRegime(btc) {
  const bars = btc.bars;
  const idxByDay = new Map(bars.map((b, i) => [b.t, i]));

  // For a timestamp t0 (ms), find the index of the LAST FULLY CLOSED daily bar before t0.
  const lastClosedIdx = (t0ms) => {
    const day = Math.floor(t0ms / 1000 / DAY) * DAY;
    // the bar that opened on `day` is still in progress at t0 -> use day-1
    let i = idxByDay.get(day - DAY);
    if (i === undefined) {
      // fall back: scan for the greatest bar with t < day
      i = -1;
      for (let k = 0; k < bars.length; k++) { if (bars[k].t < day) i = k; else break; }
      if (i < 0) return -1;
    }
    return i;
  };

  return function regimeAt(t0ms) {
    const i = lastClosedIdx(t0ms);
    if (i < 0) return null;
    const c = bars[i].close;
    const r = (lag) => (i - lag >= 0 ? (c / bars[i - lag].close - 1) * 100 : null);
    const sma = (n) => {
      if (i - n + 1 < 0) return null;
      let s = 0;
      for (let k = i - n + 1; k <= i; k++) s += bars[k].close;
      return s / n;
    };
    const s200 = sma(200);
    return {
      btcClose: c,
      btcRet7: r(7),
      btcRet30: r(30),
      btcSma200: s200,
      aboveSma200: s200 == null ? null : c > s200,
      sma200Gap: s200 == null ? null : (c / s200 - 1) * 100,
    };
  };
}

// ---------- MEXC universe ----------
const ETF_INDEX = new Set(['SPY','QQQ','TQQQ','SQQQ','SOXL','SOXS','SOXX','SMH','ARKK','ARKG','NAS100','SPX500','DJ30','US30','RUSSELL2000','IWM','DIA','VOO','VTI','NVDL','NVDS','TSLL','TSLQ','MSTU','MSTX','MSTZ','CONL','AMDL','AAPU','XLU','XLK','XLE','XLF','XLV','XLP','XLI','XLY','XBI','IBIT','USO','UNG','GLD','SLV','INDA','EWJ','FXI','KWEB','KORU','MVLL','UVXY','VIX','VXX','TLT','HYG','GDX','YINN','YANG','LABU','LABD']);
const COMMODITY = new Set(['XAU','XAG','XPT','XPD','GOLD','SILVER','PLATINUM','PALLADIUM','OIL','WTI','BRENT','CRUDE','NATGAS','GAS','ALUMINUM','ALUMINIUM','COPPER','NICKEL','ZINC','LEAD','TIN','IRON','WHEAT','CORN','SOYBEAN','SUGAR','COFFEE','COCOA']);
const ESTABLISHED = new Set(['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','TRX','AVAX','LINK','DOT','MATIC','POL','LTC','BCH','SHIB','TON','UNI','ATOM','XLM','ETC','FIL','APT','ARB','OP','NEAR','ICP','HBAR','VET','AAVE','SUI','PEPE','XMR','ALGO','INJ']);

export function categorize(symbol) {
  const base = symbol.split('_')[0].toUpperCase();
  if (base.includes('STOCK')) return 'STOCK';
  if (ETF_INDEX.has(base)) return 'ETF_INDEX';
  if (COMMODITY.has(base)) return 'COMMODITY';
  if (ESTABLISHED.has(base)) return 'ESTABLISHED';
  return 'CRYPTO_NEW';
}

export const HORIZONS = [1, 3, 7, 14, 29];
export const HLABEL = (d) => (d === 29 ? '+29d*' : `+${d}d`);
const GAP_TOL_H = 6;

// Load every MEXC symbol and precompute: entry, pre-entry features (no look-ahead),
// and per-horizon short/long PnL + MAE/MFE.
export async function loadUniverse() {
  const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
  const U = [];
  for (const f of files) {
    const r = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8'));
    const d = r.data;
    if (!d.time?.length) continue;
    const b = d.time.map((t, i) => ({
      t, open: d.open[i], high: d.high[i], low: d.low[i], close: d.close[i],
      vol: d.vol[i], amount: d.amount?.[i] ?? null,
    }));
    const t0 = Math.floor(r.t0 / 1000);
    const entryT = t0 + ENTRY_H * HOUR;
    const ei = b.findIndex((x) => x.t === entryT);
    if (ei === -1) continue;
    const entry = b[ei].open;
    if (!(entry > 0)) continue;

    // --- features observable at entry: bars from t0 up to (not incl.) entry bar ---
    const pre = b.slice(0, ei);
    if (!pre.length) continue;
    const firstOpen = pre[0].open;
    let hi = -Infinity, lo = Infinity, quote24 = 0;
    const lrets = [];
    for (let i = 0; i < pre.length; i++) {
      if (pre[i].high > hi) hi = pre[i].high;
      if (pre[i].low < lo) lo = pre[i].low;
      quote24 += pre[i].amount ?? 0;
      if (i > 0 && pre[i].close > 0 && pre[i - 1].close > 0) lrets.push(Math.log(pre[i].close / pre[i - 1].close));
    }
    const m = lrets.length ? lrets.reduce((a, x) => a + x, 0) / lrets.length : 0;
    const vol24 = lrets.length > 1
      ? Math.sqrt(lrets.reduce((a, x) => a + (x - m) ** 2, 0) / (lrets.length - 1)) * 100
      : null;

    const rec = {
      symbol: r.symbol,
      cat: categorize(r.symbol),
      t0ms: r.t0,
      t0Iso: r.t0Iso,
      month: r.t0Iso.slice(0, 7),
      cohort: `${new Date(r.t0).getUTCFullYear()}H${new Date(r.t0).getUTCMonth() < 6 ? 1 : 2}`,
      isIS: isIS(r.t0),
      entry,
      firstOpen,                                    // price level at t0 (pre-entry)
      quote24,                                      // USDT volume in the first 24h
      range24: (hi / lo - 1) * 100,                 // first-24h high/low range
      pump24: (hi / firstOpen - 1) * 100,           // first-24h max run-up from first open
      vol24,                                        // SD of 1h log returns, first 24h, %
      spanDays: (b.at(-1).t - t0) / DAY,
      h: {},
    };

    for (const H of HORIZONS) {
      const target = entryT + H * DAY;
      let xi = -1;
      for (let i = ei + 1; i < b.length; i++) {
        if (b[i].t === target) { xi = i; break; }
        if (b[i].t > target) { if (b[i].t <= target + GAP_TOL_H * HOUR) xi = i; break; }
      }
      if (xi === -1 || !(b[xi].open > 0)) continue;
      const exit = b[xi].open;
      let mh = -Infinity, ml = Infinity;
      for (let i = ei; i <= xi; i++) { if (b[i].high > mh) mh = b[i].high; if (b[i].low < ml) ml = b[i].low; }
      rec.h[H] = {
        exit,
        short: ((entry - exit) / entry) * 100 - FEE,
        long: ((exit - entry) / entry) * 100 - FEE,
        mae: ((mh - entry) / entry) * 100,  // squeeze against the short
        mfe: ((entry - ml) / entry) * 100,  // move in favour of the short
      };
    }
    U.push(rec);
  }
  U.sort((a, b) => a.t0ms - b.t0ms);
  return U;
}

// ---------- stats ----------
export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);
export const sd = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};
export const se = (a) => sd(a) / Math.sqrt(a.length);
export const tval = (a) => mean(a) / se(a);
export const srt = (a) => [...a].sort((x, y) => x - y);
export const pctile = (s, q) => {
  if (!s.length) return NaN;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
export const median = (a) => pctile(srt(a), 0.5);
export const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

// Two-sample Welch t-test -> { t, df, p } (two-sided, normal approx for p)
export function welch(a, b) {
  if (a.length < 2 || b.length < 2) return { t: NaN, df: NaN, p: NaN };
  const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length;
  const t = (mean(a) - mean(b)) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { t, df, p: 2 * (1 - normCdf(Math.abs(t))) };
}

// Mann-Whitney U (normal approximation with tie correction) -> { U, z, p, auc }
export function mannWhitney(a, b) {
  const n1 = a.length, n2 = b.length;
  if (!n1 || !n2) return { U: NaN, z: NaN, p: NaN, auc: NaN };
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  // ranks with ties averaged
  let i = 0, tieSum = 0;
  const ranks = new Array(all.length);
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j + 2) / 2; // average rank (1-based)
    const tn = j - i + 1;
    tieSum += tn ** 3 - tn;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let R1 = 0;
  for (let k = 0; k < all.length; k++) if (all[k].g === 0) R1 += ranks[k];
  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const N = n1 + n2;
  const mu = (n1 * n2) / 2;
  const sig = Math.sqrt(((n1 * n2) / 12) * ((N + 1) - tieSum / (N * (N - 1))));
  const z = sig > 0 ? (U1 - mu) / sig : NaN;
  return { U: U1, z, p: 2 * (1 - normCdf(Math.abs(z))), auc: U1 / (n1 * n2) };
}

export function normCdf(x) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export const ensureOut = () => mkdir(OUT_DIR, { recursive: true });
