'use strict';

describe('somo-demo-handler', () => {
  const origEnabled = process.env.DODGECALL_DEMO_ENABLED;

  afterEach(() => {
    if (origEnabled !== undefined) process.env.DODGECALL_DEMO_ENABLED = origEnabled;
    else delete process.env.DODGECALL_DEMO_ENABLED;
    jest.resetModules();
  });

  test('isSomoDemoDemoConnection requires flag and call_type', () => {
    process.env.DODGECALL_DEMO_ENABLED = '1';
    const { isSomoDemoDemoConnection } = require('../webhooks/somo-demo-handler');

    const demoConn = {
      callMetadata: {
        metadata: { call_type: 'somo_demo' }
      }
    };
    expect(isSomoDemoDemoConnection(demoConn)).toBe(true);

    const prodConn = {
      callMetadata: {
        metadata: { call_type: 'inbound' }
      }
    };
    expect(isSomoDemoDemoConnection(prodConn)).toBe(false);
  });

  test('isSomoDemoDemoConnection false when demo disabled', () => {
    process.env.DODGECALL_DEMO_ENABLED = '0';
    const { isSomoDemoDemoConnection } = require('../webhooks/somo-demo-handler');
    const demoConn = {
      callMetadata: { metadata: { call_type: 'somo_demo' } }
    };
    expect(isSomoDemoDemoConnection(demoConn)).toBe(false);
  });
});
