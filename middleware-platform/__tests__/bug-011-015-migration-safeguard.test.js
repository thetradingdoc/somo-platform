const fs = require('fs');
const path = require('path');

describe('BUG-011/015 migration safeguard', () => {
  it('applies 011 then 015 when rich-intake triage columns are missing', () => {
    const src = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
    const start = src.indexOf('Extra safeguard for BUG-011/015');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 2200);
    expect(block).toContain("require('./migrations/011_triage_rich_intake').up(db)");
    expect(block).toContain("require('./migrations/015_triage_rich_intake_phase1_columns').up(db)");
    expect(block).toContain('intake_complete_at');
  });

  it('keeps intake_complete_at persistence in upsertTriageSession', () => {
    const src = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
    const start = src.indexOf('module.exports.upsertTriageSession = function upsertTriageSession');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 5200);
    expect(block).toContain('SET intake_complete_at = COALESCE(?, intake_complete_at)');
  });
});
