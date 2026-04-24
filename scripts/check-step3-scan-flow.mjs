import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
  localStorage.setItem('patient_session_id', 'pw-debug');
});

const page = await context.newPage();
try {
  await page.goto('http://localhost:4000/patients/onboarding.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    if (typeof window.setStep === 'function') window.setStep(3);
  });
  await page.waitForTimeout(200);
  const before = await page.isVisible('#manualProductSheet');
  await page.click('#scanProductBtn');
  const after = await page.isVisible('#manualProductSheet');
  const msg = await page.textContent('#msg');
  const buttons = await page.$$eval('#scanProductBtn,#describeDirectBtn', (els) =>
    els.map((e) => (e.textContent || '').trim())
  );
  console.log(JSON.stringify({ before, after, msg, buttons, url: page.url() }));
} finally {
  await browser.close();
}
