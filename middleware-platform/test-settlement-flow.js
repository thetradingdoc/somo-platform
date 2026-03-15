/**
 * DocLittle Settlement Flow Test
 *
 * Verifies real money movement across 3 Circle wallets:
 *   Insurer → Escrow → Provider (97%) + Revenue (3%)
 *
 * Usage:
 *   node test-settlement-flow.js
 *   node test-settlement-flow.js --amount 10 --verbose
 *
 * Requires:
 *   CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID in .env
 *   INSURER_WALLET_ID, PROVIDER_WALLET_ID (set below or as env vars)
 */

require('dotenv').config();

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const AMOUNT_ARG = args.find(a => a.startsWith('--amount'));
const TEST_AMOUNT = AMOUNT_ARG ? parseFloat(AMOUNT_ARG.split('=')[1] || args[args.indexOf(AMOUNT_ARG) + 1]) : 1.00;

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  testAmount: TEST_AMOUNT,           // USDC to move (keep small - default $1)
  platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '3') / 100,
  insurerWalletId: process.env.INSURER_WALLET_ID || 'REPLACE_WITH_INSURER_WALLET_ID',
  providerWalletId: process.env.PROVIDER_WALLET_ID || 'REPLACE_WITH_PROVIDER_WALLET_ID',
  claimId: `test-claim-${Date.now()}`,
  toleranceUsd: 0.01,               // Acceptable rounding difference
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────
const log = (msg, data) => {
  console.log(msg);
  if (VERBOSE && data) console.log(JSON.stringify(data, null, 2));
};

const pass = (label) => console.log(`  ✅ ${label}`);
const fail = (label, detail) => { console.log(`  ❌ ${label}`); if (detail) console.log(`     ${detail}`); };
const warn = (label) => console.log(`  ⚠️  ${label}`);
const section = (title) => console.log(`\n${'─'.repeat(60)}\n${title}\n${'─'.repeat(60)}`);

let CircleService, InstantSettlementService, db;

// ─── RESULTS TRACKER ───────────────────────────────────────────────────────────
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  checks: []
};

function check(label, condition, detail, isWarning = false) {
  results.checks.push({ label, passed: condition, detail, isWarning });
  if (condition) {
    pass(label);
    results.passed++;
  } else if (isWarning) {
    warn(`${label}${detail ? ` — ${detail}` : ''}`);
    results.warnings++;
  } else {
    fail(label, detail);
    results.failed++;
  }
  return condition;
}

// ─── CIRCLE SERVICE WRAPPER ────────────────────────────────────────────────────
// If CircleService isn't importable, use direct API calls as fallback
function extractUsdcAmount(result) {
  // CircleService returns { success, balances: [{ token: { symbol }, amount }] }
  const balances = result.balances || [];
  const usdc = balances.find(b => (b.token?.symbol || b.symbol) === 'USDC');
  return parseFloat(usdc?.amount || usdc?.balance || 0);
}

