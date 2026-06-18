'use strict';

const express = require('express');
const router = express.Router();
const { requestDemoCall, isDemoEnabled } = require('../services/somo-demo-service');
const { getTurnstileSecret } = require('../lib/somo-demo-env');

async function verifyTurnstileIfConfigured(token) {
  const secret = getTurnstileSecret();
  if (!secret) return true;
  if (!token) throw new Error('Captcha verification required');
  const body = new URLSearchParams({
    secret,
    response: String(token)
  });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error('Captcha verification failed');
  return true;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, demo_enabled: isDemoEnabled() });
});

router.post('/request-call', async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      use_case,
      consent,
      language,
      country,
      city,
      practice_specialty,
      practice_size,
      questions_asked,
      turnstile_token: turnstileToken
    } = req.body || {};

    await verifyTurnstileIfConfigured(turnstileToken);

    const attribution = {
      utm_source: req.body?.utm_source || req.query?.utm_source,
      referrer: req.get('referer') || req.get('referrer'),
      user_agent: req.get('user-agent')
    };

    const result = await requestDemoCall({
      name,
      phone,
      email,
      use_case,
      language,
      country,
      city,
      practice_specialty,
      practice_size,
      questions_asked,
      consent: consent === true || consent === 'true',
      clientIp: clientIp(req),
      attribution
    });

    res.json(result);
  } catch (err) {
    const status =
      Number.isFinite(Number(err.status)) ? Number(err.status)
        : err.message?.includes('temporarily unavailable') ? 503
          : err.message?.includes('public webhook URL') ||
              err.message?.includes('ngrok') ||
              err.message?.includes('localhost')
            ? 503
            : err.message?.includes('Too many') ||
                err.message?.includes('already received') ||
                err.message?.includes('capacity') ||
                err.message?.includes('in progress')
              ? 429
              : 400;
    res.status(status).json({
      error: err.message || 'Unable to start demo call',
      error_code: err.code || null
    });
  }
});

module.exports = router;
