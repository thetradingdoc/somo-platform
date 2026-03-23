/**
 * impl-7: Retell handleScheduleAppointment must run checkBeforeScheduling before HTTP to /voice/appointments/schedule
 * (defense-in-depth vs DB triage — §2 / §6.4).
 */
const fs = require('fs');
const path = require('path');

describe('Retell handleScheduleAppointment defense-in-depth', () => {
  it('invokes checkBeforeScheduling before POST /voice/appointments/schedule', () => {
    const src = fs.readFileSync(path.join(__dirname, '../webhooks/retell-websocket.js'), 'utf8');
    const start = src.indexOf('async handleScheduleAppointment(callId, args)');
    expect(start).toBeGreaterThan(-1);
    const sub = src.slice(start, start + 15000);
    const idxCheck = sub.indexOf('checkBeforeScheduling');
    expect(idxCheck).toBeGreaterThan(-1);
    // HTTP URL may appear earlier in the file slice; require schedule URL after the defense-in-depth check
    const idxHttpAfterCheck = sub.indexOf('/voice/appointments/schedule', idxCheck);
    expect(idxHttpAfterCheck).toBeGreaterThan(idxCheck);
  });
});
