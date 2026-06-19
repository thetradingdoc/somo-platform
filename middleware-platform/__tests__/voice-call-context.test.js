'use strict';

const {
  buildVoiceCallContext,
  canRunKelly,
  canPrepopulatePatient,
  canUseClinicId,
  effectiveClinicId,
  toRetellMetadata,
  resolveTenantClinicFromCallMeta
} = require('../services/voice-call-context');
const { SiteContextStatus } = require('../services/call-site-context');

describe('voice-call-context', () => {
  test('verified site allows Kelly and patient pre-pop', () => {
    const ctx = buildVoiceCallContext({
      site_context_status: SiteContextStatus.VERIFIED,
      clinic_id: 'clinic-a',
      clinic_id_source: 'did',
      customer_id: 'cust-1'
    });
    expect(canRunKelly(ctx)).toBe(true);
    expect(canPrepopulatePatient(ctx)).toBe(true);
    expect(effectiveClinicId(ctx)).toBe('clinic-a');
  });

  test('ambiguous site blocks Kelly and clinic id in metadata', () => {
    const ctx = buildVoiceCallContext({
      site_context_status: SiteContextStatus.AMBIGUOUS,
      clinic_id: 'clinic-heuristic',
      clinic_id_source: 'merchant_limit1'
    });
    expect(canRunKelly(ctx)).toBe(false);
    expect(canPrepopulatePatient(ctx)).toBe(false);
    expect(effectiveClinicId(ctx)).toBe(null);
    const meta = toRetellMetadata(ctx);
    expect(meta.clinic_id).toBeUndefined();
    expect(meta.site_context_status).toBe('ambiguous');
  });

  test('not_required allows Kelly without clinic', () => {
    const ctx = buildVoiceCallContext({
      site_context_status: SiteContextStatus.NOT_REQUIRED,
      call_type: 'operator_outbound'
    });
    expect(canRunKelly(ctx)).toBe(true);
    expect(canUseClinicId(ctx)).toBe(false);
  });

  test('missing site blocks Kelly', () => {
    const ctx = buildVoiceCallContext({ site_context_status: SiteContextStatus.MISSING });
    expect(canRunKelly(ctx)).toBe(false);
  });
});
