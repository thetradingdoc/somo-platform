'use strict';

const { filterTools, getKellyTools, adaptToolsForTriagePolicy } = require('../services/kelly-rails/node-runner');

describe('Phase 3.15 front-desk tool descriptions', () => {
  test('dental disabled-triage tools omit run_triage_rag requirement text', () => {
    const names = ['collect_insurance', 'compute_visit_quote', 'get_available_slots'];
    const tools = filterTools(getKellyTools(), names);
    const adapted = adaptToolsForTriagePolicy(tools, 'disabled');
    for (const tool of adapted) {
      expect(tool.function.description.toLowerCase()).not.toMatch(/run_triage_rag/);
    }
    const collect = adapted.find((t) => t.function.name === 'collect_insurance');
    expect(collect.function.description).toMatch(/scheduling context/i);
  });
});
