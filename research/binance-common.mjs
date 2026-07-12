import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.join(HERE, 'data', 'kline-binance');
export const OUT = path.join(HERE, 'out');

export const HOUR = 3600_000; // ms — Binance timestamps are milliseconds
export const DAY = 86400_000;
export const FEE = 0.04;      // round-trip, % of notional

const ETF_INDEX = new Set(['SPY', 'QQQ', 'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'SOXX', 'SMH', 'ARKK', 'NAS100',
  'SPX500', 'NVDL', 'TSLL', 'MSTU', 'MSTX', 'IWM', 'DIA', 'VOO', 'GLD', 'SLV', 'XLK', 'XLE', 'XBI', 'USO', 'INDA']);
const COMMODITY = new Set(['XAU', 'XAG', 'XPT', 'XPD', 'GOLD', 'SILVER', 'OIL', 'WTI', 'BRENT', 'USOIL', 'UKOIL',
  'NGAS', 'GAS', 'ALUMINUM', 'COPPER', 'NICKEL', 'ZINC', 'LEAD', 'TIN', 'PAXG', 'XAUT']);
const ESTABLISHED = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'DOT',
  'MATIC', 'POL', 'LTC', 'BCH', 'SHIB', 'TON', 'UNI', 'ATOM', 'XLM', 'ETC', 'FIL', 'APT', 'ARB', 'OP', 'NEAR',
  'ICP', 'HBAR', 'VET', 'AAVE', 'SUI', 'PEPE', 'XMR', 'ALGO', 'INJ', 'ETHBTC', 'BTCDOM']);

export function categorize(r) {
  // contractType is the exchange's own label — more reliable than guessing from the name
  if (r.contractType === 'TRADIFI_PERPETUAL') return 'STOCK';
  const base = (r.baseAsset || r.symbol).toUpperCase();
  if (/STOCK/.test(base)) return 'STOCK';
  if (ETF_INDEX.has(base)) return 'ETF_INDEX';
  if (COMMODITY.has(base)) return 'COMMODITY';
  if (ESTABLISHED.has(base) || ESTABLISHED.has(r.symbol.toUpperCase())) return 'ESTABLISHED';
  return 'CRYPTO_NEW';
}

export async function load() {
  const files = (await readdir(CACHE)).filter((f) => f.endsWith('.json'));
  const U = [];
  for (const f of files) {
    const r = JSON.parse(await readFile(path.join(CACHE, f), 'utf8'));
    const d = r.data;
    if (!d.time.length) continue;
    const firstOpen = d.open[0];
    if (!(firstOpen > 0)) continue;

    const maxHighWithin = (h) => {
      const cut = r.t0 + h * HOUR;
      let hi = -Infinity, k = 0;
      for (let i = 0; i < d.time.length && d.time[i] < cut; i++) { if (d.high[i] > hi) hi = d.high[i]; k++; }
      return k ? hi : null;
    };
    const hi24 = maxHighWithin(24);
    if (hi24 == null) continue;
    let lo24 = Infinity, vol24 = 0;
    for (let i = 0; i < d.time.length && d.time[i] < r.t0 + 24 * HOUR; i++) {
      if (d.low[i] < lo24) lo24 = d.low[i];
      vol24 += d.quoteVol[i] ?? 0;
    }
    const dt = new Date(r.t0);

    U.push({
      symbol: r.symbol,
      contractType: r.contractType,
      status: r.status,
      t0: r.t0,
      t0Iso: r.t0Iso,
      onboardDate: r.onboardDate,
      diffDays: r.diffDays,
      actualDays: r.actualDays,
      cohort: `${dt.getUTCFullYear()}H${dt.getUTCMonth() < 6 ? 1 : 2}`,
      category: categorize(r),
      firstOpen,
      pump6: maxHighWithin(6) / firstOpen - 1,
      pump12: maxHighWithin(12) / firstOpen - 1,
      pump24: hi24 / firstOpen - 1,
      range24: (hi24 - lo24) / firstOpen,
      vol24,
      time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
    });
  }
  U.sort((a, b) => a.t0 - b.t0);
  return U;
}

