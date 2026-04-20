#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

async function fetchAdminFeatureFlags(baseUrl, bearerToken) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/api/admin/feature-flags`;
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearerToken}`
    }
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`feature-flags request failed (${r.status}): ${txt.slice(0, 240)}`);
  }
  return await r.json();
}

function parseBooleanLike(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

async function main() {
  const envValue = parseBooleanLike(process.env.RESULT_SUMMARY_REASONING_V1);
  const out = {
    success: true,
    env_flag_value: envValue,
    env_raw: String(process.env.RESULT_SUMMARY_REASONING_V1 || ''),
    checked_at: new Date().toISOString(),
    remote_checked: false
  };

  const base = String(process.env.REASONING_FLAG_CHECK_BASE_URL || '').trim();
  const token = String(process.env.REASONING_FLAG_CHECK_BEARER || '').trim();
  if (base && token) {
    const remote = await fetchAdminFeatureFlags(base, token);
    const rows = Array.isArray(remote?.flags) ? remote.flags : [];
    const row = rows.find((x) => String(x?.flag_name || '') === 'RESULT_SUMMARY_REASONING_V1');
    out.remote_checked = true;
    out.remote_flag_value = row ? !!row.enabled_globally : null;
    out.remote_flag_row = row || null;
  } else {
    out.remote_reason = 'set REASONING_FLAG_CHECK_BASE_URL + REASONING_FLAG_CHECK_BEARER to check live admin flag';
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message || String(e) }, null, 2));
  process.exit(1);
});

