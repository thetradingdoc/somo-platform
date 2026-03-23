/**
 * C12: checkBeforeScheduling is defense-in-depth vs DB triage gates — must still block on
 * conversation red flags when triage would otherwise pass.
 */
const { checkBeforeScheduling } = require('../services/triage-service');

describe('checkBeforeScheduling (defense-in-depth)', () => {
  it('blocks scheduling when user turn contains emergent pattern (even if DB triage were complete)', () => {
    const r = checkBeforeScheduling([
      { role: 'assistant', content: 'Thanks for completing triage.' },
      { role: 'user', content: 'Actually I have crushing chest pain and shortness of breath' }
    ]);
    expect(r.blockScheduling).toBe(true);
    expect(r.assessment.isEmergency).toBe(true);
  });

  it('does not block routine scheduling turns', () => {
    const r = checkBeforeScheduling([{ role: 'user', content: 'Book me for Tuesday at 10am please' }]);
    expect(r.blockScheduling).toBe(false);
  });
});
