#!/usr/bin/env node
// Usage: node --env-file=.env.test scripts/test-paper-trade.mjs
//
// Tests the full paper trading pipeline via production endpoints:
//   1. Fetch live MEXC price for SOL_USDT
//   2. POST /api/paper-trades/auto-entry  → inserts 8 pattern trades (A1-B4)
//   3. GET  /api/paper-trades             → verify 8 trades are in KV
//   4. GET  /api/paper-trades/check       → A-pattern trades should close at TP
//   5. GET  /api/paper-trades             → verify A trades closed, show PnL
//
// Note: entry price is set at 3× market → TP triggers immediately for A patterns (single-entry).
//       B patterns stay pending_lot2 and will close in the next hourly cron run.

const BASE_URL    = 'https://mexc-new-listing-short.vercel.app'
const CRON_SECRET = process.env.CRON_SECRET
const TEST_SYMBOL = 'SOL_USDT'

if (!CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1) }

function fmt(n)    { return n != null ? `$${n.toFixed(4)}` : 'null' }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—' }
function sep()     { console.log('─'.repeat(55)) }

async function api(path, opts = {}) {
  const res  = await fetch(`${BASE_URL}${path}`, opts)
  const json = await res.json()
  return { status: res.status, ...json }
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  Paper Trade System — Integration Test')
  console.log('══════════════════════════════════════════════════════\n')

  // ── 1. Fetch live SOL_USDT price from MEXC contract API ─────────────────────
  sep()
  console.log('Step 1: Fetch live price from MEXC contract API')
  sep()
  const mexcRes  = await fetch(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${TEST_SYMBOL}`)
  const mexcJson = await mexcRes.json()
  const item     = Array.isArray(mexcJson.data) ? mexcJson.data[0] : mexcJson.data
  if (!mexcJson.success || !item?.lastPrice) throw new Error('MEXC ticker failed')
  const mktPrice   = parseFloat(item.lastPrice)
  const entryPrice = mktPrice * 3   // 3× market → TP at −20% = 2.4× market, well above current price

  console.log(`  ${TEST_SYMBOL} market price : ${fmt(mktPrice)}`)
  console.log(`  Test entry price  (3×) : ${fmt(entryPrice)}`)
  console.log(`  Expected TP price (−20%): ${fmt(entryPrice * 0.80)}`)
  console.log(`  → Current price ${fmt(mktPrice)} is below TP → ✅ TP will trigger\n`)

  // ── 2. POST /api/paper-trades/auto-entry ────────────────────────────────────
  sep()
  console.log('Step 2: POST /api/paper-trades/auto-entry')
  sep()
  const entryBody = {
    symbol:       TEST_SYMBOL,
    currentPrice: entryPrice,
    score:        87,
    pumpPct:      150,
    snapshotFR:   0.0001,
    elapsedHours: 30,
  }
  console.log('  Payload:', JSON.stringify(entryBody, null, 4))
  const entryRes = await api('/api/paper-trades/auto-entry', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(entryBody),
  })
  console.log(`  HTTP ${entryRes.status}`)
  console.log('  Response:', JSON.stringify(entryRes, null, 4))

  if (entryRes.skipped) {
    console.log(`\n  ⚠️  SKIPPED: ${entryRes.reason}`)
    if (entryRes.reason === 'already_traded_24h') {
      console.log(`  ${TEST_SYMBOL} was already paper-traded in the last 24 h.`)
      console.log('  Either wait 24 h or try a different symbol.\n')
    }
    // Still proceed to test check endpoint with existing trades
  } else {
    console.log(`\n  ✅  Created ${entryRes.created} trades  (sessionId: ${entryRes.sessionId})\n`)
  }

  // ── 3. GET /api/paper-trades ─────────────────────────────────────────────────
  sep()
  console.log('Step 3: GET /api/paper-trades (verify KV contents)')
  sep()
  const listRes = await api('/api/paper-trades')
  const trades  = listRes.trades ?? []
  const testTrades = trades.filter((t) => t.symbol === TEST_SYMBOL)
  const openTest   = testTrades.filter((t) => t.status !== 'closed')
  const closedTest = testTrades.filter((t) => t.status === 'closed')

  console.log(`  Total trades in KV   : ${trades.length}`)
  console.log(`  ${TEST_SYMBOL} trades  : ${testTrades.length}  (${openTest.length} open, ${closedTest.length} closed)`)

  if (testTrades.length > 0) {
    console.log('\n  Pattern breakdown:')
    for (const t of testTrades.sort((a, b) => a.pattern.localeCompare(b.pattern))) {
      console.log(`    ${t.pattern}  status=${t.status}  entry=${fmt(t.avgEntryPrice)}  tp=${fmt(t.tpPrice)}`)
    }
  }
  console.log()

  // ── 4. GET /api/paper-trades/check ──────────────────────────────────────────
  sep()
  console.log('Step 4: GET /api/paper-trades/check  (cron simulation)')
  sep()
  const t0       = Date.now()
  const checkRes = await api('/api/paper-trades/check', {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
  const elapsed  = Date.now() - t0
  console.log(`  HTTP ${checkRes.status}  (${elapsed} ms)`)
  console.log('  Response:', JSON.stringify(checkRes, null, 4))
  console.log()

  // ── 5. GET /api/paper-trades (verify TP closed) ─────────────────────────────
  sep()
  console.log('Step 5: GET /api/paper-trades (verify TP triggered)')
  sep()
  const list2Res  = await api('/api/paper-trades')
  const trades2   = list2Res.trades ?? []
  const test2     = trades2.filter((t) => t.symbol === TEST_SYMBOL)
  const nowClosed = test2.filter((t) => t.status === 'closed')
  const nowOpen   = test2.filter((t) => t.status !== 'closed')
  const aPatterns = test2.filter((t) => t.pattern.startsWith('A'))
  const bPatterns = test2.filter((t) => t.pattern.startsWith('B'))
  const aClosed   = aPatterns.filter((t) => t.status === 'closed')

  console.log(`  ${TEST_SYMBOL} trades: ${nowOpen.length} open, ${nowClosed.length} closed`)

  if (test2.length > 0) {
    console.log('\n  Results:')
    const header = `  ${'PT'.padEnd(4)} ${'status'.padEnd(12)} ${'exitReason'.padEnd(12)} ${'netPnlPct'.padEnd(10)} netPnlUSDT`
    console.log(header)
    console.log('  ' + '─'.repeat(53))
    for (const t of test2.sort((a, b) => a.pattern.localeCompare(b.pattern))) {
      const pnlStr  = fmtPct(t.netPnlPct)
      const usdtStr = t.netPnlUsdt != null ? `${t.netPnlUsdt >= 0 ? '+' : ''}${t.netPnlUsdt.toFixed(2)}` : '—'
      console.log(`  ${t.pattern.padEnd(4)} ${t.status.padEnd(12)} ${(t.exitReason ?? '—').padEnd(12)} ${pnlStr.padEnd(10)} ${usdtStr}`)
    }
  }

  console.log('\n  ── Assertions ──')
  const aPass = aClosed.length === 4 && aPatterns.every((t) => t.exitReason === 'tp' || t.status !== 'closed')
  const bPend = bPatterns.every((t) => t.status === 'pending_lot2' || t.status === 'open')
  console.log(`  A-patterns (A1-A4) closed at TP : ${aClosed.length === 4 ? `✅ all 4 closed` : `❌ only ${aClosed.length}/4 closed`}`)
  console.log(`  B-patterns (B1-B4) pending/open  : ${bPend ? '✅' : '❌'} (lot2 added after 2 h by next cron)`)

  if (aClosed.length > 0) {
    const a1 = test2.find((t) => t.pattern === 'A1')
    if (a1?.netPnlPct != null) {
      // Expected: gross=20%×10lev=200%, cost=(0.02×2+0.20)×10=2.4% → net≈197.6%
      const expected = 197.6
      const diff     = Math.abs(a1.netPnlPct - expected)
      console.log(`  A1 net PnL: ${fmtPct(a1.netPnlPct)}  (expected ≈ +${expected}%)  ${diff < 2 ? '✅' : '❌ off by ' + diff.toFixed(1) + '%'}`)
    }
  }

  console.log('\n══════════════════════════════════════════════════════')
  const allGood = aClosed.length === 4 && bPend
  console.log(`  ${allGood ? '✅  ALL ASSERTIONS PASSED' : '⚠️  SOME ASSERTIONS FAILED — see above'}`)
  console.log('══════════════════════════════════════════════════════')
  console.log(`
  Note: ${bPatterns.length} B-pattern trades remain open (pending lot2).
  They will be processed by the next hourly cron and close at TP.
  All test trades for ${TEST_SYMBOL} will appear in the /trades UI under ペーパー tab.
`)
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1) })
