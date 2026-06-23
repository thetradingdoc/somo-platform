'use strict';

const { getOperatorCustomerId } = require('./voice-account-resolution');

function getDbFingerprint(dbModule) {
  const sqlite = dbModule.db;
  const customer_count = sqlite.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
  const latest_migration =
    sqlite.prepare('SELECT MAX(applied_at) AS m FROM schema_migrations').get().m || null;
  const voice_call_count = sqlite.prepare('SELECT COUNT(*) AS n FROM voice_call_log').get().n;
  const database_path =
    typeof sqlite.name === 'string' && sqlite.name ? sqlite.name : process.env.DB_PATH || null;
  return { customer_count, latest_migration, voice_call_count, database_path };
}

function countOperators(dbModule) {
  return dbModule.db
    .prepare(`SELECT COUNT(*) AS n FROM customers WHERE customer_type = 'operator'`)
    .get().n;
}

function listOperators(dbModule) {
  return dbModule.db
    .prepare(`SELECT id, email, customer_type FROM customers WHERE customer_type = 'operator'`)
    .all();
}

function countDuplicateEmails(dbModule) {
  return dbModule.db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT email FROM customers GROUP BY email HAVING COUNT(*) > 1
       )`
    )
    .get().n;
}

function foreignKeyViolationCount(dbModule) {
  try {
    const rows = dbModule.db.prepare('PRAGMA foreign_key_check').all();
    return Array.isArray(rows) ? rows.length : 0;
  } catch (err) {
    return { error: err.message };
  }
}

function assessVoiceOperatorReadiness(dbModule) {
  const operatorCustomerId = getOperatorCustomerId();
  const db_fingerprint = getDbFingerprint(dbModule);
  const operators = listOperators(dbModule);
  const duplicate_operator_count = operators.length;
  const duplicate_email_count = countDuplicateEmails(dbModule);
  const fk = foreignKeyViolationCount(dbModule);

  let operator_row = null;
  if (operatorCustomerId) {
    operator_row = dbModule.getCustomer(operatorCustomerId);
  }

  const operator_credits_row_present = operator_row
    ? !!dbModule.getCustomerCredits(operatorCustomerId)
    : false;

  const retell_agent_id =
    operator_row?.retell_agent_id ||
    process.env.RETELL_AGENT_ID ||
    process.env.RETELL_SALES_AGENT_ID ||
    null;

  const foreign_key_violations =
    typeof fk === 'object' && fk.error != null ? null : fk;

  const issues = [];
  if (operatorCustomerId && !operator_row) {
    issues.push(`operator customer ${operatorCustomerId} missing from DB`);
  }
  if (operatorCustomerId && operator_row && !operator_credits_row_present) {
    issues.push(`customer_credits row missing for ${operatorCustomerId}`);
  }
  if (duplicate_operator_count > 1) {
    issues.push(`${duplicate_operator_count} operator rows (expected 1)`);
  }
  if (duplicate_email_count > 0) {
    issues.push(`${duplicate_email_count} duplicate customer emails`);
  }
  if (typeof foreign_key_violations === 'number' && foreign_key_violations > 0) {
    issues.push(`${foreign_key_violations} foreign key violations`);
  }
  const fkSchemaWarning =
    typeof fk === 'object' && fk.error ? `foreign_key_check: ${fk.error}` : null;

  const ready =
    !!operatorCustomerId &&
    !!operator_row &&
    operator_credits_row_present &&
    duplicate_operator_count <= 1 &&
    duplicate_email_count === 0 &&
    (foreign_key_violations == null || foreign_key_violations === 0) &&
    issues.length === 0;

  return {
    ready,
    operator_customer_id: operatorCustomerId,
    operator_row_present: !!operator_row,
    operator_credits_row_present,
    duplicate_operator_count,
    duplicate_email_count,
    foreign_key_violations,
    foreign_key_check_error: typeof fk === 'object' && fk.error ? fk.error : null,
    foreign_key_schema_warning: fkSchemaWarning,
    operators,
    retell_agent_id,
    db_fingerprint,
    issues,
    cloud_run_revision: process.env.K_REVISION || null
  };
}

function assertVoiceOperatorReadinessOrExit(dbModule) {
  const operatorId = getOperatorCustomerId();
  if (!operatorId) return;

  const assessment = assessVoiceOperatorReadiness(dbModule);
  if (assessment.ready) return;

  const msg = `[voice-operator-readiness] ${assessment.issues.join('; ')}`;
  const strict = ['1', 'true', 'yes'].includes(
    String(process.env.VOICE_OPERATOR_READY_REQUIRED || '').toLowerCase()
  );

  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.error(`ERROR ${msg}`);
}

module.exports = {
  getDbFingerprint,
  listOperators,
  countDuplicateEmails,
  foreignKeyViolationCount,
  assessVoiceOperatorReadiness,
  assertVoiceOperatorReadinessOrExit
};
