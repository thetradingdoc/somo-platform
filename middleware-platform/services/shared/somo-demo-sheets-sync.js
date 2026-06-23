'use strict';

const crypto = require('crypto');
const fs = require('fs');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

function getServiceAccount() {
  const inline = process.env.SOMO_SHEETS_SERVICE_ACCOUNT_JSON;
  if (inline) {
    try { return JSON.parse(inline); } catch (_) {}
  }
  const path = process.env.SOMO_SHEETS_SERVICE_ACCOUNT_PATH;
  if (path && fs.existsSync(path)) {
    try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch (_) {}
  }
  return null;
}

function isEnabled() {
  return !!(process.env.SOMO_SHEETS_SPREADSHEET_ID && getServiceAccount());
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function getAccessToken() {
  const sa = getServiceAccount();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error('Sheets service account credentials are missing');
  }
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat,
    exp
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer.sign(sa.private_key, 'base64url');
  const assertion = `${unsigned}.${sig}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    throw new Error(`Sheets token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function appendRow(tabName, rowValues) {
  const spreadsheetId = process.env.SOMO_SHEETS_SPREADSHEET_ID;
  const accessToken = await getAccessToken();
  const range = encodeURIComponent(`${tabName}!A:ZZ`);
  const url = `${SHEETS_API}/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [rowValues] })
  });
  if (!res.ok) {
    throw new Error(`Sheets append failed (${tabName}): ${res.status} ${await res.text()}`);
  }
}

async function upsertLeadStatus(record = {}) {
  if (!isEnabled()) return false;
  const row = [
    record.demo_request_id || '',
    record.phone || '',
    record.name || '',
    record.language || '',
    record.country || '',
    record.city || '',
    record.practice_specialty || '',
    record.practice_size || '',
    record.status || '',
    record.call_start_at || '',
    record.call_end_at || '',
    record.questions_asked || '',
    record.updated_at || new Date().toISOString()
  ];
  await appendRow('LeadStatus', row);
  return true;
}

async function appendEventLog(record = {}) {
  if (!isEnabled()) return false;
  const row = [
    record.event_at || new Date().toISOString(),
    record.event_type || '',
    record.demo_request_id || '',
    record.call_id || '',
    record.phone || '',
    record.status || '',
    record.language || '',
    record.country || '',
    record.city || '',
    record.practice_specialty || '',
    record.practice_size || '',
    record.questions_asked || '',
    record.error_code || '',
    record.error_message || '',
    record.metadata_json ? JSON.stringify(record.metadata_json) : ''
  ];
  await appendRow('EventLog', row);
  return true;
}

module.exports = {
  isEnabled,
  appendEventLog,
  upsertLeadStatus
};

