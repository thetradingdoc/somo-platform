#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CARD_COUNT = 3;

async function auditViewport(viewport, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  const cards = page.locator('.payor-flip-card');
  const total = await cards.count();
  const checks = [];

  for (let i = 0; i < Math.min(CARD_COUNT, total); i += 1) {
    const card = cards.nth(i);
    const title = (await card.locator('.payor-card-title').first().textContent() || '').trim();
    await card.locator('.payor-card-link--flip').click();
    await page.waitForTimeout(250);

    const back = card.locator('.payor-card-back');
    const statLabels = (await back.locator('.payor-card-stat-label').allTextContents()).map((s) => s.trim());
    const ratingText = ((await back.locator('.payor-card-stat').nth(1).locator('.payor-card-stat-value').textContent()) || '').trim();
    const approvalText = ((await back.locator('.payor-card-stat').nth(3).locator('.payor-card-stat-value').textContent()) || '').trim();
    const coverageCount = await back.locator('.payor-card-coverage-section .payor-card-tag').count();
    const hasMissing = (await back.locator('.payor-card-missing-alert').count()) > 0;
    const hasSuccess = (await back.locator('.payor-card-covered-alert').count()) > 0;
    const footerBtns = (await back.locator('.payor-card-back-actions button').allTextContents()).map((s) => s.trim());

    const gaps = [
      !(statLabels.includes('Monthly cost') && statLabels.includes('Rating') && statLabels.includes('Yearly max') && statLabels.includes('Prior approval'))
        ? 'missing_stat_labels'
        : null,
      !/^\d\.\d\s\/\s5\.0$/.test(ratingText) ? 'rating_format_not_template' : null,
      !/(Low burden|Medium burden|High burden)/.test(approvalText) ? 'approval_format_not_template' : null,
      coverageCount === 0 ? 'coverage_section_empty' : null,
      !(hasMissing || hasSuccess) ? 'missing_or_success_block_absent' : null,
      !(footerBtns[0] && footerBtns[0].includes('View full details')) ? 'cta_copy_mismatch' : null,
      !(footerBtns[1] && footerBtns[1] === 'Back') ? 'back_button_missing' : null
    ].filter(Boolean);

    checks.push({ title, statLabels, ratingText, approvalText, coverageCount, hasMissing, hasSuccess, footerBtns, gaps });
  }

  await page.screenshot({ path: `./.tmp-back-audit-${label}.png`, fullPage: false });
  await browser.close();
  return { label, viewport, totalChecked: checks.length, checks };
}

async function main() {
  const desktop = await auditViewport({ width: 1365, height: 900 }, 'desktop');
  const mobile = await auditViewport({ width: 390, height: 844 }, 'mobile');
  const report = { baseUrl: BASE_URL, desktop, mobile };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const anyGaps = [...desktop.checks, ...mobile.checks].some((check) => check.gaps.length > 0);
  if (anyGaps) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
