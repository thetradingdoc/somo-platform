'use strict';

/**
 * Admin portal E2E — FD-280.
 */
const { test, expect } = require('@playwright/test');
const { API_BASE, middlewareUp, loginAdmin, gotoAdminPage } = require('./helpers/admin-fixtures.cjs');

const sampleTenants = {
  success: true,
  summary: { total_tenants: 1 },
  tenants: [{
    clinic_id: 'clinic-e2e-1',
    customer_id: 'cust-e2e-1',
    name: 'E2E Dental Practice',
    pms_type: 'dentrix',
    pms_enabled: true,
    pending_invite: false,
    shadow_week_active: false,
    pilot_live_at: '2026-06-01T00:00:00.000Z',
    onboarding_state: 'live',
    minutes_remaining: 120,
    subscription_status: 'active',
    credits: { balance_minutes: 120 },
    usage: { recent_7d_calls: 3 },
    agent: { has_agent: true },
  }],
};

test.describe('@admin Admin portal screens', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test.beforeEach(async ({ page, request }) => {
    await page.addInitScript(() => {
      sessionStorage.removeItem('admin_auth_redirect');
    });
    await page.route('**/api/admin/session**', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            authenticated: true,
            capabilities: [
              'platform.tenants',
              'platform.leads',
              'platform.feature_flags',
              'platform.tenants.delete',
            ],
          }),
        });
      }
      return route.continue();
    });
    await loginAdmin(request, page);
  });

  test('Tenants table shows PMS column and nameplate', async ({ page }) => {
    await page.route('**/api/admin/tenants/alerts**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ alerts: [], grouped_alerts: [], total: 0, clinic_count: 0 }),
      });
    });
    await page.route('**/api/admin/tenants**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const url = route.request().url();
      if (url.includes('/alerts')) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sampleTenants),
      });
    });
    await page.route('**/api/admin/invites**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, invites: [] }),
      });
    });
    await page.route('**/api/admin/voice-onboarding/stuck**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, customers: [] }),
      });
    });
    await gotoAdminPage(page, '/admin/tenants.html');
    await expect(page.locator('.admin-crm-data-table th')).toContainText(['PMS', 'Actions']);
    await expect(page.locator('.admin-crm-data-table')).toContainText('E2E Dental Practice');
    await expect(page.locator('.sfd-nameplate--live')).toBeVisible();
  });

  test('Stuck filter toggles tenant table', async ({ page }) => {
    await page.route('**/api/admin/tenants/alerts**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ alerts: [], grouped_alerts: [], total: 0, clinic_count: 0 }),
      });
    });
    await page.route('**/api/admin/tenants**', async (route) => {
      if (route.request().url().includes('/alerts')) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sampleTenants),
      });
    });
    await page.route('**/api/admin/invites**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, invites: [] }),
      });
    });
    await page.route('**/api/admin/voice-onboarding/stuck**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          customers: [{ customer_id: 'cust-other', clinic_id: 'clinic-other' }],
        }),
      });
    });
    await gotoAdminPage(page, '/admin/tenants.html');
    await page.locator('#stuckFilter').check();
    await expect(page.locator('#tenantTable')).toContainText('No stuck onboarding tenants');
  });

  test('Pending invite row shows Resend button', async ({ page }) => {
    await page.route('**/api/admin/tenants/alerts**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ alerts: [], grouped_alerts: [], total: 0, clinic_count: 0 }),
      });
    });
    await page.route('**/api/admin/tenants**', async (route) => {
      if (route.request().url().includes('/alerts')) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, summary: {}, tenants: [] }),
      });
    });
    await page.route('**/api/admin/invites**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          invites: [{
            id: 'inv-e2e-1',
            email: 'office@example.com',
            practice_name: 'Pending Office',
            status: 'pending',
          }],
        }),
      });
    });
    await page.route('**/api/admin/voice-onboarding/stuck**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, customers: [] }),
      });
    });
    await gotoAdminPage(page, '/admin/tenants.html');
    await expect(page.locator('#pendingInvites')).toContainText('Resend');
  });

  test('Pipeline kanban shows location and language metadata', async ({ page }) => {
    await page.route('**/api/admin/scrape/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          scrape_configured: true,
          leads: { verified: 0, needs_phone: 0 },
          calls_this_month: 0,
          calls_remaining: 250,
          calls_cap: 250,
        }),
      });
    });
    await page.route('**/api/admin/scrape/leads/pipeline**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          cards: {
            new: [{
              id: 1,
              clinic_name: 'Smile Clinic',
              clinic_phone: '+12025550199',
              location: 'Austin, TX',
              pms_label: 'Dentrix',
              language_labels: ['English', 'Spanish'],
              callable: true,
            }],
            contacted: [],
            demo: [],
            won: [],
            lost: [],
          },
        }),
      });
    });
    await page.route('**/api/admin/scrape/leads/call-ready**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, leads: [] }),
      });
    });
    await gotoAdminPage(page, '/admin/pipeline.html');
    await expect(page.locator('.admin-crm-kanban-card-loc').first()).toContainText('Austin');
    await expect(page.locator('.admin-crm-kanban-card-loc').first()).toContainText('Dentrix');
    await expect(page.locator('.admin-crm-kanban-card-loc').first()).toContainText('English');
  });

  test('Feature flags page loads toggle table', async ({ page }) => {
    await page.route('**/api/admin/feature-flags**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            flags: { KELLY_RAILS_V2: true, TEST_FLAG: false },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, flag_name: 'TEST_FLAG' }),
      });
    });
    await gotoAdminPage(page, '/admin/feature-flags.html');
    await expect(page.locator('.admin-crm-data-table')).toContainText('KELLY_RAILS_V2');
    await expect(page.locator('input[data-flag="TEST_FLAG"]')).toBeVisible();
  });

  test('Sales agent shows sfd nameplate status', async ({ page }) => {
    await page.route('**/api/admin/leads/sales-agent/info**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          agent_id: 'agent-sales-e2e',
          agent_name: 'Somo Sales',
        }),
      });
    });
    await page.route('**/api/admin/scrape/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          calls_cap: 250,
          leads: { verified: 12 },
        }),
      });
    });
    await gotoAdminPage(page, '/admin/sales-agent.html');
    await expect(page.locator('.sfd-nameplate--live')).toContainText('CONFIGURED');
    await expect(page.locator('.sfd-card')).toHaveCount(2);
  });

  test('Coding reviews queue renders sfd-table', async ({ page }) => {
    await page.route('**/api/admin/coding-reviews**', async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          reviews: [
            {
              id: 'rev-e2e-1',
              call_id: 'call-001',
              proposed_icd10: 'K02.9',
              proposed_cpt: 'D0120',
              confidence_score: 0.92,
              sla_deadline: '2026-07-03T12:00:00Z',
            },
          ],
        }),
      });
    });
    await gotoAdminPage(page, '/admin/coding-reviews.html');
    await expect(page.locator('.sfd-table')).toContainText('K02.9');
    await expect(page.locator('.sfd-table th')).toContainText(['Session', 'Actions']);
  });
});
