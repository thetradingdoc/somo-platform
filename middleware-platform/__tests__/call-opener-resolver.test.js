'use strict';

const {
  resolveCallOpeners,
  resolveFirstContactGreeting,
  buildDefaultInboundGreeting,
  buildDefaultOutboundOpener,
  prependAiDisclosure,
  buildAiDisclosureLine,
  isLegacyGenericGreeting,
  isManagedDefaultGreeting,
  greetingAsksForName,
  sanitizePersonName,
  sanitizePracticeName
} = require('../services/call-opener-resolver');

describe('call-opener-resolver', () => {
  test('prependAiDisclosure uses Russian line for ru locale', () => {
    const out = prependAiDisclosure("Hi, I'm Kelly.", { enabled: true, locale: 'ru' });
    expect(out).toMatch(/автоматическим помощником/i);
    expect(out).not.toMatch(/automated assistant/i);
  });

  test('prependAiDisclosure adds NY-style recording line', () => {
    const out = prependAiDisclosure('Hi, I am Kelly.', { enabled: true });
    expect(out).toMatch(/recorded/i);
    expect(out).toMatch(/automated assistant/i);
    expect(out).toContain('Kelly');
  });

  test('prependAiDisclosure skipped when disabled', () => {
    expect(prependAiDisclosure('Hello', { enabled: false })).toBe('Hello');
  });

  test('buildDefaultInboundGreeting uses Kelly and practice name', () => {
    const text = buildDefaultInboundGreeting('Bright Path Clinic', 'warm');
    expect(text).toContain('Kelly');
    expect(text).toContain('Bright Path Clinic');
    expect(text).toContain('Thank you for calling');
  });

  test('buildDefaultOutboundOpener differs from inbound', () => {
    const inbound = buildDefaultInboundGreeting('Bright Path Clinic');
    const outbound = buildDefaultOutboundOpener('Bright Path Clinic');
    expect(outbound).not.toContain('Thank you for calling');
    expect(outbound).toContain('good time');
    expect(inbound).not.toEqual(outbound);
  });

  test('resolveCallOpeners uses tenant inbound greeting for inbound calls', () => {
    const result = resolveCallOpeners({
      settings: { greeting: 'Custom inbound hello' },
      callType: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(result.activeOpener.direction).toBe('inbound');
    expect(result.activeOpener.text).toBe('Custom inbound hello');
  });

  test('resolveCallOpeners uses outbound opener for outbound calls', () => {
    const result = resolveCallOpeners({
      settings: {
        greeting: 'Custom inbound hello',
        outbound_opener: 'Custom outbound hello',
        outbound_enabled: true
      },
      callType: 'operator_outbound',
      direction: 'outbound'
    });
    expect(result.activeOpener.direction).toBe('outbound');
    expect(result.activeOpener.text).toBe('Custom outbound hello');
  });

  test('operator_outbound still gets opener when tenant outbound_enabled is false', () => {
    const result = resolveCallOpeners({
      settings: { outbound_enabled: false },
      callType: 'operator_outbound',
      direction: 'outbound'
    });
    expect(result.outbound.enabled).toBe(true);
    expect(result.outbound.text).toMatch(/Kelly/i);
    expect(result.activeOpener.direction).toBe('outbound');
  });

  test('tenant outbound disabled returns null outbound text for generic outbound type', () => {
    const result = resolveCallOpeners({
      settings: { outbound_enabled: false },
      callType: 'outbound',
      direction: 'outbound'
    });
    expect(result.outbound.enabled).toBe(false);
    expect(result.outbound.text).toBeNull();
  });

  test('sanitizePracticeName rejects bad values', () => {
    expect(sanitizePracticeName('Somo owner')).toBeNull();
    expect(sanitizePracticeName('Real Clinic')).toBe('Real Clinic');
  });

  test('isLegacyGenericGreeting detects old template', () => {
    expect(isLegacyGenericGreeting("Hi, you've reached X. I'm Kelly, your AI front desk.")).toBe(true);
    expect(isLegacyGenericGreeting('Hi, I am Kelly from Somo')).toBe(false);
  });

  test('inbound greeting is name-first (asks for the caller name)', () => {
    expect(buildDefaultInboundGreeting('Bright Path Clinic', 'warm')).toMatch(/your name|get your name/i);
    expect(buildDefaultInboundGreeting('Bright Path Clinic', 'concise')).toMatch(/your name/i);
    expect(buildDefaultInboundGreeting('Bright Path Clinic', 'professional')).toMatch(/your name/i);
  });

  test('non-operator tenant greeting has no Somo brand leak', () => {
    const text = buildDefaultInboundGreeting('Bright Path Clinic', 'warm');
    expect(text).not.toMatch(/Somo/i);
    expect(text).toContain('Bright Path Clinic');
  });

  test('operator keeps Somo branding', () => {
    const text = buildDefaultInboundGreeting('Somo', 'warm');
    expect(text).toContain("Somo's front desk receptionist");
    expect(text).toMatch(/your name/i);
  });

  test('warm_confident tone is name-first and brand-correct', () => {
    const tenant = buildDefaultInboundGreeting('Bright Path Clinic', 'warm_confident');
    expect(tenant).toContain('Bright Path Clinic');
    expect(tenant).not.toMatch(/Somo/i);
    expect(tenant).toMatch(/your name/i);

    const operator = buildDefaultInboundGreeting('Somo', 'warm_confident');
    expect(operator).toContain("Somo's front desk receptionist");

    const outbound = buildDefaultOutboundOpener('Bright Path Clinic', 'warm_confident');
    expect(outbound).toMatch(/time is valuable/i);
    expect(outbound).not.toMatch(/from Somo\b/i);
  });

  test('outbound for non-operator tenant does not claim to be from Somo', () => {
    const outbound = buildDefaultOutboundOpener('Bright Path Clinic', 'warm');
    expect(outbound).not.toMatch(/from Somo\b/i);
    expect(outbound).toContain('Bright Path Clinic');
  });

  test('asksName flag: true for default inbound, false for intent-first custom, false outbound/after-hours', () => {
    const def = resolveCallOpeners({
      settings: {},
      practiceName: 'Bright Path Clinic',
      callType: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(def.activeOpener.asksName).toBe(true);
    expect(def.inbound.asksName).toBe(true);

    const intentFirst = resolveCallOpeners({
      settings: { greeting: 'Welcome, how can I help you today?' },
      practiceName: 'Bright Path Clinic',
      callType: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(intentFirst.activeOpener.asksName).toBe(false);

    const customAsks = resolveCallOpeners({
      settings: { greeting: 'Hello! Can I get your name first?' },
      practiceName: 'Bright Path Clinic',
      callType: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(customAsks.activeOpener.asksName).toBe(true);

    const outbound = resolveCallOpeners({
      settings: { outbound_enabled: 1 },
      callType: 'operator_outbound',
      direction: 'outbound'
    });
    expect(outbound.activeOpener.asksName).toBe(false);
  });

  test('greetingAsksForName detects name-ask phrasing', () => {
    expect(greetingAsksForName('Can I start with your name?')).toBe(true);
    expect(greetingAsksForName('May I get your name?')).toBe(true);
    expect(greetingAsksForName('How can I help you today?')).toBe(false);
  });

  test('sanitizePersonName returns capitalized first token or null', () => {
    expect(sanitizePersonName('maria gomez')).toBe('Maria');
    expect(sanitizePersonName('  john  ')).toBe('John');
    expect(sanitizePersonName('x')).toBeNull();
    expect(sanitizePersonName('')).toBeNull();
  });

  test('resolveFirstContactGreeting: name-first when unknown, by-name when known, no Somo leak', () => {
    const unknown = resolveFirstContactGreeting({
      channel: 'chat',
      practiceName: 'Bright Path Clinic'
    });
    expect(unknown.asksName).toBe(true);
    expect(unknown.text).toMatch(/your name/i);
    expect(unknown.text).not.toMatch(/Somo/i);
    // chat softens voice-only phrasing
    expect(unknown.text).not.toMatch(/thank you for calling/i);

    const known = resolveFirstContactGreeting({
      channel: 'chat',
      practiceName: 'Bright Path Clinic',
      knownName: 'Maria Gomez'
    });
    expect(known.asksName).toBe(false);
    expect(known.text).toContain('Maria');
    expect(known.text).toContain('Bright Path Clinic');
    expect(known.source).toBe('known_name');
  });

  test('resolveFirstContactGreeting operator known-name greets with Somo', () => {
    const known = resolveFirstContactGreeting({
      channel: 'chat',
      practiceName: 'Somo',
      knownName: 'John'
    });
    expect(known.text).toContain('John');
    expect(known.text).toContain('Somo');
  });

  test('isManagedDefaultGreeting flags old intent-first defaults but not custom greetings', () => {
    expect(
      isManagedDefaultGreeting(
        "Hi, I'm Kelly, the front desk at Bright Path Clinic. Thank you for calling. How can I help you today?"
      )
    ).toBe(true);
    expect(
      isManagedDefaultGreeting(
        "Hi, I'm Kelly, Somo's front desk receptionist. Thank you for calling Somo. How can I help you today?"
      )
    ).toBe(true);
    expect(isManagedDefaultGreeting('Welcome to our spa, please hold for a moment.')).toBe(false);
    expect(isManagedDefaultGreeting('')).toBe(false);
  });
});
