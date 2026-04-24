'use strict';

const Database = require('better-sqlite3');

describe('landing-session-claim-service', () => {
  let mem;
  let orchestrateRows;
  let service;

  beforeEach(() => {
    jest.resetModules();
    mem = new Database(':memory:');
    orchestrateRows = new Map();

    jest.doMock('../database', () => ({
      db: mem,
      getOrchestrateSessionBySessionId: jest.fn((sid) => orchestrateRows.get(String(sid || '')) || null)
    }));

    service = require('../services/landing-session-claim-service');
    service.ensureClaimSessionTables();
  });

  afterEach(() => {
    try { mem.close(); } catch (_) {}
  });

  test('claim is idempotent for same customer/session', () => {
    orchestrateRows.set('sid_abc12345', {
      flow_state: {
        short_term_thread: [
          {
            type: 'barcode_product_context',
            created_at: '2026-01-01T00:00:00.000Z',
            product_data: { barcode: '3017620422003', product_name: 'Nutri Serum' }
          },
          {
            type: 'barcode_product_context',
            created_at: '2026-01-02T00:00:00.000Z',
            product_data: { barcode: '3600542413146', product_name: 'Face Cleanser' }
          }
        ]
      }
    });

    const first = service.claimLandingSessionToCustomer({
      customerId: 'cust_1',
      merchantId: 'm_1',
      landingSessionId: 'sid_abc12345'
    });
    const second = service.claimLandingSessionToCustomer({
      customerId: 'cust_1',
      merchantId: 'm_1',
      landingSessionId: 'sid_abc12345'
    });

    expect(first.success).toBe(true);
    expect(first.idempotent).toBe(false);
    expect(first.claimed_products_count).toBe(2);

    expect(second.success).toBe(true);
    expect(second.idempotent).toBe(true);

    const rows = mem.prepare('SELECT customer_id, barcode, source_session_id FROM customer_products ORDER BY barcode ASC').all();
    expect(rows).toHaveLength(2);
    expect(rows[0].customer_id).toBe('cust_1');
    expect(rows[0].source_session_id).toBe('sid_abc12345');
  });

  test('foreign customer cannot claim already-claimed landing session', () => {
    orchestrateRows.set('sid_foreign_01', {
      flow_state: {
        short_term_thread: [
          {
            type: 'barcode_product_context',
            created_at: '2026-01-01T00:00:00.000Z',
            product_data: { barcode: '3017620422003', product_name: 'Nutri Serum' }
          }
        ]
      }
    });

    const first = service.claimLandingSessionToCustomer({
      customerId: 'cust_owner',
      landingSessionId: 'sid_foreign_01'
    });
    const second = service.claimLandingSessionToCustomer({
      customerId: 'cust_other',
      landingSessionId: 'sid_foreign_01'
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.status).toBe(403);
    expect(String(second.error || '')).toContain('already claimed');
  });

  test('after claim, listCustomerProducts returns shelf rows (claim → shelf chain)', () => {
    orchestrateRows.set('sid_shelf_chain', {
      flow_state: {
        short_term_thread: [
          {
            type: 'barcode_product_context',
            created_at: '2026-01-01T00:00:00.000Z',
            product_data: { barcode: '3017620422003', product_name: 'Nutri Serum' }
          }
        ]
      }
    });

    const claim = service.claimLandingSessionToCustomer({
      customerId: 'cust_shelf_chain',
      merchantId: 'm_1',
      landingSessionId: 'sid_shelf_chain'
    });
    expect(claim.success).toBe(true);

    const products = service.listCustomerProducts({ customerId: 'cust_shelf_chain' });
    expect(products.length).toBe(1);
    expect(products[0].barcode).toBe('3017620422003');
    expect(products[0].product && products[0].product.product_name).toBe('Nutri Serum');
  });
});
