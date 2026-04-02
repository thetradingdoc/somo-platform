const KellyToolExecutor = require('../services/kelly-tool-executor');

describe('save_shipping_address noisy input coverage', () => {
  const providerId = 'merchant_c3d547a10f43eeec';
  const contextBase = {
    clinicId: 'clinic-default',
    patientId: null,
    callerPhone: null,
    channel: 'chat'
  };

  const cases = [
    { s: '1119 East Gun Hill Road, Bronx, NY 10465', mode: 'success', zip: '10465' },
    { s: '1119 East Gun Hill Road , Bronx NY 10465', mode: 'success', zip: '10465' },
    { s: '1119 East Gun Hill Road , Bronx NY !0465', mode: 'confirm', zip: '10465' },
    { s: '1119 East Gun Hill Road Bronx NY I0465', mode: 'confirm', zip: '10465' },
    { s: '1119 East Gun Hill Road Bronx NY l0465', mode: 'confirm', zip: '10465' },
    { s: '1119 East Gun Hill Road Bronx NY O0465', mode: 'confirm', zip: '00465' },
    { s: '1119 E Gun Hill Rd, Bronx, NY 10465', mode: 'success', zip: '10465' },
    { s: '1119 E Gun Hill Rd Bronx New York 10465', mode: 'failure' },
    { s: '1119 East Gun Hill Road, Bronx, New York 10465', mode: 'success', zip: '10465' },
    { s: '1119 east gun hill road, bronx, ny 10465', mode: 'success', zip: '10465' },
    { s: '1119 EAST GUN HILL ROAD BRONX NY 10465', mode: 'failure' },
    { s: '1119 East Gun Hill Road, Bronx NY 10465-1234', mode: 'success', zip: '10465-1234' },
    { s: '1119 East Gun Hill Road,,, Bronx, NY 10465', mode: 'success', zip: '10465' },
    { s: '1119 East Gun Hill Road - Bronx NY 10465', mode: 'success', zip: '10465' },
    { s: '1119 East Gun Hill Road Bronx,NY,10465', mode: 'success', zip: '10465' },
    { s: '1119 East Gun Hill Road | Bronx NY !0465', mode: 'confirm', zip: '10465' },
    { s: '1119 East Gun Hill Road Bronx Ny 10465', mode: 'failure' },
    { s: '1119 East Gun Hill Road Bronx NY 1O465', mode: 'confirm', zip: '10465' },
    { s: '1119 East Gun Hill Road Bronx NY 10!65', mode: 'confirm', zip: '10165' },
    { s: '1119 East Gun Hill Road Bronx NY 1046', ok: false },
    { s: '1119 East Gun Hill Road Bronx NY 104651', ok: false },
    { s: 'Bronx NY 10465', ok: false },
    { s: '1119 East Gun Hill Road, NY 10465', ok: false },
    { s: '1119 East Gun Hill Road Bronx 10465', ok: false },
    { s: '1119 East Gun Hill Road Bronx NY', ok: false },
    { s: 'just use same address as before', ok: false },
    { s: '10465 Bronx NY 1119 East Gun Hill Road', ok: false },
    { s: '1119 East Gun Hill Road, Bronx, NY !0465 apt 3A', mode: 'confirm', zip: '10465' },
    { s: '1119 East Gun Hill Road, Bronx, NY 10465.', mode: 'success', zip: '10465' },
    { s: '1119 East Gun Hill Road, Bronx, NY #10465', mode: 'success', zip: '10465' }
  ];
  const intlCases = [
    '10 Downing Street, London SW1A 2AA, UK',
    '1-1 Chiyoda, Tokyo 100-8111, Japan',
    'Piazza del Colosseo, 1, 00184 Roma RM, Italy',
    '200 Wellington St, Ottawa, ON K1A 0A9, Canada',
    'Pariser Platz, 10117 Berlin, Germany'
  ];

  test('critical noisy ZIP case is accepted and normalized', async () => {
    const out = await KellyToolExecutor.execute(
      'save_shipping_address',
      { provider_id: providerId, address_string: '1119 East Gun Hill Road , Bronx NY !0465' },
      { ...contextBase, sessionId: `noise_critical_${Date.now()}` }
    );
    expect(String(out?.error || '')).toBe('address_needs_confirmation');
    expect(String(out?.candidate_address?.postal_code || '')).toBe('10465');
  });

  test('30-case noise benchmark keeps high acceptance quality', async () => {
    let matched = 0;
    for (const [idx, c] of cases.entries()) {
      const out = await KellyToolExecutor.execute(
        'save_shipping_address',
        { provider_id: providerId, address_string: c.s },
        { ...contextBase, sessionId: `noise_case_${Date.now()}_${idx}_${Math.random()}` }
      );
      const mode = c.mode || (c.ok ? 'success' : 'failure');
      const success = !!(out && out.success);
      const needsConfirm = String(out?.error || '') === 'address_needs_confirmation';
      const acceptable =
        (mode === 'success' && success) ||
        (mode === 'confirm' && needsConfirm) ||
        (mode === 'failure' && !success);
      if (acceptable) {
        matched += 1;
      }
      if (c.zip && (success || needsConfirm)) {
        const resolvedZip = success ? out?.shipping_address?.postal_code : out?.candidate_address?.postal_code;
        expect(String(resolvedZip || '')).toBe(String(c.zip));
      }
    }
    const accuracy = matched / cases.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  test('international formats are rejected cleanly for current US-only parser', async () => {
    for (const [idx, s] of intlCases.entries()) {
      const out = await KellyToolExecutor.execute(
        'save_shipping_address',
        { provider_id: providerId, address_string: s },
        { ...contextBase, sessionId: `intl_case_${Date.now()}_${idx}_${Math.random()}` }
      );
      expect(out && out.success).toBe(false);
      expect(['address_parse_failed', 'invalid_postal_code', 'incomplete_address']).toContain(String(out?.error || ''));
    }
  });
});

