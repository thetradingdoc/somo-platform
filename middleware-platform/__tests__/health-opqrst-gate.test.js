'use strict';

const healthVideoOpqrst = require('../services/health-video-opqrst');

describe('health OPQRST accuracy gate', () => {
  test('captures region, onset, and fever negation from scripted utterances', () => {
    let meta = {};
    meta = healthVideoOpqrst.updateFromUtterance(meta, 'I have a red itchy rash on my neck');
    meta = healthVideoOpqrst.updateFromUtterance(meta, 'It started three days ago');
    meta = healthVideoOpqrst.updateFromUtterance(meta, 'No fever');

    expect(meta.negations.fever_absent).toBe(true);
    const report = healthVideoOpqrst.toReportSection(meta.opqrst, meta.negations);
    expect(report.region || report.R).toBeTruthy();
    expect(report.onset || report.O).toBeTruthy();
    expect(report.negations.fever_absent).toBe(true);
  });

  test('report section reflects metadata without LLM hallucination', () => {
    const meta = healthVideoOpqrst.updateFromUtterance({}, 'rash on neck for 3 days, no fever');
    const section = healthVideoOpqrst.toReportSection(meta.opqrst, meta.negations);
    expect(section.negations?.fever_absent).toBe(true);
    const serialized = JSON.stringify(section);
    expect(serialized).toMatch(/neck|rash/i);
  });
});
