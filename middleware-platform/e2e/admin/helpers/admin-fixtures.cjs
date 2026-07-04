'use strict';

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function middlewareUp(request) {
  try {
    const health = await request.get(`${API_BASE}/health`);
    return health.ok();
  } catch {
    return false;
  }
}

async function loginAdmin(request, page) {
  const secret = process.env.ADMIN_PORTAL_SECRET;
  if (!secret) {
    return null;
  }
  const res = await request.post(`${API_BASE}/api/admin/session`, {
    data: { secret },
  });
  if (!res.ok()) {
    console.warn(`Admin session failed (${res.status()}) — continuing without admin cookie (stubbed API tests only)`);
    return null;
  }
  const { cookies } = await request.storageState();
  if (cookies.length && page) {
    await page.context().addCookies(cookies);
  }
  return res;
}

async function gotoAdminPage(page, path) {
  const href = path.startsWith('/') ? path : `/admin/${path}`;
  await page.goto(`${API_BASE}${href}`, { waitUntil: 'networkidle' });
  await page.locator('.admin-crm-sidebar .admin-crm-brand').waitFor({ state: 'visible', timeout: 20_000 });
}

module.exports = {
  API_BASE,
  middlewareUp,
  loginAdmin,
  gotoAdminPage,
};
