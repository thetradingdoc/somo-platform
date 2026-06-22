'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  stampTenantSiteContext,
  assertSiteContextVerdict,
  evaluateTenantSiteContext,
  merchantKeyForCustomer
} = require('../scripts/lib/stamp-tenant-site-context.cjs');

const CUSTOMER_ID = 'cust_test_front_door';
const CLINIC_ID = 'clinic-test';
const DID = '+18622307479';
const MERCHANT = `cust:${CUSTOMER_ID}`;

function createMinimalDb(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      email TEXT,
      merchant_id TEXT,
      customer_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE clinics (
      clinic_id TEXT PRIMARY KEY,
      name TEXT,
      slug TEXT,
      merchant_id TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE clinic_phone_numbers (
      phone_number TEXT PRIMARY KEY,
      clinic_id TEXT,
      is_primary INTEGER,
      created_at TEXT
    );
    CREATE TABLE customer_clinics (
      customer_id TEXT NOT NULL,
      clinic_id TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (customer_id, clinic_id)
    );
  `);
  db.prepare(
    `INSERT INTO customers (id, email, customer_type) VALUES (?, 'test@example.com', 'operator')`
  ).run(CUSTOMER_ID);
  db.prepare(
    `INSERT INTO clinics (clinic_id, name, slug, is_active) VALUES (?, 'Test Clinic', 'test', 1)`
  ).run(CLINIC_ID);
  db.close();
}

describe('stamp-tenant-site-context', () => {
  let tmpDir;
  let dbPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-door-'));
    dbPath = path.join(tmpDir, 'test.db');
    createMinimalDb(dbPath);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('merchantKeyForCustomer defaults to cust: prefix', () => {
    expect(merchantKeyForCustomer(CUSTOMER_ID)).toBe(MERCHANT);
    expect(merchantKeyForCustomer(CUSTOMER_ID, 'existing')).toBe('existing');
  });

  test('evaluateTenantSiteContext fails before stamp', () => {
    const result = evaluateTenantSiteContext(dbPath, {
      customerId: CUSTOMER_ID,
      clinicId: CLINIC_ID,
      did: DID
    });
    expect(result.verdict).toMatch(/FAIL/);
    expect(result.siteContext.site_context_status).not.toBe('verified');
    expect(result.admission.admitted).toBe(false);
  });

  test('stampTenantSiteContext + assertSiteContextVerdict passes', () => {
    stampTenantSiteContext(dbPath, {
      customerId: CUSTOMER_ID,
      clinicId: CLINIC_ID,
      did: DID
    });
    const result = assertSiteContextVerdict(dbPath, {
      customerId: CUSTOMER_ID,
      clinicId: CLINIC_ID,
      did: DID
    });
    expect(result.verdict).toBe('PASS: verified bind');
    expect(result.siteContext.site_context_status).toBe('verified');
    expect(result.admission.admitted).toBe(true);
  });
});
