// @ts-check
const { test, expect } = require('@playwright/test');
const db = require('../database');
const {
  middlewareUp,
  browserContextWithCustomer,
  ensureAuthenticatedCustomer
} = require('./helpers/provider-auth.cjs');

test.describe('Voice agent page', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) {
      test.skip(true, 'Middleware not running on PW_API_BASE_URL (default http://127.0.0.1:4000)');
    }
  });

  test('agent.html loads control center markup', async ({ page }) => {
    await page.goto('/unified-dashboard/business/agent.html');
    await expect(page.locator('#vaPhone')).toBeVisible();
    await expect(page.locator('#vaToggle')).toBeVisible();
    await expect(page.locator('#vaKpiCalls')).toBeVisible();
    await expect(page.locator('#vaGreeting')).toBeVisible();
  });

  test('voice-setup.html shows step 1 when authenticated', async ({ playwright, request }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    const { browser, page } = await browserContextWithCustomer(playwright, request, customer);
    try {
      await page.goto('/unified-dashboard/business/voice-setup.html');
      await expect(page.locator('#setupTitle')).toContainText('greeting', { ignoreCase: true });
      await expect(page.locator('#setupGreeting')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('trial activation links to voice setup', async ({ playwright, request }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    const { browser, page } = await browserContextWithCustomer(playwright, request, customer);
    try {
      await page.goto('/unified-dashboard/business/trial-activation.html');
      const cta = page.locator('#activationAgent');
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute('href', /voice-setup\.html/);
    } finally {
      await browser.close();
    }
  });

  test('agent.html redirects trial user without setup to voice-setup', async ({
    playwright,
    request
  }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    const { browser, page } = await browserContextWithCustomer(playwright, request, customer);
    try {
      await page.goto('/unified-dashboard/business/agent.html');
      await page.waitForURL(/voice-setup\.html/, { timeout: 15000 });
      await expect(page.locator('#setupTitle')).toContainText('greeting', { ignoreCase: true });
    } finally {
      await browser.close();
    }
  });

  test('voice-setup 3-step wizard completes to agent.html', async ({ playwright, request }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    const { browser, page } = await browserContextWithCustomer(playwright, request, customer);

    await page.route('**/api/voice-agent/settings**', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            settings: {
              enabled: true,
              greeting: 'Hi from E2E',
              after_hours_message: 'We are closed.',
              business_hours: { mon: '09:00-17:00', tue: '09:00-17:00' },
              retell_agent_id: customer.retell_agent_id || null
            }
          })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'saved' })
      });
    });

    await page.route('**/api/voice-agent/setup-complete**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    });

    await page.route('**/api/voice-billing/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          billing: { twilio_phone_number: customer.twilio_phone_number || '+15551234567' }
        })
      });
    });

    try {
      await page.goto('/unified-dashboard/business/voice-setup.html');
      await expect(page.locator('#setupTitle')).toContainText('greeting', { ignoreCase: true });
      await page.locator('#setupGreeting').fill('Hi, this is our E2E greeting.');
      await page.locator('#setupNext1').click();
      await expect(page.locator('#setupTitle')).toContainText('hours', { ignoreCase: true });
      await page.locator('#setupNext2').click();
      await expect(page.locator('#setupTitle')).toContainText('line', { ignoreCase: true });
      await page.locator('#setupFinish').click();
      await page.waitForURL(/agent\.html/, { timeout: 15000 });
      await expect(page.locator('#vaGreeting')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('kelly toggle updates status badge', async ({ playwright, request }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    db.updateCustomer(customer.id, {
      voice_setup_completed_at: new Date().toISOString(),
      kelly_status: 'active',
      retell_agent_status: 'active'
    });
    const fresh = db.getCustomer(customer.id);
    const { browser, page } = await browserContextWithCustomer(playwright, request, fresh);

    let toggleEnabled = true;
    await page.route('**/api/kelly/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: toggleEnabled ? 'active' : 'paused',
          phone_number: '+15551234567'
        })
      });
    });

    await page.route('**/api/kelly/toggle**', async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        toggleEnabled = !!body.enabled;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: toggleEnabled ? 'active' : 'paused',
            message: 'ok'
          })
        });
      }
      return route.continue();
    });

    await page.route('**/api/voice-billing/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, billing: {} })
      });
    });

    await page.route('**/api/voice-agent/settings**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, settings: { enabled: toggleEnabled } })
      });
    });

    await page.route('**/api/customer/dashboard/agent/stats**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          stats: { calls_today: 0, avg_duration_seconds_today: 0, appts_booked_today: 0 },
          recent_calls: []
        })
      });
    });

    await page.route('**/api/customer/agent/prompt**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, prompt: 'test' })
      });
    });

    try {
      await page.goto('/unified-dashboard/business/agent.html');
      await expect(page.locator('#vaStatusBadge')).toHaveText('Active');
      await page.locator('#vaToggle').click();
      await expect(page.locator('#vaStatusBadge')).toHaveText('Paused');
      await page.locator('#vaToggle').click();
      await expect(page.locator('#vaStatusBadge')).toHaveText('Active');
    } finally {
      await browser.close();
    }
  });

  test('recent calls render caller_label and PA badge from stats API', async ({ page }) => {
    await page.route('**/api/customer/dashboard/agent/stats**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          stats: {
            total_calls: 1,
            calls_today: 1,
            avg_duration_seconds_today: 90,
            appts_booked_today: 0,
            total_cost: 0,
            cost_today: 0
          },
          recent_calls: [
            {
              id: 'c1',
              call_id: 'call_test',
              status: 'completed',
              outcome: 'pa_flagged',
              duration_seconds: 90,
              created_at: new Date().toISOString(),
              caller_label: 'Maria Lopez'
            }
          ]
        })
      });
    });

    await page.goto('/unified-dashboard/business/agent.html');
    await expect(page.locator('#vaCallList')).toContainText('Maria Lopez');
    await expect(page.locator('.va-outcome-pa_flagged')).toContainText('PA flagged');
  });
});
