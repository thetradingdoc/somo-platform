import { chromium } from 'playwright';

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const PAGE_URL = process.env.PATIENT_CALENDAR_URL || `${API_BASE}/patients/schedule.html`;
const SESSION = process.env.PATIENT_TEST_SESSION_ID || 'pw-debug';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((sid) => {
    localStorage.setItem('patient_session_id', sid);
    localStorage.setItem('journal_calendar_v2', 'true');
  }, SESSION);
  const page = await context.newPage();
  try {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(900);

    const calVisible = await page.isVisible('#journalCalendarPanel');
    if (!calVisible) throw new Error('journal calendar panel not visible');

    await page.click('#listViewBtn');
    await page.waitForTimeout(250);
    const listVisible = await page.isVisible('#checkinListPanel.show');
    if (!listVisible) throw new Error('list view panel not active');

    await page.click('#photosViewBtn');
    await page.waitForTimeout(250);
    const photosVisible = await page.isVisible('#journalPhotoStrip.show');
    if (!photosVisible) throw new Error('photos view panel not active');

    await page.click('#calendarViewBtn');
    await page.waitForTimeout(250);
    const dayLink = await page.locator('#journalMonthStack a.journal-day:not(.journal-day--empty)').first();
    const href = await dayLink.getAttribute('href');
    if (!href || !href.includes('appointments.html?journal_date=')) {
      throw new Error('day tile does not link to routine day detail');
    }

    console.log(JSON.stringify({ ok: true, page: PAGE_URL, dayHref: href }));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
