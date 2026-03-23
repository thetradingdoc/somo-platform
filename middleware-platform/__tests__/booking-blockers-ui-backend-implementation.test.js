const fs = require('fs');
const path = require('path');

describe('§7.9 booking blocker matrix', () => {
  it('defines owner + status mapping and phase coverage', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../docs/architecture/BOOKING_BLOCKER_MATRIX.md'), 'utf8');
    expect(src).toContain('Phase 1 - Get Slots');
    expect(src).toContain('Phase 2 - Schedule');
    expect(src).toContain('Phase 3 - Checkout');
    expect(src).toContain('Phase 4 - Verify and Pay');
    expect(src).toContain('Infrastructure');
    expect(src).toContain('| Owner | Status |');
  });
});

describe('§7.10 UI closures', () => {
  it('adds calendar discoverability and dual booking entry points', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '../../unified-dashboard/patients/patient-dashboard.html'), 'utf8');
    const appts = fs.readFileSync(path.join(__dirname, '../../unified-dashboard/patients/appointments.html'), 'utf8');
    const book = fs.readFileSync(path.join(__dirname, '../../unified-dashboard/patients/book.html'), 'utf8');
    expect(dashboard).toContain('href="schedule.html"');
    expect(appts).toContain('Pick from calendar');
    expect(book).toContain('Pick from calendar');
    expect(book).toContain('Book with guided chat');
  });

  it('hardens schedule handoff, retries, hold-expiry refresh, mobile chat, and async return path', () => {
    const schedule = fs.readFileSync(path.join(__dirname, '../../unified-dashboard/patients/schedule.html'), 'utf8');
    expect(schedule).toContain('slot?.date || slot?.start_time?.slice?.(0, 10)');
    expect(schedule).toContain('Retry loading times');
    expect(schedule).toContain('Try another date');
    expect(schedule).toContain('if (selectedDate) loadSlotsForDate(selectedDate);');
    expect(schedule).toContain('id="openChatModal" class="inline-flex');
    expect(schedule).toContain('visit_mode=async_review');
    expect(schedule).toContain('chatCodeEntry');
  });

  it('uses return-aware login redirects and async prefill in triage flow', () => {
    const triage = fs.readFileSync(path.join(__dirname, '../../unified-dashboard/patients/triage.html'), 'utf8');
    expect(triage).toContain('patient-login.html?expired=1&return=');
    expect(triage).toContain("visitModeParam === 'async_review'");
    expect(triage).toContain('returnToScheduleLink');
  });
});

describe('§7.11 backend BE4/BE5/BE8', () => {
  it('keeps patient checkout idempotency middleware (BE4)', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    expect(server).toContain("'/api/patient/appointments/:id/checkout'");
    expect(server).toContain("withIdempotency('patient_checkout')");
  });

  it('documents canonical Stripe webhook path and disables legacy path by default (BE5)', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const doc = fs.readFileSync(path.join(__dirname, '../docs/STRIPE_WEBHOOK_PATHS.md'), 'utf8');
    expect(server).toContain("app.use('/webhooks/stripe', stripeWebhookRouter)");
    expect(server).toContain("app.post('/webhook/stripe'");
    expect(server).toContain("ALLOW_LEGACY_STRIPE_WEBHOOK");
    expect(doc).toContain('POST /webhooks/stripe');
    expect(doc).toContain('Disabled by default');
  });

  it('validates IANA timezone across legacy voice/api booking routes (BE8)', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const startVoice = server.indexOf("app.post('/voice/appointments/available-slots'");
    const startApi = server.indexOf("app.get('/api/appointments/available-slots'");
    expect(startVoice).toBeGreaterThan(-1);
    expect(startApi).toBeGreaterThan(-1);
    expect(server.slice(startVoice, startVoice + 1200)).toContain('isValidIanaTimezone(timezone)');
    expect(server.slice(startApi, startApi + 1400)).toContain('isValidIanaTimezone(timezone)');
    expect(server).toContain("app.post('/api/patient/async-review'");
  });
});

