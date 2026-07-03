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

  test('agent.html loads control center markup', async ({ playwright, request }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    db.updateCustomer(customer.id, {
      voice_setup_completed_at: new Date().toISOString(),
      kelly_status: 'active'
    });
    const fresh = db.getCustomer(customer.id);
    const { browser, page } = await browserContextWithCustomer(playwright, request, fresh);

    await page.route('**/api/voice-agent/onboarding**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          onboarding_state: 'voice_setup_complete',
          destination: { path: '/business/agent.html' }
        })
      });
    });
    await page.route('**/api/kelly/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: 'active',
          phone_number: '+15551234567'
        })
      });
    });
    await page.route('**/api/voice-billing/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          billing: { twilio_phone_number: '+15551234567' }
        })
      });
    });
    await page.route('**/api/voice-agent/settings**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          settings: { enabled: true, greeting: 'Hi from E2E' }
        })
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
    await page.route('**/api/voice-agent/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          nameplate: 'LIVE',
          label: 'LIVE',
          enabled: true
        })
      });
    });
    await page.route('**/api/rcm/collection-queue**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, collection_queue: [] })
      });
    });

    try {
      await page.goto('/business/agent.html');
      await expect(page.locator('#vaPhone')).toBeVisible();
      await expect(page.locator('#vaToggle')).toBeVisible();
      await expect(page.locator('#vaKpiCalls')).toBeVisible();
      await expect(page.locator('#vaStatusNameplate .sfd-nameplate')).toBeVisible({
        timeout: 15_000
      });
    } finally {
      await browser.close();
    }
  });

  test('voice-setup.html shows step 1 when authenticated', async ({ playwright, request }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    const { browser, page } = await browserContextWithCustomer(playwright, request, customer);
    try {
      await page.goto('/business/voice-setup.html');
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
      await page.goto('/business/trial-activation.html');
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
      await page.route('**/api/voice-agent/onboarding**', async (route) => {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            onboarding_state: 'voice_setup_incomplete',
            destination: { path: '/business/voice-setup.html?step=1', wizard_step: 1 }
          })
        });
      });
      await page.goto('/business/agent.html');
      await page.waitForURL(/voice-setup\.html/, { timeout: 15000 });
      await expect(page.locator('#setupTitle')).toContainText('practice', { ignoreCase: true });
    } finally {
      await browser.close();
    }
  });

  test('voice-setup 6-step wizard completes to go-live checklist', async ({ playwright, request }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    const { browser, page } = await browserContextWithCustomer(playwright, request, customer);

    await page.route('**/api/voice-agent/onboarding**', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            onboarding_state: 'voice_setup_incomplete',
            destination: { path: '/business/voice-setup.html?step=1' }
          })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, onboarding_state: 'voice_setup_incomplete' })
      });
    });

    await page.route('**/api/voice-agent/preview**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          preview: {
            inbound: { text: 'Hi from preview' },
            outbound: { text: null, enabled: false }
          },
          sync_status: 'synced'
        })
      });
    });

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
      await page.goto('/business/voice-setup.html');
      await expect(page.locator('#setupTitle')).toContainText('practice', { ignoreCase: true });
      await page.locator('#setupPracticeName').fill('E2E Practice');
      await page.locator('#setupTransferNumber').fill('+12025550100');
      await page.locator('#setupNext1').click();
      await expect(page.locator('#setupTitle')).toContainText('calendar', { ignoreCase: true });
      await page.locator('#setupUseSomoCal').click();
      await page.locator('#setupNext2').click();
      await expect(page.locator('#setupTitle')).toContainText('greeting', { ignoreCase: true });
      await page.locator('#setupGreeting').fill('Hi, this is our E2E greeting.');
      await page.locator('#setupNext3').click();
      await expect(page.locator('#setupTitle')).toContainText('hours', { ignoreCase: true });
      await page.locator('#setupNext4').click();
      await expect(page.locator('#setupTitle')).toContainText('outbound', { ignoreCase: true });
      await page.locator('#setupNext5').click();
      await expect(page.locator('#setupTitle')).toContainText('test', { ignoreCase: true });
      await page.locator('#setupFinish').click();
      await page.waitForURL(/today\.html.*go-live-checklist/, { timeout: 15000 });
      await expect(page.locator('#go-live-checklist')).toBeVisible();
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

    await page.route('**/api/voice-agent/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          nameplate: toggleEnabled ? 'LIVE' : 'PAUSED',
          label: toggleEnabled ? 'LIVE' : 'PAUSED',
          enabled: toggleEnabled
        })
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
      await page.goto('/business/agent.html');
      await expect(page.locator('#vaStatusNameplate .sfd-nameplate--live')).toBeVisible();
      await page.locator('#vaToggle').click();
      await expect(page.locator('#vaStatusNameplate .sfd-nameplate--paused')).toBeVisible();
      await page.locator('#vaToggle').click();
      await expect(page.locator('#vaStatusNameplate .sfd-nameplate--live')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('recent calls render caller_label and PA badge from stats API', async ({
    playwright,
    request
  }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    db.updateCustomer(customer.id, {
      voice_setup_completed_at: new Date().toISOString(),
      kelly_status: 'active'
    });
    const fresh = db.getCustomer(customer.id);
    const { browser, page } = await browserContextWithCustomer(playwright, request, fresh);

    await page.route('**/api/voice-agent/onboarding**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          onboarding_state: 'voice_setup_complete',
          destination: { path: '/business/agent.html' }
        })
      });
    });
    await page.route('**/api/kelly/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: 'active',
          phone_number: '+15551234567'
        })
      });
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
        body: JSON.stringify({ success: true, settings: { enabled: true } })
      });
    });
    await page.route('**/api/customer/agent/prompt**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, prompt: 'test' })
      });
    });
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

    try {
      await page.goto('/business/agent.html');
      await expect(page.locator('#vaCallList')).toContainText('Maria Lopez');
      await expect(page.locator('.va-outcome-pa_flagged')).toContainText('PA flagged');
    } finally {
      await browser.close();
    }
  });

  test('agent.html test outbound button calls API', async ({ playwright, request }) => {
    const { customer } = await ensureAuthenticatedCustomer(request);
    db.updateCustomer(customer.id, {
      voice_setup_completed_at: new Date().toISOString(),
      kelly_status: 'active'
    });
    const fresh = db.getCustomer(customer.id);
    const { browser, page } = await browserContextWithCustomer(playwright, request, fresh);

    let outboundCalled = false;
    await page.route('**/api/voice-agent/onboarding**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          onboarding_state: 'voice_setup_complete',
          destination: { path: '/business/agent.html' }
        })
      });
    });
    await page.route('**/api/kelly/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, status: 'active', phone_number: '+15551234567' })
      });
    });
    await page.route('**/api/voice-billing/status**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, billing: { twilio_phone_number: '+15551234567' } })
      });
    });
    await page.route('**/api/voice-agent/settings**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          settings: {
            enabled: true,
            greeting: 'Hi from E2E',
            outbound_opener: 'Hi, this is Kelly from Somo.'
          }
        })
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
    await page.route('**/api/voice/outbound/call**', async (route) => {
      outboundCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, call_id: 'CA_e2e_test', message: 'Call initiated' })
      });
    });

    try {
      await page.goto('/business/agent.html');
      await expect(page.locator('#vaTestOutbound')).toBeVisible();
      await page.fill('#vaTestOutboundPhone', '+15559876543');
      await page.click('#vaTestOutbound');
      await expect.poll(() => outboundCalled).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
