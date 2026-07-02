#!/usr/bin/env node
'use strict';

/**
 * Discover Athena sandbox practice_id, department_id, and appointment types.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { AthenaClient } = require('../services/pms/athena-client');
const { resolveAthenaConfig } = require('../services/pms/athena-config');

// Preview sandbox default; avoid probing random IDs (each used to burn OAuth quota).
const CANDIDATE_PRACTICE_IDS = [
  process.env.ATHENA_PRACTICE_ID,
  '195900'
].filter(Boolean);

async function tryPractice(client, practiceId) {
  const prev = client.config.practice_id;
  client.config.practice_id = practiceId;
  try {
    const info = await client.get('/practiceinfo', { practiceid: practiceId });
    const row = Array.isArray(info) ? info[0] : info;
    const name = row?.name || row?.practicename || info?.name || 'unknown';
    return { ok: true, practiceId, name, info };
  } catch (e) {
    return { ok: false, practiceId, error: e.message };
  } finally {
    client.config.practice_id = prev;
  }
}

async function listDepartments(client, practiceId) {
  client.config.practice_id = practiceId;
  const data = await client.get('/departments', { limit: 20, showalldepartments: true });
  const departments = data?.departments || data || [];
  return Array.isArray(departments) ? departments : [departments].filter(Boolean);
}

async function listAppointmentTypes(client, practiceId, departmentId) {
  client.config.practice_id = practiceId;
  const data = await client.get('/appointmenttypes', { departmentid: departmentId, limit: 20 });
  const types = data?.appointmenttypes || data || [];
  return Array.isArray(types) ? types : [types].filter(Boolean);
}

async function main() {
  const config = resolveAthenaConfig({}, null);
  if (!config.client_id || !config.client_secret) {
    console.error('❌ Set ATHENA_CLIENT_ID and ATHENA_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const client = new AthenaClient({}, null);
  await client.getAccessToken();
  console.log('✅ Token OK\n');

  let practiceId = config.practice_id;
  if (!practiceId) {
    console.log('Probing candidate practice IDs...');
    for (const pid of [...new Set(CANDIDATE_PRACTICE_IDS)]) {
      const r = await tryPractice(client, pid);
      console.log(r.ok ? `✅ ${pid}: ${r.name}` : `   ${pid}: ${r.error}`);
      if (r.ok) {
        practiceId = pid;
        break;
      }
    }
  } else {
    const r = await tryPractice(client, practiceId);
    if (!r.ok) {
      console.error(`❌ ATHENA_PRACTICE_ID=${practiceId} failed:`, r.error);
      process.exit(1);
    }
    console.log(`✅ practice ${practiceId}: ${r.name}`);
  }

  if (!practiceId) {
    console.error('\n❌ No working practice_id found. Check portal Context ID for your preview app.');
    process.exit(1);
  }

  const departments = await listDepartments(client, practiceId);
  console.log(`\nDepartments (${departments.length}):`);
  for (const d of departments.slice(0, 10)) {
    console.log(`  - id=${d.departmentid} name=${d.name || d.patientdepartmentname}`);
  }

  const departmentId = config.department_id || departments[0]?.departmentid;
  let types = [];
  if (departmentId) {
    types = await listAppointmentTypes(client, practiceId, departmentId);
    console.log(`\nAppointment types for department ${departmentId} (${types.length}):`);
    for (const t of types.slice(0, 10)) {
      console.log(`  - id=${t.appointmenttypeid} name=${t.name || t.patientdisplayname}`);
    }
  }

  const envPath = path.join(__dirname, '..', '.env');
  let envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const updates = {
    ATHENA_PRACTICE_ID: practiceId,
    ATHENA_DEPARTMENT_ID: departmentId ? String(departmentId) : '',
    ATHENA_DEFAULT_APPOINTMENTTYPE_ID: types[0]?.appointmenttypeid
      ? String(types[0].appointmenttypeid)
      : ''
  };

  for (const [key, val] of Object.entries(updates)) {
    if (!val) continue;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(envText)) {
      envText = envText.replace(re, `${key}=${val}`);
    } else {
      envText += `\n${key}=${val}\n`;
    }
    console.log(`\n📝 Suggested: ${key}=${val}`);
  }

  if (fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, envText);
    console.log('\n✅ Updated middleware-platform/.env with discovered IDs');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
