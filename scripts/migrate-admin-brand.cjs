#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADMIN = path.join(ROOT, 'unified-dashboard', 'admin');

const ADMIN_HEAD = `  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=League+Spartan:wght@400;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/css/somo-tokens.css" />
  <link rel="stylesheet" href="../assets/css/signup-somo.css" />
  <link rel="stylesheet" href="../assets/css/auth-somo.css" />
  <link rel="stylesheet" href="../assets/css/admin-portal.css" />
  <link rel="stylesheet" href="assets/css/admin-ai-assistant.css" />
  <script src="../assets/js/config.js"></script>`;

function stripPurpleCss(css) {
  return css
    .replace(/#7[cC]5[dD][fF][aA]/g, 'var(--somo-lizard)')
    .replace(/#38[bB][dD][fF]8/g, 'var(--somo-grass)')
    .replace(/#7C5DFA/g, 'var(--somo-lizard)')
    .replace(/#38BDF8/g, 'var(--somo-grass)')
    .replace(/font-family:\s*['"]?Inter['"]?[^;]*;/g, "font-family: var(--font-brand, 'League Spartan', system-ui, sans-serif);")
    .replace(/font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*'Segoe UI',\s*Roboto[^;]*;/g,
      "font-family: var(--font-brand, 'League Spartan', system-ui, sans-serif);");
}

function removeDuplicateShellRules(css) {
  const patterns = [
    /:root\s*\{[^}]*--accent:\s*[^}]*\}/gs,
    /:root\.light\s*\{[^}]*\}/gs,
    /\.shell\s*\{[^}]*\}/gs,
    /aside\s*\{[^}]*\}/gs,
    /\.logo\s*\{[^}]*\}/gs,
    /\.nav-icon\s*\{[^}]*\}/gs,
    /\.nav-icon\.active\s*\{[^}]*\}/gs,
    /\.nav-icon:hover:not\(\.active\)\s*\{[^}]*\}/gs,
  ];
  let out = css;
  for (const re of patterns) {
    out = out.replace(re, '');
  }
  return out.trim();
}

function migrateIndex() {
  const file = path.join(ADMIN, 'index.html');
  let text = fs.readFileSync(file, 'utf8');

  text = text.replace(
    /<head>[\s\S]*?<\/head>/,
    `<head>\n${ADMIN_HEAD}\n  <title>Somo Admin</title>\n</head>`
  );

  text = text.replace(/\n  <style>[\s\S]*?<\/style>\n/, '\n');
  text = text.replace('<body>', '<body class="admin-portal-body signup-wizard-body">');

  const oldLogo = text.match(/<div class="logo">[\s\S]*?<\/div>\s*<div class="nav-icon" title="Dashboard"/);
  if (oldLogo) {
    text = text.replace(
      oldLogo[0],
      `<div class="logo admin-sidebar-logo">
        <img src="/assets/brand/somo-icon-lizard.png" alt="Somo" width="36" height="36" />
      </div>
      <div class="nav-icon" title="Dashboard"`
    );
  }

  text = text.replace(
    '<p style="margin:0;color:var(--muted);font-size:13px;font-weight:500;">Somo • Admin</p>',
    '<p class="admin-eyebrow">Somo • Admin</p>'
  );
  text = text.replace(
    /<h1[\s\S]*?Command Center<\/h1>/,
    '<h1 class="admin-page-title">Command Center</h1>'
  );

  text = text.replace(
    /\s*<button class="btn" id="themeToggle"[\s\S]*?<\/button>\s*/,
    '\n          '
  );
  text = text.replace(
    /<button class="btn" id="logoutBtn"[\s\S]*?Sign Out\s*<\/button>/,
    `<button class="btn admin-toolbar-btn" id="logoutBtn" style="display:none;">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style="display:inline-block;margin-right:6px;vertical-align:middle;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
            </svg>
            Sign Out
          </button>`
  );

  const loginStart = text.indexOf('<div class="login-panel" id="loginPanel">');
  const loginEnd = text.indexOf('<div id="dashboardShell"');
  if (loginStart >= 0 && loginEnd > loginStart) {
    const newLogin = `      <div class="login-panel" id="loginPanel">
        <div class="login-card login-main" style="max-width:440px;margin:0 auto;">
          <a href="/" class="signup-logo-link" aria-label="Somo home">
            <img class="signup-logo-img" src="/assets/brand/somo-logo.png" alt="Somo" width="199" height="68" />
          </a>
          <p class="signup-eyebrow">Operator access</p>
          <h1 class="signup-title" style="font-size:1.75rem;text-align:center;">Welcome back</h1>
          <p class="signup-sub" id="loginStepHint" style="text-align:center;">Sign in with your operator account. A verification code will be emailed for security.</p>
          <div class="signup-toast error hidden" id="loginError" role="alert"></div>
          <form class="login-form" id="loginForm">
            <label class="signup-field">
              <span>Email</span>
              <input type="email" id="adminEmail" autocomplete="username" required autofocus />
            </label>
            <label class="signup-field">
              <span>Password</span>
              <input type="password" id="adminPassword" autocomplete="current-password" required />
            </label>
            <label class="signup-field hidden" id="adminCodeField">
              <span>Verification code</span>
              <input type="text" id="adminCode" placeholder="6-digit code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" />
            </label>
            <button type="submit" class="signup-btn-primary admin-login-btn" id="loginSubmitBtn">Continue</button>
          </form>
        </div>
      </div>

      `;
    text = text.slice(0, loginStart) + newLogin + text.slice(loginEnd);
  }

  text = text.replace(
    "adminCodeInput.classList.remove('hidden');\n          adminCodeInput.required = true;",
    "document.getElementById('adminCodeField').classList.remove('hidden');\n          adminCodeInput.required = true;"
  );
  text = text.replace(
    "adminCodeInput.classList.add('hidden');\n          adminCodeInput.required = false;",
    "document.getElementById('adminCodeField').classList.add('hidden');\n          adminCodeInput.required = false;"
  );

  text = text.replace(/\n    \/\/ Theme toggle[\s\S]*?themeToggle\.addEventListener\('click'[\s\S]*?\}\);\n/, '\n');

  fs.writeFileSync(file, text);
  console.log('✅ index.html');
}

