'use strict';

jest.mock('../services/langsmith-trace-service', () => ({
  startTrace: jest.fn().mockResolvedValue(null),
  endTrace: jest.fn().mockResolvedValue(undefined)
}));

describe('step10-graph stub mode', () => {
  const OLD = process.env.STEP10_GRAPH_ENABLED;

  afterEach(() => {
    process.env.STEP10_GRAPH_ENABLED = OLD;
    jest.resetModules();
  });

  test('invokeStep10 returns stub when disabled', async () => {
    process.env.STEP10_GRAPH_ENABLED = 'false';
    const { invokeStep10 } = require('../services/step10-graph');
    const out = await invokeStep10({ patient_id: 'pat-1', inputs: { note: 'x' } });
    expect(out.success).toBe(true);
    expect(out.stub).toBe(true);
    expect(out.layer_trace).toEqual([]);
  });
});
