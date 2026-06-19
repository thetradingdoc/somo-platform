'use strict';

const { resolveCallSiteContext, SiteContextStatus } = require('../services/call-site-context');
const { buildVoiceCallContext, canRunKelly } = require('../services/voice-call-context');

describe('LX-12 WS reconnect site revalidation', () => {
  test('heuristic clinic without DID is ambiguous and blocks Kelly', () => {
    const db = {
      db: {
        prepare: () => ({
          get: () => ({ clinic_id: 'clinic-heuristic' })
        })
      },
      getCustomerIdForClinic: () => 'cust-1',
      getClinicById: () => ({ merchant_id: 'm-1' }),
      getCustomer: () => ({ merchant_id: 'm-1' })
    };
    const reconnect = resolveCallSiteContext({
      db,
      to_number: '+15559999999',
      customer_id: 'cust-1',
      call_type: 'inbound_tenant',
      direction: 'inbound',
      allow_heuristic: true
    });
    expect(reconnect.site_context_status).toBe(SiteContextStatus.AMBIGUOUS);
    const vctx = buildVoiceCallContext({ siteContext: reconnect });
    expect(canRunKelly(vctx)).toBe(false);
  });

  test('verified DID wins over stale metadata clinic hint', () => {
    const db = {
      getClinicPhoneNumber: () => ({ clinic_id: 'clinic-did' }),
      getCustomerIdForClinic: () => 'cust-1',
      getClinicById: (id) => ({ id, merchant_id: 'm-1' }),
      getCustomer: () => ({ merchant_id: 'm-1' })
    };
    const resolved = resolveCallSiteContext({
      db,
      to_number: '+15551234000',
      customer_id: 'cust-1',
      call_type: 'inbound_tenant',
      direction: 'inbound',
      clinic_id: 'clinic-stale-metadata',
      clinic_id_source: 'metadata'
    });
    expect(resolved.clinic_id).toBe('clinic-did');
    expect(resolved.site_context_status).toBe(SiteContextStatus.VERIFIED);
  });
});
