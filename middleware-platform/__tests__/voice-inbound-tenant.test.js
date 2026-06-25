'use strict';

const {
  resolveInboundRetellAgent,
  isResolvedSaasTenant,
  buildMissingRetellTwiml
} = require('../services/voice-inbound-tenant');

describe('voice-inbound-tenant', () => {
  const defaultAgent = 'agent_default';

  beforeEach(() => {
    process.env.SAAS_VOICE_FAIL_CLOSED = '1';
  });

  test('SaaS tenant without retell_agent_id fails closed', () => {
    const r = resolveInboundRetellAgent({
      matchedCustomer: { id: 'c1', customer_type: 'saas', retell_agent_id: null },
      customerId: 'c1',
      isOutboundSales: false,
      currentRetellAgentId: defaultAgent,
      defaultAgentId: defaultAgent
    });
    expect(r.failClosed).toBe(true);
    expect(r.reason).toBe('missing_retell_agent');
  });

  test('SaaS tenant with retell_agent_id uses tenant agent', () => {
    const r = resolveInboundRetellAgent({
      matchedCustomer: { id: 'c1', customer_type: 'saas', retell_agent_id: 'agent_tenant' },
      customerId: 'c1',
      isOutboundSales: false,
      currentRetellAgentId: defaultAgent
    });
    expect(r.failClosed).toBe(false);
    expect(r.retellAgentId).toBe('agent_tenant');
  });

  test('active trial without retell fails closed', () => {
    expect(isResolvedSaasTenant({ trial_status: 'active' })).toBe(true);
    const r = resolveInboundRetellAgent({
      matchedCustomer: { id: 'c2', trial_status: 'active' },
      customerId: 'c2',
      isOutboundSales: false,
      currentRetellAgentId: defaultAgent
    });
    expect(r.failClosed).toBe(true);
  });

  test('outbound sales keeps current agent', () => {
    const r = resolveInboundRetellAgent({
      matchedCustomer: null,
      customerId: null,
      isOutboundSales: true,
      currentRetellAgentId: 'agent_sales'
    });
    expect(r.failClosed).toBe(false);
    expect(r.retellAgentId).toBe('agent_sales');
  });

  test('legacy clinic without SaaS uses fallback when fail-closed off path', () => {
    const r = resolveInboundRetellAgent({
      matchedCustomer: { id: 'c3', customer_type: 'api' },
      customerId: 'c3',
      isOutboundSales: false,
      currentRetellAgentId: defaultAgent
    });
    expect(r.failClosed).toBe(false);
    expect(r.retellAgentId).toBe(defaultAgent);
  });

  test('SAAS_VOICE_FAIL_CLOSED=0 allows default agent for SaaS', () => {
    process.env.SAAS_VOICE_FAIL_CLOSED = '0';
    const r = resolveInboundRetellAgent({
      matchedCustomer: { id: 'c1', customer_type: 'saas' },
      customerId: 'c1',
      isOutboundSales: false,
      currentRetellAgentId: defaultAgent
    });
    expect(r.failClosed).toBe(false);
    expect(r.retellAgentId).toBe(defaultAgent);
  });

  test('buildMissingRetellTwiml returns hangup TwiML', () => {
    const twiml = buildMissingRetellTwiml();
    expect(twiml).toMatch(/Hangup/);
  });
});
