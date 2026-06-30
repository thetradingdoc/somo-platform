'use strict';

const healthSessionService = require('../services/health-session-service');
const eligibilityService = require('../services/health-session-eligibility-service');
const routingService = require('../services/health-session-routing-service');

describe('health-session finance rails (P3 stub)', () => {
  const prevFinance = process.env.HEALTH_SESSION_FINANCE_ENABLED;
  const prevMock = process.env.HEALTH_SESSION_PAYMENT_MOCK;

  beforeAll(() => {
    process.env.HEALTH_SESSION_FINANCE_ENABLED = '1';
    process.env.HEALTH_SESSION_PAYMENT_MOCK = '1';
  });

  afterAll(() => {
    process.env.HEALTH_SESSION_FINANCE_ENABLED = prevFinance;
    process.env.HEALTH_SESSION_PAYMENT_MOCK = prevMock;
  });

  test('eligibility mock returns copay quote', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const routing = await eligibilityService.runEligibilityCheck(session.id, {
      urgency: 'routine_visit',
      pathway_summary: 'Routine dermatology visit'
    });
    expect(routing.eligible).toBe(true);
    expect(routing.copay_cents).toBeGreaterThan(0);
    expect(routing.payment_status).toBe('quoted');
  });

  test('route then mock pay marks session paid', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    await eligibilityService.runEligibilityCheck(session.id, { urgency: 'routine_visit' });
    const route = await routingService.createCopayRoute(session.id);
    expect(route.mock_payment).toBe(true);

    const paid = await routingService.mockPay(session.id);
    expect(paid.payment_status).toBe('paid');
    expect(paid.routing_status).toBe('confirmed');
  });

  test('stripe webhook path marks paid from health_session_id metadata', () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const routed = routingService.markPaidFromStripe(session.id, 'pi_test_123', 2500);
    expect(routed.payment_status).toBe('paid');
    expect(routed.stripe_payment_intent_id).toBe('pi_test_123');
  });
});