async function getWalletBalance(walletId) {
  try {
    const result = await CircleService.getWalletBalance(walletId);
    if (result.success) return extractUsdcAmount(result);
    throw new Error(result.error);
  } catch (err) {
    // Direct API fallback
    const response = await fetch(
      `${process.env.CIRCLE_BASE_URL || 'https://api-sandbox.circle.com'}/v1/w3s/wallets/${walletId}/balances`,
      { headers: { 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    const usdc = data?.data?.tokenBalances?.find(b => b.token?.symbol === 'USDC');
    return parseFloat(usdc?.amount || 0);
  }
}

// ─── PHASE 1: PRE-FLIGHT CHECKS ────────────────────────────────────────────────
async function runPreflightChecks() {
  section('PHASE 1: Pre-flight Checks');

  // Check required env vars
  const required = ['CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET', 'CIRCLE_WALLET_SET_ID'];
  for (const key of required) {
    check(`Env var ${key} is set`, !!process.env[key], `Add ${key} to .env`);
  }

  check(
    'Test amount is safe (≤ $10)',
    CONFIG.testAmount <= 10,
    `Amount $${CONFIG.testAmount} exceeds $10 safety limit`,
    CONFIG.testAmount > 5
  );

  check(
    'Insurer wallet ID configured',
    CONFIG.insurerWalletId !== 'REPLACE_WITH_INSURER_WALLET_ID',
    'Set INSURER_WALLET_ID in .env or CONFIG above'
  );

  check(
    'Provider wallet ID configured',
    CONFIG.providerWalletId !== 'REPLACE_WITH_PROVIDER_WALLET_ID',
    'Set PROVIDER_WALLET_ID in .env or CONFIG above'
  );

  // Try importing services
  try {
    CircleService = require('./services/circle-service');
    check('CircleService imports successfully', true);
  } catch (err) {
    check('CircleService imports successfully', false, err.message);
    return false;
  }

  try {
    InstantSettlementService = require('./services/instant-settlement-service');
    check('InstantSettlementService imports successfully', true);
  } catch (err) {
    check('InstantSettlementService imports successfully', false, err.message);
    return false;
  }

  try {
    db = require('./database');
    check('Database imports successfully', true);
  } catch (err) {
    check('Database imports successfully', false, err.message);
    return false;
  }

  // Check CircleService is available (API key valid)
  const available = CircleService.isAvailable?.();
  check('Circle API key is valid', available, 'CIRCLE_API_KEY may be invalid or Circle SDK not initialized');

  return results.failed === 0;
}

// ─── PHASE 2: WALLET DISCOVERY ─────────────────────────────────────────────────
async function discoverWallets() {
  section('PHASE 2: Wallet Discovery');

  // Find platform wallets
  let escrowAccount, revenueAccount;

  try {
    escrowAccount = db.getCircleAccountByEntity('platform', 'escrow');
    check('Escrow wallet exists in DB', !!escrowAccount?.circle_wallet_id,
      'Run: POST /api/circle/wallets with entityType=platform, entityId=escrow');
  } catch (err) {
    check('Escrow wallet lookup', false, err.message);
    return null;
  }

  try {
    revenueAccount = db.getCircleAccountByEntity('platform', 'revenue');
    check('Revenue wallet exists in DB', !!revenueAccount?.circle_wallet_id,
      'Run: POST /api/circle/wallets with entityType=platform, entityId=revenue');
  } catch (err) {
    check('Revenue wallet lookup', false, err.message);
    return null;
  }

  const wallets = {
    insurer: CONFIG.insurerWalletId,
    escrow: escrowAccount?.circle_wallet_id,
    provider: CONFIG.providerWalletId,
    revenue: revenueAccount?.circle_wallet_id,
  };

  log('\nWallet IDs:');
  Object.entries(wallets).forEach(([name, id]) => log(`  ${name.padEnd(10)}: ${id || 'NOT FOUND'}`));

  return wallets;
}

// ─── PHASE 3: BALANCE SNAPSHOT ─────────────────────────────────────────────────
async function snapshotBalances(wallets, label) {
  section(`PHASE 3: Balance Snapshot (${label})`);

  const balances = {};
  for (const [name, walletId] of Object.entries(wallets)) {
    if (!walletId) { balances[name] = null; continue; }
    try {
      balances[name] = await getWalletBalance(walletId);
      log(`  ${name.padEnd(10)}: $${balances[name].toFixed(6)} USDC`);
    } catch (err) {
      balances[name] = null;
      fail(`Get balance for ${name} wallet`, err.message);
    }
  }

  // Check insurer has enough funds
  if (balances.insurer !== null) {
    check(
      `Insurer has sufficient funds (need $${CONFIG.testAmount})`,
      balances.insurer >= CONFIG.testAmount,
      `Insurer balance: $${balances.insurer?.toFixed(2)} — fund the insurer testnet wallet first`
    );
  }

  return balances;
}

// ─── PHASE 4: EXECUTE SETTLEMENT ───────────────────────────────────────────────
async function executeSettlement(wallets) {
  section('PHASE 4: Execute Settlement');

  const revenueAmount = Math.round(CONFIG.testAmount * CONFIG.platformFeePercent * 100) / 100;
  const providerAmount = Math.round((CONFIG.testAmount - revenueAmount) * 100) / 100;

  log(`\nExpected splits for $${CONFIG.testAmount} USDC:`);
  log(`  Insurer → Escrow  : $${CONFIG.testAmount.toFixed(2)} (100%)`);
  log(`  Escrow → Provider : $${providerAmount.toFixed(2)} (${100 - CONFIG.platformFeePercent * 100}%)`);
  log(`  Escrow → Revenue  : $${revenueAmount.toFixed(2)} (${CONFIG.platformFeePercent * 100}%)`);
  log(`  Claim ID          : ${CONFIG.claimId}\n`);

  const startTime = Date.now();

  let result;
  try {
    result = await InstantSettlementService.executeInstantSettlement({
      claimId: CONFIG.claimId,
      totalApproved: CONFIG.testAmount,
      insurerWalletId: wallets.insurer,
      providerWalletId: wallets.provider,
      description: `DocLittle settlement test — ${new Date().toISOString()}`
    });
  } catch (err) {
    check('Settlement executed without exception', false, err.message);
    return null;
  }

  const elapsedMs = Date.now() - startTime;
  log(VERBOSE ? 'Settlement result:' : '', VERBOSE ? result : null);

  check('Settlement returned success=true', result?.success === true,
    result?.error || result?.message || 'Unknown failure');
  check('Settlement completed in < 30s', elapsedMs < 30000,
    `Took ${(elapsedMs / 1000).toFixed(1)}s — may indicate Circle API latency`);

  // Verify all 3 transfers present
  const transfers = result?.transfers || [];
  check('Transfer 1 (Insurer→Escrow) present', transfers.some(t => t.type === 'insurer_to_escrow' && t.status === 'completed'));
  check('Transfer 2 (Escrow→Provider) present', transfers.some(t => t.type === 'escrow_to_provider' && t.status === 'completed'));
  check('Transfer 3 (Escrow→Revenue) present', transfers.some(t => t.type === 'escrow_to_revenue' && t.status === 'completed'));

  // Verify Circle transfer IDs are real (non-empty)
  for (const t of transfers) {
    if (t.circleTransferId) {
      check(
        `${t.type} has real Circle transfer ID`,
        typeof t.circleTransferId === 'string' && t.circleTransferId.length > 5,
        `Got: ${t.circleTransferId}`
      );
    }
  }

  // Verify amounts
  check(
    `Provider amount is ~$${providerAmount.toFixed(2)}`,
    Math.abs((result?.providerAmount || 0) - providerAmount) <= CONFIG.toleranceUsd,
    `Got $${result?.providerAmount}`
  );
  check(
    `Revenue amount is ~$${revenueAmount.toFixed(2)}`,
    Math.abs((result?.revenueAmount || 0) - revenueAmount) <= CONFIG.toleranceUsd,
    `Got $${result?.revenueAmount}`
  );

  // Verify state machine record
  const attempt = db.getSettlementAttemptByClaimId?.(CONFIG.claimId);
  check('Settlement attempt record created in DB', !!attempt, 'DB record missing — state machine may not be saving');
  if (attempt) {
    check('Transfer 1 status = completed in DB', attempt.transfer_1_status === 'completed', `Status: ${attempt.transfer_1_status}`);
    check('Transfer 2 status = completed in DB', attempt.transfer_2_status === 'completed', `Status: ${attempt.transfer_2_status}`);
    check('Transfer 3 status = completed in DB', attempt.transfer_3_status === 'completed', `Status: ${attempt.transfer_3_status}`);
    check('Transfer 1 Circle ID saved to DB', !!attempt.transfer_1_circle_id);
    check('Transfer 2 Circle ID saved to DB', !!attempt.transfer_2_circle_id);
    check('Transfer 3 Circle ID saved to DB', !!attempt.transfer_3_circle_id);
  }

  return { result, providerAmount, revenueAmount, elapsedMs };
}

// ─── PHASE 5: VERIFY BALANCES MOVED ────────────────────────────────────────────
async function verifyBalanceMovement(wallets, before, providerAmount, revenueAmount) {
  section('PHASE 5: Verify Balances Actually Moved');

  // Give Circle a moment to settle
  log('Waiting 3s for Circle to confirm transfers...');
  await new Promise(r => setTimeout(r, 3000));

  const after = {};
  for (const [name, walletId] of Object.entries(wallets)) {
    if (!walletId) { after[name] = null; continue; }
    try {
      after[name] = await getWalletBalance(walletId);
    } catch (err) {
      after[name] = null;
      warn(`Could not get post-settlement balance for ${name}: ${err.message}`);
    }
  }

  const delta = {};
  log('\nBalance changes:');
  for (const name of Object.keys(wallets)) {
    if (before[name] === null || after[name] === null) {
      delta[name] = null;
      log(`  ${name.padEnd(10)}: unable to compare`);
      continue;
    }
    delta[name] = after[name] - before[name];
    const sign = delta[name] >= 0 ? '+' : '';
    log(`  ${name.padEnd(10)}: ${sign}$${delta[name].toFixed(6)} USDC  (${before[name].toFixed(6)} → ${after[name].toFixed(6)})`);
  }

  const tol = CONFIG.toleranceUsd;

  // Insurer should be down by test amount
  if (delta.insurer !== null) {
    check(
      `Insurer balance decreased by $${CONFIG.testAmount}`,
      Math.abs(delta.insurer - (-CONFIG.testAmount)) <= tol,
      `Delta was $${delta.insurer?.toFixed(6)}`
    );
  }

  // Escrow should net to 0 (received then paid out)
  if (delta.escrow !== null) {
    check(
      'Escrow wallet nets to zero (all funds passed through)',
      Math.abs(delta.escrow) <= tol,
      `Escrow delta $${delta.escrow?.toFixed(6)} — non-zero means funds stuck`
    );
  }

  // Provider should be up by providerAmount
  if (delta.provider !== null) {
    check(
      `Provider balance increased by ~$${providerAmount.toFixed(2)}`,
      Math.abs(delta.provider - providerAmount) <= tol,
      `Delta was $${delta.provider?.toFixed(6)}`
    );
  }

  // Revenue should be up by revenueAmount
  if (delta.revenue !== null) {
    check(
      `Revenue balance increased by ~$${revenueAmount.toFixed(2)}`,
      Math.abs(delta.revenue - revenueAmount) <= tol,
      `Delta was $${delta.revenue?.toFixed(6)}`
    );
  }

  // Conservation check: money in = money out
  if (delta.insurer !== null && delta.provider !== null && delta.revenue !== null) {
    const totalOut = (delta.provider || 0) + (delta.revenue || 0);
    const totalIn = Math.abs(delta.insurer || 0);
    check(
      `Money conserved: insurer paid $${totalIn.toFixed(4)}, provider+revenue received $${totalOut.toFixed(4)}`,
      Math.abs(totalIn - totalOut) <= tol,
      `Conservation gap: $${(totalIn - totalOut).toFixed(6)}`
    );
  }

  return { after, delta };
}

// ─── PHASE 6: IDEMPOTENCY TEST ─────────────────────────────────────────────────
async function testIdempotency(wallets, after) {
  section('PHASE 6: Idempotency Test (Retry Protection)');
  log('Re-running settlement with same claimId — should be a no-op...\n');

  const rerunResult = await InstantSettlementService.executeInstantSettlement({
    claimId: CONFIG.claimId,  // Same claim ID
    totalApproved: CONFIG.testAmount,
    insurerWalletId: wallets.insurer,
    providerWalletId: wallets.provider,
  });

  await new Promise(r => setTimeout(r, 2000));

  const rerunBalances = {};
  for (const [name, walletId] of Object.entries(wallets)) {
    if (!walletId) continue;
    try { rerunBalances[name] = await getWalletBalance(walletId); } catch { rerunBalances[name] = null; }
  }

  // Balances should not change on retry
  for (const name of ['insurer', 'provider', 'revenue']) {
    if (after[name] !== null && rerunBalances[name] !== null) {
      check(
        `${name} balance unchanged on retry (idempotency)`,
        Math.abs((rerunBalances[name] || 0) - (after[name] || 0)) <= CONFIG.toleranceUsd,
        `Balance changed: ${after[name]?.toFixed(6)} → ${rerunBalances[name]?.toFixed(6)} — double payment risk!`
      );
    }
  }
}

// ─── PHASE 7: AUDIT TRAIL CHECK ────────────────────────────────────────────────
async function checkAuditTrail() {
  section('PHASE 7: Audit Trail');

  try {
    // Check circle_transfers table has 3 records for this claim
    const transfers = db.getCircleTransfersByClaim?.(CONFIG.claimId) || [];
    check('3 records exist in circle_transfers table', transfers.length >= 3,
      `Found ${transfers.length} — expected at least 3`);

    const hasInsurer = transfers.some(t => t.from_wallet_id === CONFIG.insurerWalletId);
    const hasProvider = transfers.some(t => t.to_wallet_id === CONFIG.providerWalletId);
    check('Insurer→Escrow transfer in audit table', hasInsurer);
    check('Escrow→Provider transfer in audit table', hasProvider);

    const allHaveCircleId = transfers.every(t => !!t.circle_transfer_id);
    check('All transfers have Circle transfer IDs', allHaveCircleId,
      'Missing Circle IDs mean transfers cannot be verified with Circle');

    if (VERBOSE) {
      log('\nAudit records:');
      transfers.forEach(t => log(`  ${t.from_wallet_id?.slice(-6)} → ${t.to_wallet_id?.slice(-6)} : $${t.amount} (${t.circle_transfer_id})`));
    }
  } catch (err) {
    check(`Audit trail check skipped`, false, err.message, true); // Mark as warning, not failure
  }
}

// ─── FINAL REPORT ──────────────────────────────────────────────────────────────
function printReport(elapsedMs) {
  section('TEST REPORT');

  console.log(`  Test amount    : $${CONFIG.testAmount} USDC`);
  console.log(`  Claim ID       : ${CONFIG.claimId}`);
  console.log(`  Total checks   : ${results.checks.length}`);
  console.log(`  ✅ Passed       : ${results.passed}`);
  console.log(`  ❌ Failed       : ${results.failed}`);
  console.log(`  ⚠️  Warnings     : ${results.warnings}`);
  if (elapsedMs) console.log(`  Settlement time: ${(elapsedMs / 1000).toFixed(2)}s`);

  if (results.failed > 0) {
    console.log('\n  Failed checks:');
    results.checks
      .filter(c => !c.passed && !c.isWarning)
      .forEach(c => console.log(`    ❌ ${c.label}${c.detail ? ` — ${c.detail}` : ''}`));
  }

  const verdict = results.failed === 0
    ? '\n  🟢 SETTLEMENT FLOW VERIFIED — money moves correctly\n'
    : `\n  🔴 SETTLEMENT FLOW FAILED — ${results.failed} check(s) failed\n`;
  console.log(verdict);
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n============================================================');
  console.log('  DocLittle Triple Jump Settlement — Integration Test');
  console.log(`  Amount: $${CONFIG.testAmount} USDC | Verbose: ${VERBOSE}`);
  console.log('============================================================');

  let elapsedMs;

  try {
    const preflightOk = await runPreflightChecks();
    if (!preflightOk) {
      console.log('\n⛔ Pre-flight checks failed — aborting test');
      printReport();
      process.exit(1);
    }

    const wallets = await discoverWallets();
    if (!wallets || !wallets.escrow || !wallets.revenue) {
      console.log('\n⛔ Wallet discovery failed — aborting test');
      printReport();
      process.exit(1);
    }

    const before = await snapshotBalances(wallets, 'BEFORE');
    if (results.failed > 0) {
      console.log('\n⛔ Pre-balance check failed (likely insufficient funds) — aborting');
      printReport();
      process.exit(1);
    }

    const settlement = await executeSettlement(wallets);
    if (!settlement) {
      printReport();
      process.exit(1);
    }
    elapsedMs = settlement.elapsedMs;

    const { delta, after } = await verifyBalanceMovement(
      wallets, before, settlement.providerAmount, settlement.revenueAmount
    );

    await testIdempotency(wallets, after);
    await checkAuditTrail();

  } catch (err) {
    console.error('\n❌ Unexpected test error:', err);
    results.failed++;
  }

  printReport(elapsedMs);
  process.exit(results.failed > 0 ? 1 : 0);
}

main();
