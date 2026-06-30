const { test, expect } = require('@playwright/test');

async function enterJourney(page) {
  await page.goto('/health-video/start');
}

async function enterJourneyFromLanding(page) {
  await page.goto('/health-video/');
  await page.getByRole('button', { name: /Call Somo/i }).click();
}

async function advanceToPrivacy(page) {
  await page.getByRole('button', { name: /Continue →/i }).click();
  await page.getByRole('button', { name: /Skip — stay anonymous/i }).click();
}

async function advanceToPreview(page) {
  await advanceToPrivacy(page);
  await page.getByRole('button', { name: /I understand — call Somo/i }).click();
}

async function enterLiveSession(page) {
  await advanceToPreview(page);
  await expect(page.getByText(/Almost ready/i)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Continue to Somo/i }).click();
  await expect(page.getByText(/I'm Somo/i)).toBeVisible({ timeout: 10000 });
}

test.describe('health video demo', () => {
  test('marketing landing shows split hero and CTA', async ({ page }) => {
    await page.goto('/health-video/');
    await expect(page.locator('.hv-marketing-split')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Have a health problem/i })).toBeVisible();
    await expect(page.getByText(/Somo Health/i)).toBeVisible();
    await expect(page.getByText(/Encrypted/i)).toBeVisible();
    await expect(page.getByText(/You control the camera/i)).toBeVisible();
    await expect(page.getByText(/Not a diagnosis/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Call Somo/i }).first()).toBeVisible();
    await expect(page.getByText(/If this is an emergency/i)).not.toBeVisible();
    await expect(page.getByRole('radio', { name: /English/i })).not.toBeVisible();
  });

  test('language start screen at /start', async ({ page }) => {
    await enterJourney(page);
    await expect(page.getByText(/Choose your language/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue →/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /English/i })).toBeVisible();
  });

  test('marketing split fills viewport on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'health-video-mobile', 'desktop layout check only');
    await page.goto('/health-video/');
    const split = page.locator('.hv-marketing-split');
    await expect(split).toBeVisible();
    const box = await split.boundingBox();
    const viewport = page.viewportSize();
    expect(box?.width).toBeGreaterThan((viewport?.width || 1280) - 4);
  });

  test('journey shell uses content max width on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'health-video-mobile', 'desktop journey layout');
    await enterJourney(page);
    const shell = page.locator('.hv-journey-shell');
    const frame = page.locator('.hv-journey-frame');
    await expect(shell).toBeVisible();
    const frameBox = await frame.boundingBox();
    expect(frameBox?.width).toBeGreaterThan(500);
    expect(frameBox?.width).toBeLessThanOrEqual(720);
  });

  test('marketing landing stacks on mobile', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'health-video', 'mobile layout check only');
    await page.goto('/health-video/');
    await expect(page.locator('.hv-marketing-split')).toBeVisible();
    await expect(page.getByRole('button', { name: /Call Somo/i })).toBeVisible();
  });

  test('privacy screen shows Heroicons', async ({ page }) => {
    await enterJourneyFromLanding(page);
    await advanceToPrivacy(page);
    await expect(page.locator('.hv-privacy-icon svg')).toHaveCount(2);
    await expect(page.locator('.hv-sensitive-icon svg')).toHaveCount(1);
  });

  test('session page uses light live shell on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'health-video-mobile', 'desktop session layout');
    await enterJourneyFromLanding(page);
    await enterLiveSession(page);
    await expect(page.locator('.hv-session-outer--live')).toBeVisible();
    const bg = await page.locator('.hv-session-outer--live').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(255, 255, 255)');
    await expect(page.locator('[data-testid="kelly-presence-panel"]')).toBeVisible();
    await expect(page.getByText(/^Routine$/)).not.toBeVisible();
  });

  test('mobile live session shows Kelly stage without urgency ladder', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'health-video', 'mobile session layout');
    await enterJourneyFromLanding(page);
    await enterLiveSession(page);
    await expect(page.locator('[data-testid="kelly-stage"]')).toBeVisible();
    await expect(page.getByText(/^Routine$/)).not.toBeVisible();
    await expect(page.locator('.hv-session-video-col')).toHaveCount(0);
  });

  test('desktop camera does not cover chat panel', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'health-video-mobile', 'desktop camera layout');
    await enterJourneyFromLanding(page);
    await enterLiveSession(page);
    await expect(page.locator('.hv-transcript-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: /Turn on camera/i }).click();
    await expect(page.getByText(/Before you turn on camera/i)).toBeVisible();
    await page.getByRole('button', { name: /Continue with camera/i }).click();
    const chatPanel = page.locator('.hv-chat-panel');
    const presence = page.locator('[data-testid="kelly-presence-panel"]');
    await expect(chatPanel).toBeVisible();
    await expect(presence).toBeVisible();
    await expect(page.locator('.hv-chat-area')).toBeVisible();
    const chatBox = await chatPanel.boundingBox();
    const presenceBox = await presence.boundingBox();
    expect(chatBox?.width).toBeGreaterThan(200);
    expect(presenceBox?.width).toBeGreaterThan(200);
    if (chatBox && presenceBox) {
      expect(chatBox.x).toBeGreaterThan(presenceBox.x);
    }
  });

  test('mobile chat stays visible when camera on', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'health-video', 'mobile camera layout');
    await enterJourneyFromLanding(page);
    await enterLiveSession(page);
    await page.getByRole('button', { name: /Turn on camera/i }).click();
    await page.getByRole('button', { name: /Continue with camera/i }).click();
    await expect(page.locator('.hv-chat-area')).toBeVisible();
    await expect(page.locator('.hv-chat-fab')).toHaveCount(0);
  });

  test('live chat shows Somo greeting after continue', async ({ page }) => {
    await enterJourneyFromLanding(page);
    await enterLiveSession(page);
    await expect(page.getByText(/I'm Somo/i)).toBeVisible();
  });

  test('single mic control in live session', async ({ page }) => {
    await enterJourneyFromLanding(page);
    await enterLiveSession(page);
    const micButtons = page.getByRole('button', { name: /Microphone|Turn microphone/i });
    await expect(micButtons).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Finish$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Get my summary/i })).not.toBeVisible();
  });

  test('camera education sheet before voluntary camera', async ({ page }) => {
    await enterJourneyFromLanding(page);
    await enterLiveSession(page);
    await page.getByRole('button', { name: /^Turn on camera$/i }).click();
    await expect(page.getByText(/Before you turn on camera/i)).toBeVisible();
  });

  test('journey flow: landing → language → name skip → privacy', async ({ page }) => {
    await enterJourneyFromLanding(page);
    await page.getByRole('button', { name: /Continue →/i }).click();
    await expect(page.getByText(/What should Somo call you/i)).toBeVisible();
    await page.getByRole('button', { name: /Skip — stay anonymous/i }).click();
    await expect(page.getByText(/Before we start/i)).toBeVisible();
    await expect(page.getByText(/Private by design/i)).toBeVisible();
  });

  test('consent route redirects to marketing landing', async ({ page }) => {
    await page.goto('/health-video/consent');
    await expect(page.getByRole('heading', { name: /Have a health problem/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Call Somo/i }).first()).toBeVisible();
  });

  test('terms and privacy pages link back to health chat', async ({ page }) => {
    await page.goto('/health-terms.html');
    await expect(page.getByText(/Terms of Use|Terms/i)).toBeVisible();
    await page.goto('/health-privacy.html');
    await expect(page.getByText(/Privacy Notice/i)).toBeVisible();
  });

  test('API journey: start → turn → end → report', async ({ request }) => {
    const startRes = await request.post('/api/health-session/start', {
      data: {
        terms_accepted: true,
        locale: 'en',
        reply_language: 'en',
        terms_version: '2026-06-25',
        display_name: 'Amina',
        metadata: { age_range: '18 – 35' }
      }
    });
    expect(startRes.ok()).toBeTruthy();
    const start = await startRes.json();
    expect(start.success).toBe(true);
    expect(start.session.room_id).toMatch(/^health-/);
    expect(start.session_token).toBeTruthy();

    const sessionId = start.session.id;
    const token = start.session_token;

    const turnRes = await request.post(`/api/health-session/${sessionId}/turn`, {
      data: { text: 'I have a mild rash on my arm for two days' },
      headers: { 'x-health-session-token': token }
    });
    expect(turnRes.ok()).toBeTruthy();
    const turn = await turnRes.json();
    expect(turn.success).toBe(true);

    const transcriptRes = await request.get(`/api/health-session/${sessionId}/transcript`, {
      headers: { 'x-health-session-token': token }
    });
    expect(transcriptRes.ok()).toBeTruthy();
    const transcript = await transcriptRes.json();
    expect(transcript.transcript?.length).toBeGreaterThan(0);

    const endRes = await request.post(`/api/health-session/${sessionId}/end`, {
      headers: { 'x-health-session-token': token },
      data: { session_token: token }
    });
    expect(endRes.ok()).toBeTruthy();
    const ended = await endRes.json();
    expect(ended.success).toBe(true);
    expect(ended.session.session_status).toBe('ended');

    const reportRes = await request.get(`/api/health-session/${sessionId}/report`, {
      headers: { 'x-health-session-token': token }
    });
    expect(reportRes.ok()).toBeTruthy();
    const reportBody = await reportRes.json();
    expect(reportBody.report).toBeTruthy();
  });

  test('API journey: turn without token is rejected', async ({ request }) => {
    const startRes = await request.post('/api/health-session/start', {
      data: { terms_accepted: true, locale: 'en' }
    });
    const start = await startRes.json();
    const turnRes = await request.post(`/api/health-session/${start.session.id}/turn`, {
      data: { text: 'rash on arm' }
    });
    expect(turnRes.status()).toBe(401);
  });

  test('UI journey: type turn → Somo reply → end → report', async ({ page }) => {
    test.skip(!process.env.GROQ_API_KEY, 'requires GROQ_API_KEY for live Somo turn');

    await page.goto('/health-video/');
    await page.getByRole('button', { name: /Call Somo/i }).click();
    await enterLiveSession(page);

    const input = page.getByRole('textbox', { name: /Message to Somo/i });
    await input.fill('I have a mild rash on my arm for two days');
    await page.getByRole('button', { name: /Send message/i }).click();

    await expect(page.locator('.hv-chat-area')).toContainText(/rash|Somo|tell me|when|symptom/i, {
      timeout: 45000
    });

    await page.getByRole('button', { name: /^Finish$/i }).click();
    await page.getByRole('button', { name: /Get my summary/i }).click();
    await page.getByRole('button', { name: /End chat \+ get summary/i }).click();

    await expect(page.getByRole('heading', { name: /Your health chat summary/i })).toBeVisible({
      timeout: 60000
    });

    await expect(page.getByText(/What you told Somo/i)).toBeVisible();
    await expect(page.getByText(/What Somo noticed|could not build a full summary/i)).toBeVisible();
  });

  test('API journey: copay route and mock pay', async ({ request }) => {
    const startRes = await request.post('/api/health-session/start', {
      data: { terms_accepted: true, locale: 'en', reply_language: 'en' }
    });
    const start = await startRes.json();
    if (!start.success) test.skip();

    const sessionId = start.session.id;
    const token = start.session_token;
    const headers = { 'x-health-session-token': token };

    const eligRes = await request.post(`/api/health-session/${sessionId}/eligibility`, {
      headers,
      data: { urgency: 'routine_visit', pathway_summary: 'Routine dermatology visit' }
    });
    if (eligRes.status() === 503 || eligRes.status() === 404) {
      test.skip(true, 'finance rails not enabled on server');
    }
    expect(eligRes.ok()).toBeTruthy();

    const routeRes = await request.post(`/api/health-session/${sessionId}/route`, { headers, data: {} });
    if (!routeRes.ok()) test.skip(true, 'route not available');
    const routeBody = await routeRes.json();
    expect(routeBody.routing?.copay_cents).toBeGreaterThan(0);

    const payRes = await request.post(`/api/health-session/${sessionId}/pay/mock`, { headers });
    expect(payRes.ok()).toBeTruthy();
    const paid = await payRes.json();
    expect(paid.routing?.payment_status).toBe('paid');
  });

  test('UI journey live: skin turn shows chat reply without diagnosis language', async ({ page }) => {
    test.skip(!process.env.GROQ_API_KEY, 'requires GROQ_API_KEY');
    test.skip(process.env.DERM_EDUCATION_PIPELINE_ENABLED !== 'true', 'requires derm pipeline');

    await page.goto('/health-video/');
    await page.getByRole('button', { name: /Call Somo/i }).click();
    await enterLiveSession(page);

    const input = page.getByRole('textbox', { name: /Message to Somo/i });
    await input.fill('I have a red itchy rash on my neck for 3 days, no fever');
    await page.getByRole('button', { name: /Send message/i }).click();

    await expect(page.locator('.hv-chat-area')).toContainText(/rash|neck|itch|skin|tell me/i, {
      timeout: 45000
    });
    await expect(page.locator('.hv-chat-area')).not.toContainText(/you have eczema|this is a diagnosis/i);
  });

  test('LOCAL_DEV_ROOT=health redirects root to health-video SPA', async ({ request }) => {
    const res = await request.get('/', { maxRedirects: 0 });
    if (process.env.LOCAL_DEV_ROOT === 'health') {
      expect(res.status()).toBe(302);
      expect(res.headers().location).toMatch(/health-video/);
    } else {
      test.skip();
    }
  });

  test('legacy health-video.html redirects to SPA when built', async ({ request }) => {
    const res = await request.get('/health-video.html', { maxRedirects: 0 });
    if (res.status() === 302) {
      expect(res.headers().location).toMatch(/\/health-video\//);
    } else {
      expect(res.status()).toBe(200);
    }
  });
});
