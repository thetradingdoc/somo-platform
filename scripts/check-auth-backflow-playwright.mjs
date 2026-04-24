import { chromium } from 'playwright';

const base = 'http://localhost:4000/patients';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

// Mock session validation endpoint as authenticated.
await page.route('**/api/patient/appointments', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, appointments: [] })
  });
});

try {
  // Seed a session before first page load.
  await page.addInitScript(() => {
    localStorage.setItem('patient_session_id', 'pw-session-e2e');
  });

  // Scenario A: direct open login (no prior page in history).
  await page.goto(`${base}/patient-login.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForURL('**/patients/appointments.html', { timeout: 15000 });
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
  const directBackUrl = page.url();

  // Scenario B (realistic): landing -> login -> appointments -> browser back.
  await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    window.location.href = '/patients/patient-login.html';
  });
  await page.waitForURL('**/patients/appointments.html', { timeout: 15000 });
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(900);
  const realisticBackUrl = page.url();
  const bouncedBackToAppointments = realisticBackUrl.includes('/patients/appointments.html');

  console.log(JSON.stringify({ directBackUrl, realisticBackUrl, bouncedBackToAppointments }));
} finally {
  await browser.close();
}
