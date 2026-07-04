'use strict';

/**
 * FD-228 — frontend nameplate class mapping (mirrors nameplate-status labels).
 */
describe('sfd-nameplate mapping', () => {
  const MODIFIER = {
    LIVE: 'live',
    PAUSED: 'paused',
    'COVERAGE-OFF': 'coverage-off',
    SHADOW: 'shadow',
    'MANUAL SYNC': 'manual-sync',
    CONNECTED: 'connected',
    'NEEDS REAUTH': 'reauth',
    'ACTION NEEDED': 'action-needed',
    ERROR: 'error',
    VERIFIED: 'connected',
    'LINK SENT': 'pending',
    'SYNC PENDING': 'manual-sync'
  };

  function nameplateClassForStatus(label) {
    const raw = String(label || '').trim().toUpperCase();
    const mod = MODIFIER[raw] || String(label || 'off').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `sfd-nameplate sfd-nameplate--${mod}`;
  }

  test('maps Kelly statuses', () => {
    expect(nameplateClassForStatus('LIVE')).toContain('--live');
    expect(nameplateClassForStatus('PAUSED')).toContain('--paused');
    expect(nameplateClassForStatus('COVERAGE-OFF')).toContain('--coverage-off');
    expect(nameplateClassForStatus('SHADOW')).toContain('--shadow');
  });

  test('maps integration statuses', () => {
    expect(nameplateClassForStatus('CONNECTED')).toContain('--connected');
    expect(nameplateClassForStatus('MANUAL SYNC')).toContain('--manual-sync');
    expect(nameplateClassForStatus('NEEDS REAUTH')).toContain('--reauth');
  });

  test('maps call chips', () => {
    expect(nameplateClassForStatus('VERIFIED')).toContain('--connected');
    expect(nameplateClassForStatus('SYNC PENDING')).toContain('--manual-sync');
  });
});