// Short. Pessimistic: if a bar touches both SL and TP, the SL fills.
export function simulate(s, entryH, slPct, tpPct, holdDays) {
  const ei = s.time.indexOf(s.t0 + entryH * HOUR);
  if (ei === -1) return null;
  const entry = s.open[ei];
  if (!(entry > 0)) return null;
  const slPrice = entry * (1 + slPct / 100);
  const tpPrice = entry * (1 - tpPct / 100);
  const deadline = s.time[ei] + holdDays * DAY;

  let lastClose = null, bothTouched = false;
  for (let i = ei + 1; i < s.time.length; i++) {
    if (s.time[i] > deadline) break;
    const hitSL = s.high[i] >= slPrice;
    const hitTP = s.low[i] <= tpPrice;
    if (hitSL && hitTP) bothTouched = true;
    if (hitSL) return { o: 'SL', pnl: ((entry - slPrice) / entry) * 100 - FEE, entry, bothTouched };
    if (hitTP) return { o: 'TP', pnl: ((entry - tpPrice) / entry) * 100 - FEE, entry, bothTouched };
    lastClose = s.close[i];
  }
  if (lastClose == null) return null;
  return { o: 'TIMEOUT', pnl: ((entry - lastClose) / entry) * 100 - FEE, entry, bothTouched };
}

export function stats(trades) {
  const t = trades.filter(Boolean);
  const n = t.length;
  if (!n) return null;
  const p = t.map((x) => x.pnl);
  const avg = p.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(p.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  const sorted = [...p].sort((a, b) => a - b);
  return {
    n, avg, sd, se, t: avg / se, sig: Math.abs(avg) > 2 * se,
    med: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    win: (p.filter((x) => x > 0).length / n) * 100,
    tp: t.filter((x) => x.o === 'TP').length,
    sl: t.filter((x) => x.o === 'SL').length,
    to: t.filter((x) => x.o === 'TIMEOUT').length,
    both: t.filter((x) => x.bothTouched).length,
    min: sorted[0], max: sorted.at(-1),
  };
}

export const SLS = [10, 15, 20, 25, 30, 40, 50];
export const TPS = [3, 5, 8, 10, 15, 20, 30];
export const BASE = { entryH: 24, SL: 30, TP: 20, hold: 7 };

// 49-cell SL x TP scan at fixed entryH/hold. The positive-cell share is the edge indicator,
// not the best cell.
export function gridScan(members, entryH = BASE.entryH, hold = BASE.hold) {
  const cells = [];
  for (const SL of SLS) for (const TP of TPS) {
    const s = stats(members.map((m) => simulate(m, entryH, SL, TP, hold)));
    if (s) cells.push({ SL, TP, ...s });
  }
  if (!cells.length) return null;
  return {
    cells,
    posPct: (cells.filter((c) => c.avg > 0).length / cells.length) * 100,
    cellMean: cells.reduce((a, b) => a + b.avg, 0) / cells.length,
    best: Math.max(...cells.map((c) => c.avg)),
    worst: Math.min(...cells.map((c) => c.avg)),
    sig: cells.filter((c) => c.t > 2).length,
  };
}

export const line = (label, st, width = 22) => {
  if (!st) return `${label.padEnd(width)} n=0`;
  return `${label.padEnd(width)} n=${String(st.n).padStart(4)} win=${st.win.toFixed(1).padStart(5)}% ` +
    `avg=${st.avg.toFixed(2).padStart(7)}% med=${st.med.toFixed(2).padStart(6)}% sd=${st.sd.toFixed(1).padStart(5)} ` +
    `se=${st.se.toFixed(2).padStart(5)} t=${st.t.toFixed(2).padStart(6)} ${st.sig ? '★' : ' '} | ` +
    `TP=${String(st.tp).padStart(3)} SL=${String(st.sl).padStart(3)} TO=${String(st.to).padStart(3)}` +
    (st.n < 30 ? '  <-- n<30 参考値' : '');
};
