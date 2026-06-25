'use strict';

/**
 * Somo transactional email layout — see docs/Brand/SOMO_GUIDELINES.md and LOGO_AND_ICON_SSOT.md
 */

const LOGO_URL =
  process.env.SOMO_EMAIL_LOGO_URL ||
  process.env.SOMO_EMAIL_LOGO ||
  'https://callsomo.com/assets/brand/somo-logo.png';

const SITE_URL = (process.env.SOMO_EMAIL_SITE_URL || 'https://callsomo.com').replace(/\/$/, '');

const SUPPORT_EMAIL =
  process.env.SOMO_EMAIL_SUPPORT || process.env.SMTP_FROM_EMAIL || 'richard@callsomo.com';

const TOKENS = {
  primary: '#1C35EA',
  primaryDark: '#1529C4',
  primarySoft: '#EEF0FE',
  ink: '#000000',
  inkDark: '#0a0a0a',
  text: '#1a1a1a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  pageBg: '#f1f5f9',
  white: '#ffffff',
  warning: '#d97706',
  warningSoft: '#fffbeb',
  danger: '#dc2626'
};

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseCss() {
  return `
    body {
      font-family: 'League Spartan', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: ${TOKENS.text};
      margin: 0;
      padding: 0;
      background-color: ${TOKENS.pageBg};
      -webkit-font-smoothing: antialiased;
    }
    .somo-wrap { max-width: 600px; margin: 0 auto; padding: 24px 16px; box-sizing: border-box; }
    .somo-card {
      background: ${TOKENS.white};
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(10, 10, 10, 0.08);
    }
    .somo-header {
      background: linear-gradient(135deg, ${TOKENS.ink} 0%, ${TOKENS.primary} 100%);
      color: ${TOKENS.white};
      padding: 32px 28px 28px;
      text-align: center;
    }
    .somo-header h1 {
      margin: 12px 0 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .somo-header p {
      margin: 8px 0 0;
      font-size: 15px;
      opacity: 0.92;
    }
    .somo-logo {
      display: block;
      margin: 0 auto 8px;
      max-width: 180px;
      height: auto;
      border: 0;
    }
    .somo-body { padding: 32px 28px; color: ${TOKENS.muted}; font-size: 16px; }
    .somo-body h2 {
      color: ${TOKENS.text};
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 12px;
    }
    .somo-body p { margin: 0 0 16px; }
    .somo-body a { color: ${TOKENS.primary}; font-weight: 600; }
    .somo-panel {
      background: ${TOKENS.primarySoft};
      border: 1px solid ${TOKENS.border};
      border-left: 4px solid ${TOKENS.primary};
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .somo-panel--warning {
      background: ${TOKENS.warningSoft};
      border-left-color: ${TOKENS.warning};
    }
    .somo-row { padding: 10px 0; border-bottom: 1px solid ${TOKENS.border}; }
    .somo-row:last-child { border-bottom: none; }
    .somo-label { display: block; font-size: 13px; color: ${TOKENS.muted}; font-weight: 600; margin-bottom: 4px; }
    .somo-value { color: ${TOKENS.text}; font-weight: 600; word-break: break-word; }
    .somo-code {
      display: inline-block;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 10px;
      color: ${TOKENS.primary};
      font-family: 'Courier New', Courier, monospace;
      margin: 0;
    }
    .somo-code-box {
      background: ${TOKENS.white};
      border: 2px solid ${TOKENS.primary};
      border-radius: 8px;
      padding: 28px 20px;
      text-align: center;
      margin: 24px 0;
    }
    .somo-btn {
      display: inline-block;
      background: ${TOKENS.primary};
      color: ${TOKENS.white} !important;
      padding: 14px 28px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 700;
      font-size: 16px;
      margin: 8px 4px;
    }
    .somo-btn:hover { background: ${TOKENS.primaryDark}; }
    .somo-btn--secondary {
      background: ${TOKENS.white};
      color: ${TOKENS.primary} !important;
      border: 2px solid ${TOKENS.primary};
    }
    .somo-btn--danger { background: ${TOKENS.danger}; }
    .somo-btn--warning { background: ${TOKENS.warning}; }
    .somo-footer {
      background: ${TOKENS.pageBg};
      padding: 24px 28px;
      text-align: center;
      border-top: 1px solid ${TOKENS.border};
      color: ${TOKENS.muted};
      font-size: 13px;
    }
    .somo-footer a { color: ${TOKENS.primary}; text-decoration: none; font-weight: 600; }
    .somo-tagline { font-size: 12px; color: ${TOKENS.faint}; margin-top: 16px; }
    @media (max-width: 480px) {
      .somo-body, .somo-header, .somo-footer { padding-left: 20px; padding-right: 20px; }
      .somo-code { font-size: 26px; letter-spacing: 6px; }
    }
  `;
}

function logoImg() {
  return `<img class="somo-logo" src="${escapeHtml(LOGO_URL)}" alt="Somo" width="180" />`;
}

/**
 * Full HTML email document.
 * @param {{ title: string, subtitle?: string, bodyHtml: string, preheader?: string, footerExtra?: string }} opts
 */
function layout(opts) {
  const title = escapeHtml(opts.title);
  const subtitle = opts.subtitle ? `<p>${escapeHtml(opts.subtitle)}</p>` : '';
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>`
    : '';
  const footerExtra = opts.footerExtra || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${title}</title>
  <style>${baseCss()}</style>
</head>
<body>
  ${preheader}
  <div class="somo-wrap">
    <div class="somo-card">
      <div class="somo-header">
        ${logoImg()}
        <h1>${title}</h1>
        ${subtitle}
      </div>
      <div class="somo-body">
        ${opts.bodyHtml}
      </div>
      <div class="somo-footer">
        <p>Somo — never answer business calls again.</p>
        <p>
          <a href="${escapeHtml(SITE_URL)}">callsomo.com</a>
          &nbsp;·&nbsp;
          <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a>
        </p>
        ${footerExtra}
        <p class="somo-tagline">Please do not reply to this automated message.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function codeBox(code) {
  return `<div class="somo-code-box"><p class="somo-code">${escapeHtml(code)}</p></div>`;
}

function button(href, label, variant = 'primary') {
  const cls =
    variant === 'danger'
      ? 'somo-btn somo-btn--danger'
      : variant === 'warning'
        ? 'somo-btn somo-btn--warning'
        : variant === 'secondary'
          ? 'somo-btn somo-btn--secondary'
          : 'somo-btn';
  return `<a href="${escapeHtml(href)}" class="${cls}">${escapeHtml(label)}</a>`;
}

function panel(innerHtml, variant) {
  const cls = variant === 'warning' ? 'somo-panel somo-panel--warning' : 'somo-panel';
  return `<div class="${cls}">${innerHtml}</div>`;
}

function infoRows(rows) {
  const html = rows
    .map(
      (r) =>
        `<div class="somo-row"><span class="somo-label">${escapeHtml(r.label)}</span><span class="somo-value">${r.valueHtml ?? escapeHtml(r.value)}</span></div>`
    )
    .join('');
  return panel(html);
}

module.exports = {
  TOKENS,
  LOGO_URL,
  SITE_URL,
  SUPPORT_EMAIL,
  escapeHtml,
  layout,
  codeBox,
  button,
  panel,
  infoRows,
  logoImg
};
