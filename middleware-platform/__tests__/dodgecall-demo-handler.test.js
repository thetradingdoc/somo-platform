'use strict';

describe('dodgecall-demo-handler', () => {
  const origEnabled = process.env.DODGECALL_DEMO_ENABLED;

  afterEach(() => {
    if (origEnabled !== undefined) process.env.DODGECALL_DEMO_ENABLED = origEnabled;
    else delete process.env.DODGECALL_DEMO_ENABLED;
    jest.resetModules();
  });

  test('isDodgecallDemoConnection requires flag and call_type', () => {
    process.env.DODGECALL_DEMO_ENABLED = '1';
    const { isDodgecallDemoConnection } = require('../webhooks/dodgecall-demo-handler');

    const demoConn = {
      callMetadata: {
        metadata: { call_type: 'dodgecall_demo' }
      }
    };
    expect(isDodgecallDemoConnection(demoConn)).toBe(true);

    const prodConn = {
      callMetadata: {
        metadata: { call_type: 'inbound' }
      }
    };
    expect(isDodgecallDemoConnection(prodConn)).toBe(false);
  });

  test('isDodgecallDemoConnection false when demo disabled', () => {
    process.env.DODGECALL_DEMO_ENABLED = '0';
    const { isDodgecallDemoConnection } = require('../webhooks/dodgecall-demo-handler');
    const demoConn = {
      callMetadata: { metadata: { call_type: 'dodgecall_demo' } }
    };
    expect(isDodgecallDemoConnection(demoConn)).toBe(false);
  });
});
