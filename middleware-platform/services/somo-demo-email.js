'use strict';

const EmailService = require('./email-service');
const somoDemoEnv = require('../lib/somo-demo-env');

function getSignupUrl() {
  const base = process.env.SOMO_DEMO_SIGNUP_URL || '/signup?utm_source=somo-demo';
  if (base.startsWith('http')) return base;
  const apiBase = (process.env.API_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '');
  if (apiBase) return `${apiBase}${base.startsWith('/') ? base : `/${base}`}`;
  return base;
}

/**
 * Send Somo demo signup link email (demo/marketing path — not patient email).
 */
async function sendSignupEmail(email, { prospectName } = {}) {
  const to = String(email || '').trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error('Invalid email for signup link');
  }

  const url = getSignupUrl();
  const greeting = prospectName ? `Hi ${prospectName.split(' ')[0]},` : 'Hi,';
  const subject = 'Your Somo signup link';
  const text = `${greeting} here is your Somo signup link: ${url}`;
  const bodyHtml = `
    <p>${greeting}</p>
    <p>Thanks for trying Somo's AI front desk. Start your free trial here:</p>
    <p><a href="${url}" style="color:#238108;font-weight:600;">Get started with Somo</a></p>
    <p style="font-size:12px;color:#666;">If you did not request this, you can ignore this email.</p>`;

  if (process.env.NODE_ENV === 'test' || somoDemoEnv.shouldRelaxDemoLimitsFlag?.()) {
    return { success: true, simulated: true, to, subject, text };
  }

  return EmailService.sendEmail({
    to,
    subject,
    html: EmailService._somoLayout(subject, 'Somo front desk demo', bodyHtml),
    text
  });
}

async function sendDemoConfirmation(email, { prospectName } = {}) {
  const to = String(email || '').trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { skipped: true };

  const subject = 'Your Somo demo call is on the way';
  const greeting = prospectName ? `Hi ${prospectName.split(' ')[0]},` : 'Hi,';
  const bodyHtml = `
    <p>${greeting}</p>
    <p>We're calling you now from Somo's AI front desk for your 2-minute live demo.</p>
    <p>Answer when your phone rings — Kelly will ask a few quick questions about your practice.</p>`;
  const text = `${greeting} We're calling you now for your Somo demo. Answer when your phone rings.`;

  if (process.env.NODE_ENV === 'test') {
    return { success: true, simulated: true, to, subject };
  }

  return EmailService.sendEmail({
    to,
    subject,
    html: EmailService._somoLayout(subject, 'Somo demo', bodyHtml),
    text
  });
}

module.exports = { sendSignupEmail, sendDemoConfirmation, getSignupUrl };
