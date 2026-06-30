import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatOpqrstSection, hasThinReport, OPQRST_LABELS } from './reportFormatters.js';
import { saveSession, getStoredSession, clearSession, saveConsent, getConsent, saveJourney, getJourney } from './healthStorage.js';

describe('reportFormatters', () => {
  it('formats OPQRST keys to labeled rows', () => {
    const rows = formatOpqrstSection({
      onset: '2 days ago',
      region: 'left arm'
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ key: 'onset', label: OPQRST_LABELS.onset, value: '2 days ago' });
  });

  it('detects thin reports', () => {
    expect(hasThinReport(null)).toBe(true);
    expect(hasThinReport({ summary: 'A real summary' })).toBe(false);
  });
});

describe('healthStorage', () => {
  beforeEach(() => clearSession());
  afterEach(() => clearSession());

  it('persists session round-trip', () => {
    saveSession({ sessionId: 'abc', sessionToken: 'tok' });
    expect(getStoredSession().sessionId).toBe('abc');
  });

  it('persists consent', () => {
    saveConsent({ locale: 'en', terms_version: '2026-06-25' });
    expect(getConsent().locale).toBe('en');
  });

  it('persists journey state', () => {
    saveJourney({ locale: 'en', terms_accepted: true });
    expect(getJourney().locale).toBe('en');
  });
});
