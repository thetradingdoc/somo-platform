'use strict';

const { expect } = require('@playwright/test');

const TRIAGE_STATE_KEY = 'patient_triage_state_v1';

const FAST_ERROR_PATTERNS =
  /temporarily disabled|not defined|Cannot find module|Request failed|Something went wrong/i;

/**
 * A7: Inject patient portal session (localStorage) before triage.html loads.
 */
async function injectPatientSession(page, portalSessionId) {
  await page.addInitScript((sid) => {
    localStorage.setItem('patient_session_id', sid);
  }, portalSessionId);
}

/**
 * Bind Kelly triage session_id in sessionStorage so HTTP turns hit seeded DB state.
 */
async function injectKellyTriageSession(page, kellySessionId) {
  await page.addInitScript(
    ({ key, sessionId }) => {
      sessionStorage.setItem(key, JSON.stringify({ session_id: sessionId }));
    },
    { key: TRIAGE_STATE_KEY, sessionId: kellySessionId }
  );
}

async function openTriagePage(page, baseURL, portalSessionId, kellySessionId) {
  await injectPatientSession(page, portalSessionId);
  if (kellySessionId) {
    await injectKellyTriageSession(page, kellySessionId);
  }
  await page.goto(`${baseURL.replace(/\/$/, '')}/patients/triage.html`);
  await expect(page).toHaveURL(/triage\.html/, { timeout: 15_000 });
  await expect(page.locator('#msgs')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });

  const resumeBtn = page.locator('#resumeContinueBtn');
  if (await resumeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await resumeBtn.click();
  }
}

/**
 * Install listener to capture triage API JSON (toolsUsed, session_id).
 */
function installTriageResponseCapture(page) {
  const captured = [];
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!url.includes('/api/patient/triage/message')) return;
      if (response.request().method() !== 'POST') return;
      const json = await response.json();
      captured.push({
        url,
        status: response.status(),
        reply: json.reply,
        toolsUsed: Array.isArray(json.toolsUsed) ? json.toolsUsed : [],
        session_id: json.session_id || null,
        success: json.success,
        error: json.error || null,
      });
    } catch (_) {}
  });
  return {
    getLast: () => captured[captured.length - 1] || null,
    getAll: () => [...captured],
    reset: () => {
      captured.length = 0;
    },
  };
}

async function sendTriageMessage(page, text) {
  const input = page.locator('#input');
  const sendBtn = page.locator('#sendBtn');

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/patient/triage/message') && r.request().method() === 'POST',
    { timeout: 600_000 }
  );

  const assistantCountBefore = await page.locator('#msgs .msg.assistant').count();
  const userCountBefore = await page.locator('#msgs .msg.user').count();
  const t0 = Date.now();

  await input.fill(text);
  await sendBtn.click();

  const response = await responsePromise;
  const elapsed = Date.now() - t0;
  const body = await response.json().catch(() => ({}));

  return { assistantCountBefore, userCountBefore, t0, elapsed, response, body };
}

async function waitForAssistantReply(
  page,
  {
    minMs = 500,
    timeoutMs = 300_000,
    assistantCountBefore = 0,
    userCountBefore = 0,
    elapsed = 0,
    body = {},
    response = null,
  } = {}
) {
  if (response && (!response.ok() || body.success === false)) {
    throw new Error(
      `Triage API failed (${response.status()}): ${body.error || 'unknown'}`
    );
  }

  if (
    elapsed < minMs &&
    (FAST_ERROR_PATTERNS.test(String(body.error || '')) ||
      FAST_ERROR_PATTERNS.test(String(body.reply || '')))
  ) {
    throw new Error(
      `Reply too fast — LLM not reached (${elapsed}ms). Check fast-path bypass.`
    );
  }

  await expect(page.locator('#msgs .msg.user')).toHaveCount(userCountBefore + 1, {
    timeout: timeoutMs,
  });
  await expect(page.locator('#msgs .msg.assistant')).toHaveCount(assistantCountBefore + 1, {
    timeout: timeoutMs,
  });

  const replyText =
    (await page.locator('#msgs .msg.assistant').last().textContent()) ||
    String(body.reply || '');
  return { replyText, elapsedMs: elapsed, toolsUsed: body.toolsUsed || [] };
}

async function sendTriageTurn(page, text, opts = {}) {
  const minMs = opts.minMs ?? 500;
  await expect(page.locator('#msgs .msg.assistant').first()).toBeVisible({ timeout: 15_000 });

  const turn = await sendTriageMessage(page, text);
  const { replyText, elapsedMs, toolsUsed } = await waitForAssistantReply(page, {
    minMs,
    ...turn,
    timeoutMs: opts.timeoutMs,
  });
  return { replyText, elapsedMs, toolsUsed, api: turn.body };
}

module.exports = {
  TRIAGE_STATE_KEY,
  injectPatientSession,
  injectKellyTriageSession,
  openTriagePage,
  installTriageResponseCapture,
  sendTriageMessage,
  waitForAssistantReply,
  sendTriageTurn,
};
