import { chromium } from 'playwright';

const BASE_URL = process.env.PATIENT_BASE_URL || 'http://127.0.0.1:4000';
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1366, height: 900 };

function buildJsonResponse(payload) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem('patient_session_id', 'pw-test-session');
    localStorage.setItem('patient_phone', '+15555555555');
  });

  await page.route('**/api/patient/intake', async (route) => {
    await route.fulfill(buildJsonResponse({
      success: true,
      intake: {
        first_name: 'Jeremiah',
        last_name: 'Patient',
        dob: '1990-01-01',
        phone: '+15555555555',
        email: 'jeremiah@example.com',
        address: {
          country: 'US',
          city: 'Austin',
          line1: '100 Main St',
          postal_code: '78701'
        }
      }
    }));
  });

  await page.route('**/api/patient/my-records', async (route) => {
    await route.fulfill(buildJsonResponse({
      success: true,
      records: [
        { id: 'r1', created_at: '2026-04-23', summary: 'Follow-up complete' }
      ]
    }));
  });

  await page.route('**/api/patient/documents', async (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      await route.fulfill(buildJsonResponse({ success: true, uploaded: 1 }));
      return;
    }
    await route.fulfill(buildJsonResponse({
      success: true,
      documents: [{ id: 'd1', file_name: 'lab.pdf', created_at: '2026-04-23', status: 'available' }],
      documentReferences: []
    }));
  });

  await page.route('**/api/patient/documents/*/download', async (route) => {
    await route.fulfill(buildJsonResponse({ success: true, url: 'https://example.com/mock-download' }));
  });

  await page.route('**/api/patient/shelf/products', async (route) => {
    await route.fulfill(buildJsonResponse({
      success: true,
      products: [
        { shelf_product_id: 'p1', product_name: 'Cleanser', inventory_status: 'stock', badge_initials: 'CL', badge_color: '#314DB6' }
      ]
    }));
  });

  await page.route('**/api/patient/health/catalog', async (route) => {
    await route.fulfill(buildJsonResponse({ success: true, catalog_ok: true }));
  });

  await page.route('**/api/**', async (route) => {
    await route.fulfill(buildJsonResponse({ success: true }));
  });

  const results = [];

  // 1) Profile discoverability in bottom nav
  await page.goto(`${BASE_URL}/patients/profile.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#patientBottomTabs');
  const profileTab = page.locator('#patientBottomTabs .tab .label', { hasText: 'Profile' });
  const profileVisible = await profileTab.first().isVisible();
  results.push({
    check: 'Profile discoverability in bottom nav',
    passed: profileVisible
  });

  // 2) Wallet tab visibility + active state
  await page.goto(`${BASE_URL}/patients/wallet.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#patientBottomTabs');
  const walletTab = page.locator('#patientBottomTabs .tab', { hasText: 'Wallet' });
  const walletVisible = await walletTab.first().isVisible();
  const walletActive = await walletTab.first().evaluate((el) => el.classList.contains('active'));
  results.push({
    check: 'Wallet tab visible',
    passed: walletVisible
  });
  results.push({
    check: 'Wallet tab active on wallet page',
    passed: walletActive
  });

  // 3) Products showing only products content
  await page.goto(`${BASE_URL}/patients/my-records.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#shelfGrid', { state: 'attached' });
  const productsTitleVisible = await page.getByRole('heading', { name: 'Products' }).isVisible();
  const legacySectionsHidden = await page.locator('.records-legacy').evaluateAll((els) =>
    els.length > 0 && els.every((el) => window.getComputedStyle(el).display === 'none')
  );
  const legacyCaseReportsVisible = await page.getByRole('heading', { name: 'Case reports' }).isVisible().catch(() => false);
  const legacyRecordsCenterVisible = await page.locator('text=Records center').isVisible().catch(() => false);
  results.push({
    check: 'Products heading visible',
    passed: productsTitleVisible
  });
  results.push({
    check: 'Legacy records sections are hidden',
    passed: legacySectionsHidden
  });
  results.push({
    check: 'Case reports hidden',
    passed: !legacyCaseReportsVisible
  });
  results.push({
    check: 'Records center hidden',
    passed: !legacyRecordsCenterVisible
  });

  // 4) Products IA tabs present
  const expectedTabs = ['Products', 'Info', 'Saved Scans', 'Informations'];
  for (const tabName of expectedTabs) {
    const tabVisible = await page.locator('.products-tab', { hasText: tabName }).first().isVisible().catch(() => false);
    results.push({
      check: `Products tab visible: ${tabName}`,
      passed: tabVisible
    });
  }

  // 5) Products page non-blank by viewport (mobile + desktop)
  const isProductsNonBlank = async (targetPage) => {
    const heading = await targetPage.getByRole('heading', { name: 'Products' }).isVisible().catch(() => false);
    const cards = await targetPage.locator('.dashboard-card, .products-pane, #shelfGrid .journal-product-card').count();
    return heading && cards > 0;
  };

  const mobileNonBlank = await isProductsNonBlank(page);
  results.push({
    check: 'Products page non-blank (mobile viewport)',
    passed: mobileNonBlank
  });

  const desktopContext = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.addInitScript(() => {
    localStorage.setItem('patient_session_id', 'pw-test-session');
    localStorage.setItem('patient_phone', '+15555555555');
  });
  await desktopPage.route('**/api/**', async (route) => {
    await route.fulfill(buildJsonResponse({ success: true, products: [] }));
  });
  await desktopPage.goto(`${BASE_URL}/patients/my-records.html`, { waitUntil: 'domcontentloaded' });
  await desktopPage.waitForSelector('#shelfGrid', { state: 'attached' });
  const desktopNonBlank = await isProductsNonBlank(desktopPage);
  results.push({
    check: 'Products page non-blank (desktop viewport)',
    passed: desktopNonBlank
  });
  await desktopContext.close();

  console.log('Playwright IA mobile checks');
  for (const item of results) {
    console.log(`- ${item.passed ? 'PASS' : 'FAIL'}: ${item.check}`);
  }

  const failed = results.filter((r) => !r.passed);
  await browser.close();
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
