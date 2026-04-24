'use strict';

const db = require('../database');

function ensureClaimSessionTables() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS customer_products (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      merchant_id TEXT,
      barcode TEXT NOT NULL,
      product_json TEXT NOT NULL,
      source_session_id TEXT,
      scanned_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_customer_products_customer ON customer_products(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_products_source_session ON customer_products(source_session_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_products_customer_session_barcode
      ON customer_products(customer_id, source_session_id, barcode);

    CREATE TABLE IF NOT EXISTS claim_audit (
      id TEXT PRIMARY KEY,
      landing_session_id TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      first_claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      claim_count INTEGER DEFAULT 1,
      ip_hash TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_claim_audit_customer ON claim_audit(customer_id);
  `);
}

function normalizeBarcode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(digits)) return '';
  return digits;
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function extractClaimableProductsFromThread(shortTermThread) {
  if (!Array.isArray(shortTermThread)) return [];
  const rows = [];
  for (let i = shortTermThread.length - 1; i >= 0; i -= 1) {
    const evt = shortTermThread[i];
    if (String(evt?.type || '') !== 'barcode_product_context') continue;
    const pd = parseJsonObject(evt?.product_data);
    if (!pd) continue;
    const barcode = normalizeBarcode(pd.barcode || pd.code || pd?.normalized?.barcode);
    if (!barcode) continue;
    rows.push({
      barcode,
      product: pd,
      scanned_at: String(evt?.created_at || '').trim() || null
    });
  }
  return rows;
}

function upsertCustomerProductScan({
  customerId,
  merchantId = null,
  landingSessionId = null,
  barcode,
  product,
  scannedAt = null
}) {
  const normalizedBarcode = normalizeBarcode(barcode);
  const cleanCustomerId = String(customerId || '').trim();
  const cleanSessionId = String(landingSessionId || '').trim() || null;
  if (!cleanCustomerId || !normalizedBarcode || !product || typeof product !== 'object') {
    return { success: false, skipped: true };
  }

  ensureClaimSessionTables();
  const existing = db.db.prepare(`
    SELECT id
    FROM customer_products
    WHERE customer_id = ? AND source_session_id IS ? AND barcode = ?
    LIMIT 1
  `).get(cleanCustomerId, cleanSessionId, normalizedBarcode);

  const now = new Date().toISOString();
  const payload = JSON.stringify(product);
  if (existing?.id) {
    db.db.prepare(`
      UPDATE customer_products
      SET merchant_id = COALESCE(?, merchant_id),
          product_json = ?,
          scanned_at = COALESCE(?, scanned_at),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(merchantId || null, payload, scannedAt || now, existing.id);
    return { success: true, inserted: false, id: existing.id };
  }

  const id = `cprod_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  db.db.prepare(`
    INSERT INTO customer_products (
      id, customer_id, merchant_id, barcode, product_json, source_session_id, scanned_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, cleanCustomerId, merchantId || null, normalizedBarcode, payload, cleanSessionId, scannedAt || now);
  return { success: true, inserted: true, id };
}

function claimLandingSessionToCustomer({
  customerId,
  merchantId = null,
  landingSessionId,
  ipHash = null,
  userAgent = null
}) {
  ensureClaimSessionTables();
  const sid = String(landingSessionId || '').trim();
  const cid = String(customerId || '').trim();
  if (!cid) return { success: false, error: 'customer_id required', status: 400 };
  if (!sid) return { success: false, error: 'landing_session_id required', status: 400 };
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sid)) {
    return { success: false, error: 'invalid landing_session_id', status: 400 };
  }

  const owned = db.db.prepare(`
    SELECT customer_id, claim_count
    FROM claim_audit
    WHERE landing_session_id = ?
    LIMIT 1
  `).get(sid);
  if (owned && String(owned.customer_id) !== cid) {
    return { success: false, error: 'session already claimed by another customer', status: 403 };
  }

  const row = db.getOrchestrateSessionBySessionId ? db.getOrchestrateSessionBySessionId(sid) : null;
  if (!row) return { success: false, error: 'landing session not found', status: 404 };

  const flowState = row?.flow_state && typeof row.flow_state === 'object' ? row.flow_state : {};
  const products = extractClaimableProductsFromThread(flowState.short_term_thread);
  let upserted = 0;
  products.forEach((p) => {
    const out = upsertCustomerProductScan({
      customerId: cid,
      merchantId: merchantId || null,
      landingSessionId: sid,
      barcode: p.barcode,
      product: p.product,
      scannedAt: p.scanned_at
    });
    if (out.success) upserted += 1;
  });

  const existingAudit = db.db.prepare(`
    SELECT id, claim_count
    FROM claim_audit
    WHERE landing_session_id = ?
    LIMIT 1
  `).get(sid);

  if (existingAudit?.id) {
    db.db.prepare(`
      UPDATE claim_audit
      SET claim_count = claim_count + 1,
          last_claimed_at = datetime('now'),
          ip_hash = COALESCE(?, ip_hash),
          user_agent = COALESCE(?, user_agent)
      WHERE id = ?
    `).run(ipHash || null, userAgent || null, existingAudit.id);
  } else {
    db.db.prepare(`
      INSERT INTO claim_audit (
        id, landing_session_id, customer_id, first_claimed_at, last_claimed_at, claim_count, ip_hash, user_agent
      ) VALUES (?, ?, ?, datetime('now'), datetime('now'), 1, ?, ?)
    `).run(`claim_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, sid, cid, ipHash || null, userAgent || null);
  }

  return {
    success: true,
    idempotent: !!existingAudit,
    claimed_products_count: upserted,
    landing_session_id: sid
  };
}

function listCustomerProducts({ customerId, limit = 100 }) {
  ensureClaimSessionTables();
  const cid = String(customerId || '').trim();
  const cap = Math.max(1, Math.min(200, Number(limit) || 100));
  if (!cid) return [];
  const rows = db.db.prepare(`
    SELECT id, customer_id, merchant_id, barcode, product_json, source_session_id, scanned_at, created_at, updated_at
    FROM customer_products
    WHERE customer_id = ?
    ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
    LIMIT ?
  `).all(cid, cap);
  return rows.map((r) => {
    let product = null;
    try {
      product = JSON.parse(String(r.product_json || '{}'));
    } catch (_) {
      product = null;
    }
    return {
      id: r.id,
      customer_id: r.customer_id,
      merchant_id: r.merchant_id || null,
      barcode: r.barcode,
      source_session_id: r.source_session_id || null,
      scanned_at: r.scanned_at || null,
      product
    };
  });
}

module.exports = {
  ensureClaimSessionTables,
  extractClaimableProductsFromThread,
  upsertCustomerProductScan,
  claimLandingSessionToCustomer,
  listCustomerProducts
};