function migrateStandalone(filename, extraHead = '', extraCss = '') {
  const file = path.join(ADMIN, filename);
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8');

  const titleMatch = text.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch ? titleMatch[1] : 'Somo Admin';
  const preHead = text.match(/^[\s\S]*?<head>/);
  const prefix = preHead ? preHead[0] : '<!DOCTYPE html>\n<html lang="en">\n\n<head>';

  text = text.replace(
    /^[\s\S]*?<head>[\s\S]*?<\/head>/,
    `${prefix}\n${ADMIN_HEAD}${extraHead}\n  <title>${title}</title>\n</head>`
  );

  text = text.replace('<body>', '<body class="admin-portal-body">');
  text = text.replace(/<link rel="stylesheet" href="\.\.\/assets\/css\/global\.css">\s*/g, '');

  const styleMatch = text.match(/<style>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    let css = stripPurpleCss(styleMatch[1]);
    css = removeDuplicateShellRules(css);
    if (extraCss) css = `${extraCss}\n${css}`;
    text = text.replace(styleMatch[0], css.trim() ? `<style>\n${css}\n    </style>` : '');
  }

  text = text.replace(
    /<div class="logo">[\s\S]*?<\/div>/,
    `<div class="logo admin-sidebar-logo"><img src="/assets/brand/somo-icon-lizard.png" alt="Somo" width="36" height="36" /></div>`
  );

  fs.writeFileSync(file, text);
  console.log(`✅ ${filename}`);
}

function migrateAiAssistant() {
  const file = path.join(ADMIN, 'assets/css/admin-ai-assistant.css');
  let css = fs.readFileSync(file, 'utf8');
  css = stripPurpleCss(css);
  css = css.replace(
    '.admin-ai-message-user {\n  background: var(--accent-blue);\n  color: white;',
    '.admin-ai-message-user {\n  background: var(--somo-lizard-10, var(--panel-2));\n  color: var(--somo-msu);\n  border: 1px solid var(--somo-cap-border, var(--border));'
  );
  css = css.replace(
    '.admin-ai-input:focus {\n  border-color: var(--accent-blue);',
    '.admin-ai-input:focus {\n  border-color: var(--somo-lizard);'
  );
  css = css.replace(
    '.admin-ai-send {\n  padding: 10px 20px;\n  background: var(--accent-blue);\n  color: white;',
    '.admin-ai-send {\n  padding: 10px 20px;\n  background: var(--admin-cta, var(--somo-lizard));\n  color: var(--somo-msu);'
  );
  css = css.replace(
    '.admin-ai-send:hover:not(:disabled) {\n  background: #128a2e;',
    '.admin-ai-send:hover:not(:disabled) {\n  background: var(--admin-cta-hover, var(--somo-lizard-hover));'
  );
  fs.writeFileSync(file, css);
  console.log('✅ admin-ai-assistant.css');
}

migrateIndex();
for (const f of ['index.html', 'pipeline.html', 'lead.html', 'tenants.html']) {
  migrateStandalone(f, '');
}
migrateAiAssistant();
