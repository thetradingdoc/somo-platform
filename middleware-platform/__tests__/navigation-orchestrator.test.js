'use strict';

const { processNavigationTurn } = require('../services/navigation/navigation-orchestrator');
const { seedMetroHealthPlus } = require('../scripts/seed-navigation-demo.cjs');

describe('navigation-orchestrator patient navigator P1', () => {
  beforeAll(() => {
    seedMetroHealthPlus();
  });

  function makeConnection() {
    return {
      _navigationState: {},
      conversationHistory: [],
      clinic_id: null,
      customer_id: 'cust-navigation-demo'
    };
  }

  test('need-first flow asks for plan after care need', async () => {
    const connection = makeConnection();
    const reply = await processNavigationTurn({
      callId: 'call_test_1',
      connection,
      userSaid: 'my kid needs braces',
      db: require('../database')
    });
    expect(reply).toMatch(/health plan/i);
    expect(connection._navigationState.last_specialty).toBe('Orthodontics');
  });

  test('prompts for care need when plan given first without need', async () => {
    const connection = makeConnection();
    const reply = await processNavigationTurn({
      callId: 'call_test_2',
      connection,
      userSaid: 'Metro Health Plus',
      db: require('../database')
    });
    expect(reply).toMatch(/what kind of care|tell me what you need/i);
  });
});
