#!/usr/bin/env node
'use strict';

/**
 * Probe Stedi Test Mode: DNS, reachability, and eligibility v3 approval.
 * Does not log API keys or PII.
 *
 * Usage: node scripts/stedi-test-mode-probe.cjs
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const dns = require('dns').promises;
const axios = require('axios');

const HEALTHCARE_BASE = (process.env.STEDI_HEALTHCARE_BASE || 'https://healthcare.us.stedi.com').replace(/\/$/, '');
const ELIGIBILITY_V3 = '/2024-04-01/change/medicalnetwork/eligibility/v3';

const SCENARIOS = [
  {
    name: 'minimal_invalid',
    body: {
      tradingPartnerServiceId: process.env.STEDI_TEST_PAYER_ID || 'STEDI',
      provider: {
        organizationName: 'Doclittle Test',
        npi: process.env.STEDI_TEST_PROVIDER_NPI || process.env.STEDI_TEST_PROVIDER_NPI || '1999999984'
      },
      subscriber: {
        memberId: process.env.STEDI_TEST_MEMBER_ID || '0000000001'
      }
    }
  },
  {
    name: 'stedi_test_subscriber',
    body: {
      tradingPartnerServiceId: process.env.STEDI_TEST_PAYER_ID || 'STEDI',
      provider: {
        organizationName: 'Doclittle Test',
        npi: process.env.STEDI_TEST_PROVIDER_NPI || '1999999984'
      },
      subscriber: {
        memberId: process.env.STEDI_TEST_MEMBER_ID || '0000000001',
        firstName: process.env.STEDI_TEST_SUBSCRIBER_FIRST || 'Jane',
        lastName: process.env.STEDI_TEST_SUBSCRIBER_LAST || 'Doe',
        dateOfBirth: String(process.env.STEDI_TEST_DOB || '2004-04-04').replace(/-/g, '')
      },
      encounter: { serviceTypeCodes: ['30'] }
    }
  },
  {
    name: 'env_payer_member',
    body: {
      tradingPartnerServiceId: process.env.STEDI_TEST_PAYER_ID || '60054',
      provider: {
        organizationName: 'Doclittle Test',
        npi: process.env.STEDI_TEST_PROVIDER_NPI || '1999999984'
      },
      subscriber: {
        memberId: process.env.STEDI_TEST_MEMBER_ID || 'TEST123456',
        firstName: process.env.STEDI_TEST_SUBSCRIBER_FIRST || 'Jane',
        lastName: process.env.STEDI_TEST_SUBSCRIBER_LAST || 'Doe',
        dateOfBirth: String(process.env.STEDI_TEST_DOB || '2004-04-04').replace(/-/g, '')
      },
      encounter: { serviceTypeCodes: ['30'] }
    }
  }
];

async function dnsCheck(host) {
  try {
    const addr = await dns.lookup(host);
    return { host, ok: true, address: addr.address };
  } catch (e) {
    return { host, ok: false, error: e.code || e.message };
  }
}

async function postEligibility(label, body, apiKey) {
  const url = `${HEALTHCARE_BASE}${ELIGIBILITY_V3}`;
  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 25000,
      validateStatus: () => true
    });
    const d = res.data || {};
    return {
      scenario: label,
      status: res.status,
      code: d.code || d.status || null,
      message: d.message ? String(d.message).slice(0, 80) : null,
      hasBenefits: Boolean(d.benefitsInformation && d.benefitsInformation.length),
      eligibilitySearchId: d.eligibilitySearchId || d.id || null,
      approved: res.status === 200
    };
  } catch (e) {
    return {
      scenario: label,
      status: 0,
      error: e.code || e.message,
      approved: false
    };
  }
}

async function main() {
  const apiKey = (process.env.STEDI_API_KEY || '').trim();
  const keyPrefix = apiKey ? apiKey.slice(0, 5) + '…' : 'missing';

  console.log('\n=== Stedi Test Mode Probe ===\n');
  console.log('STEDI_API_KEY:', apiKey ? `present (${keyPrefix})` : 'MISSING');
  console.log('STEDI_TEST_MODE:', process.env.STEDI_TEST_MODE || '(not set)');
  console.log('STEDI_HEALTHCARE_BASE:', HEALTHCARE_BASE);
  console.log('STEDI_API_BASE:', process.env.STEDI_API_BASE || '(default)');

  const hosts = ['api.stedi.com', 'core.us.stedi.com', 'healthcare.us.stedi.com'];
  console.log('\n--- DNS ---');
  for (const h of hosts) {
    const r = await dnsCheck(h);
    console.log(`  ${r.host}: ${r.ok ? r.address : r.error}`);
  }

  console.log('\n--- Healthcare reachability ---');
  try {
    const root = await axios.get(HEALTHCARE_BASE, {
      headers: { Authorization: apiKey },
      timeout: 10000,
      validateStatus: () => true
    });
    console.log(`  GET ${HEALTHCARE_BASE} → ${root.status} (403/401 expected without route)`);
  } catch (e) {
    console.log(`  GET failed: ${e.code || e.message}`);
  }

  if (!apiKey) {
    console.error('\nSet STEDI_API_KEY in middleware-platform/.env\n');
    process.exit(1);
  }

  console.log('\n--- Eligibility v3 scenarios ---');
  const results = [];
  for (const s of SCENARIOS) {
    const r = await postEligibility(s.name, s.body, apiKey);
    results.push(r);
    console.log(
      `  [${s.name}] HTTP ${r.status}` +
        (r.code ? ` code=${r.code}` : '') +
        (r.hasBenefits ? ' benefits=yes' : '') +
        (r.approved ? ' APPROVED' : '')
    );
    if (r.message) console.log(`    message: ${r.message}`);
  }

  const approved = results.find((r) => r.approved);
  const reachable = results.some((r) => r.status > 0 && r.status !== 0);

  const report = {
    keyPresent: Boolean(apiKey),
    keyPrefix: apiKey.startsWith('test_') ? 'test_' : 'other',
    eligibilityReachable: reachable,
    eligibilityApproved: Boolean(approved),
    winningScenario: approved?.scenario || null,
    recommendedEnv: approved
      ? {
          STEDI_TEST_PAYER_ID: SCENARIOS.find((s) => s.name === approved.scenario)?.body?.tradingPartnerServiceId,
          STEDI_TEST_MEMBER_ID: SCENARIOS.find((s) => s.name === approved.scenario)?.body?.subscriber?.memberId
        }
      : null
  };

  console.log('\n--- Summary ---');
  console.log(JSON.stringify(report, null, 2));

  if (approved) {
    console.log('\nUse winning scenario IDs in .env as STEDI_TEST_PAYER_ID / STEDI_TEST_MEMBER_ID\n');
    process.exit(0);
  }

  console.log(
    '\nNo scenario returned HTTP 200. Check Stedi dashboard → Test Mode → approved test requests,\n' +
      'then set STEDI_TEST_PAYER_ID and STEDI_TEST_MEMBER_ID in .env and re-run.\n'
  );
  process.exit(reachable ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
