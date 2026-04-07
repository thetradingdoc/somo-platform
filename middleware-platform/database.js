const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { hashApiKey } = require('./utils/api-keys');

const usePostgres = !!process.env.POSTGRES_URL;
let pgPool = null;
let pgSql = null;
/** impl-9: ensure Postgres voice_checkouts has triage_session_id before INSERT */
let voiceCheckoutsPgColumnEnsured = false;
async function ensureVoiceCheckoutsTriageColumnPg() {
  if (!usePostgres || !pgPool || voiceCheckoutsPgColumnEnsured) return;
  try {
    await pgPool.unsafe(
      'ALTER TABLE voice_checkouts ADD COLUMN IF NOT EXISTS triage_session_id TEXT'
    );
    voiceCheckoutsPgColumnEnsured = true;
  } catch (e) {
    console.warn('[postgres] voice_checkouts.triage_session_id column ensure failed:', e.message);
  }
}
let sqliteDb = null;
let activeAdapter = null;

const { normalizeToE164 } = require('./utils/phone-e164');

function normalizePhoneNumber(phone) {
  if (!phone) return phone;
  const e164 = normalizeToE164(phone);
  return e164 || phone;
}

/** Multiple E.164 / legacy forms for lookup until DB is fully backfilled. */
function phoneLookupCandidates(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  const out = [];
  const e164 = normalizeToE164(raw);
  if (e164) out.push(e164);
  const legacy = normalizePhoneNumber(raw);
  if (legacy && legacy !== e164) out.push(legacy);
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) out.push('+1' + digits);
  if (digits.length >= 11 && digits[0] === '1') out.push('+' + digits);
  if (digits.length >= 8 && digits.length <= 15 && !out.includes('+' + digits)) out.push('+' + digits);
  return [...new Set(out.filter(Boolean))];
}

// Use Azure's writable directory (/home) if available, otherwise use current directory
// Azure App Service uses /home for writable files
// CRITICAL: In production, always use /home (not process.env.HOME which may be /root)
// Azure App Service does not persist data outside /home
const env = process.env.NODE_ENV || 'development';
const isProdEnv = env === 'production' || env === 'prod';
const defaultDbDir = isProdEnv ? '/home' : (process.env.HOME || '/home' || __dirname);

// Environment-based database naming to separate production and test/dev data
// Production: middleware-prod.db
// Development: middleware-dev.db
// Test: middleware-test.db (if NODE_ENV=test)
// Note: env is already defined above

// CRITICAL: Check DB_NAME FIRST (highest priority), then fall back to environment-based naming
let dbFileName;
if (process.env.DB_NAME) {
  // DB_NAME environment variable takes highest priority
  dbFileName = process.env.DB_NAME;
  console.log(`📁 Using DB_NAME from environment: ${dbFileName}`);
} else if (env === 'production' || env === 'prod') {
  // Production defaults to middleware-prod.db
  dbFileName = 'middleware-prod.db';
} else if (env === 'test') {
  dbFileName = 'middleware-test.db';
} else {
  dbFileName = 'middleware-dev.db';
}

// DB_PATH overrides location (use project-local path to avoid readonly HOME dir)
const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(defaultDbDir, dbFileName);
console.log(`📁 Database path: ${dbPath} (environment: ${env})`);

// Ensure directory exists
try {
  if (!fs.existsSync(defaultDbDir)) {
    fs.mkdirSync(defaultDbDir, { recursive: true });
  }
} catch (e) {
  console.warn('⚠️  Could not create db directory, using current directory');
}

if (usePostgres) {
  try {
    const { createPool } = require('./utils/postgres');
    pgPool = createPool();
    pgSql = pgPool;
    console.log('🗄️  POSTGRES_URL detected – Postgres pool initialized');
  } catch (err) {
    console.error('❌ Failed to initialize Postgres pool:', err.message);
    process.exit(1);
  }
}

const db = new Database(dbPath);

// Environment helpers for better prod vs staging management
const isProduction = () => {
  return env === 'production' || env === 'prod';
};

const isStaging = () => {
  return env === 'development' || env === 'staging' || !isProduction();
};

// Add environment helpers to db object for use in other modules
db.isProduction = isProduction;
db.isStaging = isStaging;
db.getEnvironment = () => env;

console.log(`🌍 Environment: ${env} | Production: ${isProduction()} | Staging: ${isStaging()}`);

// Disable foreign key constraints during migrations (they can cause issues with ALTER TABLE)
db.pragma('foreign_keys = OFF');

function toBoolean(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function toJsonValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isSameStatus(a, b) {
  return (a || '').toString().trim().toLowerCase() === (b || '').toString().trim().toLowerCase();
}

function canTransitionAppointmentStatus(current, next) {
  let cur = (current || 'scheduled').toString().trim().toLowerCase();
  let nxt = (next || '').toString().trim().toLowerCase();
  if (cur === 'cancelled') cur = 'canceled';
  if (nxt === 'cancelled') nxt = 'canceled';
  if (!nxt) return false;
  if (cur === nxt) return true;

  // Canonical lifecycle (allow a few legacy states)
  const allowed = {
    pending: ['scheduled', 'confirmed', 'canceled'],
    pending_payment: ['scheduled', 'confirmed', 'canceled'],
    scheduled: ['confirmed', 'canceled', 'completed'],
    confirmed: ['completed', 'canceled'],
    completed: ['documented'],
    documented: [],
    canceled: []
  };

  if (!allowed[cur]) {
    // If we encounter an unknown legacy status, be conservative but don't brick prod.
    // Allow moving to canceled/confirmed/completed only.
    return ['canceled', 'cancelled', 'confirmed', 'completed', 'documented'].includes(nxt);
  }
  return allowed[cur].includes(nxt);
}

function canTransitionPaymentStatus(current, next) {
  const cur = (current || 'unpaid').toString().trim().toLowerCase();
  const nxt = (next || '').toString().trim().toLowerCase();
  if (!nxt) return false;
  if (cur === nxt) return true;
  const allowed = {
    unpaid: ['paid'],
    paid: ['refunded'],
    refunded: []
  };
  if (!allowed[cur]) return ['paid', 'refunded'].includes(nxt);
  return allowed[cur].includes(nxt);
}

function canTransitionCheckoutStatus(current, next) {
  const cur = (current || 'pending').toString().trim().toLowerCase();
  const nxt = (next || '').toString().trim().toLowerCase();
  if (!nxt) return false;
  if (cur === nxt) return true;
  const allowed = {
    pending: ['completed', 'failed', 'cancelled', 'canceled'],
    failed: [],
    completed: ['refunded'],
    refunded: [],
    cancelled: ['completed'], // Allow recovery when payment succeeded but webhook race marked cancelled
    canceled: ['completed']
  };
  if (!allowed[cur]) return ['completed', 'failed', 'refunded', 'cancelled', 'canceled'].includes(nxt);
  return allowed[cur].includes(nxt);
}

/**
 * Enqueue failed Postgres sync for retry (Section 2.2).
 * @param {string} entityType - clinic|clinic_phone|appointment|appointment_delete|voice_checkout|voice_call_log|function_call_log
 * @param {object} payload - Serializable payload for the sync operation
 * @param {number} priority - 1=high, 2=medium, 3=low
 * @param {string} errorMessage - Last error message
 */
function enqueuePostgresSyncRetry(entityType, payload, priority = 2, errorMessage = null) {
  try {
    const id = require('crypto').randomBytes(16).toString('hex');
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    db.prepare(`
      INSERT INTO postgres_sync_retry (id, entity_type, payload_json, priority, last_error, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, entityType, payloadJson, Math.min(3, Math.max(1, priority)), errorMessage || null);
    console.log(`📥 Postgres sync queued for retry: ${entityType} (priority ${priority})`);
  } catch (e) {
    console.error('❌ Failed to enqueue postgres sync retry:', e.message);
  }
}

/** Internal: returns Promise for worker retries. Public sync uses .catch(enqueue). */
function _syncClinicToPostgres(clinic) {
  if (!pgPool || !clinic) return Promise.resolve();
  return pgPool`
    INSERT INTO clinics (
      clinic_id, name, slug, phone_number, email, address, business_hours, services,
      retell_agent_id, retell_agent_status, merchant_id, is_active, created_at, updated_at
    ) VALUES (
      ${clinic.clinic_id},
      ${clinic.name},
      ${clinic.slug},
      ${clinic.phone_number || null},
      ${clinic.email || null},
      ${clinic.address || null},
      ${clinic.business_hours || null},
      ${toJsonValue(clinic.services)},
      ${clinic.retell_agent_id || null},
      ${clinic.retell_agent_status || 'pending'},
      ${clinic.merchant_id || null},
      ${toBoolean(clinic.is_active)},
      ${clinic.created_at || null},
      ${clinic.updated_at || null}
    )
    ON CONFLICT (clinic_id) DO UPDATE SET
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      phone_number = EXCLUDED.phone_number,
      email = EXCLUDED.email,
      address = EXCLUDED.address,
      business_hours = EXCLUDED.business_hours,
      services = EXCLUDED.services,
      retell_agent_id = EXCLUDED.retell_agent_id,
      retell_agent_status = EXCLUDED.retell_agent_status,
      merchant_id = EXCLUDED.merchant_id,
      is_active = EXCLUDED.is_active,
      updated_at = COALESCE(EXCLUDED.updated_at, NOW());
  `;
}
function syncClinicToPostgres(clinic) {
  _syncClinicToPostgres(clinic).catch(err => {
    console.error('❌ Postgres sync [clinics] failed:', err.message);
    console.error('   Clinic ID:', clinic.clinic_id);
    enqueuePostgresSyncRetry('clinic', clinic, 1, err.message);
  });
}

/** Internal: returns Promise for worker retries. */
function _syncClinicPhoneToPostgres(phoneRow) {
  if (!pgPool || !phoneRow) return Promise.resolve();
  return pgPool`
    INSERT INTO clinic_phone_numbers (phone_number, clinic_id, is_primary, created_at)
    VALUES (
      ${phoneRow.phone_number},
      ${phoneRow.clinic_id},
      ${toBoolean(phoneRow.is_primary !== undefined ? phoneRow.is_primary : true)},
      ${phoneRow.created_at || new Date().toISOString()}
    )
    ON CONFLICT (phone_number) DO UPDATE SET
      clinic_id = EXCLUDED.clinic_id,
      is_primary = EXCLUDED.is_primary,
      created_at = EXCLUDED.created_at;
  `;
}
function syncClinicPhoneToPostgres(phoneRow) {
  _syncClinicPhoneToPostgres(phoneRow).catch(err => {
    console.error('❌ Postgres sync [clinic_phone_numbers] failed:', err.message);
    console.error('   Phone:', phoneRow.phone_number, 'Clinic:', phoneRow.clinic_id);
    enqueuePostgresSyncRetry('clinic_phone', phoneRow, 1, err.message);
  });
}

/** Internal: returns Promise for worker retries. */
function _syncAppointmentToPostgres(appointment) {
  if (!pgPool || !appointment) return Promise.resolve();
  return pgPool`
    INSERT INTO appointments (
      id, clinic_id, patient_name, patient_phone, patient_email, patient_id,
      appointment_type, date, time, start_time, end_time, duration_minutes,
      provider, status, notes, reminder_sent, calendar_event_id, calendar_link,
      cancellation_reason, created_at, updated_at
    ) VALUES (
      ${appointment.id},
      ${appointment.clinic_id || null},
      ${appointment.patient_name},
      ${appointment.patient_phone || null},
      ${appointment.patient_email || null},
      ${appointment.patient_id || null},
      ${appointment.appointment_type || null},
      ${appointment.date},
      ${appointment.time},
      ${appointment.start_time || null},
      ${appointment.end_time || null},
      ${appointment.duration_minutes || null},
      ${appointment.provider || null},
      ${appointment.status || null},
      ${toJsonValue(appointment.notes)},
      ${toBoolean(appointment.reminder_sent)},
      ${appointment.calendar_event_id || null},
      ${appointment.calendar_link || null},
      ${appointment.cancellation_reason || null},
      ${appointment.created_at || null},
      ${appointment.updated_at || appointment.created_at || null}
    )
    ON CONFLICT (id) DO UPDATE SET
      clinic_id = EXCLUDED.clinic_id,
      patient_name = EXCLUDED.patient_name,
      patient_phone = EXCLUDED.patient_phone,
      patient_email = EXCLUDED.patient_email,
      patient_id = EXCLUDED.patient_id,
      appointment_type = EXCLUDED.appointment_type,
      date = EXCLUDED.date,
      time = EXCLUDED.time,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      duration_minutes = EXCLUDED.duration_minutes,
      provider = EXCLUDED.provider,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      reminder_sent = EXCLUDED.reminder_sent,
      calendar_event_id = EXCLUDED.calendar_event_id,
      calendar_link = EXCLUDED.calendar_link,
      cancellation_reason = EXCLUDED.cancellation_reason,
      updated_at = COALESCE(EXCLUDED.updated_at, NOW());
  `;
}
function syncAppointmentToPostgres(appointment) {
  _syncAppointmentToPostgres(appointment).catch(err => {
    console.error('❌ Postgres sync [appointments] failed:', err.message);
    console.error('   Appointment ID:', appointment.id, 'Patient:', appointment.patient_name);
    enqueuePostgresSyncRetry('appointment', appointment, 1, err.message);
  });
}

/** Internal: returns Promise for worker retries. */
function _deleteAppointmentFromPostgres(appointmentId) {
  if (!pgPool || !appointmentId) return Promise.resolve();
  return pgPool`DELETE FROM appointments WHERE id = ${appointmentId};`;
}
function deleteAppointmentFromPostgres(appointmentId) {
  _deleteAppointmentFromPostgres(appointmentId).catch(err => {
    console.error('❌ Postgres sync [appointments-delete] failed:', err.message);
    console.error('   Appointment ID:', appointmentId);
    enqueuePostgresSyncRetry('appointment_delete', { appointmentId }, 2, err.message);
  });
}

function _syncVoiceCheckoutToPostgres(checkout) {
  if (!pgPool || !checkout) return Promise.resolve();
  return pgPool`
    INSERT INTO voice_checkouts (
      id, clinic_id, merchant_id, product_id, product_name, quantity, amount,
      customer_phone, customer_name, customer_email, appointment_id, payment_method,
      status, payment_token, payment_intent_id, merchant_order_id,
      fhir_patient_id, fhir_encounter_id, created_at, completed_at
    ) VALUES (
      ${checkout.id},
      ${checkout.clinic_id || null},
      ${checkout.merchant_id},
      ${checkout.product_id},
      ${checkout.product_name},
      ${checkout.quantity || 1},
      ${checkout.amount},
      ${checkout.customer_phone},
      ${checkout.customer_name || null},
      ${checkout.customer_email || null},
      ${checkout.appointment_id || null},
      ${checkout.payment_method || null},
      ${checkout.status || 'pending'},
      ${checkout.payment_token || null},
      ${checkout.payment_intent_id || null},
      ${checkout.merchant_order_id || null},
      ${checkout.fhir_patient_id || null},
      ${checkout.fhir_encounter_id || null},
      ${checkout.created_at || null},
      ${checkout.completed_at || null}
    )
    ON CONFLICT (id) DO UPDATE SET
      clinic_id = EXCLUDED.clinic_id,
      merchant_id = EXCLUDED.merchant_id,
      product_id = EXCLUDED.product_id,
      product_name = EXCLUDED.product_name,
      quantity = EXCLUDED.quantity,
      amount = EXCLUDED.amount,
      customer_phone = EXCLUDED.customer_phone,
      customer_name = EXCLUDED.customer_name,
      customer_email = EXCLUDED.customer_email,
      appointment_id = EXCLUDED.appointment_id,
      payment_method = EXCLUDED.payment_method,
      status = EXCLUDED.status,
      payment_token = EXCLUDED.payment_token,
      payment_intent_id = EXCLUDED.payment_intent_id,
      merchant_order_id = EXCLUDED.merchant_order_id,
      fhir_patient_id = EXCLUDED.fhir_patient_id,
      fhir_encounter_id = EXCLUDED.fhir_encounter_id,
      completed_at = EXCLUDED.completed_at;
  `;
}
function syncVoiceCheckoutToPostgres(checkout) {
  _syncVoiceCheckoutToPostgres(checkout).catch(err => {
    console.error('❌ Postgres sync [voice_checkouts] failed:', err.message);
    console.error('   Checkout ID:', checkout.id, 'Amount:', checkout.amount);
    enqueuePostgresSyncRetry('voice_checkout', checkout, 2, err.message);
  });
}

/** Internal: returns Promise for worker retries. */
function _syncVoiceCallToPostgres(call) {
  if (!pgPool || !call) return Promise.resolve();
  return pgPool`
    INSERT INTO voice_call_log (
      id, customer_id, call_id, twilio_call_sid, call_duration_seconds, call_duration_minutes,
      credits_deducted, function_calls_count, status, twilio_cost_usd, retell_cost_usd,
      total_cost_usd, twilio_cost_calculated_usd, retell_cost_calculated_usd, cost_source,
      cost_updated_at, created_at
    ) VALUES (
      ${call.id},
      ${call.customer_id || null},
      ${call.call_id},
      ${call.twilio_call_sid || null},
      ${call.call_duration_seconds || null},
      ${call.call_duration_minutes || null},
      ${call.credits_deducted || 0},
      ${call.function_calls_count || 0},
      ${call.status || 'active'},
      ${call.twilio_cost_usd || null},
      ${call.retell_cost_usd || null},
      ${call.total_cost_usd || null},
      ${call.twilio_cost_calculated_usd || null},
      ${call.retell_cost_calculated_usd || null},
      ${call.cost_source || null},
      ${call.cost_updated_at || null},
      ${call.created_at || null}
    )
    ON CONFLICT (id) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      call_id = EXCLUDED.call_id,
      twilio_call_sid = EXCLUDED.twilio_call_sid,
      call_duration_seconds = EXCLUDED.call_duration_seconds,
      call_duration_minutes = EXCLUDED.call_duration_minutes,
      credits_deducted = EXCLUDED.credits_deducted,
      function_calls_count = EXCLUDED.function_calls_count,
      status = EXCLUDED.status,
      twilio_cost_usd = EXCLUDED.twilio_cost_usd,
      retell_cost_usd = EXCLUDED.retell_cost_usd,
      total_cost_usd = EXCLUDED.total_cost_usd,
      twilio_cost_calculated_usd = EXCLUDED.twilio_cost_calculated_usd,
      retell_cost_calculated_usd = EXCLUDED.retell_cost_calculated_usd,
      cost_source = EXCLUDED.cost_source,
      cost_updated_at = COALESCE(EXCLUDED.cost_updated_at, voice_call_log.cost_updated_at),
      created_at = COALESCE(EXCLUDED.created_at, voice_call_log.created_at);
  `;
}
function syncVoiceCallToPostgres(call) {
  _syncVoiceCallToPostgres(call).catch(err => {
    console.error('❌ Postgres sync [voice_call_log] failed:', err.message);
    console.error('   Call ID:', call.call_id, 'Customer:', call.customer_id);
    enqueuePostgresSyncRetry('voice_call_log', call, 2, err.message);
  });
}

/** Internal: returns Promise for worker retries. */
function _syncFunctionCallToPostgres(funcLog) {
  if (!pgPool || !funcLog) return Promise.resolve();
  return pgPool`
    INSERT INTO function_call_log (
      id, customer_id, call_id, function_name, parameters,
      response_time_ms, success, error_message, created_at
    ) VALUES (
      ${funcLog.id},
      ${funcLog.customer_id || null},
      ${funcLog.call_id || null},
      ${funcLog.function_name},
      ${toJsonValue(funcLog.parameters)},
      ${funcLog.response_time_ms || null},
      ${toBoolean(funcLog.success)},
      ${funcLog.error_message || null},
      ${funcLog.created_at || null}
    )
    ON CONFLICT (id) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      call_id = EXCLUDED.call_id,
      function_name = EXCLUDED.function_name,
      parameters = EXCLUDED.parameters,
      response_time_ms = EXCLUDED.response_time_ms,
      success = EXCLUDED.success,
      error_message = EXCLUDED.error_message,
      created_at = COALESCE(EXCLUDED.created_at, function_call_log.created_at);
  `;
}
function syncFunctionCallToPostgres(funcLog) {
  _syncFunctionCallToPostgres(funcLog).catch(err => {
    console.error('❌ Postgres sync [function_call_log] failed:', err.message);
    console.error('   Function:', funcLog.function_name, 'Call ID:', funcLog.call_id);
    enqueuePostgresSyncRetry('function_call_log', funcLog, 3, err.message);
  });
}

/**
 * Execute Postgres sync by entity type (for retry worker). Returns Promise.
 * @param {string} entityType - clinic|clinic_phone|appointment|appointment_delete|voice_checkout|voice_call_log|function_call_log
 * @param {object|string} payload - JSON payload or string
 */
async function executePostgresSync(entityType, payload) {
  const p = typeof payload === 'string' ? JSON.parse(payload || '{}') : (payload || {});
  switch (entityType) {
    case 'clinic': return _syncClinicToPostgres(p);
    case 'clinic_phone': return _syncClinicPhoneToPostgres(p);
    case 'appointment': return _syncAppointmentToPostgres(p);
    case 'appointment_delete': return _deleteAppointmentFromPostgres(p.appointmentId);
    case 'voice_checkout': return _syncVoiceCheckoutToPostgres(p);
    case 'voice_call_log': return _syncVoiceCallToPostgres(p);
    case 'function_call_log': return _syncFunctionCallToPostgres(p);
    default: throw new Error('Unknown entity_type: ' + entityType);
  }
}

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    api_url TEXT NOT NULL,
    webhook_url TEXT,
    enabled_platforms TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS merchant_api_keys (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    key_suffix TEXT NOT NULL,
    label TEXT,
    status TEXT DEFAULT 'active',
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    revoked_at DATETIME,
    revoked_by TEXT,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE INDEX IF NOT EXISTS idx_merchant_api_keys_merchant ON merchant_api_keys(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_merchant_api_keys_status ON merchant_api_keys(status);

  CREATE TABLE IF NOT EXISTS product_sync (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    merchant_product_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_product_id TEXT,
    sync_status TEXT DEFAULT 'pending',
    last_synced DATETIME,
    product_data TEXT,
    universal_data TEXT,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_order_id TEXT,
    merchant_order_id TEXT,
    product_id TEXT,
    amount REAL,
    status TEXT DEFAULT 'pending',
    customer_email TEXT,
    customer_phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS checkout_sessions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    session_data TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS ap2_mandates (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    mandate_data TEXT NOT NULL,
    signature TEXT,
    verified BOOLEAN DEFAULT FALSE,
    merchant_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS shopping_carts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    intent_mandate_id TEXT,
    items TEXT NOT NULL,
    subtotal REAL,
    tax REAL,
    shipping REAL,
    total REAL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    inventory INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    category TEXT,
    tags TEXT,
    protocol_stage TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS merchant_orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    product_id TEXT,
    quantity INTEGER NOT NULL,
    customer_email TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    shipping_address TEXT,
    total_amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'direct',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  CREATE INDEX IF NOT EXISTS idx_merchant_orders_merchant ON merchant_orders(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_merchant_orders_status ON merchant_orders(status);
  CREATE INDEX IF NOT EXISTS idx_merchant_orders_created ON merchant_orders(created_at);

  CREATE TABLE IF NOT EXISTS ap2_transactions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    intent_mandate_id TEXT,
    cart_mandate_id TEXT,
    payment_mandate_id TEXT,
    cart_id TEXT,
    order_id TEXT,
    amount REAL,
    status TEXT DEFAULT 'pending',
    audit_trail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS voice_checkouts (
    id TEXT PRIMARY KEY,
    clinic_id TEXT,
    merchant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    amount REAL NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT,
    customer_email TEXT,
    payment_token TEXT,
    payment_intent_id TEXT,
    merchant_order_id TEXT,
    fhir_patient_id TEXT,
    fhir_encounter_id TEXT,
    appointment_id TEXT,
    payment_method TEXT DEFAULT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    deleted_at DATETIME,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id),
    FOREIGN KEY (fhir_patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (fhir_encounter_id) REFERENCES fhir_encounters(resource_id)
  );

  -- ============================================
  -- PAYMENT RECEIPTS (patient portal)
  -- ============================================
  CREATE TABLE IF NOT EXISTS payment_receipts (
    id TEXT PRIMARY KEY,
    checkout_id TEXT UNIQUE,
    appointment_id TEXT,
    patient_id TEXT,
    patient_email TEXT,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    payment_method TEXT,
    external_payment_id TEXT,
    status TEXT DEFAULT 'issued',
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    metadata TEXT,
    FOREIGN KEY (checkout_id) REFERENCES voice_checkouts(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE INDEX IF NOT EXISTS idx_payment_receipts_patient_id ON payment_receipts(patient_id);
  CREATE INDEX IF NOT EXISTS idx_payment_receipts_patient_email ON payment_receipts(patient_email);
  CREATE INDEX IF NOT EXISTS idx_payment_receipts_appointment_id ON payment_receipts(appointment_id);

  CREATE TABLE IF NOT EXISTS voice_agent_settings (
    merchant_id TEXT PRIMARY KEY,
    retell_agent_id TEXT,
    enabled INTEGER DEFAULT 1,
    greeting TEXT,
    after_hours_message TEXT,
    business_hours TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    type TEXT NOT NULL, -- credit | debit | refund
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USDC',
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  -- ============================================
  -- AUTOMATION TABLES
  -- ============================================

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- email | sms
    subject TEXT,
    content TEXT NOT NULL,
    variables TEXT, -- JSON array of available variables
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    trigger TEXT NOT NULL, -- order_completed | customer_created | etc.
    action TEXT NOT NULL, -- send_email | send_sms | call_customer
    template_id TEXT,
    enabled BOOLEAN DEFAULT 1,
    conditions TEXT, -- JSON object for conditional logic
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (template_id) REFERENCES templates(id)
  );

  CREATE TABLE IF NOT EXISTS message_history (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    customer_id TEXT,
    type TEXT NOT NULL, -- email | sms
    recipient TEXT NOT NULL, -- email address or phone number
    content TEXT NOT NULL,
    subject TEXT,
    status TEXT DEFAULT 'pending', -- pending | sent | delivered | failed | bounced
    provider_id TEXT, -- External provider message ID (e.g., Twilio SID, SendGrid ID)
    sent_at DATETIME,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE INDEX IF NOT EXISTS idx_templates_merchant_id ON templates(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type);
  CREATE INDEX IF NOT EXISTS idx_automation_rules_merchant_id ON automation_rules(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(trigger);
  CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);
  CREATE INDEX IF NOT EXISTS idx_message_history_merchant_id ON message_history(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_message_history_customer_id ON message_history(customer_id);
  CREATE INDEX IF NOT EXISTS idx_message_history_type ON message_history(type);
  CREATE INDEX IF NOT EXISTS idx_message_history_status ON message_history(status);
  CREATE INDEX IF NOT EXISTS idx_message_history_created_at ON message_history(created_at);

  CREATE TABLE IF NOT EXISTS promotions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL, -- percentage | fixed_amount
    discount_value REAL NOT NULL,
    code TEXT UNIQUE, -- Optional promotion code
    product_ids TEXT, -- JSON array of product IDs (null = all products)
    customer_segment TEXT DEFAULT 'all', -- all | new | returning | vip
    start_date DATETIME,
    end_date DATETIME,
    enabled INTEGER DEFAULT 1,
    max_uses INTEGER, -- null = unlimited
    current_uses INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE INDEX IF NOT EXISTS idx_promotions_merchant_id ON promotions(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
  CREATE INDEX IF NOT EXISTS idx_promotions_enabled ON promotions(enabled);
  CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(start_date, end_date);

  CREATE TABLE IF NOT EXISTS payment_tokens (
    token TEXT PRIMARY KEY,
    checkout_id TEXT NOT NULL,
    verification_code TEXT,
    verification_code_expires DATETIME,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME,
    FOREIGN KEY (checkout_id) REFERENCES voice_checkouts(id)
  );

  -- ============================================
  -- FRAUD DETECTION TABLES
  -- ============================================

  CREATE TABLE IF NOT EXISTS fraud_checks (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    merchant_id TEXT,
    agent_platform TEXT,
    risk_score INTEGER NOT NULL,
    risk_level TEXT NOT NULL,
    signals TEXT,
    is_fraud BOOLEAN DEFAULT FALSE,
    requires_verification BOOLEAN DEFAULT FALSE,
    reviewed BOOLEAN DEFAULT FALSE,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    action_taken TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS fraud_blacklist (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    added_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, value)
  );

  CREATE TABLE IF NOT EXISTS fraud_whitelist (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    added_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, value)
  );

  CREATE TABLE IF NOT EXISTS fraud_attempts (
    id TEXT PRIMARY KEY,
    call_id TEXT,
    patient_phone TEXT,
    initial_name TEXT,
    provided_name TEXT,
    member_id TEXT,
    fraud_type TEXT NOT NULL,
    risk_score INTEGER NOT NULL,
    blocked BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agent_stats (
    platform TEXT PRIMARY KEY,
    total_transactions INTEGER DEFAULT 0,
    fraud_count INTEGER DEFAULT 0,
    chargeback_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Create indexes for performance
  CREATE INDEX IF NOT EXISTS idx_fraud_checks_customer_phone ON fraud_checks(customer_phone);
  CREATE INDEX IF NOT EXISTS idx_fraud_checks_customer_email ON fraud_checks(customer_email);
  CREATE INDEX IF NOT EXISTS idx_fraud_checks_risk_score ON fraud_checks(risk_score);
  CREATE INDEX IF NOT EXISTS idx_fraud_checks_created_at ON fraud_checks(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_customer_phone ON transactions(customer_phone);
  CREATE INDEX IF NOT EXISTS idx_transactions_customer_email ON transactions(customer_email);
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

  -- ============================================
  -- FHIR RESOURCES - Healthcare Data Layer
  -- ============================================

  CREATE TABLE IF NOT EXISTS fhir_patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id TEXT UNIQUE NOT NULL,
    version_id INTEGER DEFAULT 1,
    resource_data TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    name TEXT,
    is_deleted BOOLEAN DEFAULT 0,
    profile_verified INTEGER DEFAULT 0,
    insurance_verified INTEGER DEFAULT 0,
    profile_verified_at DATETIME,
    insurance_verified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Add unique constraint on phone (when not deleted and phone is not null)
  -- Note: SQLite doesn't support partial unique indexes directly, so we'll enforce this at application level
  -- Create index for fast phone lookups
  CREATE UNIQUE INDEX IF NOT EXISTS idx_fhir_patients_phone_active ON fhir_patients(phone) WHERE phone IS NOT NULL AND is_deleted = 0;

  CREATE TABLE IF NOT EXISTS fhir_encounters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id TEXT UNIQUE NOT NULL,
    version_id INTEGER DEFAULT 1,
    resource_data TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    status TEXT NOT NULL,
    call_id TEXT,
    start_time DATETIME,
    end_time DATETIME,
    is_deleted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE TABLE IF NOT EXISTS fhir_communications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id TEXT UNIQUE NOT NULL,
    version_id INTEGER DEFAULT 1,
    resource_data TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    encounter_id TEXT,
    sent_time DATETIME,
    is_deleted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (encounter_id) REFERENCES fhir_encounters(resource_id)
  );

  CREATE TABLE IF NOT EXISTS fhir_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id TEXT UNIQUE NOT NULL,
    version_id INTEGER DEFAULT 1,
    resource_data TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    encounter_id TEXT,
    code TEXT,
    value TEXT,
    effective_date DATETIME,
    is_deleted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (encounter_id) REFERENCES fhir_encounters(resource_id)
  );

  CREATE TABLE IF NOT EXISTS fhir_document_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id TEXT UNIQUE NOT NULL,
    version_id INTEGER DEFAULT 1,
    resource_data TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    encounter_id TEXT,
    date DATETIME,
    status TEXT DEFAULT 'current',
    is_deleted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (encounter_id) REFERENCES fhir_encounters(resource_id)
  );

  CREATE TABLE IF NOT EXISTS fhir_provenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id TEXT UNIQUE NOT NULL,
    version_id INTEGER DEFAULT 1,
    resource_data TEXT NOT NULL,
    patient_id TEXT,
    target_resource_type TEXT,
    target_resource_id TEXT,
    recorded_at DATETIME,
    is_deleted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fhir_consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id TEXT UNIQUE NOT NULL,
    version_id INTEGER DEFAULT 1,
    resource_data TEXT NOT NULL,
    patient_id TEXT,
    status TEXT,
    scope_code TEXT,
    category_code TEXT,
    is_deleted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fhir_bulk_export_jobs (
    id TEXT PRIMARY KEY,
    requester_scope TEXT,
    requester_sub TEXT,
    patient_id TEXT,
    status TEXT NOT NULL,
    since DATETIME,
    types TEXT,
    output_base_url TEXT,
    error TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fhir_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    user_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- FHIR Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_fhir_patients_phone ON fhir_patients(phone);
  CREATE INDEX IF NOT EXISTS idx_fhir_patients_email ON fhir_patients(email);
  CREATE INDEX IF NOT EXISTS idx_fhir_patients_name ON fhir_patients(name);
  CREATE INDEX IF NOT EXISTS idx_fhir_encounters_patient_id ON fhir_encounters(patient_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_encounters_call_id ON fhir_encounters(call_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_encounters_start_time ON fhir_encounters(start_time);
  CREATE INDEX IF NOT EXISTS idx_fhir_communications_patient_id ON fhir_communications(patient_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_communications_encounter_id ON fhir_communications(encounter_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_observations_patient_id ON fhir_observations(patient_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_observations_encounter_id ON fhir_observations(encounter_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_document_references_patient_id ON fhir_document_references(patient_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_document_references_encounter_id ON fhir_document_references(encounter_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_document_references_date ON fhir_document_references(date);
  CREATE INDEX IF NOT EXISTS idx_fhir_provenance_patient_id ON fhir_provenance(patient_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_provenance_target ON fhir_provenance(target_resource_type, target_resource_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_consents_patient_id ON fhir_consents(patient_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_bulk_export_jobs_status ON fhir_bulk_export_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_fhir_audit_resource_type ON fhir_audit_log(resource_type);
  CREATE INDEX IF NOT EXISTS idx_fhir_audit_resource_id ON fhir_audit_log(resource_id);
  CREATE INDEX IF NOT EXISTS idx_fhir_audit_timestamp ON fhir_audit_log(timestamp);

  -- ============================================
  -- EHR INTEGRATION TABLES
  -- ============================================

  CREATE TABLE IF NOT EXISTS ehr_connections (
    id TEXT PRIMARY KEY,
    provider_id TEXT,
    ehr_name TEXT NOT NULL,
    client_id TEXT,
    client_secret TEXT,
    auth_url TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at DATETIME,
    state_token TEXT,
    patient_id TEXT,
    connected_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ehr_encounters (
    id TEXT PRIMARY KEY,
    fhir_encounter_id TEXT UNIQUE NOT NULL,
    patient_id TEXT NOT NULL,
    appointment_id TEXT,
    provider_id TEXT,
    start_time DATETIME,
    end_time DATETIME,
    status TEXT,
    raw_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  );

  CREATE TABLE IF NOT EXISTS ehr_conditions (
    id TEXT PRIMARY KEY,
    ehr_encounter_id TEXT NOT NULL,
    icd10_code TEXT NOT NULL,
    description TEXT,
    is_primary BOOLEAN DEFAULT 0,
    raw_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ehr_encounter_id) REFERENCES ehr_encounters(id)
  );

  CREATE TABLE IF NOT EXISTS ehr_procedures (
    id TEXT PRIMARY KEY,
    ehr_encounter_id TEXT NOT NULL,
    cpt_code TEXT NOT NULL,
    modifier TEXT,
    description TEXT,
    raw_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ehr_encounter_id) REFERENCES ehr_encounters(id)
  );

  CREATE TABLE IF NOT EXISTS ehr_observations (
    id TEXT PRIMARY KEY,
    ehr_encounter_id TEXT NOT NULL,
    type TEXT,
    value TEXT,
    unit TEXT,
    raw_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ehr_encounter_id) REFERENCES ehr_encounters(id)
  );

  -- EHR Indexes
  CREATE INDEX IF NOT EXISTS idx_ehr_connections_provider_id ON ehr_connections(provider_id);
  CREATE INDEX IF NOT EXISTS idx_ehr_connections_ehr_name ON ehr_connections(ehr_name);
  CREATE INDEX IF NOT EXISTS idx_ehr_encounters_patient_id ON ehr_encounters(patient_id);
  CREATE INDEX IF NOT EXISTS idx_ehr_encounters_appointment_id ON ehr_encounters(appointment_id);
  CREATE INDEX IF NOT EXISTS idx_ehr_encounters_start_time ON ehr_encounters(start_time);
  CREATE INDEX IF NOT EXISTS idx_ehr_conditions_encounter_id ON ehr_conditions(ehr_encounter_id);
  CREATE INDEX IF NOT EXISTS idx_ehr_conditions_icd10_code ON ehr_conditions(icd10_code);
  CREATE INDEX IF NOT EXISTS idx_ehr_procedures_encounter_id ON ehr_procedures(ehr_encounter_id);
  CREATE INDEX IF NOT EXISTS idx_ehr_procedures_cpt_code ON ehr_procedures(cpt_code);
  CREATE INDEX IF NOT EXISTS idx_ehr_observations_encounter_id ON ehr_observations(ehr_encounter_id);
`);

// Run migrations AFTER tables are created
// Migration: Add appointment_id column if it doesn't exist (for existing databases)
try {
  // Check if voice_checkouts table exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='voice_checkouts'
  `).get();

  if (tableExists) {
    const tableInfo = db.prepare(`PRAGMA table_info(voice_checkouts)`).all();
    const hasAppointmentId = tableInfo.some(col => col.name === 'appointment_id');
    if (!hasAppointmentId) {
      console.log('📦 Adding appointment_id column to voice_checkouts table...');
      db.exec(`ALTER TABLE voice_checkouts ADD COLUMN appointment_id TEXT;`);
      console.log('✅ Migration complete: appointment_id column added');
    }
    const hasCheckoutClinic = tableInfo.some(col => col.name === 'clinic_id');
    if (!hasCheckoutClinic) {
      console.log('📦 Adding clinic_id column to voice_checkouts table...');
      db.exec(`ALTER TABLE voice_checkouts ADD COLUMN clinic_id TEXT;`);
      console.log('✅ Migration complete: clinic_id column added to voice_checkouts');
    }
    // Create index after column is added (or if it already exists)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_checkouts_appointment_id ON voice_checkouts(appointment_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_checkouts_clinic_id ON voice_checkouts(clinic_id);`);
  }
} catch (migrationError) {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  if (isProduction) {
    console.error('❌ CRITICAL: Migration failed in production:', migrationError.message);
    console.error('   Database schema may be inconsistent. Server cannot start safely.');
    process.exit(1);
  } else {
    console.warn('⚠️  Migration check failed:', migrationError.message);
  }
}

// B-1: Unique constraint on slot booking to prevent race-condition double-booking
try {
  const apptExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='appointments'`).get();
  if (apptExists) {
    const idxExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_appointments_slot_unique'`).get();
    if (!idxExists) {
      console.log('📦 B-1: Creating unique index on appointments (clinic_id, start_time) for active slots...');
      db.exec(`CREATE UNIQUE INDEX idx_appointments_slot_unique ON appointments(clinic_id, start_time) WHERE deleted_at IS NULL AND (status IS NULL OR status NOT IN ('cancelled','no_show'))`);
      console.log('✅ B-1: Slot booking constraint added');
    }
  }
} catch (migrationError) {
  console.warn('⚠️  B-1 slot constraint migration failed:', migrationError.message);
}

// Migration: Add verification_code columns to payment_tokens if they don't exist
try {
  // Check if payment_tokens table exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='payment_tokens'
  `).get();

  if (tableExists) {
    const paymentTokensInfo = db.prepare(`PRAGMA table_info(payment_tokens)`).all();
    const hasVerificationCode = paymentTokensInfo.some(col => col.name === 'verification_code');
    const hasVerificationCodeExpires = paymentTokensInfo.some(col => col.name === 'verification_code_expires');

    if (!hasVerificationCode) {
      console.log('📦 Adding verification_code column to payment_tokens table...');
      db.exec(`ALTER TABLE payment_tokens ADD COLUMN verification_code TEXT;`);
      console.log('✅ Migration complete: verification_code column added');
    }

    if (!hasVerificationCodeExpires) {
      console.log('📦 Adding verification_code_expires column to payment_tokens table...');
      db.exec(`ALTER TABLE payment_tokens ADD COLUMN verification_code_expires DATETIME;`);
      console.log('✅ Migration complete: verification_code_expires column added');
    }
  }
} catch (migrationError) {
  console.warn('⚠️  Payment tokens migration check failed:', migrationError.message);
}

// Migration: products.tags / protocol_stage for catalog UI (serum labels, filtering)
try {
  const productsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='products'`).get();
  if (productsExists) {
    const pinfo = db.prepare(`PRAGMA table_info(products)`).all();
    if (!pinfo.some((c) => c.name === 'tags')) {
      console.log('📦 Adding tags column to products table...');
      db.exec(`ALTER TABLE products ADD COLUMN tags TEXT;`);
    }
    if (!pinfo.some((c) => c.name === 'protocol_stage')) {
      console.log('📦 Adding protocol_stage column to products table...');
      db.exec(`ALTER TABLE products ADD COLUMN protocol_stage TEXT;`);
    }
  }
} catch (migrationError) {
  console.warn('⚠️  products tags migration check failed:', migrationError.message);
}

// Migration: Add eligibility detail columns if they don't exist
try {
  const eligExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='eligibility_checks'`).get();
  if (eligExists) {
    const info = db.prepare(`PRAGMA table_info(eligibility_checks)`).all();
    const needDeductTotal = !info.some(c => c.name === 'deductible_total');
    const needDeductRemain = !info.some(c => c.name === 'deductible_remaining');
    const needCoins = !info.some(c => c.name === 'coinsurance_percent');
    const needPlan = !info.some(c => c.name === 'plan_summary');
    const needOopMax = !info.some(c => c.name === 'oop_max');
    const needOopMet = !info.some(c => c.name === 'oop_met');
    if (needDeductTotal) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN deductible_total REAL;`);
    if (needDeductRemain) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN deductible_remaining REAL;`);
    if (needCoins) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN coinsurance_percent REAL;`);
    if (needPlan) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN plan_summary TEXT;`);
    if (needOopMax) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN oop_max REAL;`);
    if (needOopMet) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN oop_met REAL;`);
  }
} catch (migrationError) {
  console.warn('⚠️  Eligibility checks migration failed:', migrationError.message);
}

// Migration: code_acceptance_rates table (Tiba Phase 4 - φ^historical_i)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_acceptance_rates (
      payer_id TEXT NOT NULL,
      cpt_code TEXT NOT NULL,
      acceptance_count INTEGER DEFAULT 0,
      denial_count INTEGER DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (payer_id, cpt_code)
    );
    CREATE INDEX IF NOT EXISTS idx_code_acceptance_payer ON code_acceptance_rates(payer_id);
    CREATE INDEX IF NOT EXISTS idx_code_acceptance_cpt ON code_acceptance_rates(cpt_code);
  `);
} catch (migrationError) {
  console.warn('⚠️  code_acceptance_rates migration failed:', migrationError.message);
}

// Migration: real_time_plan_paid for Tiba reconciliation (Phase 5)
try {
  const icExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='insurance_claims'`).get();
  if (icExists) {
    const info = db.prepare(`PRAGMA table_info(insurance_claims)`).all();
    if (!info.some(c => c.name === 'real_time_plan_paid')) {
      db.exec(`ALTER TABLE insurance_claims ADD COLUMN real_time_plan_paid REAL;`);
    }
  }
} catch (migrationError) {
  console.warn('⚠️  real_time_plan_paid migration failed:', migrationError.message);
}

// Migration: settlement state columns (Tiba Phase 3.8)
try {
  const ic2 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='insurance_claims'`).get();
  if (ic2) {
    const info2 = db.prepare(`PRAGMA table_info(insurance_claims)`).all();
    const cols = ['settlement_state', 'settlement_aggregate_confidence', 'settlement_amount_released', 'settlement_escrow_remainder', 'settlement_decision'];
    for (const col of cols) {
      if (!info2.some(c => c.name === col)) {
        db.exec(`ALTER TABLE insurance_claims ADD COLUMN ${col} ${col.includes('decision') ? 'TEXT' : 'REAL'};`);
      }
    }
  }
} catch (migrationError) {
  console.warn('⚠️  settlement state migration failed:', migrationError.message);
}

// Migration: provider_npi on insurance_claims (Tiba Phase 3.7)
try {
  const ic3 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='insurance_claims'`).get();
  if (ic3) {
    const info3 = db.prepare(`PRAGMA table_info(insurance_claims)`).all();
    if (!info3.some(c => c.name === 'provider_npi')) {
      db.exec(`ALTER TABLE insurance_claims ADD COLUMN provider_npi TEXT;`);
    }
  }
} catch (migrationError) {
  console.warn('⚠️  provider_npi migration failed:', migrationError.message);
}

// Migration: proof_of_care_hash (Tiba Spec 5.3, 5.4)
try {
  const ic4 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='insurance_claims'`).get();
  if (ic4) {
    const info4 = db.prepare(`PRAGMA table_info(insurance_claims)`).all();
    if (!info4.some(c => c.name === 'proof_of_care_hash')) {
      db.exec(`ALTER TABLE insurance_claims ADD COLUMN proof_of_care_hash TEXT;`);
      console.log('✅ Migration complete: proof_of_care_hash added to insurance_claims');
    }
  }
} catch (migrationError) {
  console.warn('⚠️  proof_of_care_hash migration failed:', migrationError.message);
}

// Migration: provider_trust_metrics (Tiba Phase 3.7)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_trust_metrics (
      provider_npi TEXT PRIMARY KEY,
      trust_score REAL DEFAULT 1.0,
      denial_rate REAL DEFAULT 0,
      coding_variance REAL DEFAULT 0,
      volume_anomaly_score REAL DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const ptm = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='provider_trust_metrics'`).get();
  if (ptm) {
    const info = db.prepare('PRAGMA table_info(provider_trust_metrics)').all();
    if (!info.some(c => c.name === 'coding_variance')) {
      db.exec('ALTER TABLE provider_trust_metrics ADD COLUMN coding_variance REAL DEFAULT 0;');
    }
    if (!info.some(c => c.name === 'volume_anomaly_score')) {
      db.exec('ALTER TABLE provider_trust_metrics ADD COLUMN volume_anomaly_score REAL DEFAULT 0;');
    }
  }
} catch (migrationError) {
  console.warn('⚠️  provider_trust_metrics migration failed:', migrationError.message);
}

// Migration: Add EHR sync columns to appointments table
try {
  const apptExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='appointments'`).get();
  if (apptExists) {
    const info = db.prepare(`PRAGMA table_info(appointments)`).all();
    const needEhrSynced = !info.some(c => c.name === 'ehr_synced');
    const needPrimaryIcd10 = !info.some(c => c.name === 'primary_icd10');
    const needPrimaryCpt = !info.some(c => c.name === 'primary_cpt');
    if (needEhrSynced) {
      console.log('📦 Adding ehr_synced column to appointments table...');
      db.exec(`ALTER TABLE appointments ADD COLUMN ehr_synced BOOLEAN DEFAULT 0;`);
    }
    if (needPrimaryIcd10) {
      console.log('📦 Adding primary_icd10 column to appointments table...');
      db.exec(`ALTER TABLE appointments ADD COLUMN primary_icd10 TEXT;`);
    }
    if (needPrimaryCpt) {
      console.log('📦 Adding primary_cpt column to appointments table...');
      db.exec(`ALTER TABLE appointments ADD COLUMN primary_cpt TEXT;`);
    }
    if (needEhrSynced || needPrimaryIcd10 || needPrimaryCpt) {
      console.log('✅ Migration complete: EHR columns added to appointments');
    }
    const needVideoRoom = !info.some(c => c.name === 'video_room_name');
    if (needVideoRoom) {
      console.log('📦 Adding video_room_name column to appointments table...');
      db.exec(`ALTER TABLE appointments ADD COLUMN video_room_name TEXT;`);
      console.log('✅ Migration complete: video_room_name added to appointments');
    }
    // Backfill: every appointment gets a stable video room (appt-{id} or id if already appt-*)
    try {
      const backfill = db.prepare(`
        UPDATE appointments SET video_room_name = CASE
          WHEN id LIKE 'appt-%' THEN id
          ELSE 'appt-' || id
        END WHERE video_room_name IS NULL
      `).run();
      if (backfill.changes > 0) {
        console.log('✅ Migration complete: video_room_name backfilled for', backfill.changes, 'appointments');
      }
    } catch (e) {
      console.warn('⚠️  video_room_name backfill skipped:', e.message);
    }
  }
} catch (migrationError) {
  console.warn('⚠️  Appointments EHR migration failed:', migrationError.message);
}

// Migration: Add Google calendar fields to users table
try {
  const usersInfo = db.prepare(`PRAGMA table_info(users)`).all();
  const addColumnIfMissing = (columnName, sql) => {
    if (!usersInfo.some(c => c.name === columnName)) {
      console.log(`📦 Adding ${columnName} column to users table...`);
      db.exec(sql);
    }
  };

  addColumnIfMissing('google_calendar_connected', `ALTER TABLE users ADD COLUMN google_calendar_connected BOOLEAN DEFAULT 0;`);
  addColumnIfMissing('google_calendar_email', `ALTER TABLE users ADD COLUMN google_calendar_email TEXT;`);
  addColumnIfMissing('google_calendar_id', `ALTER TABLE users ADD COLUMN google_calendar_id TEXT;`);
  addColumnIfMissing('google_calendar_name', `ALTER TABLE users ADD COLUMN google_calendar_name TEXT;`);
  addColumnIfMissing('google_calendar_timezone', `ALTER TABLE users ADD COLUMN google_calendar_timezone TEXT;`);
  addColumnIfMissing('google_refresh_token', `ALTER TABLE users ADD COLUMN google_refresh_token TEXT;`);
  addColumnIfMissing('google_access_token', `ALTER TABLE users ADD COLUMN google_access_token TEXT;`);
  addColumnIfMissing('google_token_expiry', `ALTER TABLE users ADD COLUMN google_token_expiry INTEGER;`);
  addColumnIfMissing('google_calendar_scopes', `ALTER TABLE users ADD COLUMN google_calendar_scopes TEXT;`);
  addColumnIfMissing('google_calendar_sync_at', `ALTER TABLE users ADD COLUMN google_calendar_sync_at DATETIME;`);
  addColumnIfMissing('google_calendar_last_error', `ALTER TABLE users ADD COLUMN google_calendar_last_error TEXT;`);

  console.log('✅ Migration complete: Google Calendar columns ensured on users');
} catch (migrationError) {
  console.warn('⚠️  Users Google Calendar migration failed:', migrationError.message);
}

// ============================================
// MULTI-TENANT: CLINICS AND PHONE NUMBERS
// ============================================

// Create clinics table
db.exec(`
  CREATE TABLE IF NOT EXISTS clinics (
    clinic_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    phone_number TEXT,
    email TEXT,
    address TEXT,
    business_hours TEXT,
    services TEXT,
    retell_agent_id TEXT,
    retell_agent_status TEXT DEFAULT 'pending',
    merchant_id TEXT,
    is_active BOOLEAN DEFAULT 1,
    surge_enabled BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clinic_phone_numbers (
    phone_number TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id)
  );

  CREATE INDEX IF NOT EXISTS idx_clinics_slug ON clinics(slug);
  CREATE INDEX IF NOT EXISTS idx_clinics_phone ON clinics(phone_number);
  CREATE INDEX IF NOT EXISTS idx_clinic_phone_numbers_clinic ON clinic_phone_numbers(clinic_id);
  CREATE INDEX IF NOT EXISTS idx_clinic_phone_numbers_phone ON clinic_phone_numbers(phone_number);

  -- ============================================
  -- VISIT PRICING (per clinic + appointment type)
  -- ============================================
  CREATE TABLE IF NOT EXISTS visit_pricing (
    clinic_id TEXT NOT NULL,
    appointment_type TEXT NOT NULL,
    base_price REAL NOT NULL,
    surge_multiplier REAL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (clinic_id, appointment_type),
    FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id)
  );

  CREATE INDEX IF NOT EXISTS idx_visit_pricing_clinic ON visit_pricing(clinic_id);
  CREATE INDEX IF NOT EXISTS idx_visit_pricing_appt_type ON visit_pricing(appointment_type);

  -- ============================================
  -- PROVIDER STATUS (online/offline + availability)
  -- ============================================
  CREATE TABLE IF NOT EXISTS provider_status (
    email TEXT PRIMARY KEY,
    is_online BOOLEAN DEFAULT 0,
    availability_rules TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_provider_status_online ON provider_status(is_online) WHERE is_online = 1;

  CREATE TABLE IF NOT EXISTS provider_availability_blocks (
    id TEXT PRIMARY KEY,
    provider_email TEXT NOT NULL,
    block_type TEXT NOT NULL,
    start_datetime TEXT NOT NULL,
    end_datetime TEXT NOT NULL,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_availability_blocks_provider ON provider_availability_blocks(provider_email);

  -- ============================================
  -- STRIPE ISSUING: CARDHOLDERS AND CARDS
  -- ============================================

  CREATE TABLE IF NOT EXISTS stripe_cardholders (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    clinic_id TEXT,
    stripe_cardholder_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'individual',
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    billing_address TEXT,
    status TEXT DEFAULT 'active',
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (clinic_id) REFERENCES clinics(id)
  );

  CREATE TABLE IF NOT EXISTS stripe_cards (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    clinic_id TEXT,
    cardholder_id TEXT NOT NULL,
    stripe_card_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'virtual',
    currency TEXT DEFAULT 'usd',
    status TEXT DEFAULT 'active',
    last4 TEXT,
    brand TEXT,
    expiry_month INTEGER,
    expiry_year INTEGER,
    spending_controls TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (clinic_id) REFERENCES clinics(id),
    FOREIGN KEY (cardholder_id) REFERENCES stripe_cardholders(id)
  );

  CREATE TABLE IF NOT EXISTS stripe_card_transactions (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    clinic_id TEXT,
    stripe_transaction_id TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'usd',
    merchant_name TEXT,
    merchant_category TEXT,
    status TEXT,
    authorization_code TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES stripe_cards(id),
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (clinic_id) REFERENCES clinics(id)
  );

  CREATE INDEX IF NOT EXISTS idx_stripe_cardholders_patient ON stripe_cardholders(patient_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_cardholders_clinic ON stripe_cardholders(clinic_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_cardholders_stripe_id ON stripe_cardholders(stripe_cardholder_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_cards_patient ON stripe_cards(patient_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_cards_clinic ON stripe_cards(clinic_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_cards_cardholder ON stripe_cards(cardholder_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_cards_stripe_id ON stripe_cards(stripe_card_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_card_transactions_card ON stripe_card_transactions(card_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_card_transactions_patient ON stripe_card_transactions(patient_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_card_transactions_clinic ON stripe_card_transactions(clinic_id);
`);

// Migration: Add surge_enabled to clinics table (legal safety before dynamic pricing)
try {
  const clinicInfo = db.prepare(`PRAGMA table_info(clinics)`).all();
  const hasSurgeEnabled = clinicInfo.some(c => c.name === 'surge_enabled');
  if (!hasSurgeEnabled) {
    console.log('📦 Adding surge_enabled column to clinics table...');
    db.exec(`ALTER TABLE clinics ADD COLUMN surge_enabled BOOLEAN DEFAULT 0;`);
    console.log('✅ Migration complete: surge_enabled added to clinics');
  }
} catch (migrationError) {
  console.warn('⚠️  Clinics surge_enabled migration failed:', migrationError.message);
}

// Migration: Add per-clinic calendar and business hours (Tasks 1, 3, 51)
try {
  const clinicCols = db.prepare(`PRAGMA table_info(clinics)`).all();
  const addCol = (name, sql) => {
    if (!clinicCols.some(c => c.name === name)) {
      db.exec(`ALTER TABLE clinics ADD COLUMN ${name} ${sql}`);
      console.log(`✅ Migration: clinics.${name} added`);
    }
  };
  addCol('timezone', "TEXT DEFAULT 'America/New_York'");
  addCol('business_hours_start', 'INTEGER DEFAULT 9');
  addCol('business_hours_end', 'INTEGER DEFAULT 19');
  addCol('business_days', "TEXT DEFAULT '[1,2,3,4,5]'"); // Mon-Fri
  addCol('holidays', 'TEXT'); // JSON array of YYYY-MM-DD
  addCol('calendar_user_email', 'TEXT');
  addCol('google_calendar_id', 'TEXT');
} catch (e) {
  console.warn('⚠️  Clinics calendar/business_hours migration failed:', e.message);
}

// Migration: reminder_24h_sent for 24h appointment reminders (Task 52)
try {
  const apptInfo = db.prepare(`PRAGMA table_info(appointments)`).all();
  if (!apptInfo.some(c => c.name === 'reminder_24h_sent')) {
    db.exec(`ALTER TABLE appointments ADD COLUMN reminder_24h_sent BOOLEAN DEFAULT 0;`);
    console.log('✅ Migration: appointments.reminder_24h_sent added');
  }
} catch (e) {
  console.warn('⚠️  appointments reminder_24h_sent migration failed:', e.message);
}

// Migration: appointment calendar metadata for booking confidence/source audits
try {
  const apptInfo = db.prepare(`PRAGMA table_info(appointments)`).all();
  const hasCalendarSource = apptInfo.some(c => c.name === 'calendar_source');
  const hasCalendarConfidence = apptInfo.some(c => c.name === 'calendar_confidence');
  if (!hasCalendarSource) {
    db.exec(`ALTER TABLE appointments ADD COLUMN calendar_source TEXT`);
    console.log('✅ Migration: appointments.calendar_source added');
  }
  if (!hasCalendarConfidence) {
    db.exec(`ALTER TABLE appointments ADD COLUMN calendar_confidence TEXT`);
    console.log('✅ Migration: appointments.calendar_confidence added');
  }
} catch (e) {
  console.warn('⚠️  appointments calendar metadata migration failed:', e.message);
}

// ============================================
// ADMIN SESSIONS (DB-backed, survives restarts)
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    issued_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
`);

// Seed base visit prices per clinic (idempotent) - Task 24: use config fallbacks
try {
  const { FALLBACKS } = require('./config/pricing-fallbacks');
  const clinics = db.prepare(`SELECT clinic_id FROM clinics`).all();
  if (Array.isArray(clinics) && clinics.length > 0) {
    const seed = db.prepare(`
      INSERT OR IGNORE INTO visit_pricing (clinic_id, appointment_type, base_price, surge_multiplier)
      VALUES (?, ?, ?, ?)
    `);
    const apptTypes = [
      { appointment_type: 'General Consult', base_price: FALLBACKS['General Consult'] },
      { appointment_type: 'Therapy', base_price: FALLBACKS['Therapy'] },
      { appointment_type: 'Psychiatry Initial', base_price: FALLBACKS['Psychiatry Initial'] },
      { appointment_type: 'Psychiatry Follow-up', base_price: FALLBACKS['Psychiatry Follow-up'] },
      { appointment_type: 'Mental Health Consultation', base_price: FALLBACKS['Mental Health Consultation'] }
    ];
    const tx = db.transaction(() => {
      for (const c of clinics) {
        for (const row of apptTypes) {
          seed.run(c.clinic_id, row.appointment_type, row.base_price, 1.0);
        }
      }
    });
    tx();
  }
} catch (e) {
  console.warn('⚠️  visit_pricing seeding skipped:', e.message);
}

// Add clinic_id to users table (multi-tenant migration)
try {
  const usersInfo = db.pragma('table_info(users)');
  const hasClinicId = usersInfo.some(c => c.name === 'clinic_id');
  if (!hasClinicId) {
    console.log('📦 Adding clinic_id column to users table...');
    db.exec('ALTER TABLE users ADD COLUMN clinic_id TEXT;');
    console.log('✅ Migration complete: clinic_id added to users');
  }
} catch (migrationError) {
  console.warn('⚠️  Users clinic_id migration failed:', migrationError.message);
}

// Add clinic_id to existing tables (multi-tenant migration)
const tablesToMigrate = ['fhir_patients', 'eligibility_checks', 'insurance_claims'];
tablesToMigrate.forEach(tableName => {
  try {
    const tableInfo = db.pragma(`table_info(${tableName})`);
    const hasClinicId = tableInfo.some(c => c.name === 'clinic_id');
    if (!hasClinicId) {
      console.log(`📦 Adding clinic_id column to ${tableName} table...`);
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN clinic_id TEXT;`);
      console.log(`✅ Migration complete: clinic_id added to ${tableName}`);
    }
  } catch (migrationError) {
    console.warn(`⚠️  ${tableName} clinic_id migration failed:`, migrationError.message);
  }
});

const DEFAULT_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || 'legacy-clinic';

try {
  const missingClinicRows = db.prepare(`
    SELECT COUNT(1) as count
    FROM appointments
    WHERE clinic_id IS NULL OR clinic_id = ''
  `).get();

  if (missingClinicRows && missingClinicRows.count > 0) {
    console.log(`📦 Backfilling clinic_id for ${missingClinicRows.count} legacy appointments...`);
    db.prepare(`
      UPDATE appointments
      SET clinic_id = ?
      WHERE clinic_id IS NULL OR clinic_id = ''
    `).run(DEFAULT_CLINIC_ID);
    console.log('✅ Legacy appointments now scoped to default clinic');
  }
} catch (migrationError) {
  console.warn('⚠️  Appointment clinic backfill failed:', migrationError.message);
}

// Continue with remaining table creation
db.exec(`
  -- ============================================
  -- USERS TABLE
  -- ============================================
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'healthcare_provider',
    merchant_id TEXT,
    picture TEXT,
    auth_method TEXT DEFAULT 'email',
    google_id TEXT,
    google_calendar_connected BOOLEAN DEFAULT 0,
    google_calendar_email TEXT,
    google_calendar_id TEXT,
    google_calendar_name TEXT,
    google_calendar_timezone TEXT,
    google_refresh_token TEXT,
    google_access_token TEXT,
    google_token_expiry INTEGER,
    google_calendar_scopes TEXT,
    google_calendar_sync_at DATETIME,
    google_calendar_last_error TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

  -- ============================================
  -- CLINICS TABLE (Multi-Tenant)
  -- ============================================
  CREATE TABLE IF NOT EXISTS clinics (
    clinic_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    phone_number TEXT,
    email TEXT,
    address TEXT,
    business_hours TEXT,
    services TEXT,
    retell_agent_id TEXT,
    retell_agent_status TEXT DEFAULT 'pending',
    merchant_id TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clinic_phone_numbers (
    phone_number TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id)
  );

  CREATE INDEX IF NOT EXISTS idx_clinics_slug ON clinics(slug);
  CREATE INDEX IF NOT EXISTS idx_clinics_phone ON clinics(phone_number);
  CREATE INDEX IF NOT EXISTS idx_clinic_phone_numbers_clinic_id ON clinic_phone_numbers(clinic_id);
  CREATE INDEX IF NOT EXISTS idx_clinic_phone_numbers_phone ON clinic_phone_numbers(phone_number);

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    clinic_id TEXT,
    patient_name TEXT NOT NULL,
    patient_phone TEXT,
    patient_email TEXT,
    patient_id TEXT,
    appointment_type TEXT DEFAULT 'Mental Health Consultation',
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    duration_minutes INTEGER DEFAULT 50,
    provider TEXT DEFAULT 'DocLittle Mental Health Team',
    status TEXT DEFAULT 'scheduled',
    payment_status TEXT DEFAULT 'unpaid',
    notes TEXT,
    reminder_sent BOOLEAN DEFAULT 0,
    calendar_event_id TEXT,
    calendar_link TEXT,
    cancellation_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
  CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(patient_phone);
  CREATE INDEX IF NOT EXISTS idx_appointments_email ON appointments(patient_email);
  CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

  -- ============================================
  -- INSURANCE & BILLING TABLES
  -- ============================================

  CREATE TABLE IF NOT EXISTS eligibility_checks (
    id TEXT PRIMARY KEY,
    patient_id TEXT,
    member_id TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    service_code TEXT,
    date_of_service TEXT,
    eligible BOOLEAN DEFAULT 0,
    copay_amount REAL DEFAULT 0,
    allowed_amount REAL DEFAULT 0,
    insurance_pays REAL DEFAULT 0,
    deductible_total REAL,
    deductible_remaining REAL,
    coinsurance_percent REAL,
    plan_summary TEXT,
    response_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE TABLE IF NOT EXISTS insurance_claims (
    id TEXT PRIMARY KEY,
    appointment_id TEXT,
    patient_id TEXT,
    member_id TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    service_code TEXT,
    diagnosis_code TEXT,
    total_amount REAL NOT NULL,
    copay_amount REAL DEFAULT 0,
    insurance_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'submitted',
    x12_claim_id TEXT,
    idempotency_key TEXT,
    blockchain_proof TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status_checked_at DATETIME,
    approved_at DATETIME,
    paid_at DATETIME,
    response_data TEXT,
    circle_transfer_id TEXT,
    payment_status TEXT DEFAULT 'pending',
    payment_amount REAL,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE TABLE IF NOT EXISTS insurance_payers (
    id TEXT PRIMARY KEY,
    payer_id TEXT UNIQUE NOT NULL,
    payer_name TEXT NOT NULL,
    aliases TEXT,
    supported_transactions TEXT,
    is_active BOOLEAN DEFAULT 1,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS patient_insurance (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    payer_name TEXT,
    member_id TEXT NOT NULL,
    group_number TEXT,
    plan_name TEXT,
    relationship_code TEXT DEFAULT 'self',
    is_primary BOOLEAN DEFAULT 1,
    is_verified BOOLEAN DEFAULT 0,
    verified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE INDEX IF NOT EXISTS idx_eligibility_checks_patient_id ON eligibility_checks(patient_id);
  CREATE INDEX IF NOT EXISTS idx_eligibility_checks_member_id ON eligibility_checks(member_id);
  CREATE INDEX IF NOT EXISTS idx_insurance_claims_appointment_id ON insurance_claims(appointment_id);
  CREATE INDEX IF NOT EXISTS idx_insurance_claims_patient_id ON insurance_claims(patient_id);
  CREATE INDEX IF NOT EXISTS idx_insurance_claims_status ON insurance_claims(status);
  CREATE INDEX IF NOT EXISTS idx_insurance_claims_idem ON insurance_claims(idempotency_key);
  CREATE INDEX IF NOT EXISTS idx_insurance_payers_payer_id ON insurance_payers(payer_id);
  CREATE INDEX IF NOT EXISTS idx_insurance_payers_name ON insurance_payers(payer_name);
  CREATE INDEX IF NOT EXISTS idx_patient_insurance_patient_id ON patient_insurance(patient_id);
  CREATE INDEX IF NOT EXISTS idx_patient_insurance_payer_id ON patient_insurance(payer_id);
  CREATE INDEX IF NOT EXISTS idx_patient_insurance_member_id ON patient_insurance(member_id);

  -- ============================================
  -- INVOICE TABLES - Patient Billing
  -- ============================================

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    claim_id TEXT,
    patient_id TEXT NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'draft', -- draft, sent, paid, overdue, cancelled
    amount REAL NOT NULL,
    due_date DATE,
    notes TEXT,
    sent_at DATETIME,
    paid_at DATETIME,
    cancelled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES insurance_claims(id),
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    service_date DATE,
    description TEXT NOT NULL,
    cpt_code TEXT,
    icd_code TEXT,
    quantity INTEGER DEFAULT 1,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invoice_payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    payment_date DATE NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT, -- cash, check, credit_card, bank_transfer, etc.
    reference_number TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_claim_id ON invoices(claim_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_patient_id ON invoices(patient_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
  CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);

  -- ============================================
  -- LEDGER ACCOUNTS & ENTRIES
  -- ============================================
  CREATE TABLE IF NOT EXISTS ledger_accounts (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL, -- patient|provider|insurer|system
    owner_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    rail_type TEXT NOT NULL, -- stripe|circle|internal
    status TEXT DEFAULT 'active',
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_accounts_owner
    ON ledger_accounts(owner_type, owner_id, currency, rail_type);

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    currency TEXT NOT NULL,
    external_ref_type TEXT,
    external_ref_id TEXT,
    description TEXT,
    status TEXT DEFAULT 'pending', -- pending|settled|void
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    settled_at DATETIME,
    FOREIGN KEY (account_id) REFERENCES ledger_accounts(id)
  );

  CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_entries_status ON ledger_entries(status);

  CREATE TABLE IF NOT EXISTS financial_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL, -- payment_intent|circle_transfer|claim|refund|adjustment
    actor_type TEXT,
    actor_id TEXT,
    amount REAL,
    currency TEXT,
    rail_type TEXT,
    status TEXT,
    cause TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_financial_events_actor ON financial_events(actor_type, actor_id);
  CREATE INDEX IF NOT EXISTS idx_financial_events_type ON financial_events(event_type);

  -- ============================================
  -- AUDIT LOG (SECURITY & COMPLIANCE)
  -- ============================================
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_type TEXT,
    actor_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    ip TEXT,
    user_agent TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_type, actor_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);

  -- ============================================
  -- CIRCLE PAYMENT INTEGRATION TABLES
  -- ============================================

  CREATE TABLE IF NOT EXISTS circle_accounts (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    circle_wallet_id TEXT UNIQUE,
    circle_account_id TEXT,
    currency TEXT DEFAULT 'USDC',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS circle_transfers (
    id TEXT PRIMARY KEY,
    claim_id TEXT,
    from_wallet_id TEXT NOT NULL,
    to_wallet_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USDC',
    circle_transfer_id TEXT UNIQUE,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (claim_id) REFERENCES insurance_claims(id)
  );

  CREATE INDEX IF NOT EXISTS idx_circle_accounts_entity_type ON circle_accounts(entity_type);
  CREATE INDEX IF NOT EXISTS idx_circle_accounts_entity_id ON circle_accounts(entity_id);
  CREATE INDEX IF NOT EXISTS idx_circle_transfers_claim_id ON circle_transfers(claim_id);
  CREATE INDEX IF NOT EXISTS idx_circle_transfers_status ON circle_transfers(status);
  CREATE INDEX IF NOT EXISTS idx_circle_transfers_circle_transfer_id ON circle_transfers(circle_transfer_id);

  -- Settlement Attempts State Machine - tracks triple jump transfers for recovery
  CREATE TABLE IF NOT EXISTS settlement_attempts (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL UNIQUE,
    total_approved REAL NOT NULL,
    provider_amount REAL NOT NULL,
    revenue_amount REAL NOT NULL,
    insurer_wallet_id TEXT NOT NULL,
    escrow_wallet_id TEXT NOT NULL,
    provider_wallet_id TEXT NOT NULL,
    revenue_wallet_id TEXT NOT NULL,
    transfer_1_status TEXT DEFAULT 'pending', -- pending, completed, failed
    transfer_2_status TEXT DEFAULT 'pending',
    transfer_3_status TEXT DEFAULT 'pending',
    transfer_1_id TEXT, -- Circle transfer ID
    transfer_2_id TEXT,
    transfer_3_id TEXT,
    transfer_1_circle_id TEXT, -- Circle transaction ID
    transfer_2_circle_id TEXT,
    transfer_3_circle_id TEXT,
    error_message TEXT,
    recovery_attempts INTEGER DEFAULT 0,
    last_recovery_attempt DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (claim_id) REFERENCES insurance_claims(id)
  );

  CREATE INDEX IF NOT EXISTS idx_settlement_attempts_claim_id ON settlement_attempts(claim_id);
  CREATE INDEX IF NOT EXISTS idx_settlement_attempts_transfer_1_status ON settlement_attempts(transfer_1_status);
  CREATE INDEX IF NOT EXISTS idx_settlement_attempts_stuck ON settlement_attempts(transfer_1_status, transfer_2_status, created_at);

  -- EOB Calculation Audit - full transparency of inputs/outputs for each calculation
  CREATE TABLE IF NOT EXISTS eob_calculation_audit (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    calculation_inputs TEXT,
    calculation_outputs TEXT,
    triggered_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES insurance_claims(id)
  );
  CREATE INDEX IF NOT EXISTS idx_eob_audit_claim_id ON eob_calculation_audit(claim_id);

  -- Persistent patient sessions (email + resolved patient_id)
  CREATE TABLE IF NOT EXISTS patient_sessions (
    session_id   TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    patient_id   TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at   DATETIME NOT NULL,
    last_used    DATETIME,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );
  CREATE INDEX IF NOT EXISTS idx_patient_sessions_email ON patient_sessions(email);

  -- Cross-channel safety flags (Phase 1)
  CREATE TABLE IF NOT EXISTS patient_emergency_flags (
    id TEXT PRIMARY KEY,
    patient_id TEXT,
    email TEXT,
    phone TEXT,
    source TEXT, -- voice/web
    call_id TEXT,
    flagged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    cleared_at DATETIME,
    metadata_json TEXT,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );
  CREATE INDEX IF NOT EXISTS idx_patient_emergency_flags_patient ON patient_emergency_flags(patient_id);
  CREATE INDEX IF NOT EXISTS idx_patient_emergency_flags_email ON patient_emergency_flags(email);
  CREATE INDEX IF NOT EXISTS idx_patient_emergency_flags_phone ON patient_emergency_flags(phone);

  CREATE TABLE IF NOT EXISTS patient_portal_sessions (
    id TEXT PRIMARY KEY,
    patient_id TEXT,
    phone TEXT,
    email TEXT,
    verification_code TEXT,
    verified BOOLEAN DEFAULT 0,
    verified_at DATETIME,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    failed_attempts INTEGER DEFAULT 0,
    locked_until DATETIME,
    revoked_at DATETIME,
    rotated_to TEXT,
    emergency_flag BOOLEAN DEFAULT 0,
    emergency_flag_at DATETIME,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE INDEX IF NOT EXISTS idx_portal_sessions_phone ON patient_portal_sessions(phone);
  CREATE INDEX IF NOT EXISTS idx_portal_sessions_verified ON patient_portal_sessions(verified);
  -- Note: email index will be created in migration if column is added

  -- Patient-uploaded and staff-uploaded documents
  CREATE TABLE IF NOT EXISTS patient_documents (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    encounter_id TEXT,
    appointment_id TEXT,
    file_name TEXT NOT NULL,
    file_type TEXT,
    storage_path TEXT NOT NULL,
    storage_provider TEXT DEFAULT 'local',
    storage_bucket TEXT,
    storage_key TEXT,
    uploaded_by TEXT,
    status TEXT DEFAULT 'available',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );
  CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON patient_documents(patient_id);

  -- Durable one-time download tokens (mvp-67)
  CREATE TABLE IF NOT EXISTS patient_document_download_tokens (
    token TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    revoked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doc_id) REFERENCES patient_documents(id)
  );
  CREATE INDEX IF NOT EXISTS idx_doc_tokens_doc ON patient_document_download_tokens(doc_id);
  CREATE INDEX IF NOT EXISTS idx_doc_tokens_patient ON patient_document_download_tokens(patient_id);

  CREATE TABLE IF NOT EXISTS patient_merge_events (
    id TEXT PRIMARY KEY,
    primary_id TEXT NOT NULL,
    secondary_id TEXT NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    reviewed INTEGER DEFAULT 0,
    reviewed_at DATETIME,
    FOREIGN KEY (primary_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (secondary_id) REFERENCES fhir_patients(resource_id)
  );
  CREATE INDEX IF NOT EXISTS idx_patient_merge_primary ON patient_merge_events(primary_id);
  CREATE INDEX IF NOT EXISTS idx_patient_merge_secondary ON patient_merge_events(secondary_id);

  CREATE TABLE IF NOT EXISTS cpt_codes (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT,
    subcategory TEXT,
    is_new BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_cpt_codes_description ON cpt_codes(description);

  CREATE TABLE IF NOT EXISTS icd10_codes (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT,
    billable INTEGER DEFAULT 1,
    source_file TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_icd10_codes_description ON icd10_codes(description);

  CREATE TABLE IF NOT EXISTS hcpcs_codes (
    code TEXT PRIMARY KEY,
    long_desc TEXT NOT NULL,
    short_desc TEXT,
    pricing_ind TEXT,
    coverage_cd TEXT,
    type TEXT,
    source_file TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_hcpcs_codes_long_desc ON hcpcs_codes(long_desc);
  CREATE INDEX IF NOT EXISTS idx_hcpcs_codes_short_desc ON hcpcs_codes(short_desc);

  CREATE TABLE IF NOT EXISTS code_embeddings (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    code_type TEXT NOT NULL,
    description_text TEXT,
    embedding_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_code_embeddings_code_type ON code_embeddings(code_type);

  -- Fee schedules: payer-specific allowed amounts per CPT (enables real-time adjudication)
  CREATE TABLE IF NOT EXISTS fee_schedules (
    id TEXT PRIMARY KEY,
    payer_id TEXT NOT NULL,
    cpt_code TEXT NOT NULL,
    allowed_amount REAL NOT NULL,
    in_network BOOLEAN DEFAULT 1,
    effective_date DATE,
    end_date DATE,
    source TEXT DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_fee_schedules_payer ON fee_schedules(payer_id);
  CREATE INDEX IF NOT EXISTS idx_fee_schedules_cpt ON fee_schedules(cpt_code);
  CREATE INDEX IF NOT EXISTS idx_fee_schedules_payer_cpt ON fee_schedules(payer_id, cpt_code);

  -- ============================================
  -- USAGE TRACKING & LOGGING TABLES
  -- ============================================

  CREATE TABLE IF NOT EXISTS api_usage_log (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    api_key_id TEXT,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    request_size_bytes INTEGER,
    response_size_bytes INTEGER,
    ip_address TEXT,
    user_agent TEXT,
    request_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS voice_call_log (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    call_id TEXT NOT NULL,
    twilio_call_sid TEXT,
    call_duration_seconds INTEGER,
    call_duration_minutes REAL,
    credits_deducted INTEGER DEFAULT 0,
    function_calls_count INTEGER,
    status TEXT,
    twilio_cost_usd REAL,
    retell_cost_usd REAL,
    total_cost_usd REAL,
    twilio_cost_calculated_usd REAL,
    retell_cost_calculated_usd REAL,
    cost_source TEXT,
    cost_updated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS function_call_log (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    call_id TEXT,
    function_name TEXT NOT NULL,
    parameters TEXT,
    response_time_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  -- Voice call state management (medical coding agent)
  CREATE TABLE IF NOT EXISTS voice_call_states (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL UNIQUE,
    clinic_id TEXT,
    current_stage TEXT DEFAULT 'INTAKE',
    state_data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_voice_call_states_call_id ON voice_call_states(call_id);

  -- Step 1: Patient Orchestrate sessions (stateful, multi-modal Voice+Chat)
  CREATE TABLE IF NOT EXISTS patient_orchestrate_sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    channel TEXT NOT NULL, -- voice|chat
    patient_id TEXT,
    caller_phone TEXT,
    portal_session_id TEXT,
    clinic_id TEXT,
    preferred_language TEXT DEFAULT 'en',
    turn_count INTEGER DEFAULT 0,
    conversation_history TEXT, -- JSON: [{ role, content, content_english, timestamp }]
    flow_state TEXT, -- JSON: { step, reason, date, time, appointment_id, ... }
    case_id TEXT,
    status TEXT DEFAULT 'active', -- active|abandoned|completed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_orchestrate_sessions_session_id ON patient_orchestrate_sessions(session_id);
  CREATE INDEX IF NOT EXISTS idx_orchestrate_sessions_caller_phone ON patient_orchestrate_sessions(caller_phone);
  CREATE INDEX IF NOT EXISTS idx_orchestrate_sessions_patient_id ON patient_orchestrate_sessions(patient_id);

  -- Phase 3: Case records (triage session persistence)
  CREATE TABLE IF NOT EXISTS case_records (
    id TEXT PRIMARY KEY,
    case_number TEXT UNIQUE,
    patient_id TEXT,
    session_id TEXT,
    channel TEXT,
    visit_mode TEXT,
    status TEXT DEFAULT 'draft',
    opqrst TEXT,
    suggested_icd10 TEXT,
    created_at TEXT,
    abandoned_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_case_records_session_id ON case_records(session_id);
  CREATE INDEX IF NOT EXISTS idx_case_records_status ON case_records(status);

  CREATE TABLE IF NOT EXISTS voice_conversation_memory (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    clinic_id TEXT,
    turn_number INTEGER DEFAULT 0,
    role TEXT NOT NULL,
    content TEXT,
    extracted_entities TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_voice_conversation_memory_call_id ON voice_conversation_memory(call_id);

  CREATE TABLE IF NOT EXISTS agent_state_snapshots (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    state_name TEXT NOT NULL,
    state_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_agent_state_snapshots_call_id ON agent_state_snapshots(call_id);

  CREATE TABLE IF NOT EXISTS prompt_profiles (
    id TEXT PRIMARY KEY,
    clinic_id TEXT,
    name TEXT NOT NULL,
    specialty TEXT,
    system_prompt TEXT NOT NULL,
    allowed_tools TEXT,
    version TEXT DEFAULT 'v1',
    status TEXT DEFAULT 'active', -- draft|active|archived
    metadata TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_prompt_profiles_clinic_id ON prompt_profiles(clinic_id);

  CREATE TABLE IF NOT EXISTS prompt_audit_logs (
    id TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL,
    user_id TEXT,
    change_diff TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agent_turns (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    clinic_id TEXT,
    turn_index INTEGER,
    role TEXT NOT NULL,
    text TEXT,
    actions_json TEXT,
    prompt_profile_id TEXT,
    prompt_version TEXT,
    prompt_checksum TEXT,
    model TEXT,
    latency_ms INTEGER,
    trace_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_agent_turns_call_id ON agent_turns(call_id);

  CREATE TABLE IF NOT EXISTS sms_usage_log (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    merchant_id TEXT,
    phone_number TEXT NOT NULL,
    direction TEXT NOT NULL, -- 'inbound' or 'outbound'
    message_sid TEXT,
    segments INTEGER DEFAULT 1,
    cost_usd REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sms_usage_customer ON sms_usage_log(customer_id);
  CREATE INDEX IF NOT EXISTS idx_sms_usage_merchant ON sms_usage_log(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_sms_usage_created_at ON sms_usage_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_sms_usage_direction ON sms_usage_log(direction);

  CREATE TABLE IF NOT EXISTS usage_aggregates (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    date DATE NOT NULL,
    metric_type TEXT NOT NULL,
    metric_value INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer_id, date, metric_type)
  );

  CREATE TABLE IF NOT EXISTS error_log (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    request_id TEXT,
    endpoint TEXT,
    context TEXT,
    severity TEXT DEFAULT 'medium',
    resolved BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number TEXT,
    company_name TEXT,
    business_size TEXT,
    use_case TEXT,
    api_features TEXT,
    email_verified BOOLEAN DEFAULT 0,
    email_verified_at DATETIME,
    plan_tier TEXT DEFAULT 'starter',
    status TEXT DEFAULT 'pending',
    retell_agent_id TEXT,
    retell_agent_status TEXT DEFAULT 'pending',
    customer_type TEXT DEFAULT 'api',
    twilio_phone_number TEXT,
    twilio_phone_sid TEXT,
    pricing_tier TEXT DEFAULT 'starter',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customer_feature_requests (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    feature_name TEXT NOT NULL,
    feature_category TEXT,
    status TEXT DEFAULT 'pending',
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    notes TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE INDEX IF NOT EXISTS idx_customer_feature_requests_customer ON customer_feature_requests(customer_id);
  CREATE INDEX IF NOT EXISTS idx_customer_feature_requests_status ON customer_feature_requests(status);

  CREATE TABLE IF NOT EXISTS email_verification_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    customer_id TEXT,
    verified BOOLEAN DEFAULT 0,
    verified_at DATETIME,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS terms_acceptance (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    terms_version TEXT NOT NULL DEFAULT '1.0',
    ip_address TEXT,
    user_agent TEXT,
    accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS customer_sessions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_secret TEXT,
    scopes TEXT,
    rate_limit_tier TEXT DEFAULT 'starter',
    ip_whitelist TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    last_used_at DATETIME,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE INDEX IF NOT EXISTS idx_api_usage_log_customer ON api_usage_log(customer_id);
  CREATE INDEX IF NOT EXISTS idx_api_usage_log_endpoint ON api_usage_log(endpoint);
  CREATE INDEX IF NOT EXISTS idx_api_usage_log_created_at ON api_usage_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_voice_call_log_customer ON voice_call_log(customer_id);
  -- Note: idx_voice_call_log_twilio_sid and idx_voice_call_log_created_at are created in migrateVoiceCallLogCosts()
  CREATE INDEX IF NOT EXISTS idx_function_call_log_customer ON function_call_log(customer_id);
  CREATE INDEX IF NOT EXISTS idx_function_call_log_function ON function_call_log(function_name);
  CREATE INDEX IF NOT EXISTS idx_usage_aggregates_customer ON usage_aggregates(customer_id);
  CREATE INDEX IF NOT EXISTS idx_usage_aggregates_date ON usage_aggregates(date);
  CREATE INDEX IF NOT EXISTS idx_error_log_customer ON error_log(customer_id);
  CREATE INDEX IF NOT EXISTS idx_error_log_severity ON error_log(severity);
  CREATE INDEX IF NOT EXISTS idx_error_log_resolved ON error_log(resolved);
  CREATE INDEX IF NOT EXISTS idx_error_log_created_at ON error_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
  CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
  CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
  CREATE INDEX IF NOT EXISTS idx_email_verification_codes_code ON email_verification_codes(code);
  CREATE INDEX IF NOT EXISTS idx_email_verification_codes_customer ON email_verification_codes(customer_id);
  CREATE INDEX IF NOT EXISTS idx_terms_acceptance_customer ON terms_acceptance(customer_id);
  CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id);
  CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires ON customer_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_api_keys_customer ON api_keys(customer_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  
  -- ============================================
  -- CUSTOMER CREDITS & BILLING TABLES
  -- ============================================
  
  CREATE TABLE IF NOT EXISTS customer_credits (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL UNIQUE,
    credits_balance_minutes INTEGER DEFAULT 0,
    free_credits_allocated INTEGER DEFAULT 0,
    free_credits_used INTEGER DEFAULT 0,
    paid_credits_purchased INTEGER DEFAULT 0,
    paid_credits_used INTEGER DEFAULT 0,
    free_credits_expires_at DATETIME,
    last_replenished_at DATETIME,
    low_credit_alert_sent_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );
  
  CREATE TABLE IF NOT EXISTS credit_purchases (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    package_name TEXT NOT NULL,
    credits_amount INTEGER NOT NULL,
    amount_paid REAL NOT NULL,
    stripe_payment_intent_id TEXT,
    stripe_checkout_session_id TEXT,
    stripe_payment_method_id TEXT,
    status TEXT DEFAULT 'pending',
    purchased_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS monthly_usage (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    billing_month TEXT NOT NULL,
    voice_minutes_used INTEGER DEFAULT 0,
    api_requests_used INTEGER DEFAULT 0,
    free_credits_used INTEGER DEFAULT 0,
    overage_voice_minutes INTEGER DEFAULT 0,
    overage_api_requests INTEGER DEFAULT 0,
    invoice_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE(customer_id, billing_month)
  );

  CREATE TABLE IF NOT EXISTS monthly_invoices (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    billing_month TEXT NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    voice_minutes INTEGER DEFAULT 0,
    api_requests INTEGER DEFAULT 0,
    voice_minutes_cost REAL DEFAULT 0,
    api_requests_cost REAL DEFAULT 0,
    base_costs REAL DEFAULT 0,
    integration_costs REAL DEFAULT 0,
    markup_percentage REAL DEFAULT 0,
    markup_amount REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    total REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    approved_by TEXT,
    approved_at DATETIME,
    sent_at DATETIME,
    stripe_invoice_id TEXT,
    stripe_payment_intent_id TEXT,
    due_date DATETIME NOT NULL,
    paid_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    external_id TEXT UNIQUE,
    title TEXT NOT NULL,
    clinic_name TEXT NOT NULL,
    clinic_phone TEXT,
    clinic_email TEXT,
    opening_hours TEXT,
    location TEXT,
    source_url TEXT,
    status TEXT DEFAULT 'new',
    pipeline_stage TEXT DEFAULT 'new',
    is_qualified INTEGER DEFAULT 0,
    auto_qualified INTEGER DEFAULT 0,
    qualified_at DATETIME,
    priority INTEGER DEFAULT 5,
    lead_score INTEGER DEFAULT 0,
    last_score_update DATETIME,
    source TEXT DEFAULT 'google_search',
    posted_at TEXT,
    notes TEXT,
    call_count INTEGER DEFAULT 0,
    last_called_at DATETIME,
    follow_up_date DATETIME,
    next_action TEXT,
    estimated_value REAL,
    owner_id TEXT,
    is_test INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS lead_calls (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    call_id TEXT,
    call_status TEXT DEFAULT 'pending',
    call_duration_seconds INTEGER,
    call_cost REAL,
    transcript_url TEXT,
    notes TEXT,
    outcome TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  );

  CREATE TABLE IF NOT EXISTS lead_activities (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    activity_subject TEXT,
    activity_description TEXT,
    activity_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  );

  CREATE TABLE IF NOT EXISTS monthly_call_usage (
    id TEXT PRIMARY KEY,
    billing_month TEXT NOT NULL UNIQUE,
    calls_used INTEGER DEFAULT 0,
    calls_remaining INTEGER DEFAULT 250,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_customer_credits_customer ON customer_credits(customer_id);
  CREATE INDEX IF NOT EXISTS idx_credit_purchases_customer ON credit_purchases(customer_id);
  CREATE INDEX IF NOT EXISTS idx_credit_purchases_status ON credit_purchases(status);
  CREATE INDEX IF NOT EXISTS idx_customers_retell_agent ON customers(retell_agent_id);
  CREATE INDEX IF NOT EXISTS idx_monthly_usage_customer ON monthly_usage(customer_id);
  CREATE INDEX IF NOT EXISTS idx_monthly_usage_billing_month ON monthly_usage(billing_month);
  CREATE INDEX IF NOT EXISTS idx_monthly_invoices_customer ON monthly_invoices(customer_id);
  CREATE INDEX IF NOT EXISTS idx_monthly_invoices_billing_month ON monthly_invoices(billing_month);
  CREATE INDEX IF NOT EXISTS idx_monthly_invoices_status ON monthly_invoices(status);
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage ON leads(pipeline_stage);
  CREATE INDEX IF NOT EXISTS idx_leads_is_qualified ON leads(is_qualified);
  CREATE INDEX IF NOT EXISTS idx_leads_clinic_name ON leads(clinic_name);
  CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);
  CREATE INDEX IF NOT EXISTS idx_leads_follow_up_date ON leads(follow_up_date);
  CREATE INDEX IF NOT EXISTS idx_lead_calls_lead_id ON lead_calls(lead_id);
  CREATE INDEX IF NOT EXISTS idx_lead_calls_status ON lead_calls(call_status);
  CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON lead_activities(lead_id);
  CREATE INDEX IF NOT EXISTS idx_lead_activities_type ON lead_activities(activity_type);
  CREATE INDEX IF NOT EXISTS idx_lead_activities_date ON lead_activities(activity_date);
  CREATE INDEX IF NOT EXISTS idx_monthly_call_usage_month ON monthly_call_usage(billing_month);

  -- ============================================
  -- SEQUENCES - Multi-Step Automation
  -- ============================================

  CREATE TABLE IF NOT EXISTS sequences (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    steps_json TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS sequence_executions (
    id TEXT PRIMARY KEY,
    sequence_id TEXT NOT NULL,
    lead_id TEXT NOT NULL,
    current_step INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    paused_at DATETIME,
    metadata TEXT,
    FOREIGN KEY (sequence_id) REFERENCES sequences(id),
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sequences_merchant_id ON sequences(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_sequences_enabled ON sequences(enabled);
  CREATE INDEX IF NOT EXISTS idx_sequence_executions_sequence_id ON sequence_executions(sequence_id);
  CREATE INDEX IF NOT EXISTS idx_sequence_executions_lead_id ON sequence_executions(lead_id);
  CREATE INDEX IF NOT EXISTS idx_sequence_executions_status ON sequence_executions(status);

  -- ============================================
  -- QUALIFICATION RULES (Phase 2)
  -- ============================================

  CREATE TABLE IF NOT EXISTS qualification_rules (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    rules_json TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE INDEX IF NOT EXISTS idx_qualification_rules_merchant_id ON qualification_rules(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_qualification_rules_enabled ON qualification_rules(enabled);
  CREATE INDEX IF NOT EXISTS idx_qualification_rules_priority ON qualification_rules(priority);

  CREATE TABLE IF NOT EXISTS lead_labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#3b82f6',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS lead_label_assignments (
    lead_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lead_id, label_id),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES lead_labels(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_lead_id ON lead_label_assignments(lead_id);
  CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_label_id ON lead_label_assignments(label_id);

  -- ============================================
  -- INCOMPLETE SIGNUPS TABLE (Separate from admin leads)
  -- ============================================
  CREATE TABLE IF NOT EXISTS incomplete_signups (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL,
    phone_number TEXT,
    company_name TEXT,
    business_size TEXT,
    use_case TEXT,
    api_features TEXT,
    customer_type TEXT,
    signup_step TEXT DEFAULT 'started', -- started, email_verified, integration_selected, terms_accepted, payment_verified, completed
    last_step_completed_at DATETIME,
    signup_started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    signup_completed_at DATETIME,
    is_completed BOOLEAN DEFAULT 0,
    converted_to_customer_id TEXT, -- If they complete signup later
    source TEXT DEFAULT 'signup_page', -- signup_page, landing_page, etc.
    metadata TEXT, -- JSON for additional data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_incomplete_signups_email ON incomplete_signups(email);
  CREATE INDEX IF NOT EXISTS idx_incomplete_signups_step ON incomplete_signups(signup_step);
  CREATE INDEX IF NOT EXISTS idx_incomplete_signups_completed ON incomplete_signups(is_completed);
  CREATE INDEX IF NOT EXISTS idx_incomplete_signups_created_at ON incomplete_signups(created_at);
`);

// Re-enable foreign keys after table creation
db.pragma('foreign_keys = ON');

/**
 * Migration: Add missing columns to insurance_claims table
 * This handles the case where the table was created before circle_transfer_id, payment_status, and payment_amount were added
 */
function migrateInsuranceClaimsTable() {
  try {
    // Temporarily disable foreign keys for migration
    db.pragma('foreign_keys = OFF');

    // Get table info to check existing columns
    const tableInfo = db.prepare("PRAGMA table_info(insurance_claims)").all();
    const columnNames = tableInfo.map(col => col.name);

    // Check and add circle_transfer_id if missing
    if (!columnNames.includes('circle_transfer_id')) {
      console.log('🔄 Migrating: Adding circle_transfer_id column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN circle_transfer_id TEXT").run();
    }

    // Check and add payment_status if missing
    if (!columnNames.includes('payment_status')) {
      console.log('🔄 Migrating: Adding payment_status column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN payment_status TEXT DEFAULT 'pending'").run();
    }

    // Check and add payment_amount if missing
    if (!columnNames.includes('payment_amount')) {
      console.log('🔄 Migrating: Adding payment_amount column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN payment_amount REAL").run();
    }

    // Impact-weighted escrow: salted SHA-256 hash linking Octopi scan to blockchain (PHI-safe)
    if (!columnNames.includes('data_integrity_hash')) {
      console.log('🔄 Migrating: Adding data_integrity_hash column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN data_integrity_hash TEXT").run();
    }

    if (!columnNames.includes('impact_tier')) {
      console.log('🔄 Migrating: Adding impact_tier column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN impact_tier INTEGER DEFAULT 1").run();
    }

    if (!columnNames.includes('escrow_hash')) {
      console.log('🔄 Migrating: Adding escrow_hash column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN escrow_hash TEXT").run();
    }

    if (!columnNames.includes('healthcare_staff_address')) {
      console.log('🔄 Migrating: Adding healthcare_staff_address column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN healthcare_staff_address TEXT").run();
    }

    // Re-enable foreign keys after migration
    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Insurance claims migration failed:', error.message);
    // Re-enable foreign keys even if migration fails
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add email column to patient_portal_sessions if it doesn't exist
function migratePatientPortalSessionsEmail() {
  try {
    // Temporarily disable foreign keys for migration
    db.pragma('foreign_keys = OFF');

    const portalSessionsInfo = db.prepare(`PRAGMA table_info(patient_portal_sessions)`).all();
    const hasEmail = portalSessionsInfo.some(col => col.name === 'email');

    if (!hasEmail) {
      console.log('📦 Adding email column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN email TEXT;`);
      // Create index for email column
      db.exec(`CREATE INDEX IF NOT EXISTS idx_portal_sessions_email ON patient_portal_sessions(email);`);
      console.log('✅ Migration complete: email column added to patient_portal_sessions');
    } else {
      // Ensure index exists even if column already exists
      db.exec(`CREATE INDEX IF NOT EXISTS idx_portal_sessions_email ON patient_portal_sessions(email);`);
    }

    // Re-enable foreign keys after migration
    db.pragma('foreign_keys = ON');
  } catch (migrationError) {
    console.warn('⚠️  Patient portal sessions email migration failed:', migrationError.message);
    // Re-enable foreign keys even if migration fails
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add security metadata columns to patient_portal_sessions if they don't exist
function migratePatientPortalSessionsSecurityMeta() {
  try {
    db.pragma('foreign_keys = OFF');

    const cols = db.prepare(`PRAGMA table_info(patient_portal_sessions)`).all();
    const hasIp = cols.some((c) => c.name === 'ip_address');
    const hasUa = cols.some((c) => c.name === 'user_agent');
    const hasFailed = cols.some((c) => c.name === 'failed_attempts');
    const hasLocked = cols.some((c) => c.name === 'locked_until');
    const hasLastSeen = cols.some((c) => c.name === 'last_seen_at');
    const hasRevokedAt = cols.some((c) => c.name === 'revoked_at');
    const hasRotatedTo = cols.some((c) => c.name === 'rotated_to');

    if (!hasIp) {
      console.log('📦 Adding ip_address column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN ip_address TEXT;`);
    }
    if (!hasUa) {
      console.log('📦 Adding user_agent column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN user_agent TEXT;`);
    }
    if (!hasFailed) {
      console.log('📦 Adding failed_attempts column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN failed_attempts INTEGER DEFAULT 0;`);
    }
    if (!hasLocked) {
      console.log('📦 Adding locked_until column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN locked_until DATETIME;`);
    }
    if (!hasLastSeen) {
      console.log('📦 Adding last_seen_at column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN last_seen_at DATETIME;`);
    }
    if (!hasRevokedAt) {
      console.log('📦 Adding revoked_at column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN revoked_at DATETIME;`);
    }
    if (!hasRotatedTo) {
      console.log('📦 Adding rotated_to column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN rotated_to TEXT;`);
    }

    db.pragma('foreign_keys = ON');
  } catch (e) {
    console.warn('⚠️  Patient portal sessions security meta migration failed:', e.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add status column to patient_documents (mvp-41)
function migratePatientDocumentsStatus() {
  try {
    const info = db.prepare('PRAGMA table_info(patient_documents)').all();
    if (!info.some(c => c.name === 'status')) {
      db.exec(`ALTER TABLE patient_documents ADD COLUMN status TEXT DEFAULT 'available'`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_patient_documents_status ON patient_documents(status)`);
      console.log('✅ Migration: patient_documents.status added');
    }
    if (!info.some(c => c.name === 'storage_provider')) {
      db.exec(`ALTER TABLE patient_documents ADD COLUMN storage_provider TEXT DEFAULT 'local'`);
    }
    if (!info.some(c => c.name === 'storage_bucket')) {
      db.exec(`ALTER TABLE patient_documents ADD COLUMN storage_bucket TEXT`);
    }
    if (!info.some(c => c.name === 'storage_key')) {
      db.exec(`ALTER TABLE patient_documents ADD COLUMN storage_key TEXT`);
    }
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_patient_documents_provider ON patient_documents(storage_provider)`);
    } catch (_) {}
  } catch (e) {
    console.warn('⚠️  patient_documents status migration failed:', e.message);
  }
}

// Migration: durable patient doc download tokens table (mvp-67)
function migratePatientDocumentDownloadTokens() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS patient_document_download_tokens (
        token TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME,
        revoked_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_doc_tokens_doc ON patient_document_download_tokens(doc_id);
      CREATE INDEX IF NOT EXISTS idx_doc_tokens_patient ON patient_document_download_tokens(patient_id);
      CREATE INDEX IF NOT EXISTS idx_doc_tokens_expires ON patient_document_download_tokens(expires_at);
    `);
    console.log('✅ Migration: patient_document_download_tokens ensured');
  } catch (e) {
    console.warn('⚠️  patient_document_download_tokens migration failed:', e.message);
  }
}

// Migration: Add job call revenue columns to monthly_invoices table
function migrateMonthlyInvoicesJobCalls() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(monthly_invoices)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('job_calls_count')) {
      console.log('🔄 Migrating: Adding job_calls_count column to monthly_invoices table');
      db.prepare("ALTER TABLE monthly_invoices ADD COLUMN job_calls_count INTEGER DEFAULT 0").run();
    }

    if (!columnNames.includes('job_calls_revenue')) {
      console.log('🔄 Migrating: Adding job_calls_revenue column to monthly_invoices table');
      db.prepare("ALTER TABLE monthly_invoices ADD COLUMN job_calls_revenue REAL DEFAULT 0").run();
    }

    if (!columnNames.includes('job_calls_cost')) {
      console.log('🔄 Migrating: Adding job_calls_cost column to monthly_invoices table');
      db.prepare("ALTER TABLE monthly_invoices ADD COLUMN job_calls_cost REAL DEFAULT 0").run();
    }

    db.pragma('foreign_keys = ON');
    console.log('✅ Migration complete: job call columns added to monthly_invoices');
  } catch (error) {
    console.warn('⚠️  Monthly invoices job calls migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add delivery tracking fields to merchant_orders table
function migrateOrderTracking() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(merchant_orders)").all();
    const columnNames = tableInfo.map(col => col.name);

    const trackingFields = {
      'delivery_status': "TEXT DEFAULT 'pending'",
      'driver_name': 'TEXT',
      'driver_phone': 'TEXT',
      'current_latitude': 'REAL',
      'current_longitude': 'REAL',
      'current_address': 'TEXT',
      'estimated_arrival': 'DATETIME',
      'last_location_update': 'DATETIME',
      'tracking_events': 'TEXT', // JSON array of tracking events
      'pickup_address': 'TEXT', // Pickup/from location (store/warehouse)
      'pickup_latitude': 'REAL', // Pickup location coordinates
      'pickup_longitude': 'REAL',
      'drop_point': 'TEXT', // Drop point/delivery address (same as shipping_address but explicit)
      commerce_quote_id: 'TEXT',
      voice_checkout_id: 'TEXT',
      stripe_payment_intent_id: 'TEXT'
    };

    let addedCount = 0;
    for (const [fieldName, fieldType] of Object.entries(trackingFields)) {
      if (!columnNames.includes(fieldName)) {
        console.log(`📦 Adding ${fieldName} column to merchant_orders table...`);
        db.prepare(`ALTER TABLE merchant_orders ADD COLUMN ${fieldName} ${fieldType}`).run();
        addedCount++;
      }
    }

    if (addedCount > 0) {
      console.log(`✅ Migration complete: ${addedCount} tracking columns added to merchant_orders`);
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Order tracking migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: external_order_id + partial unique indexes for commerce idempotency (PI / voice checkout)
function migrateMerchantOrderCommerceIdempotency() {
  try {
    db.pragma('foreign_keys = OFF');
    const tableInfo = db.prepare('PRAGMA table_info(merchant_orders)').all();
    const columnNames = tableInfo.map((col) => col.name);
    if (!columnNames.includes('external_order_id')) {
      console.log('📦 Adding external_order_id column to merchant_orders...');
      db.prepare('ALTER TABLE merchant_orders ADD COLUMN external_order_id TEXT').run();
    }
    try {
      db.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_orders_pi_unique
        ON merchant_orders(stripe_payment_intent_id)
        WHERE stripe_payment_intent_id IS NOT NULL AND length(trim(stripe_payment_intent_id)) > 0
      `).run();
    } catch (e) {
      console.warn('⚠️  merchant_orders stripe_payment_intent_id unique index:', e.message);
    }
    try {
      db.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_orders_vc_unique
        ON merchant_orders(voice_checkout_id)
        WHERE voice_checkout_id IS NOT NULL AND length(trim(voice_checkout_id)) > 0
      `).run();
    } catch (e) {
      console.warn('⚠️  merchant_orders voice_checkout_id unique index:', e.message);
    }
    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  merchant_orders commerce idempotency migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add merchant_id column to customers table
function migrateCustomerMerchantId() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(customers)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('merchant_id')) {
      console.log('🔄 Migrating: Adding merchant_id column to customers table');
      db.prepare("ALTER TABLE customers ADD COLUMN merchant_id TEXT").run();

      // Create index for performance
      console.log('🔄 Migrating: Creating index on customers.merchant_id');
      db.prepare("CREATE INDEX IF NOT EXISTS idx_customers_merchant ON customers(merchant_id)").run();

      console.log('✅ Migration complete: merchant_id column added to customers table');
    } else {
      console.log('✅ Migration skipped: merchant_id column already exists in customers table');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ Customer merchant_id migration failed:', error.message);
    console.error('Stack:', error.stack);
    db.pragma('foreign_keys = ON');

    // In production, fail fast
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
    if (isProduction) {
      console.error('❌ CRITICAL: Migration failed in production. Exiting.');
      process.exit(1);
    }
  }
}

// Migration: Add subdomain column to merchants table
function migrateMerchantsSubdomain() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(merchants)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('subdomain')) {
      console.log('🔄 Migrating: Adding subdomain column to merchants table');
      // SQLite doesn't support UNIQUE in ALTER TABLE ADD COLUMN, so add without constraint first
      db.prepare("ALTER TABLE merchants ADD COLUMN subdomain TEXT").run();

      // Generate subdomains for existing merchants that don't have one
      console.log('🔄 Migrating: Generating subdomains for existing merchants');
      const existingMerchants = db.prepare('SELECT id, name FROM merchants WHERE subdomain IS NULL').all();
      // Use lazy require to avoid circular dependency - pass db instance
      const { generateSubdomain } = require('./utils/subdomain-generator');

      for (const merchant of existingMerchants) {
        const subdomain = generateSubdomain(merchant.name, merchant.id, db);
        db.prepare('UPDATE merchants SET subdomain = ? WHERE id = ?').run(subdomain, merchant.id);
        console.log(`   Generated subdomain "${subdomain}" for merchant ${merchant.id}`);
      }

      // Create unique index (this enforces uniqueness)
      console.log('🔄 Migrating: Creating unique index on merchants.subdomain');
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_subdomain_unique ON merchants(subdomain) WHERE subdomain IS NOT NULL").run();

      // Also create regular index for performance
      console.log('🔄 Migrating: Creating index on merchants.subdomain');
      db.prepare("CREATE INDEX IF NOT EXISTS idx_merchants_subdomain ON merchants(subdomain)").run();

      console.log('✅ Migration complete: subdomain column added to merchants table');
    } else {
      console.log('✅ Migration skipped: subdomain column already exists in merchants table');

      // Ensure unique index exists (in case migration was partially run)
      try {
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_subdomain_unique ON merchants(subdomain) WHERE subdomain IS NOT NULL").run();
      } catch (indexError) {
        // Index might already exist, that's okay
        console.log('   Unique index already exists or could not be created');
      }
    }

    // Migration: Add tenant_type column to merchants table
    if (!columnNames.includes('tenant_type')) {
      console.log('🔄 Migrating: Adding tenant_type column to merchants table');
      db.prepare("ALTER TABLE merchants ADD COLUMN tenant_type TEXT DEFAULT 'clinic'").run();

      // Set 'shop' for akin-dunbar (backward compatibility)
      const constants = require('./utils/constants');
      const defaultSubdomain = constants.TENANTS.DEFAULT_SUBDOMAIN;
      const akinDunbarMerchant = db.prepare('SELECT id FROM merchants WHERE subdomain = ?').get(defaultSubdomain);
      if (akinDunbarMerchant) {
        db.prepare('UPDATE merchants SET tenant_type = ? WHERE subdomain = ?').run('shop', defaultSubdomain);
        console.log(`   Set tenant_type='shop' for merchant with subdomain '${defaultSubdomain}'`);
      }

      console.log('✅ Migration complete: tenant_type column added to merchants table');
    } else {
      console.log('✅ Migration skipped: tenant_type column already exists in merchants table');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ Merchants subdomain migration failed:', error.message);
    console.error('Stack:', error.stack);
    db.pragma('foreign_keys = ON');

    // In production, fail fast
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
    if (isProduction) {
      console.error('❌ CRITICAL: Migration failed in production. Exiting.');
      process.exit(1);
    }
  }
}

// Migration: Add expiration and alert columns to customer_credits table
function migrateCustomerCreditsExpiration() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(customer_credits)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('free_credits_expires_at')) {
      console.log('🔄 Migrating: Adding free_credits_expires_at column to customer_credits table');
      db.prepare("ALTER TABLE customer_credits ADD COLUMN free_credits_expires_at DATETIME").run();
    }

    if (!columnNames.includes('low_credit_alert_sent_at')) {
      console.log('🔄 Migrating: Adding low_credit_alert_sent_at column to customer_credits table');
      db.prepare("ALTER TABLE customer_credits ADD COLUMN low_credit_alert_sent_at DATETIME").run();
    }

    db.pragma('foreign_keys = ON');
    console.log('✅ Migration complete: customer_credits expiration columns added');
  } catch (error) {
    console.error('❌ Customer credits expiration migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add pipeline fields to leads table
function migrateLeadsPipeline() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(leads)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('pipeline_stage')) {
      console.log('🔄 Migrating: Adding pipeline_stage column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN pipeline_stage TEXT DEFAULT 'new'").run();
    }

    if (!columnNames.includes('is_qualified')) {
      console.log('🔄 Migrating: Adding is_qualified column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN is_qualified INTEGER DEFAULT 0").run();

      // Auto-qualify existing leads that have phone + email
      db.prepare(`
        UPDATE leads 
        SET is_qualified = 1 
        WHERE clinic_phone IS NOT NULL 
          AND clinic_phone != '' 
          AND clinic_email IS NOT NULL 
          AND clinic_email != ''
      `).run();
    }

    if (!columnNames.includes('lead_score')) {
      console.log('🔄 Migrating: Adding lead_score column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN lead_score INTEGER DEFAULT 0").run();
    }

    if (!columnNames.includes('follow_up_date')) {
      console.log('🔄 Migrating: Adding follow_up_date column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN follow_up_date DATETIME").run();
    }

    if (!columnNames.includes('next_action')) {
      console.log('🔄 Migrating: Adding next_action column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN next_action TEXT").run();
    }

    if (!columnNames.includes('estimated_value')) {
      console.log('🔄 Migrating: Adding estimated_value column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN estimated_value REAL").run();
    }

    if (!columnNames.includes('owner_id')) {
      console.log('🔄 Migrating: Adding owner_id column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN owner_id TEXT").run();
    }

    if (!columnNames.includes('opening_hours')) {
      console.log('🔄 Migrating: Adding opening_hours column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN opening_hours TEXT").run();
    }

    if (!columnNames.includes('is_test')) {
      console.log('🔄 Migrating: Adding is_test column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN is_test INTEGER DEFAULT 0").run();
    }

    if (!columnNames.includes('lead_type')) {
      console.log('🔄 Migrating: Adding lead_type column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN lead_type TEXT DEFAULT 'sales'").run();

      // Set lead_type based on source field for existing leads
      // Sales leads: source = 'google_search' or 'job_search'
      // Customer leads: source = 'self_signup'
      db.prepare(`
        UPDATE leads 
        SET lead_type = CASE 
          WHEN source = 'self_signup' THEN 'customer'
          ELSE 'sales'
        END
      `).run();
    }

    db.pragma('foreign_keys = ON');
    console.log('✅ Migration complete: pipeline columns added to leads');
  } catch (error) {
    console.warn('⚠️  Leads pipeline migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add Phase 2 qualification rules table
function migrateQualificationRules() {
  try {
    db.pragma('foreign_keys = OFF');

    // Check if qualification_rules table exists
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='qualification_rules'").get();
    if (!table) {
      console.log('🔄 Migrating: Creating qualification_rules table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS qualification_rules (
          id TEXT PRIMARY KEY,
          merchant_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          rules_json TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          priority INTEGER DEFAULT 5,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        );

        CREATE INDEX IF NOT EXISTS idx_qualification_rules_merchant_id ON qualification_rules(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_qualification_rules_enabled ON qualification_rules(enabled);
        CREATE INDEX IF NOT EXISTS idx_qualification_rules_priority ON qualification_rules(priority);
      `);
      console.log('✅ Migration complete: qualification_rules table created');
    } else {
      console.log('✅ Migration skipped: qualification_rules table already exists');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Qualification rules migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add Phase 2 sequences tables
function migrateSequences() {
  try {
    db.pragma('foreign_keys = OFF');

    // Check if sequences table exists
    const sequencesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sequences'").get();
    if (!sequencesTable) {
      console.log('🔄 Migrating: Creating sequences and sequence_executions tables');
      db.exec(`
        CREATE TABLE IF NOT EXISTS sequences (
          id TEXT PRIMARY KEY,
          merchant_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          steps_json TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        );

        CREATE TABLE IF NOT EXISTS sequence_executions (
          id TEXT PRIMARY KEY,
          sequence_id TEXT NOT NULL,
          lead_id TEXT NOT NULL,
          current_step INTEGER DEFAULT 0,
          status TEXT DEFAULT 'active',
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          paused_at DATETIME,
          metadata TEXT,
          FOREIGN KEY (sequence_id) REFERENCES sequences(id),
          FOREIGN KEY (lead_id) REFERENCES leads(id)
        );

        CREATE INDEX IF NOT EXISTS idx_sequences_merchant_id ON sequences(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_sequences_enabled ON sequences(enabled);
        CREATE INDEX IF NOT EXISTS idx_sequence_executions_sequence_id ON sequence_executions(sequence_id);
        CREATE INDEX IF NOT EXISTS idx_sequence_executions_lead_id ON sequence_executions(lead_id);
        CREATE INDEX IF NOT EXISTS idx_sequence_executions_status ON sequence_executions(status);
      `);
      console.log('✅ Migration complete: sequences tables created');
    } else {
      console.log('✅ Migration skipped: sequences tables already exist');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Sequences migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add Phase 1 admin portal columns to leads table
function migrateLeadsPhase1() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(leads)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('auto_qualified')) {
      console.log('🔄 Migrating: Adding auto_qualified column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN auto_qualified INTEGER DEFAULT 0").run();
    }

    if (!columnNames.includes('qualified_at')) {
      console.log('🔄 Migrating: Adding qualified_at column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN qualified_at DATETIME").run();
    }

    if (!columnNames.includes('last_score_update')) {
      console.log('🔄 Migrating: Adding last_score_update column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN last_score_update DATETIME").run();
    }

    db.pragma('foreign_keys = ON');
    console.log('✅ Migration complete: Phase 1 columns added to leads');
  } catch (error) {
    console.warn('⚠️  Leads Phase 1 migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add password_hash column to customers table
function migrateCustomersPasswordHash() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(customers)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('password_hash')) {
      console.log('🔄 Migrating: Adding password_hash column to customers table');
      db.prepare("ALTER TABLE customers ADD COLUMN password_hash TEXT").run();

      // Create index for faster lookups (though we'll primarily query by email)
      console.log('✅ Migration complete: password_hash column added to customers table');
    } else {
      console.log('✅ Migration skipped: password_hash column already exists in customers table');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ Customers password_hash migration failed:', error.message);
    console.error('Stack:', error.stack);
    db.pragma('foreign_keys = ON');

    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
    if (isProduction) {
      console.error('❌ CRITICAL: Migration failed in production. Exiting.');
      process.exit(1);
    }
  }
}

// Migration: Add customer_id to appointments table for tenant isolation
function migrateAppointmentsCustomerId() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(appointments)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('customer_id')) {
      console.log('🔄 Migrating: Adding customer_id column to appointments table');
      db.prepare("ALTER TABLE appointments ADD COLUMN customer_id TEXT").run();

      // Create index for faster queries
      db.prepare("CREATE INDEX IF NOT EXISTS idx_appointments_customer_id ON appointments(customer_id)").run();

      console.log('✅ Migration complete: customer_id added to appointments table');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Appointments customer_id migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add missing columns to customers table
function migrateCustomersTable() {
  try {
    db.pragma('foreign_keys = OFF');
    const tableInfo = db.prepare("PRAGMA table_info(customers)").all();
    const columnNames = tableInfo.map(col => col.name);

    const newColumns = {
      phone_number: 'TEXT',
      business_size: 'TEXT',
      use_case: 'TEXT',
      api_features: 'TEXT',
      email_verified: 'BOOLEAN DEFAULT 0',
      email_verified_at: 'DATETIME',
      updated_at: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
      retell_agent_id: 'TEXT',
      retell_agent_status: "TEXT DEFAULT 'pending'",
      stripe_customer_id: 'TEXT',
      stripe_payment_method_id: 'TEXT',
      card_last4: 'TEXT',
      card_brand: 'TEXT',
      card_verified: 'BOOLEAN DEFAULT 0',
      card_verified_at: 'DATETIME',
      customer_type: "TEXT DEFAULT 'saas'",
      twilio_phone_number: 'TEXT',
      twilio_phone_sid: 'TEXT',
      pricing_tier: "TEXT DEFAULT 'starter'",
      custom_prompt: 'TEXT',
      prompt_updated_at: 'DATETIME',
      fhir_patient_id: 'TEXT',
      provider_profile: 'TEXT'
    };

    Object.keys(newColumns).forEach(colName => {
      if (!columnNames.includes(colName)) {
        console.log(`📦 Adding ${colName} column to customers table...`);
        db.prepare(`ALTER TABLE customers ADD COLUMN ${colName} ${newColumns[colName]}`).run();
      }
    });

    // Create index for fhir_patient_id if it was just added
    if (!columnNames.includes('fhir_patient_id')) {
      console.log('📦 Creating index on customers.fhir_patient_id...');
      db.prepare("CREATE INDEX IF NOT EXISTS idx_customers_fhir_patient_id ON customers(fhir_patient_id)").run();
    }

    db.pragma('foreign_keys = ON');
    console.log('✅ Migration complete: customers table updated');
  } catch (migrationError) {
    console.warn('⚠️  Customers table migration failed:', migrationError.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Canonical provider links (provider_id) for status + availability
function migrateProviderCanonicalLinks() {
  try {
    db.pragma('foreign_keys = OFF');

    const statusCols = db.prepare("PRAGMA table_info(provider_status)").all().map((c) => c.name);
    if (!statusCols.includes('provider_id')) {
      db.exec('ALTER TABLE provider_status ADD COLUMN provider_id TEXT');
      console.log('✅ Migration: provider_status.provider_id added');
    }
    if (!statusCols.includes('last_seen_at')) {
      db.exec('ALTER TABLE provider_status ADD COLUMN last_seen_at DATETIME');
      console.log('✅ Migration: provider_status.last_seen_at added');
    }
    if (!statusCols.includes('heartbeat_expires_at')) {
      db.exec('ALTER TABLE provider_status ADD COLUMN heartbeat_expires_at DATETIME');
      console.log('✅ Migration: provider_status.heartbeat_expires_at added');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_provider_status_provider_id ON provider_status(provider_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_provider_status_heartbeat_expiry ON provider_status(heartbeat_expires_at)');

    const blockCols = db.prepare("PRAGMA table_info(provider_availability_blocks)").all().map((c) => c.name);
    if (!blockCols.includes('provider_id')) {
      db.exec('ALTER TABLE provider_availability_blocks ADD COLUMN provider_id TEXT');
      console.log('✅ Migration: provider_availability_blocks.provider_id added');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_availability_blocks_provider_id ON provider_availability_blocks(provider_id)');

    // Backfill provider_id by provider email
    db.exec(`
      UPDATE provider_status
      SET provider_id = (
        SELECT pp.id
        FROM provider_profiles pp
        WHERE lower(pp.email) = lower(provider_status.email)
        LIMIT 1
      )
      WHERE provider_id IS NULL
    `);

    db.exec(`
      UPDATE provider_availability_blocks
      SET provider_id = (
        SELECT pp.id
        FROM provider_profiles pp
        WHERE lower(pp.email) = lower(provider_availability_blocks.provider_email)
        LIMIT 1
      )
      WHERE provider_id IS NULL
    `);

    db.pragma('foreign_keys = ON');
  } catch (e) {
    console.warn('⚠️  provider canonical links migration failed:', e.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: persist booking persona in triage session for reconnect/restart resilience
function migrateTriageSessionBookingFor() {
  try {
    const info = db.prepare("PRAGMA table_info(triage_sessions)").all();
    const cols = info.map((c) => c.name);
    if (!cols.includes('booking_for')) {
      db.exec('ALTER TABLE triage_sessions ADD COLUMN booking_for TEXT');
      console.log('✅ Migration: triage_sessions.booking_for added');
    }
  } catch (e) {
    console.warn('⚠️  triage_sessions.booking_for migration failed:', e.message);
  }
}

// ============================================
// MIGRATION: Add cost columns to voice_call_log
// ============================================
function migrateVoiceCallLogCosts() {
  try {
    const voiceCallLogColumns = db.pragma('table_info(voice_call_log)');
    const columnNames = voiceCallLogColumns.map(col => col.name);

    const costColumns = {
      'twilio_call_sid': 'TEXT',
      'twilio_cost_usd': 'REAL',
      'retell_cost_usd': 'REAL',
      'total_cost_usd': 'REAL',
      'twilio_cost_calculated_usd': 'REAL',
      'retell_cost_calculated_usd': 'REAL',
      'cost_source': 'TEXT',
      'cost_updated_at': 'DATETIME'
    };

    Object.keys(costColumns).forEach(colName => {
      if (!columnNames.includes(colName)) {
        console.log(`📦 Adding ${colName} column to voice_call_log table...`);
        db.exec(`ALTER TABLE voice_call_log ADD COLUMN ${colName} ${costColumns[colName]};`);
        console.log(`✅ Migration complete: ${colName} column added`);
      }
    });

    // Create indexes for cost tracking
    db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_call_log_twilio_sid ON voice_call_log(twilio_call_sid);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_call_log_created_at ON voice_call_log(created_at);`);

    console.log('✅ Migration complete: voice_call_log cost columns ensured');
  } catch (migrationError) {
    console.warn('⚠️  voice_call_log cost columns migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: Voice call state tables (medical coding agent)
// ============================================
function migrateVoiceCallStateTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_call_states (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL UNIQUE,
        clinic_id TEXT,
        current_stage TEXT DEFAULT 'INTAKE',
        state_data TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_voice_call_states_call_id ON voice_call_states(call_id);

      CREATE TABLE IF NOT EXISTS voice_conversation_memory (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        clinic_id TEXT,
        turn_number INTEGER DEFAULT 0,
        role TEXT NOT NULL,
        content TEXT,
        extracted_entities TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_voice_conversation_memory_call_id ON voice_conversation_memory(call_id);

      CREATE TABLE IF NOT EXISTS agent_state_snapshots (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        state_name TEXT NOT NULL,
        state_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_agent_state_snapshots_call_id ON agent_state_snapshots(call_id);

      CREATE TABLE IF NOT EXISTS decision_log (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        node TEXT NOT NULL,
        input_summary TEXT,
        output_summary TEXT,
        reasoning TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_decision_log_call_id ON decision_log(call_id);
    `);
    console.log('✅ Migration complete: voice call state tables ensured');
  } catch (migrationError) {
    console.warn('⚠️  Voice call state tables migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: icd10_codes table (Phase 2.1)
// ============================================
function migrateIcd10CodesTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS icd10_codes (
        code TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        category TEXT,
        billable INTEGER DEFAULT 1,
        source_file TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_icd10_codes_description ON icd10_codes(description);
    `);
    console.log('✅ Migration complete: icd10_codes table ensured');
  } catch (migrationError) {
    console.warn('⚠️  icd10_codes table migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: hcpcs_codes table (Phase 2.2)
// ============================================
function migrateHcpcsCodesTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hcpcs_codes (
        code TEXT PRIMARY KEY,
        long_desc TEXT NOT NULL,
        short_desc TEXT,
        pricing_ind TEXT,
        coverage_cd TEXT,
        type TEXT,
        source_file TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_hcpcs_codes_long_desc ON hcpcs_codes(long_desc);
      CREATE INDEX IF NOT EXISTS idx_hcpcs_codes_short_desc ON hcpcs_codes(short_desc);
    `);
    console.log('✅ Migration complete: hcpcs_codes table ensured');
  } catch (migrationError) {
    console.warn('⚠️  hcpcs_codes table migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: coding_decisions table (Phase 5.2 - audit trail)
// ============================================
function migrateCodingDecisionsTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS coding_decisions (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        clinic_id TEXT,
        patient_id TEXT,
        clinical_note TEXT,
        proposed_icd10 TEXT NOT NULL,
        proposed_cpt TEXT NOT NULL,
        reasoning TEXT,
        confidence_score REAL,
        validation_status TEXT NOT NULL,
        validation_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_coding_decisions_call_id ON coding_decisions(call_id);
      CREATE INDEX IF NOT EXISTS idx_coding_decisions_clinic_id ON coding_decisions(clinic_id);
      CREATE INDEX IF NOT EXISTS idx_coding_decisions_created_at ON coding_decisions(created_at);
    `);
    console.log('✅ Migration complete: coding_decisions table ensured');
    // Tiba Phase 5.4: rule_version, rule_hash for audit
    try {
      const cdInfo = db.prepare('PRAGMA table_info(coding_decisions)').all();
      if (!cdInfo.some(c => c.name === 'rule_version')) {
        db.exec('ALTER TABLE coding_decisions ADD COLUMN rule_version TEXT');
      }
      if (!cdInfo.some(c => c.name === 'rule_hash')) {
        db.exec('ALTER TABLE coding_decisions ADD COLUMN rule_hash TEXT');
      }
    } catch (_) {}
  } catch (migrationError) {
    console.warn('⚠️  coding_decisions table migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: llm_usage_log table (Phase 8.2 - our LLM token/cost tracking)
// ============================================
function migrateLlmUsageLogTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_usage_log (
        id TEXT PRIMARY KEY,
        call_id TEXT,
        operation TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER,
        tokens_out INTEGER,
        cost_usd REAL,
        latency_ms INTEGER,
        confidence_score REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_llm_usage_log_call_id ON llm_usage_log(call_id);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_log_operation ON llm_usage_log(operation);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_log_created_at ON llm_usage_log(created_at);
    `);
    // Add confidence_score if table existed without it
    try {
      const info = db.prepare("PRAGMA table_info(llm_usage_log)").all();
      if (!info.some(c => c.name === 'confidence_score')) {
        db.exec('ALTER TABLE llm_usage_log ADD COLUMN confidence_score REAL');
        console.log('✅ Migration: llm_usage_log confidence_score column added');
      }
    } catch (_) { /* column may already exist */ }
    console.log('✅ Migration complete: llm_usage_log table ensured');
  } catch (migrationError) {
    console.warn('⚠️  llm_usage_log table migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: clinic_monthly_llm_cost (Section 10 - cost caps)
// ============================================
function migrateClinicMonthlyLlmCostTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS clinic_monthly_llm_cost (
        clinic_id TEXT NOT NULL,
        year_month TEXT NOT NULL,
        cost_usd REAL DEFAULT 0,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (clinic_id, year_month)
      );
      CREATE INDEX IF NOT EXISTS idx_clinic_monthly_llm_cost_ym ON clinic_monthly_llm_cost(year_month);
    `);
    const info = db.prepare('PRAGMA table_info(llm_usage_log)').all();
    if (!info.some(c => c.name === 'clinic_id')) {
      db.exec('ALTER TABLE llm_usage_log ADD COLUMN clinic_id TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_llm_usage_log_clinic_id ON llm_usage_log(clinic_id)');
    }
    console.log('✅ Migration complete: clinic_monthly_llm_cost + llm_usage_log.clinic_id');
  } catch (e) {
    console.warn('⚠️  clinic_monthly_llm_cost migration failed:', e.message);
  }
}

function migrateClinicsMonthlyCostCap() {
  try {
    const info = db.prepare('PRAGMA table_info(clinics)').all();
    if (!info.some(c => c.name === 'monthly_cost_cap')) {
      db.exec('ALTER TABLE clinics ADD COLUMN monthly_cost_cap REAL');
      console.log('✅ Migration: clinics.monthly_cost_cap added');
    }
    if (!info.some(c => c.name === 'region')) {
      db.exec('ALTER TABLE clinics ADD COLUMN region TEXT');
      console.log('✅ Migration: clinics.region added');
    }
    if (!info.some(c => c.name === 'country_code')) {
      db.exec('ALTER TABLE clinics ADD COLUMN country_code TEXT');
      console.log('✅ Migration: clinics.country_code added');
    }
  } catch (e) {
    console.warn('⚠️  clinics monthly_cost_cap migration failed:', e.message);
  }
}

// ============================================
// MIGRATION: patient_coding_history + provider_preferences (Section 8 - long-term memory)
// ============================================
function migrateLongTermMemoryTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS patient_coding_history (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        encounter_id TEXT,
        clinic_id TEXT,
        icd10 TEXT,
        cpt TEXT,
        confidence REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_patient_coding_history_patient ON patient_coding_history(patient_id);
      CREATE INDEX IF NOT EXISTS idx_patient_coding_history_clinic ON patient_coding_history(clinic_id);

      CREATE TABLE IF NOT EXISTS provider_preferences (
        provider_id TEXT NOT NULL,
        preference_key TEXT NOT NULL,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider_id, preference_key)
      );
    `);
    console.log('✅ Migration complete: patient_coding_history + provider_preferences');
  } catch (e) {
    console.warn('⚠️  Long-term memory tables migration failed:', e.message);
  }
}

// ============================================
// MIGRATION: clinic_settings (Section 14 - per-tenant config)
// ============================================
function migrateHipaaAccessLogTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hipaa_access_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        action TEXT NOT NULL,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_hipaa_access_log_user ON hipaa_access_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_hipaa_access_log_resource ON hipaa_access_log(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_hipaa_access_log_created ON hipaa_access_log(created_at);
    `);
    // Gap Analysis: add patient_id for HIPAA audit (which patient's PHI was accessed)
    const info = db.prepare('PRAGMA table_info(hipaa_access_log)').all();
    if (!info.some(c => c.name === 'patient_id')) {
      db.exec('ALTER TABLE hipaa_access_log ADD COLUMN patient_id TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_hipaa_access_log_patient ON hipaa_access_log(patient_id)');
      console.log('✅ Migration: hipaa_access_log patient_id column added');
    }
    console.log('✅ Migration complete: hipaa_access_log table');
  } catch (e) {
    console.warn('⚠️  hipaa_access_log migration failed:', e.message);
  }
}

// ============================================
function migrateClinicSettingsTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS clinic_settings (
        clinic_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (clinic_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_clinic_settings_clinic ON clinic_settings(clinic_id);
    `);
    console.log('✅ Migration complete: clinic_settings');
  } catch (e) {
    console.warn('⚠️  clinic_settings migration failed:', e.message);
  }
}

// ============================================
// MIGRATION: postgres_sync_retry + postgres_sync_dlq (Section 2.2 - retry queue)
// ============================================
function migratePostgresSyncRetryTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS postgres_sync_retry (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        priority INTEGER DEFAULT 2,
        attempt_count INTEGER DEFAULT 0,
        last_error TEXT,
        last_attempt_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_postgres_sync_retry_priority ON postgres_sync_retry(priority);
      CREATE INDEX IF NOT EXISTS idx_postgres_sync_retry_created ON postgres_sync_retry(created_at);

      CREATE TABLE IF NOT EXISTS postgres_sync_dlq (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempt_count INTEGER DEFAULT 0,
        last_error TEXT,
        moved_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_postgres_sync_dlq_entity ON postgres_sync_dlq(entity_type);
    `);
    console.log('✅ Migration complete: postgres_sync_retry + postgres_sync_dlq tables ensured');
  } catch (migrationError) {
    console.warn('⚠️  postgres_sync_retry table migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: dlq_tool_calls table (Section 2 - dead letter queue for failed tool calls)
// ============================================
function migrateDlqToolCallsTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dlq_tool_calls (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        clinic_id TEXT,
        function_name TEXT NOT NULL,
        parameters_json TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_dlq_tool_calls_call_id ON dlq_tool_calls(call_id);
      CREATE INDEX IF NOT EXISTS idx_dlq_tool_calls_function ON dlq_tool_calls(function_name);
      CREATE INDEX IF NOT EXISTS idx_dlq_tool_calls_created ON dlq_tool_calls(created_at);
    `);
    console.log('✅ Migration complete: dlq_tool_calls table ensured');
  } catch (migrationError) {
    console.warn('⚠️  dlq_tool_calls table migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: feature_flags table (Section 15)
// ============================================
function migrateFeatureFlagsTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        flag_name TEXT PRIMARY KEY,
        enabled_globally INTEGER DEFAULT 0,
        enabled_for_clinic_ids TEXT,
        rollout_pct INTEGER DEFAULT 100,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Migration complete: feature_flags table ensured');
  } catch (e) {
    console.warn('⚠️  feature_flags migration failed:', e.message);
  }
}

// ============================================
// MIGRATION: voice_call_log.clinic_id (Section 14)
// ============================================
function migrateVoiceCallLogClinicId() {
  try {
    const info = db.prepare('PRAGMA table_info(voice_call_log)').all();
    if (!info.some(c => c.name === 'clinic_id')) {
      db.exec('ALTER TABLE voice_call_log ADD COLUMN clinic_id TEXT');
      db.exec('UPDATE voice_call_log SET clinic_id = customer_id WHERE clinic_id IS NULL AND customer_id IS NOT NULL');
      db.exec('CREATE INDEX IF NOT EXISTS idx_voice_call_log_clinic_id ON voice_call_log(clinic_id)');
      console.log('✅ Migration complete: voice_call_log.clinic_id added');
    }
  } catch (e) {
    console.warn('⚠️  voice_call_log clinic_id migration failed:', e.message);
  }
}

// ============================================
// MIGRATION: idempotency_keys table (Section 22 - prevent double-billing)
// ============================================
function migrateIdempotencyKeysTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id TEXT PRIMARY KEY,
        operation_type TEXT NOT NULL,
        result_json TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys(created_at);
      CREATE INDEX IF NOT EXISTS idx_idempotency_keys_operation ON idempotency_keys(operation_type);
    `);
    try {
      const info = db.prepare("PRAGMA table_info(idempotency_keys)").all();
      if (!info.some(c => c.name === 'status')) {
        db.exec('ALTER TABLE idempotency_keys ADD COLUMN status TEXT DEFAULT \'pending\'');
      }
    } catch (_) { /* column may exist */ }
    console.log('✅ Migration complete: idempotency_keys table ensured');
  } catch (migrationError) {
    console.warn('⚠️  idempotency_keys table migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: code_embeddings table (Phase 2.3 - optional semantic search)
// ============================================
function migrateCodeEmbeddingsTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS code_embeddings (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        code_type TEXT NOT NULL,
        description_text TEXT,
        embedding_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_code_embeddings_code_type ON code_embeddings(code_type);
    `);
    const tableInfo = db.prepare('PRAGMA table_info(code_embeddings)').all();
    const hasSpecialty = tableInfo.some(c => c.name === 'specialty');
    if (!hasSpecialty) {
      db.prepare('ALTER TABLE code_embeddings ADD COLUMN specialty TEXT').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_code_embeddings_specialty ON code_embeddings(specialty)').run();
      console.log('✅ Migration complete: code_embeddings.specialty column added');
    } else {
      console.log('✅ Migration complete: code_embeddings table ensured');
    }
  } catch (migrationError) {
    console.warn('⚠️  code_embeddings table migration failed:', migrationError.message);
  }
}

// Migration: Add merchant_id column to fhir_patients table
function migrateFHIRPatientsMerchantId() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(fhir_patients)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('merchant_id')) {
      console.log('🔄 Migrating: Adding merchant_id column to fhir_patients table');
      db.prepare("ALTER TABLE fhir_patients ADD COLUMN merchant_id TEXT").run();

      // Create index for performance
      console.log('🔄 Migrating: Creating index on fhir_patients.merchant_id');
      db.prepare("CREATE INDEX IF NOT EXISTS idx_fhir_patients_merchant ON fhir_patients(merchant_id)").run();

      console.log('✅ Migration complete: merchant_id column added to fhir_patients table');
    } else {
      console.log('✅ Migration skipped: merchant_id column already exists in fhir_patients table');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ FHIR patients merchant_id migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add patient_wallet_address (HSA) to fhir_patients for impact-weighted escrow
function migrateFHIRPatientsWalletAddress() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(fhir_patients)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('patient_wallet_address')) {
      console.log('🔄 Migrating: Adding patient_wallet_address column to fhir_patients table');
      db.prepare("ALTER TABLE fhir_patients ADD COLUMN patient_wallet_address TEXT").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_fhir_patients_wallet ON fhir_patients(patient_wallet_address)").run();
      console.log('✅ Migration complete: patient_wallet_address added for HSA escrow flow');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ FHIR patients wallet migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add merged_into marker for patient merges (helps unify identity)
function migrateFHIRPatientsMergedInto() {
  try {
    db.pragma('foreign_keys = OFF');
    const tableInfo = db.prepare("PRAGMA table_info(fhir_patients)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('merged_into')) {
      console.log('🔄 Migrating: Adding merged_into column to fhir_patients table');
      db.prepare("ALTER TABLE fhir_patients ADD COLUMN merged_into TEXT").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_fhir_patients_merged_into ON fhir_patients(merged_into)").run();
      console.log('✅ Migration complete: merged_into column added to fhir_patients table');
    }
    if (!columnNames.includes('merged_at')) {
      console.log('🔄 Migrating: Adding merged_at column to fhir_patients table');
      db.prepare("ALTER TABLE fhir_patients ADD COLUMN merged_at DATETIME").run();
      console.log('✅ Migration complete: merged_at column added to fhir_patients table');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ FHIR patients merge marker migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add merchant_id column to circle_accounts table
function migrateCircleAccountsMerchantId() {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(circle_accounts)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('merchant_id')) {
      console.log('🔄 Migrating: Adding merchant_id column to circle_accounts table');
      db.prepare("ALTER TABLE circle_accounts ADD COLUMN merchant_id TEXT").run();

      // Create index for performance
      console.log('🔄 Migrating: Creating index on circle_accounts.merchant_id');
      db.prepare("CREATE INDEX IF NOT EXISTS idx_circle_accounts_merchant ON circle_accounts(merchant_id)").run();

      console.log('✅ Migration complete: merchant_id column added to circle_accounts table');
    } else {
      console.log('✅ Migration skipped: merchant_id column already exists in circle_accounts table');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ Circle accounts merchant_id migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Create lead labels tables
function migrateLeadLabels() {
  try {
    db.pragma('foreign_keys = OFF');

    // Check if lead_labels table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='lead_labels'
    `).get();

    if (!tableExists) {
      console.log('🔄 Migrating: Creating lead_labels and lead_label_assignments tables');

      db.exec(`
        CREATE TABLE IF NOT EXISTS lead_labels (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT DEFAULT '#3b82f6',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS lead_label_assignments (
          lead_id TEXT NOT NULL,
          label_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (lead_id, label_id),
          FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
          FOREIGN KEY (label_id) REFERENCES lead_labels(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_lead_id ON lead_label_assignments(lead_id);
        CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_label_id ON lead_label_assignments(label_id);
      `);

      // Create default labels
      const defaultLabels = [
        { id: require('crypto').randomBytes(16).toString('hex'), name: 'HOT', color: '#ef4444' },
        { id: require('crypto').randomBytes(16).toString('hex'), name: 'WARM', color: '#f59e0b' },
        { id: require('crypto').randomBytes(16).toString('hex'), name: 'COLD', color: '#6b7280' },
        { id: require('crypto').randomBytes(16).toString('hex'), name: 'WEBSITE LEADS', color: '#10b981' }
      ];

      for (const label of defaultLabels) {
        try {
          db.prepare(`
            INSERT INTO lead_labels (id, name, color)
            VALUES (?, ?, ?)
          `).run(label.id, label.name, label.color);
        } catch (e) {
          // Label might already exist, skip
        }
      }

      console.log('✅ Migration complete: lead_labels tables created');
    } else {
      console.log('✅ Migration skipped: lead_labels tables already exist');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Lead labels migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: unified intake event stream (Phase 1 channel adapter persistence)
function migrateIntakeEventStream() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS intake_event_stream (
        event_id TEXT PRIMARY KEY,
        trace_id TEXT,
        request_id TEXT,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        session_id TEXT,
        room_id TEXT,
        raw_envelope_json TEXT NOT NULL,
        normalized_event_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_intake_event_stream_trace ON intake_event_stream(trace_id);
      CREATE INDEX IF NOT EXISTS idx_intake_event_stream_session ON intake_event_stream(session_id);
      CREATE INDEX IF NOT EXISTS idx_intake_event_stream_room ON intake_event_stream(room_id);
      CREATE INDEX IF NOT EXISTS idx_intake_event_stream_type ON intake_event_stream(event_type);
      CREATE INDEX IF NOT EXISTS idx_intake_event_stream_created ON intake_event_stream(created_at);
    `);
    console.log('✅ Migration complete: intake_event_stream table ensured');
  } catch (e) {
    console.warn('⚠️  intake_event_stream migration failed:', e.message);
  }
}

// Migration: deterministic canonical session/room state projection
function migrateSessionStateProjection() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_state_projection (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        room_id TEXT,
        trace_id TEXT,
        source_last TEXT,
        event_type_last TEXT,
        last_event_id TEXT,
        chief_complaint TEXT,
        body_sites_json TEXT,
        severity REAL,
        timeline_text TEXT,
        risk_flags_json TEXT,
        raw_last_text TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_session_state_projection_session ON session_state_projection(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_state_projection_room ON session_state_projection(room_id);
      CREATE INDEX IF NOT EXISTS idx_session_state_projection_trace ON session_state_projection(trace_id);
      CREATE INDEX IF NOT EXISTS idx_session_state_projection_updated ON session_state_projection(updated_at);
    `);
    console.log('✅ Migration complete: session_state_projection table ensured');
  } catch (e) {
    console.warn('⚠️  session_state_projection migration failed:', e.message);
  }
}

// Migration: backfill canonical state from historical triage_sessions.
function migrateBackfillSessionStateFromTriage() {
  try {
    const triageTable = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='triage_sessions'
    `).get();
    if (!triageTable) return;

    const rows = db.prepare(`
      SELECT session_id, associated_sx, quality, severity, onset, timing, safety_screen, referred_to_911, updated_at
      FROM triage_sessions
      WHERE session_id IS NOT NULL AND TRIM(session_id) <> ''
      ORDER BY datetime(updated_at) DESC
      LIMIT 5000
    `).all();
    if (!rows.length) return;

    const upsert = db.prepare(`
      INSERT INTO session_state_projection (
        id, session_id, chief_complaint, severity, timeline_text, risk_flags_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        chief_complaint = COALESCE(excluded.chief_complaint, session_state_projection.chief_complaint),
        severity = COALESCE(excluded.severity, session_state_projection.severity),
        timeline_text = COALESCE(excluded.timeline_text, session_state_projection.timeline_text),
        risk_flags_json = CASE
          WHEN excluded.risk_flags_json IS NOT NULL AND excluded.risk_flags_json <> '[]' THEN excluded.risk_flags_json
          ELSE session_state_projection.risk_flags_json
        END,
        updated_at = datetime('now')
    `);

    for (const r of rows) {
      const sid = String(r.session_id || '').trim();
      if (!sid) continue;
      const id = `session:${sid}`;
      const complaint = r.associated_sx || r.quality || null;
      const timeline = r.onset || r.timing || null;
      const riskFlags = [];
      if (String(r.safety_screen || '').toLowerCase().includes('positive')) riskFlags.push('safety_screen_positive');
      if (Number(r.referred_to_911 || 0) === 1) riskFlags.push('referred_to_911');
      upsert.run(id, sid, complaint, r.severity ?? null, timeline, JSON.stringify(riskFlags));
    }
    console.log('✅ Migration complete: session_state_projection backfill from triage_sessions');
  } catch (e) {
    console.warn('⚠️  session_state_projection backfill failed:', e.message);
  }
}

// Migration: cosmetic knowledge stack tables (OBF/CosIng + restrictions)
function migrateCosmeticKnowledgeTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS products_catalog (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'obf',
        source_product_id TEXT,
        brand TEXT,
        product_name TEXT NOT NULL,
        normalized_name TEXT,
        inci_text TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_products_catalog_source ON products_catalog(source);
      CREATE INDEX IF NOT EXISTS idx_products_catalog_source_id ON products_catalog(source_product_id);
      CREATE INDEX IF NOT EXISTS idx_products_catalog_name ON products_catalog(normalized_name);

      CREATE TABLE IF NOT EXISTS product_ingredients (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        inci_name TEXT NOT NULL,
        ingredient_order INTEGER,
        raw_ingredient TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, inci_name, ingredient_order)
      );
      CREATE INDEX IF NOT EXISTS idx_product_ingredients_product ON product_ingredients(product_id);
      CREATE INDEX IF NOT EXISTS idx_product_ingredients_inci ON product_ingredients(inci_name);

      CREATE TABLE IF NOT EXISTS cosing_ingredients (
        inci_name TEXT PRIMARY KEY,
        cas_number TEXT,
        ec_number TEXT,
        functions_json TEXT,
        restrictions_json TEXT,
        metadata_json TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cosing_inci_name ON cosing_ingredients(inci_name);

      CREATE TABLE IF NOT EXISTS cosmetic_restrictions (
        id TEXT PRIMARY KEY,
        inci_name TEXT NOT NULL,
        annex TEXT,
        restriction_type TEXT,
        limit_text TEXT,
        conditions_text TEXT,
        reference_text TEXT,
        source TEXT DEFAULT 'eu_1223',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cosmetic_restrictions_inci ON cosmetic_restrictions(inci_name);
      CREATE INDEX IF NOT EXISTS idx_cosmetic_restrictions_annex ON cosmetic_restrictions(annex);
    `);
    console.log('✅ Migration complete: cosmetic knowledge tables ensured');
  } catch (e) {
    console.warn('⚠️  cosmetic knowledge migration failed:', e.message);
  }
}

// Migration: de-identified case patterns store
function migrateCasePatternsStore() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS case_patterns (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_ref TEXT,
        chief_complaint TEXT,
        specialty TEXT,
        urgency TEXT,
        safety_level TEXT,
        body_sites_json TEXT,
        risk_flags_json TEXT,
        summary_text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_case_patterns_source ON case_patterns(source);
      CREATE INDEX IF NOT EXISTS idx_case_patterns_complaint ON case_patterns(chief_complaint);
      CREATE INDEX IF NOT EXISTS idx_case_patterns_specialty ON case_patterns(specialty);
      CREATE INDEX IF NOT EXISTS idx_case_patterns_urgency ON case_patterns(urgency);
      CREATE INDEX IF NOT EXISTS idx_case_patterns_safety ON case_patterns(safety_level);
      CREATE INDEX IF NOT EXISTS idx_case_patterns_created ON case_patterns(created_at);
    `);
    console.log('✅ Migration complete: case_patterns table ensured');
  } catch (e) {
    console.warn('⚠️  case_patterns migration failed:', e.message);
  }
}

// Migration: final assessment artifacts for case summary/billing/decision logs.
function migrateFinalAssessmentArtifacts() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS final_assessment_artifacts (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        session_id TEXT,
        room_id TEXT,
        trace_id TEXT,
        artifact_type TEXT NOT NULL,
        retrieval_key TEXT,
        payload_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_final_artifacts_source ON final_assessment_artifacts(source);
      CREATE INDEX IF NOT EXISTS idx_final_artifacts_session ON final_assessment_artifacts(session_id);
      CREATE INDEX IF NOT EXISTS idx_final_artifacts_room ON final_assessment_artifacts(room_id);
      CREATE INDEX IF NOT EXISTS idx_final_artifacts_type ON final_assessment_artifacts(artifact_type);
      CREATE INDEX IF NOT EXISTS idx_final_artifacts_retrieval ON final_assessment_artifacts(retrieval_key);
      CREATE INDEX IF NOT EXISTS idx_final_artifacts_created ON final_assessment_artifacts(created_at);
    `);
    console.log('✅ Migration complete: final_assessment_artifacts table ensured');
  } catch (e) {
    console.warn('⚠️  final_assessment_artifacts migration failed:', e.message);
  }
}

// Run migrations on startup
migrateInsuranceClaimsTable();
migrateFHIRPatientsWalletAddress();
migratePatientPortalSessionsEmail();
migratePatientPortalSessionsSecurityMeta();
migrateMonthlyInvoicesJobCalls();
migrateOrderTracking();
migrateMerchantOrderCommerceIdempotency();
migrateLeadsPipeline();
migrateLeadsPhase1(); // Phase 1: Admin portal agentic capabilities
migrateSequences(); // Phase 2: Sequences for automation
migrateQualificationRules(); // Phase 2: Configurable qualification rules
migrateCustomersTable();
migrateProviderCanonicalLinks();
migrateTriageSessionBookingFor();
migrateVoiceCallLogCosts();
migrateVoiceCallStateTables();
migrateIcd10CodesTable();
migrateHcpcsCodesTable();
migrateCodeEmbeddingsTable();
    migrateCodingDecisionsTable();
    migrateLlmUsageLogTable();
    migratePostgresSyncRetryTable();
    migrateDlqToolCallsTable();
    migrateFeatureFlagsTable();
    migrateVoiceCallLogClinicId();
    migrateClinicMonthlyLlmCostTable();
    migrateClinicsMonthlyCostCap();
    migrateLongTermMemoryTables();
    migrateClinicSettingsTable();
    migrateHipaaAccessLogTable();
migratePatientDocumentsStatus();
migratePatientDocumentDownloadTokens();
    migrateIdempotencyKeysTable();
migrateAppointmentsCustomerId();
migrateCustomerMerchantId(); // CRITICAL: Link customers to merchants
migrateMerchantsSubdomain(); // Add subdomain support for tenant isolation
migrateCustomersPasswordHash(); // Add password_hash for password-based authentication
migrateCustomerCreditsExpiration(); // Add expiration and alert tracking for credits
migrateFHIRPatientsMerchantId(); // Link FHIR patients to merchants (tenants)
migrateFHIRPatientsMergedInto(); // Ensure merge markers exist on fhir_patients
migrateCircleAccountsMerchantId(); // Link wallets to merchants (tenants)
migrateLeadLabels(); // Create lead labels system
migrateResearchBounties(); // Pharma data requests for impact-weighted escrow
migrateEmpiTables(); // Enterprise Master Patient Index (FHIR-native financial layer)
migrateRcmPremiumTables(); // Premium billed/paid (Safe Harbor 2026)
migrateRcmAiDecisions(); // Financial agent audit (FHIR-native RCM layer)
migrateVideoConsultSessions(); // Video consult multimodal AI sessions
migrateEncounterVitals(); // vc-4: Provider-entered vitals during video consult
migrateIntakeEventStream(); // Unified ingress adapter raw + normalized event persistence
migrateSessionStateProjection(); // Deterministic canonical state projection table
migrateBackfillSessionStateFromTriage(); // Initialize canonical state from triage history
migrateCosmeticKnowledgeTables(); // OBF/CosIng + cosmetic restrictions
migrateCasePatternsStore(); // De-identified case pattern retrieval store
migrateFinalAssessmentArtifacts(); // Case summary + billing packs + decision logs

/**
 * Migration: Enterprise Master Patient Index (EMPI)
 *
 * empi_persons: canonical patient/person identifier used across systems
 * empi_links: links EMPI IDs to source systems (EHR, FHIR, billing, wallet, claims, etc.)
 */
function migrateEmpiTables() {
  try {
    const empiExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='empi_persons'`).get();
    if (!empiExists) {
      console.log('🔄 Migrating: Creating EMPI tables (empi_persons, empi_links)');
      db.exec(`
        CREATE TABLE IF NOT EXISTS empi_persons (
          id TEXT PRIMARY KEY,
          primary_patient_id TEXT, -- optional internal patient/customer id
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS empi_links (
          id TEXT PRIMARY KEY,
          empi_id TEXT NOT NULL,
          source_system TEXT NOT NULL, -- e.g. 'ehr', 'fhir', 'billing', 'rcm', 'wallet'
          source_id TEXT NOT NULL,     -- id in that source system
          entity_type TEXT,            -- e.g. 'patient', 'claim', 'coverage'
          confidence REAL DEFAULT 1.0, -- 0-1 confidence of the match
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (empi_id) REFERENCES empi_persons(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_empi_link_source ON empi_links(source_system, source_id);
        CREATE INDEX IF NOT EXISTS idx_empi_link_empi ON empi_links(empi_id);
      `);
      console.log('✅ Migration complete: EMPI tables created');
    }
  } catch (e) {
    console.warn('⚠️  EMPI migration failed:', e.message);
  }
}

/**
 * Migration: RCM AI Decisions (financial agent audit)
 *
 * Stores agentic decisions for claims / reconciliation / patient liaison workflows.
 * This is the financial analogue of video_consult_ai_decisions, but keyed for RCM.
 */
function migrateRcmAiDecisions() {
  try {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ai_decisions_rcm'`).get();
    if (!exists) {
      console.log('🔄 Migrating: Creating ai_decisions_rcm audit table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_decisions_rcm (
          id TEXT PRIMARY KEY,
          merchant_id TEXT,         -- tenant
          clinic_id TEXT,
          empi_id TEXT,             -- longitudinal patient identity (optional but preferred)
          patient_id TEXT,          -- fallback when empi not resolved
          agent_type TEXT NOT NULL, -- claims_specialist | reconciliation | patient_liaison | prior_auth
          operation TEXT NOT NULL,  -- e.g. 'classify_denial', 'match_deposit', 'create_payment_plan'
          input_ref TEXT,           -- JSON: claim_id/eob_id/deposit_id/etc
          input_snapshot TEXT,      -- JSON: minimal structured input (avoid raw PHI if possible)
          output_snapshot TEXT,     -- JSON: proposed decision/result
          explanation TEXT,         -- JSON/text rationale suitable for audit (not patient-facing)
          confidence REAL,
          requires_human_review INTEGER DEFAULT 0,
          human_review_status TEXT DEFAULT 'pending', -- pending|approved|rejected|n/a
          reviewed_by TEXT,
          reviewed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ai_rcm_merchant_created ON ai_decisions_rcm(merchant_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_ai_rcm_agent_created ON ai_decisions_rcm(agent_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_ai_rcm_empi_created ON ai_decisions_rcm(empi_id, created_at);
      `);
      console.log('✅ Migration complete: ai_decisions_rcm table created');
    }
  } catch (e) {
    console.warn('⚠️  RCM AI decisions migration failed:', e.message);
  }
}

/**
 * Migration: RCM premium obligations + payments (Safe Harbor inputs)
 *
 * rcm_premium_obligations: billed premium per EMPI per month (YYYY-MM)
 * rcm_premium_payments: payments applied toward premium per EMPI per month
 */
function migrateRcmPremiumTables() {
  try {
    const obExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='rcm_premium_obligations'`).get();
    if (!obExists) {
      console.log('🔄 Migrating: Creating rcm_premium_obligations / rcm_premium_payments');
      db.exec(`
        CREATE TABLE IF NOT EXISTS rcm_premium_obligations (
          id TEXT PRIMARY KEY,
          empi_id TEXT NOT NULL,
          billing_month TEXT NOT NULL, -- YYYY-MM
          billed_amount REAL NOT NULL,
          currency TEXT DEFAULT 'USD',
          payer_name TEXT,
          plan_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (empi_id) REFERENCES empi_persons(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_rcm_premium_ob_unique ON rcm_premium_obligations(empi_id, billing_month);

        CREATE TABLE IF NOT EXISTS rcm_premium_payments (
          id TEXT PRIMARY KEY,
          empi_id TEXT NOT NULL,
          billing_month TEXT NOT NULL, -- YYYY-MM
          paid_amount REAL NOT NULL,
          currency TEXT DEFAULT 'USD',
          rail TEXT, -- 'ach'|'card'|'usdc'|'hsa' etc.
          reference TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (empi_id) REFERENCES empi_persons(id)
        );
        CREATE INDEX IF NOT EXISTS idx_rcm_premium_pay_empi_month ON rcm_premium_payments(empi_id, billing_month);
      `);
      console.log('✅ Migration complete: RCM premium tables created');
    }
  } catch (e) {
    console.warn('⚠️  RCM premium tables migration failed:', e.message);
  }
}

/**
 * Migration: Create video_consult_sessions table (multimodal telehealth)
 */
function migrateVideoConsultSessions() {
  try {
    db.pragma('foreign_keys = OFF');

    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='video_consult_sessions'`).get();
    if (!exists) {
      console.log('🔄 Migrating: Creating video_consult_sessions table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_consult_sessions (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL UNIQUE,
          encounter_id TEXT,
          clinic_id TEXT,
          patient_id TEXT,
          provider_id TEXT,
          session_status TEXT DEFAULT 'active',
          start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          end_time DATETIME,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_video_consult_sessions_room ON video_consult_sessions(room_id);
        CREATE INDEX IF NOT EXISTS idx_video_consult_sessions_encounter ON video_consult_sessions(encounter_id);
        CREATE INDEX IF NOT EXISTS idx_video_consult_sessions_status ON video_consult_sessions(session_status);
        CREATE INDEX IF NOT EXISTS idx_video_consult_sessions_created ON video_consult_sessions(created_at);
      `);
      console.log('✅ Migration complete: video_consult_sessions table created');
    }

    const aiExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='video_consult_ai_decisions'`).get();
    if (!aiExists) {
      console.log('🔄 Migrating: Creating video_consult_ai_decisions audit table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_consult_ai_decisions (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          stage TEXT NOT NULL,
          findings TEXT,
          codes TEXT,
          confidence REAL,
          patient_id TEXT,
          model_used TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_video_consult_ai_room ON video_consult_ai_decisions(room_id);
        CREATE INDEX IF NOT EXISTS idx_video_consult_ai_created ON video_consult_ai_decisions(created_at);
      `);
      console.log('✅ Migration complete: video_consult_ai_decisions table created');
    }

    const reviewExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='video_consult_review_tasks'`).get();
    if (!reviewExists) {
      console.log('🔄 Migrating: Creating video_consult_review_tasks table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_consult_review_tasks (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          severity TEXT DEFAULT 'WARNING',
          findings TEXT,
          assigned_to TEXT,
          status TEXT DEFAULT 'pending',
          resolved_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_video_consult_review_room ON video_consult_review_tasks(room_id);
        CREATE INDEX IF NOT EXISTS idx_video_consult_review_status ON video_consult_review_tasks(status);
      `);
      console.log('✅ Migration complete: video_consult_review_tasks table created');
    }

    // vc-db-4: Composite indexes for common queries
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_vc_sessions_room_created ON video_consult_sessions(room_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_vc_ai_room_created ON video_consult_ai_decisions(room_id, created_at);
      `);
    } catch (e) {
      if (!e.message?.includes('already exists')) console.warn('⚠️  Video consult composite indexes:', e.message);
    }

    // vc-p0-1: fhir_diagnostic_reports for video consult AI assessment
    const drExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='fhir_diagnostic_reports'`).get();
    if (!drExists) {
      console.log('🔄 Migrating: Creating fhir_diagnostic_reports table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS fhir_diagnostic_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          resource_id TEXT NOT NULL UNIQUE,
          resource_data TEXT NOT NULL,
          patient_id TEXT NOT NULL,
          encounter_id TEXT,
          effective_date DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_deleted INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_fhir_diagnostic_reports_patient ON fhir_diagnostic_reports(patient_id);
        CREATE INDEX IF NOT EXISTS idx_fhir_diagnostic_reports_encounter ON fhir_diagnostic_reports(encounter_id);
      `);
      console.log('✅ Migration complete: fhir_diagnostic_reports table created');
    }

    // vc-db-5: Incremental transcript storage (real-time persistence)
    const transcriptsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='video_consult_transcripts'`).get();
    if (!transcriptsExists) {
      console.log('🔄 Migrating: Creating video_consult_transcripts table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_consult_transcripts (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          appointment_id TEXT,
          participant_identity TEXT,
          speaker TEXT,
          text TEXT NOT NULL,
          timestamp DATETIME,
          source TEXT DEFAULT 'agent_stt',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_vc_transcripts_room ON video_consult_transcripts(room_id);
        CREATE INDEX IF NOT EXISTS idx_vc_transcripts_appointment ON video_consult_transcripts(appointment_id);
        CREATE INDEX IF NOT EXISTS idx_vc_transcripts_speaker ON video_consult_transcripts(speaker);
        CREATE INDEX IF NOT EXISTS idx_vc_transcripts_timestamp ON video_consult_transcripts(timestamp);
      `);
      console.log('✅ Migration complete: video_consult_transcripts table created');
    }

    // vc-db-6: Frame-level visual data storage
    const framesExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='video_consult_frames'`).get();
    if (!framesExists) {
      console.log('🔄 Migrating: Creating video_consult_frames table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_consult_frames (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          appointment_id TEXT,
          participant_identity TEXT,
          frame_url TEXT,
          yolo_detections TEXT,
          timestamp DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_vc_frames_room ON video_consult_frames(room_id);
        CREATE INDEX IF NOT EXISTS idx_vc_frames_appointment ON video_consult_frames(appointment_id);
        CREATE INDEX IF NOT EXISTS idx_vc_frames_timestamp ON video_consult_frames(timestamp);
      `);
      console.log('✅ Migration complete: video_consult_frames table created');
    }

    // vc-db-7: Add appointment_id links to video_consult_sessions
    try {
      const vcInfo = db.prepare(`PRAGMA table_info(video_consult_sessions)`).all();
      const hasAppointmentId = vcInfo.some(c => c.name === 'appointment_id');
      if (!hasAppointmentId) {
        console.log('🔄 Migrating: Adding appointment_id to video_consult_sessions');
        db.exec(`ALTER TABLE video_consult_sessions ADD COLUMN appointment_id TEXT;`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_vc_sessions_appointment ON video_consult_sessions(appointment_id);`);
        console.log('✅ Migration complete: appointment_id added to video_consult_sessions');
      }
    } catch (e) {
      if (!e.message?.includes('duplicate column')) console.warn('⚠️  appointment_id migration:', e.message);
    }

    // vc-db-8: Add appointment outcome fields
    try {
      const apptInfo = db.prepare(`PRAGMA table_info(appointments)`).all();
      const addIfMissing = (col, sql) => {
        if (!apptInfo.some(c => c.name === col)) {
          console.log(`📦 Adding ${col} column to appointments table...`);
          db.exec(sql);
        }
      };
      addIfMissing('visit_summary', `ALTER TABLE appointments ADD COLUMN visit_summary TEXT;`);
      addIfMissing('diagnosis_codes', `ALTER TABLE appointments ADD COLUMN diagnosis_codes TEXT;`);
      addIfMissing('prescribed_medications', `ALTER TABLE appointments ADD COLUMN prescribed_medications TEXT;`);
      addIfMissing('follow_up_notes', `ALTER TABLE appointments ADD COLUMN follow_up_notes TEXT;`);
      addIfMissing('video_session_id', `ALTER TABLE appointments ADD COLUMN video_session_id TEXT;`);
      addIfMissing('total_cost', `ALTER TABLE appointments ADD COLUMN total_cost REAL DEFAULT 0;`);
      addIfMissing('llm_tokens_used', `ALTER TABLE appointments ADD COLUMN llm_tokens_used INTEGER DEFAULT 0;`);
      addIfMissing('visit_mode', `ALTER TABLE appointments ADD COLUMN visit_mode TEXT DEFAULT 'sync_video';`);
      addIfMissing('slot_state', `ALTER TABLE appointments ADD COLUMN slot_state TEXT DEFAULT 'soft_reserved';`);
      addIfMissing('stripe_payment_intent_id', `ALTER TABLE appointments ADD COLUMN stripe_payment_intent_id TEXT;`);
      addIfMissing('tech_check_sent', `ALTER TABLE appointments ADD COLUMN tech_check_sent BOOLEAN DEFAULT 0;`);
      console.log('✅ Migration complete: Appointment outcome fields added');
    } catch (e) {
      if (!e.message?.includes('duplicate column')) console.warn('⚠️  Appointment outcome fields migration:', e.message);
    }

    // Phase 8: visit_feedbacks table
    const visitFeedbacksExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='visit_feedbacks'`).get();
    if (!visitFeedbacksExists) {
      console.log('🔄 Migrating: Creating visit_feedbacks table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS visit_feedbacks (
          id TEXT PRIMARY KEY,
          appointment_id TEXT,
          patient_id TEXT,
          rating INTEGER,
          helpful INTEGER,
          comment TEXT,
          created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_visit_feedbacks_appointment ON visit_feedbacks(appointment_id);
      `);
      console.log('✅ Migration complete: visit_feedbacks table created');
    }

    // vc-db-9: Risk events (symptom triage audit)
    const riskEventsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='video_consult_risk_events'`).get();
    if (!riskEventsExists) {
      console.log('🔄 Migrating: Creating video_consult_risk_events table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_consult_risk_events (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          appointment_id TEXT,
          patient_id TEXT,
          provider_id TEXT,
          rule_id TEXT NOT NULL,
          level TEXT NOT NULL,
          match_snippet TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          source TEXT DEFAULT 'symptom_triage'
        );
        CREATE INDEX IF NOT EXISTS idx_vc_risk_room ON video_consult_risk_events(room_id);
        CREATE INDEX IF NOT EXISTS idx_vc_risk_timestamp ON video_consult_risk_events(timestamp);
      `);
      console.log('✅ Migration complete: video_consult_risk_events table created');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ Video consult migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Migration: encounter_vitals (vc-4) — Provider-entered vitals during video consult
 */
function migrateEncounterVitals() {
  try {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='encounter_vitals'`).get();
    if (!exists) {
      console.log('🔄 Migrating: Creating encounter_vitals table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS encounter_vitals (
          id TEXT PRIMARY KEY,
          encounter_id TEXT NOT NULL,
          appointment_id TEXT,
          room_id TEXT,
          blood_pressure_systolic INTEGER,
          blood_pressure_diastolic INTEGER,
          heart_rate INTEGER,
          blood_sugar_mgdl REAL,
          temperature_f REAL,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_encounter_vitals_encounter ON encounter_vitals(encounter_id);
        CREATE INDEX IF NOT EXISTS idx_encounter_vitals_appointment ON encounter_vitals(appointment_id);
        CREATE INDEX IF NOT EXISTS idx_encounter_vitals_room ON encounter_vitals(room_id);
      `);
      console.log('✅ Migration complete: encounter_vitals table created');
    }
  } catch (e) {
    console.error('❌ encounter_vitals migration failed:', e.message);
  }
}

/**
 * Migration: Create research_bounties table (Pharma Data Requests)
 */
function migrateResearchBounties() {
  try {
    db.pragma('foreign_keys = OFF');

    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='research_bounties'`).get();
    if (!exists) {
      console.log('🔄 Migrating: Creating research_bounties table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS research_bounties (
          id TEXT PRIMARY KEY,
          requester_id TEXT,
          requester_type TEXT DEFAULT 'pharma',
          title TEXT,
          description TEXT,
          data_type TEXT,
          target_count INTEGER,
          fulfilled_count INTEGER DEFAULT 0,
          bounty_amount_per_unit REAL,
          total_bounty_amount REAL,
          status TEXT DEFAULT 'open',
          impact_tier INTEGER DEFAULT 1,
          escrow_hash TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_research_bounties_status ON research_bounties(status);
        CREATE INDEX IF NOT EXISTS idx_research_bounties_escrow ON research_bounties(escrow_hash);
      `);
      console.log('✅ Migration complete: research_bounties table created');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ Research bounties migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Helper to safely stringify data
 */
function safeStringify(data) {
  if (data === null || data === undefined) return null;
  if (typeof data === 'string') return data;
  return JSON.stringify(data);
}

/**
 * Task 23: Run versioned migrations from middleware-platform/migrations/
 */
function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  // mvp-76: optional backup-before-migrate (prod)
  try {
    const strict = (process.env.MIGRATIONS_STRICT === '1' || process.env.MIGRATIONS_STRICT === 'true') || isProdEnv;
    const wantBackup = (process.env.BACKUP_BEFORE_MIGRATE === '1' || process.env.BACKUP_BEFORE_MIGRATE === 'true') && isProdEnv;
    if (wantBackup && fs.existsSync(dbPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = process.env.DB_BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
      try { fs.mkdirSync(backupDir, { recursive: true }); } catch (_) {}
      const backupPath = path.join(backupDir, `${path.basename(dbPath)}.bak-${ts}`);
      fs.copyFileSync(dbPath, backupPath);
      console.log(`✅ DB backup created: ${backupPath}`);
    }

    const files = fs.readdirSync(migrationsDir).filter(f => /^\d+_.*\.js$/.test(f)).sort();
    for (const f of files) {
      const version = f.replace(/\.js$/, '');
      const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
      if (applied) continue;
      try {
        const m = require(path.join(migrationsDir, f));
        if (typeof m.up === 'function') {
          m.up(db);
          db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
          console.log(`✅ Migration applied: ${version}`);
        }
      } catch (e) {
        console.warn(`⚠️  Migration ${version} failed:`, e.message);
        if (strict) {
          console.error('❌ Migration failed with MIGRATIONS_STRICT enabled; refusing to start.');
          process.exit(1);
        }
      }
    }
    return;
  } catch (e) {
    if (isProdEnv) {
      console.error('❌ Migration runner crashed in production:', e.message);
      process.exit(1);
    }
  }
}
runMigrations();

// Extra safeguard for BUG-011/015:
// if rich-intake columns are missing (common when older environments skipped 011/015),
// apply 011 first, then 015 as a final patch so triage->booking gates can persist/read
// `intake_complete_at` and related fields reliably.
try {
  const triageInfo = db.prepare(`PRAGMA table_info(triage_sessions)`).all();
  const existingCols = new Set(triageInfo.map(c => c.name));
  const requiredRichIntakeCols = [
    'family_history',
    'medications',
    'prior_diagnoses',
    'prior_workups',
    'allergies',
    'alcohol_use',
    'alcohol_cage_score',
    'smoking_status',
    'phq2_score',
    'gad2_score',
    'safety_screen',
    'substance_use',
    'critical_unknowns',
    'soap_note',
    'detected_language',
    'occupation',
    'intake_complete_at'
  ];
  const missing = requiredRichIntakeCols.filter(c => !existingCols.has(c));
  if (missing.length) {
    console.warn(`[migration] triage_sessions missing rich-intake cols: ${missing.join(', ')}. Applying 011 + 015...`);
    require('./migrations/011_triage_rich_intake').up(db);
    require('./migrations/015_triage_rich_intake_phase1_columns').up(db);
  }
} catch (e) {
  console.warn('[migration] triage_sessions column safeguard failed:', e.message);
}

// mvp-74/75/78: durable notification jobs + leader locks + ops counters
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_jobs (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,          -- email/sms
      type TEXT NOT NULL,             -- reminder_24h, reminder_1h, appt_rescheduled, appt_canceled, post_visit_summary, payment_receipt, etc
      to_address TEXT,
      patient_id TEXT,
      appointment_id TEXT,
      idempotency_key TEXT,
      payload_json TEXT,
      status TEXT DEFAULT 'queued',   -- queued/in_progress/sent/dead
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 6,
      run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      locked_by TEXT,
      locked_at DATETIME,
      last_error TEXT,
      provider_message_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_jobs_idem ON notification_jobs(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_notification_jobs_status_run ON notification_jobs(status, run_at);

    CREATE TABLE IF NOT EXISTS scheduler_locks (
      name TEXT PRIMARY KEY,
      locked_by TEXT,
      locked_until DATETIME,
      heartbeat_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS ops_counters (
      name TEXT NOT NULL,
      bucket TEXT NOT NULL, -- YYYY-MM-DDTHH
      count INTEGER DEFAULT 0,
      PRIMARY KEY (name, bucket)
    );

    -- Immutable audit trail (mvp-34)
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,       -- patient/admin/system
      actor_id TEXT,
      patient_id TEXT,
      resource_type TEXT NOT NULL,    -- session/appointment/payment/receipt/document
      resource_id TEXT,
      action TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_patient ON audit_events(patient_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
  `);
} catch (e) {
  console.warn('⚠️  Failed to init ops tables:', e.message);
}

// mvp-34: migrations for soft delete columns (existing DBs)
function migrateSoftDeleteColumns() {
  const addColIfMissing = (table, colDef) => {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      const name = colDef.split(/\s+/)[0];
      if (!cols.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
      }
    } catch (_) {}
  };
  addColIfMissing('appointments', 'deleted_at DATETIME');
  addColIfMissing('voice_checkouts', 'deleted_at DATETIME');
  addColIfMissing('voice_checkouts', 'stripe_checkout_session_id TEXT');
  addColIfMissing('voice_checkouts', 'stripe_session_expires_at DATETIME');
  /** C9: link checkout row to triage_sessions.session_id (voice callId / Kelly session) for audit */
  addColIfMissing('voice_checkouts', 'triage_session_id TEXT');
  addColIfMissing('voice_checkouts', 'shipping_address TEXT');
  /** Commerce: link voice_checkout to checkout_sessions quote row for PI metadata / webhooks */
  addColIfMissing('voice_checkouts', 'commerce_quote_id TEXT');
  addColIfMissing('payment_receipts', 'deleted_at DATETIME');
  addColIfMissing('patient_documents', 'deleted_at DATETIME');
  addColIfMissing('patient_portal_sessions', 'emergency_flag BOOLEAN DEFAULT 0');
  addColIfMissing('patient_portal_sessions', 'emergency_flag_at DATETIME');
}
try { migrateSoftDeleteColumns(); } catch (_) {}

module.exports = {
  // Expose the database instance for direct access when needed
  db: db,

  // Run versioned migrations (also runs automatically on require). Use for pre-deploy or CI.
  runMigrations,

  // ============================================
  // ADMIN SESSIONS (persistent admin auth)
  // ============================================
  createAdminSession: (session) => {
    return db.prepare(`
      INSERT INTO admin_sessions (id, issued_at, expires_at, ip, user_agent, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.issued_at,
      session.expires_at,
      session.ip || null,
      session.user_agent || null,
      session.last_seen_at || session.issued_at
    );
  },
  getAdminSession: (id) => {
    try {
      return db.prepare(`SELECT * FROM admin_sessions WHERE id = ?`).get(id) || null;
    } catch (_) {
      return null;
    }
  },
  touchAdminSession: (id) => {
    try {
      db.prepare(`UPDATE admin_sessions SET last_seen_at = datetime('now') WHERE id = ?`).run(id);
    } catch (_) {}
  },
  deleteAdminSession: (id) => {
    try {
      db.prepare(`DELETE FROM admin_sessions WHERE id = ?`).run(id);
    } catch (_) {}
  },
  deleteExpiredAdminSessions: () => {
    try {
      db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= datetime('now')`).run();
    } catch (_) {}
  },

  // ============================================
  // PATIENT SESSIONS (email → FHIR patient_id mapping)
  // ============================================
  createPatientSession: ({ session_id, email, patient_id = null, expires_at }) => {
    if (!session_id || !email || !expires_at) return;
    try {
      db.prepare(`
        INSERT INTO patient_sessions (session_id, email, patient_id, expires_at, created_at, last_used)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(session_id, email.toLowerCase().trim(), patient_id || null, expires_at);
    } catch (e) {
      console.error('❌ Failed to create patient_session:', e.message);
    }
  },
  getPatientSession: (session_id) => {
    if (!session_id) return null;
    try {
      return db.prepare(`
        SELECT * FROM patient_sessions
        WHERE session_id = ?
      `).get(session_id) || null;
    } catch (_) {
      return null;
    }
  },
  updatePatientSession: (session_id, fields = {}) => {
    if (!session_id || !fields || Object.keys(fields).length === 0) return;
    const sets = [];
    const values = [];
    if (fields.email !== undefined) {
      sets.push('email = ?');
      values.push(fields.email.toLowerCase().trim());
    }
    if (fields.patient_id !== undefined) {
      sets.push('patient_id = ?');
      values.push(fields.patient_id || null);
    }
    if (fields.expires_at !== undefined) {
      sets.push('expires_at = ?');
      values.push(fields.expires_at);
    }
    // Always bump last_used when we update
    sets.push('last_used = datetime(\'now\')');
    if (sets.length === 0) return;
    values.push(session_id);
    try {
      db.prepare(`
        UPDATE patient_sessions
        SET ${sets.join(', ')}
        WHERE session_id = ?
      `).run(...values);
    } catch (e) {
      console.error('❌ Failed to update patient_session:', e.message);
    }
  },

  // ============================================
  // PATIENT ORCHESTRATE SESSIONS (Step 1 - Multi-Modal Front Door)
  // ============================================
  getOrchestrateSessionBySessionId: (session_id) => {
    if (!session_id) return null;
    try {
      const row = db.prepare('SELECT * FROM patient_orchestrate_sessions WHERE session_id = ?').get(session_id);
      return row ? { ...row, conversation_history: row.conversation_history ? JSON.parse(row.conversation_history) : [], flow_state: row.flow_state ? JSON.parse(row.flow_state) : {} } : null;
    } catch (_) { return null; }
  },
  getOrchestrateSessionByCallerPhone: (caller_phone) => {
    if (!caller_phone) return null;
    try {
      const norm = String(caller_phone).replace(/\D/g, '');
      if (norm.length < 6) return null;
      const rows = db.prepare('SELECT * FROM patient_orchestrate_sessions WHERE REPLACE(REPLACE(REPLACE(caller_phone, \'-\', \'\'), \' \', \'\'), \'+\', \'\') LIKE ? AND status = ? ORDER BY last_activity_at DESC LIMIT 1').all('%' + norm.slice(-10) + '%', 'active');
      const row = rows && rows[0];
      return row ? { ...row, conversation_history: row.conversation_history ? JSON.parse(row.conversation_history) : [], flow_state: row.flow_state ? JSON.parse(row.flow_state) : {} } : null;
    } catch (_) { return null; }
  },
  upsertOrchestrateSession: (data) => {
    try {
      const id = data.id || require('uuid').v4();
      const session_id = data.session_id || id;
      const now = new Date().toISOString();
      const history = JSON.stringify(data.conversation_history || []);
      const flow_state = JSON.stringify(data.flow_state || {});
      const case_id = data.case_id || (data.flow_state && data.flow_state.case_id) || null;
      db.prepare(`
        INSERT INTO patient_orchestrate_sessions (id, session_id, channel, patient_id, caller_phone, portal_session_id, clinic_id, preferred_language, turn_count, conversation_history, flow_state, case_id, status, created_at, updated_at, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          patient_id = COALESCE(excluded.patient_id, patient_orchestrate_sessions.patient_id),
          caller_phone = COALESCE(excluded.caller_phone, patient_orchestrate_sessions.caller_phone),
          portal_session_id = COALESCE(excluded.portal_session_id, patient_orchestrate_sessions.portal_session_id),
          clinic_id = COALESCE(excluded.clinic_id, patient_orchestrate_sessions.clinic_id),
          preferred_language = COALESCE(excluded.preferred_language, patient_orchestrate_sessions.preferred_language),
          turn_count = excluded.turn_count,
          conversation_history = excluded.conversation_history,
          flow_state = excluded.flow_state,
          case_id = COALESCE(excluded.case_id, patient_orchestrate_sessions.case_id),
          status = COALESCE(excluded.status, patient_orchestrate_sessions.status),
          updated_at = excluded.updated_at,
          last_activity_at = excluded.last_activity_at
      `).run(id, session_id, data.channel || 'chat', data.patient_id || null, data.caller_phone || null, data.portal_session_id || null, data.clinic_id || null, data.preferred_language || 'en', data.turn_count || 0, history, flow_state, case_id, data.status || 'active', now, now, now);
      return { id, session_id };
    } catch (e) {
      console.error('❌ Failed to upsert orchestrate session:', e.message);
      throw e;
    }
  },

  /**
   * Clear triage/RAG/Kelly rows for a chat session_id before the first persisted orchestrate turn.
   * Prevents get_available_slots from succeeding on leftover triage_rag_results when session IDs
   * collide or dev DB is dirty. Uses the same sqlite handle as the rest of this module.
   */
  wipeChatSessionClinicalState: (session_id) => {
    if (!session_id) return { ok: false };
    const sid = String(session_id).trim();
    if (!sid) return { ok: false };
    const run = (sql) => {
      try {
        db.prepare(sql).run(sid);
      } catch (_) {
        /* table may not exist until Kelly first touches it */
      }
    };
    run('DELETE FROM triage_rag_results WHERE session_id = ?');
    run('DELETE FROM triage_sessions WHERE session_id = ?');
    run('DELETE FROM kelly_conversation_history WHERE session_id = ?');
    run('DELETE FROM kelly_session_meta WHERE session_id = ?');
    return { ok: true };
  },

  // Phase 3: Case records
  createCaseRecord: (data) => {
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO case_records (id, case_number, patient_id, session_id, channel, visit_mode, status, opqrst, suggested_icd10, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.id,
        data.case_number,
        data.patient_id || null,
        data.session_id || null,
        data.channel || 'chat',
        data.visit_mode || null,
        data.status || 'draft',
        data.opqrst ? (typeof data.opqrst === 'string' ? data.opqrst : JSON.stringify(data.opqrst)) : null,
        data.suggested_icd10 || null,
        data.created_at || now
      );
      return { id: data.id, case_number: data.case_number };
    } catch (e) {
      if (e.message && (e.message.includes('UNIQUE') || e.message.includes('unique'))) {
        return { id: data.id, case_number: data.case_number };
      }
      console.error('❌ Failed to create case record:', e.message);
      throw e;
    }
  },

  abandonStaleCaseRecords: (cutoffIso) => {
    try {
      const r = db.prepare(`
        UPDATE case_records
        SET status = 'abandoned', abandoned_at = datetime('now')
        WHERE status = 'draft' AND created_at < ?
      `).run(cutoffIso);
      return r.changes || 0;
    } catch (e) {
      console.warn('abandonStaleCaseRecords:', e.message);
      return 0;
    }
  },

  /** Phase 7: Resolve case_number for an appointment (via case_records + session flow_state). */
  getCaseNumberForAppointment(appointmentId) {
    try {
      const row = db.prepare(`
        SELECT cr.case_number
        FROM case_records cr
        JOIN patient_orchestrate_sessions s ON s.session_id = cr.session_id
        WHERE json_extract(s.flow_state, '$.appointment_id') = ?
        AND cr.case_number IS NOT NULL
        LIMIT 1
      `).get(appointmentId);
      return row ? row.case_number : null;
    } catch (_) {
      return null;
    }
  },

  /** Phase 7: Resolve case_number to appointment_id (reverse of getCaseNumberForAppointment). */
  getAppointmentIdFromCaseNumber(caseNumber) {
    if (!caseNumber) return null;
    try {
      const row = db.prepare(`
        SELECT json_extract(s.flow_state, '$.appointment_id') AS appointment_id
        FROM case_records cr
        JOIN patient_orchestrate_sessions s ON s.session_id = cr.session_id
        WHERE cr.case_number = ?
        LIMIT 1
      `).get(caseNumber);
      return row?.appointment_id || null;
    } catch (_) {
      return null;
    }
  },

  // ============================================
  // NOTIFICATION QUEUE + OPS COUNTERS (mvp-74/75/78)
  // ============================================
  enqueueNotificationJob: (job) => {
    try {
      const id = job.id;
      db.prepare(`
        INSERT OR IGNORE INTO notification_jobs
          (id, channel, type, to_address, patient_id, appointment_id, idempotency_key, payload_json, status, attempts, max_attempts, run_at, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, COALESCE(?, datetime('now')), datetime('now'), datetime('now'))
      `).run(
        id,
        job.channel,
        job.type,
        job.to_address || null,
        job.patient_id || null,
        job.appointment_id || null,
        job.idempotency_key || null,
        job.payload_json || null,
        job.max_attempts || 6,
        job.run_at || null
      );
      return { success: true, id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  claimNextNotificationJob: (workerId) => {
    try {
      const row = db.prepare(`
        SELECT id
        FROM notification_jobs
        WHERE status = 'queued'
          AND datetime(run_at) <= datetime('now')
          AND attempts < max_attempts
        ORDER BY datetime(run_at) ASC, created_at ASC
        LIMIT 1
      `).get();
      if (!row) return null;
      const r = db.prepare(`
        UPDATE notification_jobs
        SET status = 'in_progress', locked_by = ?, locked_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status = 'queued'
      `).run(workerId, row.id);
      if (!r.changes) return null;
      return db.prepare(`SELECT * FROM notification_jobs WHERE id = ?`).get(row.id) || null;
    } catch (_) {
      return null;
    }
  },

  completeNotificationJobSuccess: (id, providerMessageId = null) => {
    try {
      db.prepare(`
        UPDATE notification_jobs
        SET status = 'sent', provider_message_id = ?, last_error = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(providerMessageId || null, id);
    } catch (_) {}
  },

  completeNotificationJobFailure: (id, errMsg, nextRunAtIso = null, dead = false) => {
    try {
      db.prepare(`
        UPDATE notification_jobs
        SET status = ?, attempts = attempts + 1, last_error = ?, run_at = COALESCE(?, run_at), updated_at = datetime('now')
        WHERE id = ?
      `).run(dead ? 'dead' : 'queued', (errMsg || '').slice(0, 800), nextRunAtIso || null, id);
    } catch (_) {}
  },

  getNotificationQueueStats: () => {
    try {
      const rows = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM notification_jobs
        GROUP BY status
      `).all();
      const byStatus = {};
      for (const r of rows) byStatus[r.status] = r.count;
      return { success: true, by_status: byStatus };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  listDeadNotificationJobs: (limit = 50) => {
    try {
      return db.prepare(`
        SELECT id, channel, type, to_address, patient_id, appointment_id, attempts, max_attempts, last_error, updated_at
        FROM notification_jobs
        WHERE status = 'dead'
        ORDER BY datetime(updated_at) DESC
        LIMIT ?
      `).all(limit);
    } catch (_) {
      return [];
    }
  },

  tryAcquireSchedulerLock: (name, workerId, ttlSeconds = 60) => {
    try {
      const until = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      db.prepare(`INSERT OR IGNORE INTO scheduler_locks (name, locked_by, locked_until, heartbeat_at) VALUES (?, ?, ?, datetime('now'))`)
        .run(name, workerId, until);
      const r = db.prepare(`
        UPDATE scheduler_locks
        SET locked_by = ?, locked_until = ?, heartbeat_at = datetime('now')
        WHERE name = ?
          AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now') OR locked_by = ?)
      `).run(workerId, until, name, workerId);
      return !!(r.changes && r.changes > 0);
    } catch (_) {
      return false;
    }
  },

  heartbeatSchedulerLock: (name, workerId, ttlSeconds = 60) => {
    try {
      const until = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const r = db.prepare(`
        UPDATE scheduler_locks
        SET locked_until = ?, heartbeat_at = datetime('now')
        WHERE name = ? AND locked_by = ?
      `).run(until, name, workerId);
      return !!(r.changes && r.changes > 0);
    } catch (_) {
      return false;
    }
  },

  incrementOpsCounter: (name, date = new Date()) => {
    try {
      const bucket = date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
      db.prepare(`
        INSERT INTO ops_counters (name, bucket, count)
        VALUES (?, ?, 1)
        ON CONFLICT(name, bucket) DO UPDATE SET count = count + 1
      `).run(name, bucket);
    } catch (_) {}
  },

  getOpsCounters: (sinceHours = 24) => {
    try {
      const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString().slice(0, 13);
      return db.prepare(`
        SELECT name, bucket, count
        FROM ops_counters
        WHERE bucket >= ?
        ORDER BY bucket ASC
      `).all(cutoff);
    } catch (_) {
      return [];
    }
  },

  // ============================================
  // AUDIT EVENTS (mvp-34)
  // ============================================
  insertAuditEvent: (evt) => {
    try {
      const { v4: uuidv4 } = require('uuid');
      const id = evt.id || `aud_${uuidv4()}`;
      const meta = evt.metadata ? (typeof evt.metadata === 'string' ? evt.metadata : JSON.stringify(evt.metadata)) : null;
      db.prepare(`
        INSERT INTO audit_events
          (id, actor_type, actor_id, patient_id, resource_type, resource_id, action, metadata_json, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id,
        evt.actor_type,
        evt.actor_id || null,
        evt.patient_id || null,
        evt.resource_type,
        evt.resource_id || null,
        evt.action,
        meta
      );
      return { success: true, id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getAuditEventsForPatient: (patientId, limit = 100) => {
    try {
      const lim = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
      return db.prepare(`
        SELECT id, actor_type, actor_id, patient_id, resource_type, resource_id, action, metadata_json, created_at
        FROM audit_events
        WHERE patient_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT ?
      `).all(patientId, lim);
    } catch (_) {
      return [];
    }
  },

  // ============================================
  // SOFT DELETE HELPERS (mvp-34)
  // ============================================
  softDeleteAppointment: (id) => {
    try {
      return db.prepare(`UPDATE appointments SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`).run(id);
    } catch (_) { return { changes: 0 }; }
  },
  softDeleteVoiceCheckout: (id) => {
    try {
      return db.prepare(`UPDATE voice_checkouts SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`).run(id);
    } catch (_) { return { changes: 0 }; }
  },
  softDeletePaymentReceipt: (id) => {
    try {
      return db.prepare(`UPDATE payment_receipts SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`).run(id);
    } catch (_) { return { changes: 0 }; }
  },
  softDeletePatientDocument: (id) => {
    try {
      return db.prepare(`UPDATE patient_documents SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`).run(id);
    } catch (_) { return { changes: 0 }; }
  },
  deletePatientSession: (session_id) => {
    if (!session_id) return;
    try {
      db.prepare(`DELETE FROM patient_sessions WHERE session_id = ?`).run(session_id);
    } catch (_) {}
  },

  // Revoke all patient_sessions for an email or patient_id
  revokePatientSessionsByEmail: (email) => {
    if (!email) return;
    try {
      db.prepare(`DELETE FROM patient_sessions WHERE LOWER(email) = LOWER(?)`).run(email);
    } catch (_) {}
  },
  revokePatientSessionsByPatientId: (patient_id) => {
    if (!patient_id) return;
    try {
      db.prepare(`DELETE FROM patient_sessions WHERE patient_id = ?`).run(patient_id);
    } catch (_) {}
  },

  // ============================================
  // PATIENT DOCUMENTS
  // ============================================
  createPatientDocument: (doc) => {
    try {
      const { v4: uuidv4 } = require('uuid');
      const id = doc.id || uuidv4();
      db.prepare(`
        INSERT INTO patient_documents (
          id, patient_id, encounter_id, appointment_id,
          file_name, file_type, storage_path, storage_provider, storage_bucket, storage_key,
          uploaded_by, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id,
        doc.patient_id,
        doc.encounter_id || null,
        doc.appointment_id || null,
        doc.file_name,
        doc.file_type || null,
        doc.storage_path || null,
        doc.storage_provider || 'local',
        doc.storage_bucket || null,
        doc.storage_key || null,
        doc.uploaded_by || 'patient',
        doc.status || 'available'
      );
      return { id };
    } catch (e) {
      console.error('❌ Failed to create patient_document:', e.message);
      throw e;
    }
  },
  getPatientDocuments: (patientId) => {
    if (!patientId) return [];
    try {
      return db.prepare(`
        SELECT id, patient_id, encounter_id, appointment_id,
               file_name, file_type, storage_provider, storage_bucket, storage_key,
               storage_path, uploaded_by, status, created_at
        FROM patient_documents
        WHERE patient_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
      `).all(patientId);
    } catch (e) {
      console.error('❌ Failed to fetch patient_documents:', e.message);
      return [];
    }
  },

  getPatientDocumentById: (docId) => {
    if (!docId) return null;
    try {
      return db.prepare(`SELECT * FROM patient_documents WHERE id = ? AND deleted_at IS NULL LIMIT 1`).get(docId) || null;
    } catch (_) {
      return null;
    }
  },

  // M-Doc.2: patient_document_extracts
  createPatientDocumentExtract: (extract) => {
    try {
      const id = extract.id || require('uuid').v4();
      db.prepare(`
        INSERT OR REPLACE INTO patient_document_extracts (id, doc_id, patient_id, extracted_text, extraction_method, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(id, extract.doc_id, extract.patient_id, extract.extracted_text || '', extract.extraction_method || 'unknown');
      return { id };
    } catch (e) {
      console.error('❌ Failed to create patient_document_extract:', e.message);
      throw e;
    }
  },
  getPatientDocumentExtractsByPatient: (patientId) => {
    if (!patientId) return [];
    try {
      return db.prepare(`
        SELECT id, doc_id, patient_id, extracted_text, extraction_method, created_at
        FROM patient_document_extracts
        WHERE patient_id = ?
        ORDER BY created_at DESC
      `).all(patientId);
    } catch (_) {
      return [];
    }
  },

  // ============================================
  // Patient document download tokens (mvp-67)
  // ============================================
  createPatientDocumentDownloadToken: ({ token, doc_id, patient_id, expires_at }) => {
    try {
      db.prepare(`
        INSERT INTO patient_document_download_tokens (token, doc_id, patient_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(token, doc_id, patient_id, expires_at);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  getPatientDocumentDownloadToken: (token) => {
    if (!token) return null;
    try {
      return db.prepare(`
        SELECT * FROM patient_document_download_tokens WHERE token = ? LIMIT 1
      `).get(token) || null;
    } catch (_) {
      return null;
    }
  },
  markPatientDocumentDownloadTokenUsed: (token) => {
    try {
      return db.prepare(`
        UPDATE patient_document_download_tokens
        SET used_at = datetime('now')
        WHERE token = ? AND used_at IS NULL AND revoked_at IS NULL
      `).run(token);
    } catch (_) {
      return { changes: 0 };
    }
  },
  revokePatientDocumentDownloadToken: (token) => {
    try {
      return db.prepare(`
        UPDATE patient_document_download_tokens
        SET revoked_at = datetime('now')
        WHERE token = ? AND revoked_at IS NULL
      `).run(token);
    } catch (_) {
      return { changes: 0 };
    }
  },

  insertHipaaAccessLog: (row) => {
    try {
      const { v4: uuidv4 } = require('uuid');
      const id = row.id || `hal_${uuidv4()}`;
      db.prepare(`
        INSERT INTO hipaa_access_log (id, user_id, patient_id, resource_type, resource_id, action, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id,
        row.user_id || null,
        row.patient_id || null,
        row.resource_type,
        row.resource_id || null,
        row.action,
        row.ip_address || null
      );
      return id;
    } catch (e) {
      // Don't break request path on audit logging failure
      return null;
    }
  },

  // ============================================
  // PATIENT MERGE EVENTS
  // ============================================
  createPatientMergeEvent: ({ id, primary_id, secondary_id, reason, created_by }) => {
    try {
      const { v4: uuidv4 } = require('uuid');
      const mergeId = id || uuidv4();
      db.prepare(`
        INSERT INTO patient_merge_events (
          id, primary_id, secondary_id, reason, created_at, created_by
        ) VALUES (?, ?, ?, ?, datetime('now'), ?)
      `).run(mergeId, primary_id, secondary_id, reason || null, created_by || null);
      return { id: mergeId };
    } catch (e) {
      console.error('❌ Failed to create patient_merge_event:', e.message);
      throw e;
    }
  },
  getRecentPatientMergeEvents: (limit = 50) => {
    try {
      return db.prepare(`
        SELECT id, primary_id, secondary_id, reason, created_at, created_by, reviewed, reviewed_at
        FROM patient_merge_events
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);
    } catch (e) {
      console.error('❌ Failed to fetch patient_merge_events:', e.message);
      return [];
    }
  },
  markPatientMergeEventReviewed: (id, reviewer) => {
    if (!id) return;
    try {
      db.prepare(`
        UPDATE patient_merge_events
        SET reviewed = 1,
            reviewed_at = datetime('now'),
            created_by = COALESCE(created_by, ?)
        WHERE id = ?
      `).run(reviewer || null, id);
    } catch (e) {
      console.error('❌ Failed to mark patient_merge_event reviewed:', e.message);
    }
  },

  // ============================================
  // APPOINTMENT PAYMENT HELPERS
  // ============================================
  getLatestCheckoutForAppointment: (appointmentId) => {
    if (!appointmentId) return null;
    try {
      const checkout = db.prepare(`
        SELECT vc.* FROM voice_checkouts vc
        WHERE vc.appointment_id = ?
        ORDER BY vc.created_at DESC
        LIMIT 1
      `).get(appointmentId);
      return checkout || null;
    } catch (e) {
      console.error('❌ Failed to fetch latest checkout for appointment:', e.message);
      return null;
    }
  },
  updateAppointmentPaymentStatus: (appointmentId, status) => {
    if (!appointmentId || !status) return;
    try {
      const existing = db.prepare(`SELECT payment_status FROM appointments WHERE id = ? LIMIT 1`).get(appointmentId);
      if (existing && !canTransitionPaymentStatus(existing.payment_status, status)) {
        throw new Error(`Invalid payment_status transition: ${existing.payment_status} -> ${status}`);
      }
      db.prepare(`
        UPDATE appointments
        SET payment_status = ?
        WHERE id = ?
      `).run(status, appointmentId);
    } catch (e) {
      console.error('❌ Failed to update appointment payment_status:', e.message);
    }
  },

  // ============================================
  // VISIT PRICING (clinic + appointment type)
  // ============================================
  upsertVisitPricing: (row) => {
    return db.prepare(`
      INSERT INTO visit_pricing (clinic_id, appointment_type, base_price, surge_multiplier, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT (clinic_id, appointment_type) DO UPDATE SET
        base_price = excluded.base_price,
        surge_multiplier = excluded.surge_multiplier,
        updated_at = datetime('now')
    `).run(
      row.clinic_id,
      row.appointment_type,
      row.base_price,
      row.surge_multiplier ?? 1.0
    );
  },
  getVisitPricing: (clinicId, appointmentType) => {
    try {
      return db.prepare(`
        SELECT * FROM visit_pricing
        WHERE clinic_id = ? AND appointment_type = ?
        LIMIT 1
      `).get(clinicId, appointmentType) || null;
    } catch (_) {
      return null;
    }
  },
  insertPricingAuditLog: (record) => {
    try {
      const { v4: uuidv4 } = require('uuid');
      const id = record.id || `pal_${uuidv4()}`;
      db.prepare(`
        INSERT INTO pricing_audit_log (id, actor_id, actor_role, clinic_id, appointment_type, action, old_base_price, new_base_price, old_surge_multiplier, new_surge_multiplier, ip, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id,
        record.actor_id || null,
        record.actor_role || 'admin',
        record.clinic_id,
        record.appointment_type,
        record.action || 'update',
        record.old_base_price ?? null,
        record.new_base_price ?? null,
        record.old_surge_multiplier ?? null,
        record.new_surge_multiplier ?? 1.0,
        record.ip || null
      );
      return id;
    } catch (e) {
      console.warn('insertPricingAuditLog failed:', e.message);
      return null;
    }
  },
  getClinic: (clinicId) => {
    try {
      return db.prepare(`SELECT * FROM clinics WHERE clinic_id = ? LIMIT 1`).get(clinicId) || null;
    } catch (_) {
      return null;
    }
  },
  /** R-1: Map clinic to customer for credits/billing (clinic.merchant_id = customer.merchant_id) */
  getCustomerIdForClinic(clinicId) {
    if (!clinicId) return null;
    try {
      const clinic = db.prepare('SELECT merchant_id FROM clinics WHERE clinic_id = ?').get(clinicId);
      if (!clinic?.merchant_id) return null;
      const customer = db.prepare('SELECT id FROM customers WHERE merchant_id = ? LIMIT 1').get(clinic.merchant_id);
      return customer?.id || null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Ensure there is a tenant-level customer row for a clinic.
   * This prevents "No customer_id found for clinic..." and enables tenant-scoped billing/payment.
   */
  ensureCustomerIdForClinic(clinicId) {
    if (!clinicId) return null;
    try {
      const clinic = db.prepare('SELECT clinic_id, name, merchant_id FROM clinics WHERE clinic_id = ?').get(clinicId);
      if (!clinic?.merchant_id) return null;

      const existing = db.prepare('SELECT id FROM customers WHERE merchant_id = ? LIMIT 1').get(clinic.merchant_id);
      if (existing?.id) return existing.id;

      const tableInfo = db.prepare('PRAGMA table_info(customers)').all();
      const columnNames = new Set(tableInfo.map((c) => c.name));

      const { v4: uuidv4 } = require('uuid');
      const customerId = uuidv4();
      const name = clinic.name || clinicId;
      // Unique per-tenant so we avoid email uniqueness collisions.
      const email = `tenant-${clinicId}-${customerId}@example.com`;

      const insertCols = ['id', 'name', 'email'];
      const values = [customerId, name, email];

      if (columnNames.has('merchant_id')) {
        insertCols.push('merchant_id');
        values.push(clinic.merchant_id);
      }

      const placeholders = insertCols.map(() => '?').join(', ');
      db.prepare(`INSERT INTO customers (${insertCols.join(', ')}) VALUES (${placeholders})`).run(...values);

      return customerId;
    } catch (_) {
      return null;
    }
  },
  /**
   * Return effective visit price for an appointment type at a clinic.
   * - Falls back to sensible defaults when not configured.
   * - Applies surge multiplier only when clinics.surge_enabled is true.
   */
  getEffectiveVisitPrice: (clinicId, appointmentType) => {
    const normalizeType = (t) => {
      const s = (t || '').toString().trim();
      const l = s.toLowerCase();
      if (!s) return 'General Consult';
      if (l.includes('psychiatry') && (l.includes('follow') || l.includes('follow-up') || l.includes('follow up'))) return 'Psychiatry Follow-up';
      if (l.includes('psychiatry')) return 'Psychiatry Initial';
      if (l.includes('therapy') || l.includes('mental health')) return 'Therapy';
      if (l.includes('consult')) return 'General Consult';
      return s;
    };

    const clinic = clinicId ? (db.prepare(`SELECT * FROM clinics WHERE clinic_id = ?`).get(clinicId) || null) : null;
    const surgeEnabled = !!clinic?.surge_enabled;
    const canonical = normalizeType(appointmentType);

    // Try exact match, then canonical match
    const exact = clinicId && appointmentType ? (db.prepare(`
      SELECT * FROM visit_pricing WHERE clinic_id = ? AND appointment_type = ? LIMIT 1
    `).get(clinicId, appointmentType) || null) : null;
    const row = exact || (clinicId ? (db.prepare(`
      SELECT * FROM visit_pricing WHERE clinic_id = ? AND appointment_type = ? LIMIT 1
    `).get(clinicId, canonical) || null) : null);

    const { getPricingFallback } = require('./config/pricing-fallbacks');
    const base = row?.base_price ?? getPricingFallback(canonical);
    const mult = surgeEnabled ? (row?.surge_multiplier ?? 1.0) : 1.0;
    const effective = Math.round((Number(base) * Number(mult)) * 100) / 100;
    return { clinicId, appointmentType, canonicalType: canonical, base_price: Number(base), surge_multiplier: Number(mult), surge_enabled: surgeEnabled, effective_price: effective };
  },

  // ============================================
  // LEDGER ACCOUNTS & ENTRIES
  // ============================================
  getOrCreateLedgerAccount: (ownerType, ownerId, currency, railType, metadata) => {
    const existing = db.prepare(`
      SELECT * FROM ledger_accounts
      WHERE owner_type = ? AND owner_id = ? AND currency = ? AND rail_type = ?
      LIMIT 1
    `).get(ownerType, ownerId, currency, railType);
    if (existing) return existing;
    const id = `acct_${require('crypto').randomBytes(12).toString('hex')}`;
    db.prepare(`
      INSERT INTO ledger_accounts (id, owner_type, owner_id, currency, rail_type, status, metadata)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).run(id, ownerType, ownerId, currency, railType, safeStringify(metadata || {}));
    return db.prepare(`SELECT * FROM ledger_accounts WHERE id = ?`).get(id);
  },
  getLedgerAccount: (id) => {
    try {
      return db.prepare(`SELECT * FROM ledger_accounts WHERE id = ?`).get(id) || null;
    } catch (_) {
      return null;
    }
  },
  insertLedgerEntry: (entry) => {
    const id = entry.id || `le_${require('crypto').randomBytes(12).toString('hex')}`;
    db.prepare(`
      INSERT INTO ledger_entries (
        id, account_id, debit, credit, currency,
        external_ref_type, external_ref_id, description, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `).run(
      id,
      entry.account_id,
      entry.debit || 0,
      entry.credit || 0,
      entry.currency,
      entry.external_ref_type || null,
      entry.external_ref_id || null,
      entry.description || null,
      entry.status || 'pending',
      entry.created_at || null
    );
    return db.prepare(`SELECT * FROM ledger_entries WHERE id = ?`).get(id);
  },
  markLedgerEntrySettled: (id) => {
    db.prepare(`
      UPDATE ledger_entries
      SET status = 'settled', settled_at = datetime('now')
      WHERE id = ?
    `).run(id);
  },
  getLedgerEntriesByRef: (externalRefType, externalRefId) => {
    return db.prepare(`
      SELECT * FROM ledger_entries
      WHERE external_ref_type = ? AND external_ref_id = ?
      ORDER BY created_at ASC
    `).all(externalRefType, externalRefId);
  },

  // ============================================
  // FINANCIAL EVENTS & AUDIT LOG
  // ============================================
  insertFinancialEvent: (event) => {
    const id = event.id || `fe_${require('crypto').randomBytes(12).toString('hex')}`;
    db.prepare(`
      INSERT INTO financial_events (
        id, event_type, actor_type, actor_id, amount, currency,
        rail_type, status, cause, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `).run(
      id,
      event.event_type,
      event.actor_type || null,
      event.actor_id || null,
      event.amount || null,
      event.currency || null,
      event.rail_type || null,
      event.status || null,
      event.cause || null,
      safeStringify(event.metadata || {}),
      event.created_at || null
    );
    return db.prepare(`SELECT * FROM financial_events WHERE id = ?`).get(id);
  },
  writeAuditLog: (log) => {
    const id = log.id || `audit_${require('crypto').randomBytes(12).toString('hex')}`;
    db.prepare(`
      INSERT INTO audit_log (
        id, actor_type, actor_id, action, target_type, target_id,
        ip, user_agent, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `).run(
      id,
      log.actor_type || null,
      log.actor_id || null,
      log.action,
      log.target_type || null,
      log.target_id || null,
      log.ip || null,
      log.user_agent || null,
      safeStringify(log.details || {}),
      log.created_at || null
    );
    return id;
  },

  /**
   * Telemedicine Phase 1 — Task 5: Compliance audit log.
   * Schema: id, timestamp, actor_type, actor_id, action, resource_type, resource_id, ip_address, user_agent, result.
   */
  auditLog: (actorType, actorId, action, resourceType, resourceId, ipAddress, userAgent, result) => {
    const id = `audit_${require('crypto').randomBytes(12).toString('hex')}`;
    const info = db.prepare('PRAGMA table_info(audit_log)').all();
    const has = (name) => info.some(c => c.name === name);
    if (!has('resource_type')) {
      try {
        db.prepare(`
          INSERT INTO audit_log (id, actor_type, actor_id, action, ip, user_agent, details, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, actorType || null, actorId || null, action, ipAddress || null, userAgent || null, result || null);
      } catch (e) {
        console.warn('[auditLog] fallback insert failed:', e.message);
      }
      return id;
    }
    if (has('timestamp')) {
      db.prepare(`
        INSERT INTO audit_log (id, actor_type, actor_id, action, resource_type, resource_id, ip_address, user_agent, result, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(id, actorType || null, actorId || null, action, resourceType || null, resourceId || null, ipAddress || null, userAgent || null, result || null);
    } else {
      db.prepare(`
        INSERT INTO audit_log (id, actor_type, actor_id, action, resource_type, resource_id, ip_address, user_agent, result)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, actorType || null, actorId || null, action, resourceType || null, resourceId || null, ipAddress || null, userAgent || null, result || null);
    }
    return id;
  },

  // ============================================
  // POSTGRES SYNC RETRY QUEUE (Section 2.2)
  // ============================================
  executePostgresSync,
  getPendingSyncRetries: () => {
    try {
      const rows = db.prepare(`
        SELECT * FROM postgres_sync_retry
        ORDER BY priority ASC, created_at ASC
        LIMIT 10
      `).all();
    return rows.filter(r => {
      if (r.last_attempt_at == null) return true;
      const backoffSeconds = Math.pow(2, Math.min(r.attempt_count, 4));
      const lastAttempt = new Date(r.last_attempt_at).getTime();
      return Date.now() - lastAttempt >= backoffSeconds * 1000;
    });
    } catch (_) { return []; }
  },
  updateSyncRetry: (id, attemptCount, lastError) => {
    db.prepare(`
      UPDATE postgres_sync_retry
      SET attempt_count = ?, last_error = ?, last_attempt_at = datetime('now')
      WHERE id = ?
    `).run(attemptCount, lastError || null, id);
  },
  deleteSyncRetry: (id) => {
    db.prepare('DELETE FROM postgres_sync_retry WHERE id = ?').run(id);
  },
  moveToDLQ: (id) => {
    const row = db.prepare('SELECT * FROM postgres_sync_retry WHERE id = ?').get(id);
    if (!row) return;
    db.prepare(`
      INSERT INTO postgres_sync_dlq (id, entity_type, payload_json, attempt_count, last_error)
      VALUES (?, ?, ?, ?, ?)
    `).run(row.id, row.entity_type, row.payload_json, row.attempt_count, row.last_error);
    db.prepare('DELETE FROM postgres_sync_retry WHERE id = ?').run(id);
    console.log(`📤 Postgres sync moved to DLQ: ${row.entity_type} (id=${id})`);
  },
  getRetryQueueDepth: () => {
    try {
      return db.prepare('SELECT COUNT(*) as n FROM postgres_sync_retry').get()?.n ?? 0;
    } catch (_) { return 0; }
  },
  getDLQSize: () => {
    try {
      return db.prepare('SELECT COUNT(*) as n FROM postgres_sync_dlq').get()?.n ?? 0;
    } catch (_) { return 0; }
  },

  // ============================================
  // DLQ TOOL CALLS (Section 2 - failed function calls)
  // ============================================
  enqueueToolCallDLQ: (payload) => {
    try {
      const id = `dlq_${require('crypto').randomBytes(12).toString('hex')}`;
      db.prepare(`
        INSERT INTO dlq_tool_calls (id, call_id, clinic_id, function_name, parameters_json, error_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        payload.call_id || '',
        payload.clinic_id || null,
        payload.function_name || 'unknown',
        typeof payload.parameters === 'string' ? payload.parameters : JSON.stringify(payload.parameters || {}),
        payload.error_message || null
      );
      console.log(`📥 Tool call moved to DLQ: ${payload.function_name} (call_id=${payload.call_id})`);
      return id;
    } catch (e) {
      console.error('❌ Failed to enqueue tool call DLQ:', e.message);
      return null;
    }
  },
  getDlqToolCallsSize: () => {
    try {
      return db.prepare('SELECT COUNT(*) as n FROM dlq_tool_calls').get()?.n ?? 0;
    } catch (_) { return 0; }
  },

  // ============================================
  // PROMPT PROFILES & AUDIT
  // ============================================
  getClinicPromptProfile: (clinicId) => {
    try {
      const row = db.prepare(`
        SELECT *
        FROM prompt_profiles
        WHERE clinic_id = ? AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(clinicId);
      return row || null;
    } catch (_) {
      return null;
    }
  },
  listPromptProfiles: (clinicId) => {
    try {
      return db.prepare(`
        SELECT *
        FROM prompt_profiles
        WHERE clinic_id = ?
        ORDER BY created_at DESC
      `).all(clinicId);
    } catch (_) {
      return [];
    }
  },
  upsertPromptProfile: (profile) => {
    const id = profile.id || require('crypto').randomBytes(16).toString('hex');
    const allowedToolsJson = Array.isArray(profile.allowed_tools)
      ? JSON.stringify(profile.allowed_tools)
      : profile.allowed_tools || null;
    const metadataJson =
      typeof profile.metadata === 'string'
        ? profile.metadata
        : profile.metadata
        ? JSON.stringify(profile.metadata)
        : null;
    db.prepare(
      `
      INSERT INTO prompt_profiles (
        id, clinic_id, name, specialty, system_prompt,
        allowed_tools, version, status, metadata,
        created_by, updated_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        clinic_id = excluded.clinic_id,
        name = excluded.name,
        specialty = excluded.specialty,
        system_prompt = excluded.system_prompt,
        allowed_tools = excluded.allowed_tools,
        version = excluded.version,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_by = excluded.updated_by,
        updated_at = datetime('now')
    `
    ).run(
      id,
      profile.clinic_id || null,
      profile.name,
      profile.specialty || null,
      profile.system_prompt,
      allowedToolsJson,
      profile.version || 'v1',
      profile.status || 'active',
      metadataJson,
      profile.created_by || null,
      profile.updated_by || null
    );
    return id;
  },
  insertPromptAuditLog: (log) => {
    const id = log.id || require('crypto').randomBytes(16).toString('hex');
    db.prepare(
      `
      INSERT INTO prompt_audit_logs (id, prompt_id, user_id, change_diff, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `
    ).run(
      id,
      log.prompt_id,
      log.user_id || null,
      typeof log.change_diff === 'string' ? log.change_diff : JSON.stringify(log.change_diff || {})
    );
    return id;
  },

  // ============================================
  // AGENT TURNS LOG
  // ============================================
  insertAgentTurn: (turn) => {
    const id = turn.id || require('crypto').randomBytes(16).toString('hex');
    db.prepare(
      `
      INSERT INTO agent_turns (
        id, call_id, clinic_id, turn_index, role, text,
        actions_json, prompt_profile_id, prompt_version,
        prompt_checksum, model, latency_ms, trace_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
    ).run(
      id,
      turn.call_id,
      turn.clinic_id || null,
      turn.turn_index || null,
      turn.role,
      turn.text || null,
      typeof turn.actions_json === 'string'
        ? turn.actions_json
        : JSON.stringify(turn.actions_json || []),
      turn.prompt_profile_id || null,
      turn.prompt_version || null,
      turn.prompt_checksum || null,
      turn.model || null,
      typeof turn.latency_ms === 'number' ? turn.latency_ms : null,
      turn.trace_id || null
    );
    return id;
  },
  getDlqToolCalls: (limit = 50) => {
    try {
      return db.prepare(`
        SELECT * FROM dlq_tool_calls ORDER BY created_at DESC LIMIT ?
      `).all(limit);
    } catch (_) { return []; }
  },

  // ============================================
  // IDEMPOTENCY (Section 22 - prevent double-billing)
  // ============================================
  /** Get cached result for idempotency key. Returns { result, idempotent: true } or null. */
  getIdempotentResult: (key, operationType) => {
    if (!key || !operationType) return null;
    try {
      const row = db.prepare(`
        SELECT result_json, status FROM idempotency_keys
        WHERE id = ? AND operation_type = ?
          AND datetime(created_at) > datetime('now', '-24 hours')
      `).get(key, operationType);
      if (!row || row.status !== 'completed' || !row.result_json) return null;
      return { result: JSON.parse(row.result_json), idempotent: true };
    } catch (_) { return null; }
  },
  /**
   * Reserve idempotency key (call before operation). Returns: 'reserved' | 'completed' | 'in_progress'
   * - 'reserved': caller should proceed, then call completeIdempotentResult
   * - 'completed': cached result available via getIdempotentResult
   * - 'in_progress': another request is processing, return 409
   */
  reserveIdempotencyKey: (key, operationType) => {
    if (!key || !operationType) return 'reserved';
    try {
      const existing = db.prepare(`
        SELECT status, result_json FROM idempotency_keys
        WHERE id = ? AND operation_type = ?
          AND datetime(created_at) > datetime('now', '-24 hours')
      `).get(key, operationType);
      if (existing) {
        if (existing.status === 'completed') return 'completed';
        return 'in_progress';
      }
      db.prepare(`
        INSERT INTO idempotency_keys (id, operation_type, status, created_at)
        VALUES (?, ?, 'pending', datetime('now'))
      `).run(key, operationType);
      return 'reserved';
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE constraint')) return 'in_progress';
      console.warn('⚠️  Idempotency reserve failed:', e.message);
      return 'reserved'; // allow operation on error
    }
  },
  /** Release idempotency key on operation failure so retries can proceed. */
  releaseIdempotencyKey: (key, operationType) => {
    if (!key || !operationType) return;
    try {
      db.prepare('DELETE FROM idempotency_keys WHERE id = ? AND operation_type = ? AND status = ?')
        .run(key, operationType, 'pending');
    } catch (_) { /* ignore */ }
  },
  /** Complete idempotency: store result and mark completed. Call after successful operation. */
  completeIdempotentResult: (key, operationType, result) => {
    if (!key || !operationType) return;
    try {
      const resultJson = typeof result === 'string' ? result : JSON.stringify(result || {});
      db.prepare(`
        UPDATE idempotency_keys SET result_json = ?, status = 'completed'
        WHERE id = ? AND operation_type = ?
      `).run(resultJson, key, operationType);
    } catch (e) {
      console.warn('⚠️  Failed to complete idempotency result:', e.message);
    }
  },
  /** Legacy: store idempotency result (for simple flow without reserve). Prefer reserveIdempotencyKey + completeIdempotentResult. */
  setIdempotentResult: (key, operationType, result) => {
    if (!key || !operationType) return;
    try {
      const resultJson = typeof result === 'string' ? result : JSON.stringify(result || {});
      db.prepare(`
        INSERT OR REPLACE INTO idempotency_keys (id, operation_type, result_json, status, created_at)
        VALUES (?, ?, ?, 'completed', datetime('now'))
      `).run(key, operationType, resultJson);
    } catch (e) {
      console.warn('⚠️  Failed to store idempotency result:', e.message);
    }
  },
  /** Delete expired idempotency keys (older than 24h). Returns count deleted. */
  cleanupIdempotencyKeys: () => {
    try {
      const r = db.prepare(`
        DELETE FROM idempotency_keys WHERE datetime(created_at) <= datetime('now', '-24 hours')
      `).run();
      return r.changes;
    } catch (_) { return 0; }
  },

  // ============================================
  // MERCHANTS
  // ============================================
  createMerchant: (merchant) => {
    // Generate subdomain if not provided
    let subdomain = merchant.subdomain;
    if (!subdomain) {
      const { generateSubdomain } = require('./utils/subdomain-generator');
      // Pass db instance to avoid circular dependency
      subdomain = generateSubdomain(merchant.name, merchant.id, db);
    }

    return db.prepare(`
      INSERT INTO merchants (id, name, api_key, api_url, webhook_url, enabled_platforms, subdomain)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      merchant.id,
      merchant.name,
      merchant.api_key,
      merchant.api_url,
      merchant.webhook_url || null,
      JSON.stringify(merchant.enabled_platforms || ['acp', 'ap2']),
      subdomain
    );
  },

  getMerchant: (id) => db.prepare('SELECT * FROM merchants WHERE id = ?').get(id),

  getMerchantBySubdomain: (subdomain) => db.prepare('SELECT * FROM merchants WHERE subdomain = ?').get(subdomain),

  getMerchantByApiKey: (apiKey) => {
    const directMatch = db.prepare('SELECT * FROM merchants WHERE api_key = ?').get(apiKey);
    if (directMatch) {
      return directMatch;
    }

    if (!apiKey) {
      return null;
    }

    const keyHash = hashApiKey(apiKey);
    const merchantApiKey = db.prepare(`
      SELECT * FROM merchant_api_keys 
      WHERE key_hash = ? AND status = 'active'
    `).get(keyHash);

    if (merchantApiKey) {
      const merchant = db.getMerchant(merchantApiKey.merchant_id);
      if (merchant) {
        merchant.api_key_id = merchantApiKey.id;
        return merchant;
      }
    }

    return null;
  },

  getAllMerchants: () => db.prepare('SELECT * FROM merchants').all(),

  createMerchantApiKey: (record) => {
    return db.prepare(`
      INSERT INTO merchant_api_keys (
        id, merchant_id, key_hash, key_prefix, key_suffix, label,
        status, created_by, revoked_at, revoked_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.merchant_id,
      record.key_hash,
      record.key_prefix,
      record.key_suffix,
      record.label || null,
      record.status || 'active',
      record.created_by || 'system',
      record.revoked_at || null,
      record.revoked_by || null
    );
  },

  getMerchantApiKeys: (merchantId) => {
    return db.prepare(`
      SELECT * FROM merchant_api_keys
      WHERE merchant_id = ?
      ORDER BY created_at DESC
    `).all(merchantId);
  },

  getMerchantApiKey: (id) => {
    return db.prepare('SELECT * FROM merchant_api_keys WHERE id = ?').get(id);
  },

  getActiveMerchantApiKeyByHash: (keyHash) => {
    return db.prepare(`
      SELECT * FROM merchant_api_keys
      WHERE key_hash = ? AND status = 'active'
    `).get(keyHash);
  },

  markMerchantApiKeyUsed: (id) => {
    return db.prepare(`
      UPDATE merchant_api_keys
      SET last_used_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);
  },

  revokeMerchantApiKey: (id, revokedBy = 'system') => {
    return db.prepare(`
      UPDATE merchant_api_keys
      SET status = 'revoked',
          revoked_at = CURRENT_TIMESTAMP,
          revoked_by = ?
      WHERE id = ? AND status = 'active'
    `).run(revokedBy, id);
  },

  revokeAllMerchantApiKeys: (merchantId, revokedBy = 'system') => {
    return db.prepare(`
      UPDATE merchant_api_keys
      SET status = 'revoked',
          revoked_at = CURRENT_TIMESTAMP,
          revoked_by = ?
      WHERE merchant_id = ? AND status = 'active'
    `).run(revokedBy, merchantId);
  },

  /**
   * Rotate merchant API key (Gap Analysis - zero-downtime rotation).
   * Creates new key, revokes old active key(s), returns new plain key.
   * Caller must store the returned key securely; only hash is persisted.
   */
  rotateMerchantApiKey: (merchantId, revokedBy = 'system') => {
    const { generateApiKey, hashApiKey } = require('./utils/api-keys');
    const crypto = require('crypto');
    const activeKeys = db.prepare(`
      SELECT * FROM merchant_api_keys WHERE merchant_id = ? AND status = 'active'
    `).all(merchantId);
    if (activeKeys.length === 0) {
      throw new Error('No active API key to rotate for merchant ' + merchantId);
    }
    const newKey = generateApiKey('sk');
    const keyHash = hashApiKey(newKey);
    const keyPrefix = newKey.substring(0, 10);
    const keySuffix = newKey.substring(newKey.length - 4);
    const id = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO merchant_api_keys (id, merchant_id, key_hash, key_prefix, key_suffix, label, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, merchantId, keyHash, keyPrefix, keySuffix, 'rotated', 'active', revokedBy);
    for (const k of activeKeys) {
      db.prepare(`
        UPDATE merchant_api_keys SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoked_by = ?
        WHERE id = ? AND status = 'active'
      `).run(revokedBy, k.id);
    }
    return { apiKey: newKey, keyId: id };
  },

  // ============================================
  // PRODUCT SYNC
  // ============================================
  syncProduct: (sync) => {
    return db.prepare(`
      INSERT OR REPLACE INTO product_sync 
      (id, merchant_id, merchant_product_id, platform, platform_product_id, 
       sync_status, last_synced, product_data, universal_data)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
    `).run(
      sync.id,
      sync.merchant_id,
      sync.merchant_product_id,
      sync.platform,
      sync.platform_product_id || null,
      sync.sync_status || 'synced',
      safeStringify(sync.product_data),
      safeStringify(sync.universal_data)
    );
  },

  getSyncedProducts: (merchantId, platform) => {
    return db.prepare(
      'SELECT * FROM product_sync WHERE merchant_id = ? AND platform = ?'
    ).all(merchantId, platform);
  },

  getUniversalProducts: (merchantId) => {
    return db.prepare(
      'SELECT * FROM product_sync WHERE merchant_id = ? AND universal_data IS NOT NULL'
    ).all(merchantId);
  },

  // ============================================
  // TRANSACTIONS
  // ============================================
  createTransaction: (transaction) => {
    return db.prepare(`
      INSERT INTO transactions 
      (id, merchant_id, platform, platform_order_id, merchant_order_id, 
       product_id, amount, status, customer_email, customer_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transaction.id,
      transaction.merchant_id,
      transaction.platform,
      transaction.platform_order_id || null,
      transaction.merchant_order_id || null,
      transaction.product_id,
      transaction.amount,
      transaction.status || 'pending',
      transaction.customer_email,
      transaction.customer_phone || null
    );
  },

  updateTransaction: (id, updates) => {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id];
    return db.prepare(`UPDATE transactions SET ${fields} WHERE id = ?`).run(...values);
  },

  getTransaction: (id) => db.prepare('SELECT * FROM transactions WHERE id = ?').get(id),

  getAllTransactions: () => {
    return db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all();
  },

  getTransactionsByCustomer: (phone, email) => {
    return db.prepare(
      'SELECT * FROM transactions WHERE customer_phone = ? OR customer_email = ? ORDER BY created_at DESC'
    ).all(phone, email);
  },

  getTransactionsByMerchant: (merchantId) => {
    return db.prepare(
      'SELECT * FROM transactions WHERE merchant_id = ? ORDER BY created_at DESC'
    ).all(merchantId);
  },

  getTransactionsByPhone: (phone, sinceDate) => {
    return db.prepare(
      'SELECT * FROM transactions WHERE customer_phone = ? AND created_at >= ? ORDER BY created_at DESC'
    ).all(phone, sinceDate.toISOString());
  },

  getTransactionsByEmail: (email, sinceDate) => {
    return db.prepare(
      'SELECT * FROM transactions WHERE customer_email = ? AND created_at >= ? ORDER BY created_at DESC'
    ).all(email, sinceDate.toISOString());
  },

  // ============================================
  // CHECKOUT SESSIONS
  // ============================================
  createCheckoutSession: (session) => {
    return db.prepare(`
      INSERT INTO checkout_sessions (id, merchant_id, platform, session_data, status, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+1 hour'))
    `).run(
      session.id,
      session.merchant_id,
      session.platform,
      safeStringify(session.session_data),
      session.status || 'pending'
    );
  },

  getCheckoutSession: (id) => {
    return db.prepare('SELECT * FROM checkout_sessions WHERE id = ?').get(id);
  },

  updateCheckoutSession: (id, status, sessionData) => {
    return db.prepare(`
      UPDATE checkout_sessions 
      SET status = ?, session_data = ?
      WHERE id = ?
    `).run(status, safeStringify(sessionData), id);
  },

  /** Remove expired pending/quoted commerce sessions (scheduled cleanup). */
  purgeExpiredCheckoutSessions: () => {
    try {
      const r = db.prepare(`
        DELETE FROM checkout_sessions
        WHERE expires_at IS NOT NULL
          AND datetime(expires_at) < datetime('now')
          AND status IN ('pending', 'quoted')
      `).run();
      return r.changes || 0;
    } catch (_) {
      return 0;
    }
  },

  // ============================================
  // COMMERCE CHAT CART (session-scoped)
  // ============================================
  getCommerceCart: (sessionId, merchantId = null) => {
    if (!sessionId) return null;
    const row = db.prepare(`
      SELECT * FROM checkout_sessions
      WHERE id = ? AND platform = 'commerce_cart'
    `).get(sessionId);
    if (!row) return null;
    if (merchantId && row.merchant_id && row.merchant_id !== merchantId) return null;
    const parsed = toJsonValue(row.session_data) || {};
    return {
      id: row.id,
      merchant_id: row.merchant_id,
      status: row.status,
      expires_at: row.expires_at,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      subtotal: Number(parsed.subtotal || 0),
      item_count: Number(parsed.item_count || 0),
      updated_at: parsed.updated_at || row.created_at || null,
      checkout_locked: !!parsed.checkout_locked,
      voice_checkout_id: parsed.voice_checkout_id || null
    };
  },

  setCommerceCartCheckoutLock: (sessionId, merchantId, voiceCheckoutId) => {
    if (!sessionId || !merchantId || !voiceCheckoutId) return { changes: 0 };
    const row = db.prepare(`
      SELECT session_data FROM checkout_sessions
      WHERE id = ? AND platform = 'commerce_cart' AND merchant_id = ?
    `).get(sessionId, merchantId);
    if (!row) return { changes: 0 };
    const prev = toJsonValue(row.session_data) || {};
    const next = {
      ...prev,
      checkout_locked: true,
      voice_checkout_id: String(voiceCheckoutId),
      checkout_locked_at: new Date().toISOString()
    };
    return db.prepare(`
      UPDATE checkout_sessions SET session_data = ?
      WHERE id = ? AND platform = 'commerce_cart' AND merchant_id = ?
    `).run(safeStringify(next), sessionId, merchantId);
  },

  clearCommerceCartCheckoutLock: (sessionId, merchantId) => {
    if (!sessionId || !merchantId) return { changes: 0 };
    const row = db.prepare(`
      SELECT session_data FROM checkout_sessions
      WHERE id = ? AND platform = 'commerce_cart' AND merchant_id = ?
    `).get(sessionId, merchantId);
    if (!row) return { changes: 0 };
    const prev = toJsonValue(row.session_data) || {};
    const next = { ...prev };
    delete next.checkout_locked;
    delete next.voice_checkout_id;
    delete next.checkout_locked_at;
    return db.prepare(`
      UPDATE checkout_sessions SET session_data = ?
      WHERE id = ? AND platform = 'commerce_cart' AND merchant_id = ?
    `).run(safeStringify(next), sessionId, merchantId);
  },

  isCommerceCartLocked: async (sessionId, merchantId) => {
    if (!sessionId || !merchantId) return false;
    const row = db.prepare(`
      SELECT session_data FROM checkout_sessions
      WHERE id = ? AND platform = 'commerce_cart' AND merchant_id = ?
    `).get(sessionId, merchantId);
    if (!row) return false;
    const parsed = toJsonValue(row.session_data) || {};
    if (!parsed.checkout_locked) return false;
    const vid = parsed.voice_checkout_id;
    const getVc = module.exports.getVoiceCheckout;
    if (vid && typeof getVc === 'function') {
      try {
        const vc = await getVc(vid);
        const st = String(vc?.status || '');
        if (vc && (st === 'completed' || st === 'cancelled' || st === 'failed')) {
          module.exports.clearCommerceCartCheckoutLock(sessionId, merchantId);
          return false;
        }
      } catch (_) {}
    }
    return true;
  },

  upsertCommerceCheckoutProgress: ({
    session_id,
    merchant_id,
    stage,
    quote_id,
    checkout_id,
    checkout_intent,
    product_id,
    ttl_minutes = 10080
  }) => {
    if (!session_id || !merchant_id) throw new Error('session_id and merchant_id required');
    // checkout_sessions.id is PRIMARY KEY — cart rows already use session_id; progress must use a distinct id.
    const rowId = `commerce_flow:${session_id}`;
    const payload = {
      kind: 'commerce_flow',
      cart_session_id: session_id,
      stage: stage || 'cart',
      quote_id: quote_id || null,
      checkout_id: checkout_id || null,
      checkout_intent: !!checkout_intent,
      product_id: product_id || null,
      updated_at: new Date().toISOString()
    };
    const existing = db.prepare(`
      SELECT id FROM checkout_sessions WHERE id = ? AND platform = 'commerce_flow' LIMIT 1
    `).get(rowId);
    const ttl = `+${Math.max(60, Number(ttl_minutes) || 10080)} minutes`;
    if (existing) {
      return db.prepare(`
        UPDATE checkout_sessions
        SET merchant_id = ?, session_data = ?, status = 'active', expires_at = datetime('now', ?)
        WHERE id = ? AND platform = 'commerce_flow'
      `).run(merchant_id, safeStringify(payload), ttl, rowId);
    }
    return db.prepare(`
      INSERT INTO checkout_sessions (id, merchant_id, platform, session_data, status, expires_at)
      VALUES (?, ?, 'commerce_flow', ?, 'active', datetime('now', ?))
    `).run(rowId, merchant_id, safeStringify(payload), ttl);
  },

  getCommerceCheckoutProgress: (sessionId, merchantId = null) => {
    if (!sessionId) return null;
    const rowId = `commerce_flow:${sessionId}`;
    const row = db.prepare(`
      SELECT * FROM checkout_sessions WHERE id = ? AND platform = 'commerce_flow'
    `).get(rowId);
    if (!row) return null;
    if (merchantId && row.merchant_id && row.merchant_id !== merchantId) return null;
    const parsed = toJsonValue(row.session_data) || {};
    return {
      session_id: parsed.cart_session_id || sessionId,
      merchant_id: row.merchant_id,
      stage: parsed.stage || 'cart',
      quote_id: parsed.quote_id || null,
      checkout_id: parsed.checkout_id || null,
      checkout_intent: !!parsed.checkout_intent,
      product_id: parsed.product_id || null,
      updated_at: parsed.updated_at || null
    };
  },

  upsertCommerceCart: ({ session_id, merchant_id, items = [], ttl_minutes = 180 }) => {
    if (!session_id || !merchant_id) throw new Error('session_id and merchant_id required');
    const safeItems = Array.isArray(items) ? items : [];
    const subtotal = safeItems.reduce((sum, it) => sum + Number(it.total || 0), 0);
    const itemCount = safeItems.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
    const existingRow = db.prepare(`
      SELECT session_data FROM checkout_sessions
      WHERE id = ? AND platform = 'commerce_cart' AND merchant_id = ?
      LIMIT 1
    `).get(session_id, merchant_id);
    const existingParsed = existingRow ? toJsonValue(existingRow.session_data) || {} : {};
    const payload = {
      kind: 'commerce_cart',
      items: safeItems,
      subtotal: Number(subtotal.toFixed(2)),
      item_count: itemCount,
      updated_at: new Date().toISOString()
    };
    if (existingParsed.checkout_locked) {
      payload.checkout_locked = true;
      if (existingParsed.voice_checkout_id) payload.voice_checkout_id = existingParsed.voice_checkout_id;
      if (existingParsed.checkout_locked_at) payload.checkout_locked_at = existingParsed.checkout_locked_at;
    }
    const existing = db.prepare(`
      SELECT id FROM checkout_sessions
      WHERE id = ? AND platform = 'commerce_cart'
      LIMIT 1
    `).get(session_id);
    if (existing) {
      return db.prepare(`
        UPDATE checkout_sessions
        SET merchant_id = ?, session_data = ?, status = ?, expires_at = datetime('now', ?)
        WHERE id = ? AND platform = 'commerce_cart'
      `).run(
        merchant_id,
        safeStringify(payload),
        safeItems.length ? 'active' : 'empty',
        `+${Math.max(15, Number(ttl_minutes) || 180)} minutes`,
        session_id
      );
    }
    return db.prepare(`
      INSERT INTO checkout_sessions (id, merchant_id, platform, session_data, status, expires_at)
      VALUES (?, ?, 'commerce_cart', ?, ?, datetime('now', ?))
    `).run(
      session_id,
      merchant_id,
      safeStringify(payload),
      safeItems.length ? 'active' : 'empty',
      `+${Math.max(15, Number(ttl_minutes) || 180)} minutes`
    );
  },

  clearCommerceCart: (sessionId, merchantId = null) => {
    if (!sessionId) return { changes: 0 };
    if (merchantId) {
      return db.prepare(`
        DELETE FROM checkout_sessions
        WHERE id = ? AND platform = 'commerce_cart' AND merchant_id = ?
      `).run(sessionId, merchantId);
    }
    return db.prepare(`
      DELETE FROM checkout_sessions
      WHERE id = ? AND platform = 'commerce_cart'
    `).run(sessionId);
  },

  // ============================================
  // AP2 MANDATES
  // ============================================
  storeMandate: (mandate) => {
    return db.prepare(`
      INSERT OR REPLACE INTO ap2_mandates (id, type, mandate_data, signature, verified, merchant_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      mandate.id,
      mandate.type,
      JSON.stringify(mandate),
      typeof mandate.signature === 'string' ? mandate.signature : JSON.stringify(mandate.signature),
      mandate.verified ? 1 : 0,
      mandate.merchant_id || null,
      mandate.expires_at || null
    );
  },

  getMandate: (id) => {
    return db.prepare('SELECT * FROM ap2_mandates WHERE id = ?').get(id);
  },

  updateMandateVerification: (id, verified) => {
    return db.prepare('UPDATE ap2_mandates SET verified = ? WHERE id = ?').run(verified, id);
  },

  // ============================================
  // SHOPPING CARTS
  // ============================================
  createCart: (cart) => {
    return db.prepare(`
      INSERT INTO shopping_carts 
      (id, merchant_id, intent_mandate_id, items, subtotal, tax, shipping, total, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 hour'))
    `).run(
      cart.id,
      cart.merchant_id,
      cart.intent_mandate_id || null,
      JSON.stringify(cart.items),
      cart.subtotal,
      cart.tax,
      cart.shipping,
      cart.total
    );
  },

  getCart: (id) => {
    return db.prepare('SELECT * FROM shopping_carts WHERE id = ?').get(id);
  },

  updateCart: (id, cart) => {
    return db.prepare(`
      UPDATE shopping_carts 
      SET items = ?, subtotal = ?, tax = ?, shipping = ?, total = ?
      WHERE id = ?
    `).run(
      JSON.stringify(cart.items),
      cart.subtotal,
      cart.tax,
      cart.shipping,
      cart.total,
      id
    );
  },

  // ============================================
  // AP2 TRANSACTIONS
  // ============================================
  createAP2Transaction: (transaction) => {
    return db.prepare(`
      INSERT INTO ap2_transactions 
      (id, merchant_id, intent_mandate_id, cart_mandate_id, payment_mandate_id, 
       cart_id, order_id, amount, status, audit_trail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transaction.id,
      transaction.merchant_id,
      transaction.intent_mandate_id || null,
      transaction.cart_mandate_id || null,
      transaction.payment_mandate_id || null,
      transaction.cart_id || null,
      transaction.order_id || null,
      transaction.amount,
      transaction.status || 'pending',
      JSON.stringify(transaction.audit_trail || [])
    );
  },

  getAP2Transaction: (id) => {
    return db.prepare('SELECT * FROM ap2_transactions WHERE id = ?').get(id);
  },

  updateAP2Transaction: (id, updates) => {
    // SECURITY: Whitelist allowed fields to prevent SQL injection
    const allowedFields = [
      'merchant_id', 'intent_mandate_id', 'cart_mandate_id', 'payment_mandate_id',
      'cart_id', 'order_id', 'amount', 'status', 'audit_trail', 'completed_at'
    ];

    // Filter to only allowed fields
    const safeUpdates = {};
    for (const key of Object.keys(updates)) {
      if (allowedFields.includes(key)) {
        safeUpdates[key] = updates[key];
      } else {
        console.warn(`⚠️  Attempted to update disallowed field in ap2_transactions: ${key}`);
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return { changes: 0 };
    }

    const fields = Object.keys(safeUpdates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(safeUpdates).map(v =>
      typeof v === 'object' ? JSON.stringify(v) : v
    );
    return db.prepare(`UPDATE ap2_transactions SET ${fields} WHERE id = ?`).run(...values, id);
  },

  getAllAP2Transactions: () => {
    return db.prepare('SELECT * FROM ap2_transactions ORDER BY created_at DESC').all();
  },

  // ============================================
  // VOICE CHECKOUTS
  // ============================================
  createVoiceCheckout: async (checkout) => {
    // Ensure customer_phone is never null (required field)
    const customerPhone = checkout.customer_phone || '0000000000';

    if (usePostgres && pgPool) {
      await ensureVoiceCheckoutsTriageColumnPg();
      // Postgres path (impl-9: triage_session_id — audit / C9)
      const triageSid = checkout.triage_session_id || null;
      await pgPool`
        INSERT INTO voice_checkouts 
        (id, clinic_id, merchant_id, product_id, product_name, quantity, amount, 
         customer_phone, customer_name, customer_email, appointment_id, payment_method, status, created_at, triage_session_id)
        VALUES (
          ${checkout.id},
          ${checkout.clinic_id || null},
          ${checkout.merchant_id},
          ${checkout.product_id},
          ${checkout.product_name},
          ${checkout.quantity || 1},
          ${checkout.amount},
          ${customerPhone},
          ${checkout.customer_name || null},
          ${checkout.customer_email || null},
          ${checkout.appointment_id || null},
          ${checkout.payment_method || null},
          ${checkout.status || 'pending'},
          ${checkout.created_at || new Date().toISOString()},
          ${triageSid}
        )
      `;
      if (checkout.shipping_address != null && checkout.shipping_address !== '') {
        const ser =
          typeof checkout.shipping_address === 'object'
            ? JSON.stringify(checkout.shipping_address)
            : String(checkout.shipping_address);
        try {
          await pgPool`UPDATE voice_checkouts SET shipping_address = ${ser} WHERE id = ${checkout.id}`;
        } catch (e) {
          console.warn('[DB] voice_checkouts shipping_address (pg) skipped:', e.message);
        }
      }
      return { changes: 1, lastInsertRowid: checkout.id };
    } else {
      // SQLite path
      const hasTriageCol = db.prepare(`PRAGMA table_info(voice_checkouts)`).all();
      const triageCol = hasTriageCol.some((c) => c.name === 'triage_session_id');
      const triageVal = checkout.triage_session_id || null;
      if (triageCol) {
        const result = db.prepare(`
          INSERT INTO voice_checkouts 
          (id, clinic_id, merchant_id, product_id, product_name, quantity, amount, 
           customer_phone, customer_name, customer_email, appointment_id, payment_method, status,
           stripe_checkout_session_id, stripe_session_expires_at, triage_session_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          checkout.id,
          checkout.clinic_id || null,
          checkout.merchant_id,
          checkout.product_id,
          checkout.product_name,
          checkout.quantity || 1,
          checkout.amount,
          customerPhone,
          checkout.customer_name || null,
          checkout.customer_email || null,
          checkout.appointment_id || null,
          checkout.payment_method || null,
          checkout.status || 'pending',
          checkout.stripe_checkout_session_id || null,
          checkout.stripe_session_expires_at || null,
          triageVal
        );
        if (checkout.shipping_address != null && checkout.shipping_address !== '') {
          const ser =
            typeof checkout.shipping_address === 'object'
              ? JSON.stringify(checkout.shipping_address)
              : String(checkout.shipping_address);
          try {
            const hasShip = db.prepare(`PRAGMA table_info(voice_checkouts)`).all().some((c) => c.name === 'shipping_address');
            if (hasShip) {
              db.prepare('UPDATE voice_checkouts SET shipping_address = ? WHERE id = ?').run(ser, checkout.id);
            }
          } catch (e) {
            console.warn('[DB] voice_checkouts shipping_address update skipped:', e.message);
          }
        }
        try {
          const hasCq = db.prepare(`PRAGMA table_info(voice_checkouts)`).all().some((c) => c.name === 'commerce_quote_id');
          if (hasCq && checkout.commerce_quote_id) {
            db.prepare('UPDATE voice_checkouts SET commerce_quote_id = ? WHERE id = ?').run(
              String(checkout.commerce_quote_id),
              checkout.id
            );
          }
        } catch (e) {
          console.warn('[DB] voice_checkouts commerce_quote_id update skipped:', e.message);
        }
        return result;
      }
      const result = db.prepare(`
        INSERT INTO voice_checkouts 
        (id, clinic_id, merchant_id, product_id, product_name, quantity, amount, 
         customer_phone, customer_name, customer_email, appointment_id, payment_method, status,
         stripe_checkout_session_id, stripe_session_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkout.id,
        checkout.clinic_id || null,
        checkout.merchant_id,
        checkout.product_id,
        checkout.product_name,
        checkout.quantity || 1,
        checkout.amount,
        customerPhone,
        checkout.customer_name || null,
        checkout.customer_email || null,
        checkout.appointment_id || null,
        checkout.payment_method || null,
        checkout.status || 'pending',
        checkout.stripe_checkout_session_id || null,
        checkout.stripe_session_expires_at || null
      );
      if (checkout.shipping_address != null && checkout.shipping_address !== '') {
        const ser =
          typeof checkout.shipping_address === 'object'
            ? JSON.stringify(checkout.shipping_address)
            : String(checkout.shipping_address);
        try {
          const hasShip = db.prepare(`PRAGMA table_info(voice_checkouts)`).all().some((c) => c.name === 'shipping_address');
          if (hasShip) {
            db.prepare('UPDATE voice_checkouts SET shipping_address = ? WHERE id = ?').run(ser, checkout.id);
          }
        } catch (e) {
          console.warn('[DB] voice_checkouts shipping_address update skipped:', e.message);
        }
      }
      try {
        const hasCq = db.prepare(`PRAGMA table_info(voice_checkouts)`).all().some((c) => c.name === 'commerce_quote_id');
        if (hasCq && checkout.commerce_quote_id) {
          db.prepare('UPDATE voice_checkouts SET commerce_quote_id = ? WHERE id = ?').run(
            String(checkout.commerce_quote_id),
            checkout.id
          );
        }
      } catch (e) {
        console.warn('[DB] voice_checkouts commerce_quote_id update skipped:', e.message);
      }
      return result;
    }
  },

  getVoiceCheckout: async (id) => {
    if (usePostgres && pgPool) {
      const results = await pgPool`SELECT * FROM voice_checkouts WHERE id = ${id}`;
      return results[0] || null;
    } else {
      return db.prepare('SELECT * FROM voice_checkouts WHERE id = ?').get(id);
    }
  },

  updateVoiceCheckout: async (id, updates) => {
    if (usePostgres && pgPool) {
      // Enforce payment lifecycle transitions (mvp-23)
      if (updates && updates.status !== undefined) {
        const existing = await pgPool`SELECT status FROM voice_checkouts WHERE id = ${id} LIMIT 1`;
        const currentStatus = (existing && existing[0] && existing[0].status) || null;
        if (currentStatus && !canTransitionCheckoutStatus(currentStatus, updates.status)) {
          throw new Error(`Invalid checkout status transition: ${currentStatus} -> ${updates.status}`);
        }
      }

      // SECURITY: Whitelist allowed fields to prevent SQL injection
      const allowedFields = [
        'status', 'payment_intent_id', 'merchant_order_id', 'payment_token',
        'fhir_patient_id', 'fhir_encounter_id', 'appointment_id', 'payment_method', 'customer_id'
        , 'stripe_checkout_session_id', 'stripe_session_expires_at', 'triage_session_id'
      ];

      // Build dynamic update using parameterized query (safe)
      const setParts = [];
      const values = [];
      let paramIndex = 1;

      // Only process whitelisted fields
      if (updates.status !== undefined) {
        setParts.push(`status = $${paramIndex++}`);
        values.push(updates.status);
      }
      if (updates.payment_intent_id !== undefined) {
        setParts.push(`payment_intent_id = $${paramIndex++}`);
        values.push(updates.payment_intent_id);
      }
      if (updates.merchant_order_id !== undefined) {
        setParts.push(`merchant_order_id = $${paramIndex++}`);
        values.push(updates.merchant_order_id);
      }
      if (updates.payment_token !== undefined) {
        setParts.push(`payment_token = $${paramIndex++}`);
        values.push(updates.payment_token);
      }
      if (updates.fhir_patient_id !== undefined) {
        setParts.push(`fhir_patient_id = $${paramIndex++}`);
        values.push(updates.fhir_patient_id);
      }
      if (updates.fhir_encounter_id !== undefined) {
        setParts.push(`fhir_encounter_id = $${paramIndex++}`);
        values.push(updates.fhir_encounter_id);
      }
      if (updates.appointment_id !== undefined) {
        setParts.push(`appointment_id = $${paramIndex++}`);
        values.push(updates.appointment_id);
      }
      if (updates.payment_method !== undefined) {
        setParts.push(`payment_method = $${paramIndex++}`);
        values.push(updates.payment_method);
      }
      if (updates.customer_id !== undefined) {
        setParts.push(`customer_id = $${paramIndex++}`);
        values.push(updates.customer_id);
      }
      if (updates.triage_session_id !== undefined) {
        setParts.push(`triage_session_id = $${paramIndex++}`);
        values.push(updates.triage_session_id);
      }
      if (updates.status === 'completed') {
        setParts.push('completed_at = NOW()');
      }

      if (setParts.length === 0) return { changes: 0 };

      values.push(id);
      // SECURITY: Use parameterized query with template literal (safe)
      // The postgres library's template literal syntax automatically escapes values
      const query = `UPDATE voice_checkouts SET ${setParts.join(', ')} WHERE id = $${paramIndex}`;
      const result = await pgPool.unsafe(query, values);
      return { changes: result.count || 0 };
    } else {
      // SQLite path
      // Enforce payment lifecycle transitions (mvp-23)
      if (updates && updates.status !== undefined) {
        const existing = db.prepare('SELECT status FROM voice_checkouts WHERE id = ? LIMIT 1').get(id);
        const currentStatus = existing ? existing.status : null;
        if (currentStatus && !canTransitionCheckoutStatus(currentStatus, updates.status)) {
          throw new Error(`Invalid checkout status transition: ${currentStatus} -> ${updates.status}`);
        }
      }

      const fields = [];
      const values = [];

      if (updates.status) {
        fields.push('status = ?');
        values.push(updates.status);
      }
      if (updates.payment_intent_id) {
        fields.push('payment_intent_id = ?');
        values.push(updates.payment_intent_id);
      }
      if (updates.merchant_order_id) {
        fields.push('merchant_order_id = ?');
        values.push(updates.merchant_order_id);
      }
      if (updates.payment_token) {
        fields.push('payment_token = ?');
        values.push(updates.payment_token);
      }
      if (updates.fhir_patient_id) {
        fields.push('fhir_patient_id = ?');
        values.push(updates.fhir_patient_id);
      }
      if (updates.fhir_encounter_id) {
        fields.push('fhir_encounter_id = ?');
        values.push(updates.fhir_encounter_id);
      }
      if (updates.appointment_id !== undefined) {
        fields.push('appointment_id = ?');
        values.push(updates.appointment_id);
      }
      if (updates.payment_method) {
        fields.push('payment_method = ?');
        values.push(updates.payment_method);
      }
      if (updates.customer_id !== undefined) {
        fields.push('customer_id = ?');
        values.push(updates.customer_id);
      }
      if (updates.triage_session_id !== undefined) {
        fields.push('triage_session_id = ?');
        values.push(updates.triage_session_id);
      }
      if (updates.status === 'completed') {
        fields.push('completed_at = CURRENT_TIMESTAMP');
      }

      if (fields.length === 0) return { changes: 0 };

      values.push(id);
      const query = `UPDATE voice_checkouts SET ${fields.join(', ')} WHERE id = ?`;
      return db.prepare(query).run(...values);
    }
  },

  getAllVoiceCheckouts: async () => {
    if (usePostgres && pgPool) {
      return await pgPool`SELECT * FROM voice_checkouts ORDER BY created_at DESC`;
    } else {
      return db.prepare('SELECT * FROM voice_checkouts ORDER BY created_at DESC').all();
    }
  },

  getVoiceCheckoutsByMerchant: async (merchantId) => {
    if (usePostgres && pgPool) {
      return await pgPool`SELECT * FROM voice_checkouts WHERE merchant_id = ${merchantId} ORDER BY created_at DESC`;
    } else {
      return db.prepare('SELECT * FROM voice_checkouts WHERE merchant_id = ? ORDER BY created_at DESC').all(merchantId);
    }
  },

  // ============================================
  // PAYMENT RECEIPTS (patient portal)
  // ============================================
  createPaymentReceipt: (receipt) => {
    try {
      const { v4: uuidv4 } = require('uuid');
      const id = receipt.id || `rcpt_${uuidv4()}`;
      const metadata = receipt.metadata ? (typeof receipt.metadata === 'string' ? receipt.metadata : JSON.stringify(receipt.metadata)) : null;
      db.prepare(`
        INSERT OR IGNORE INTO payment_receipts
          (id, checkout_id, appointment_id, patient_id, patient_email, amount, currency, payment_method, external_payment_id, status, issued_at, metadata)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
      `).run(
        id,
        receipt.checkout_id || null,
        receipt.appointment_id || null,
        receipt.patient_id || null,
        receipt.patient_email || null,
        receipt.amount,
        receipt.currency || 'USD',
        receipt.payment_method || null,
        receipt.external_payment_id || null,
        receipt.status || 'issued',
        receipt.issued_at || null,
        metadata
      );
      return { success: true, id };
    } catch (e) {
      console.warn('createPaymentReceipt failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  getPaymentReceiptsForPatient: (patientId, patientEmail = null, limit = 50) => {
    try {
      const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
      if (patientId) {
        return db.prepare(`
          SELECT * FROM payment_receipts
          WHERE patient_id = ? AND deleted_at IS NULL
          ORDER BY issued_at DESC, created_at DESC
          LIMIT ?
        `).all(patientId, lim);
      }
      const email = (patientEmail || '').toLowerCase().trim();
      if (!email) return [];
      return db.prepare(`
        SELECT * FROM payment_receipts
        WHERE lower(patient_email) = ? AND deleted_at IS NULL
        ORDER BY issued_at DESC, created_at DESC
        LIMIT ?
      `).all(email, lim);
    } catch (e) {
      console.warn('getPaymentReceiptsForPatient failed:', e.message);
      return [];
    }
  },

  /**
   * Patient portal: combine payment_receipts with clinic invoices (draft/sent/etc.)
   * so wallet and dashboard show balances from PDF→claim→invoice flow.
   */
  getMergedReceiptsForPatient(patientId, patientEmail = null, limit = 50) {
    try {
      const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
      const receiptRows = this.getPaymentReceiptsForPatient
        ? this.getPaymentReceiptsForPatient(patientId, patientEmail, lim)
        : [];
      const asReceipts = (receiptRows || []).map((r) => ({ ...r, source: r.source || 'receipt' }));
      const invoiceExtras = [];
      if (patientId && typeof this.getInvoicesByPatient === 'function') {
        const seen = new Set();
        const variants = new Set([patientId]);
        if (typeof patientId === 'string') {
          if (patientId.startsWith('patient-')) variants.add(patientId.slice('patient-'.length));
          else variants.add(`patient-${patientId}`);
        }
        for (const pid of variants) {
          for (const inv of this.getInvoicesByPatient(pid)) {
            if (seen.has(inv.id)) continue;
            seen.add(inv.id);
            invoiceExtras.push({
              id: inv.id,
              source: 'invoice',
              amount: inv.amount,
              currency: 'USD',
              status: inv.status,
              issued_at: inv.created_at,
              created_at: inv.created_at,
              invoice_number: inv.invoice_number,
              due_date: inv.due_date || null
            });
          }
        }
      }
      const combined = [...asReceipts, ...invoiceExtras];
      combined.sort((a, b) => {
        const ta = new Date(a.issued_at || a.created_at || 0).getTime();
        const tb = new Date(b.issued_at || b.created_at || 0).getTime();
        return tb - ta;
      });
      return combined.slice(0, lim);
    } catch (e) {
      console.warn('getMergedReceiptsForPatient failed:', e.message);
      return this.getPaymentReceiptsForPatient
        ? this.getPaymentReceiptsForPatient(patientId, patientEmail, limit)
        : [];
    }
  },

  updatePaymentReceiptStatusByCheckoutId: (checkoutId, status, metadataPatch = null) => {
    if (!checkoutId || !status) return { changes: 0 };
    try {
      const existing = db.prepare(`SELECT metadata FROM payment_receipts WHERE checkout_id = ? LIMIT 1`).get(checkoutId);
      let merged = null;
      if (metadataPatch) {
        try {
          const cur = existing && existing.metadata ? (typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : existing.metadata) : {};
          merged = JSON.stringify({ ...(cur || {}), ...(metadataPatch || {}) });
        } catch (_) {
          merged = JSON.stringify(metadataPatch || {});
        }
      }
      if (merged != null) {
        return db.prepare(`
          UPDATE payment_receipts
          SET status = ?, metadata = ?, issued_at = COALESCE(issued_at, CURRENT_TIMESTAMP)
          WHERE checkout_id = ?
        `).run(status, merged, checkoutId);
      }
      return db.prepare(`
        UPDATE payment_receipts
        SET status = ?, issued_at = COALESCE(issued_at, CURRENT_TIMESTAMP)
        WHERE checkout_id = ?
      `).run(status, checkoutId);
    } catch (e) {
      console.warn('updatePaymentReceiptStatusByCheckoutId failed:', e.message);
      return { changes: 0 };
    }
  },

  /** Get most recent completed checkout for an appointment (for refund-on-cancel) */
  getCompletedCheckoutByAppointmentId: async (appointmentId) => {
    if (!appointmentId) return null;
    if (usePostgres && pgPool) {
      const results = await pgPool`
        SELECT * FROM voice_checkouts
        WHERE appointment_id = ${appointmentId} AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `;
      return results[0] || null;
    }
    return db.prepare(`
      SELECT * FROM voice_checkouts
      WHERE appointment_id = ? AND status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `).get(appointmentId);
  },

  /** Tasks 29–31: Get pending checkout and payment link for an appointment */
  getPendingCheckoutForAppointment: (appointmentId) => {
    if (!appointmentId) return null;
    try {
      const checkout = db.prepare(`
        SELECT vc.* FROM voice_checkouts vc
        WHERE vc.appointment_id = ? AND vc.status IN ('pending', 'completed')
        ORDER BY vc.created_at DESC LIMIT 1
      `).get(appointmentId);
      if (!checkout) return null;
      if (checkout.status === 'completed') return { checkout, payment_status: 'paid', payment_link: null };
      const tokenRow = db.prepare(`
        SELECT token FROM payment_tokens 
        WHERE checkout_id = ? AND status IN ('pending', 'verified')
        LIMIT 1
      `).get(checkout.id);
      if (!tokenRow) return { checkout, payment_status: 'pending', payment_link: null };
      const base = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
      return {
        checkout,
        payment_status: 'pending',
        payment_link: `${base.replace(/\/$/, '')}/payment/${tokenRow.token}`
      };
    } catch (_) {
      return null;
    }
  },

  // Wallet transactions
  async createWalletTransaction(tx) {
    const id = tx.id || require('uuid').v4();
    const payload = {
      id,
      customer_id: tx.customer_id,
      merchant_id: tx.merchant_id,
      type: tx.type,
      amount: tx.amount,
      currency: tx.currency || 'USDC',
      metadata: tx.metadata ? JSON.stringify(tx.metadata) : null
    };
    if (usePostgres && pgPool) {
      await pgPool`
        INSERT INTO wallet_transactions (id, customer_id, merchant_id, type, amount, currency, metadata, created_at)
        VALUES (${payload.id}, ${payload.customer_id}, ${payload.merchant_id}, ${payload.type}, ${payload.amount},
                ${payload.currency}, ${payload.metadata}, NOW())
      `;
      return { changes: 1, lastInsertRowid: id };
    }
    return db.prepare(`
      INSERT INTO wallet_transactions (id, customer_id, merchant_id, type, amount, currency, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.id,
      payload.customer_id,
      payload.merchant_id,
      payload.type,
      payload.amount,
      payload.currency,
      payload.metadata
    );
  },

  // ============================================
  // PATIENT EMERGENCY FLAGS (cross-channel safety)
  // ============================================
  upsertPatientEmergencyFlag: (payload) => {
    try {
      const id = payload.id || require('uuid').v4();
      const expiresAt = payload.expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const meta = payload.metadata ? JSON.stringify(payload.metadata) : (payload.metadata_json || null);
      db.prepare(`
        INSERT INTO patient_emergency_flags (id, patient_id, email, phone, source, call_id, expires_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        payload.patient_id || null,
        payload.email ? String(payload.email).toLowerCase().trim() : null,
        payload.phone || null,
        payload.source || 'voice',
        payload.call_id || null,
        expiresAt,
        meta
      );
      return { success: true, id, expires_at: expiresAt };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getActivePatientEmergencyFlag: (opts = {}) => {
    try {
      const nowIso = new Date().toISOString();
      const pid = opts.patient_id || null;
      const email = opts.email ? String(opts.email).toLowerCase().trim() : null;
      const phone = opts.phone || null;
      const row = db.prepare(`
        SELECT * FROM patient_emergency_flags
        WHERE cleared_at IS NULL
          AND expires_at > ?
          AND (
            (? IS NOT NULL AND patient_id = ?) OR
            (? IS NOT NULL AND LOWER(email) = LOWER(?)) OR
            (? IS NOT NULL AND phone = ?)
          )
        ORDER BY flagged_at DESC
        LIMIT 1
      `).get(nowIso, pid, pid, email, email, phone, phone);
      return row || null;
    } catch (_) {
      return null;
    }
  },

  async getWalletTransactions(customerId, merchantId, limit = 50) {
    if (!customerId || !merchantId) return [];
    if (usePostgres && pgPool) {
      const rows = await pgPool`
        SELECT * FROM wallet_transactions
        WHERE customer_id = ${customerId} AND merchant_id = ${merchantId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return rows;
    }
    return db.prepare(`
      SELECT * FROM wallet_transactions
      WHERE customer_id = ? AND merchant_id = ?
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(customerId, merchantId, limit);
  },

  async getWalletBalance(customerId, merchantId) {
    const txs = await db.getWalletTransactions(customerId, merchantId, 1000);
    let balance = 0;
    txs.forEach(tx => {
      if (tx.type === 'credit' || tx.type === 'refund') balance += tx.amount;
      if (tx.type === 'debit') balance -= tx.amount;
    });
    return balance;
  },

  // Voice Agent Settings
  getVoiceAgentSettings: (merchantId) => {
    if (!merchantId) return null;
    if (usePostgres && pgPool) {
      return pgPool`SELECT * FROM voice_agent_settings WHERE merchant_id = ${merchantId}`.then(res => res[0] || null);
    }
    return db.prepare('SELECT * FROM voice_agent_settings WHERE merchant_id = ?').get(merchantId);
  },

  upsertVoiceAgentSettings: (merchantId, settings = {}) => {
    if (!merchantId) throw new Error('merchantId is required');

    const payload = {
      retell_agent_id: settings.retell_agent_id || null,
      enabled: settings.enabled !== undefined ? (settings.enabled ? 1 : 0) : 1,
      greeting: settings.greeting || null,
      after_hours_message: settings.after_hours_message || null,
      business_hours: settings.business_hours ? JSON.stringify(settings.business_hours) : null
    };

    if (usePostgres && pgPool) {
      return pgPool`
        INSERT INTO voice_agent_settings (
          merchant_id, retell_agent_id, enabled, greeting, after_hours_message, business_hours, updated_at
        ) VALUES (
          ${merchantId},
          ${payload.retell_agent_id},
          ${payload.enabled},
          ${payload.greeting},
          ${payload.after_hours_message},
          ${payload.business_hours},
          NOW()
        )
        ON CONFLICT (merchant_id) DO UPDATE SET
          retell_agent_id = EXCLUDED.retell_agent_id,
          enabled = EXCLUDED.enabled,
          greeting = EXCLUDED.greeting,
          after_hours_message = EXCLUDED.after_hours_message,
          business_hours = EXCLUDED.business_hours,
          updated_at = NOW()
      `;
    }

    return db.prepare(`
      INSERT INTO voice_agent_settings (
        merchant_id, retell_agent_id, enabled, greeting, after_hours_message, business_hours, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(merchant_id) DO UPDATE SET
        retell_agent_id = excluded.retell_agent_id,
        enabled = excluded.enabled,
        greeting = excluded.greeting,
        after_hours_message = excluded.after_hours_message,
        business_hours = excluded.business_hours,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      merchantId,
      payload.retell_agent_id,
      payload.enabled,
      payload.greeting,
      payload.after_hours_message,
      payload.business_hours
    );
  },

  // ============================================
  // PAYMENT TOKENS
  // ============================================
  createPaymentToken: (token) => {
    return db.prepare(`
      INSERT INTO payment_tokens (token, checkout_id, verification_code, verification_code_expires, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      token.token,
      token.checkout_id,
      token.verification_code || null,
      token.verification_code_expires || null,
      token.status || 'pending'
    );
  },

  getPaymentToken: (token) => {
    return db.prepare('SELECT * FROM payment_tokens WHERE token = ?').get(token);
  },

  updatePaymentToken: (token, updates) => {
    const fields = [];
    const values = [];

    if (updates.status) {
      fields.push('status = ?');
      values.push(updates.status);
      if (updates.status === 'used') {
        fields.push('used_at = CURRENT_TIMESTAMP');
      }
    }
    if (updates.identity_verified_at !== undefined) {
      try {
        const info = db.prepare('PRAGMA table_info(payment_tokens)').all();
        if (info.some(c => c.name === 'identity_verified_at')) {
          fields.push('identity_verified_at = ?');
          values.push(updates.identity_verified_at);
        }
      } catch (_) {}
    }

    if (fields.length === 0) return;

    values.push(token);
    const query = `UPDATE payment_tokens SET ${fields.join(', ')} WHERE token = ?`;
    return db.prepare(query).run(...values);
  },

  cancelPaymentToken: (token) => {
    const row = db.prepare('SELECT status FROM payment_tokens WHERE token = ?').get(token);
    if (!row) return { success: false, error: 'Token not found' };
    if (row.status === 'used') return { success: false, error: 'Token already used' };
    db.prepare('UPDATE payment_tokens SET status = ? WHERE token = ?').run('cancelled', token);
    return { success: true };
  },

  /**
   * Atomically update payment token status (prevents race conditions)
   * Only updates if current status matches expectedStatus
   * @param {string} token - Payment token
   * @param {string} expectedStatus - Current status must match this
   * @param {string} newStatus - New status to set
   * @returns {Object} { success: boolean, error?: string, changes: number }
   */
  updatePaymentTokenAtomic: (token, expectedStatus, newStatus) => {
    // SECURITY: Atomic check-and-set to prevent race conditions
    // Only update if current status matches expected status
    const query = `
      UPDATE payment_tokens 
      SET status = ?, used_at = CURRENT_TIMESTAMP 
      WHERE token = ? AND status = ?
    `;
    const result = db.prepare(query).run(newStatus, token, expectedStatus);

    if (result.changes === 0) {
      // Check what the actual status is
      const tokenRecord = db.prepare('SELECT status FROM payment_tokens WHERE token = ?').get(token);
      if (!tokenRecord) {
        return { success: false, error: 'Token not found', changes: 0 };
      }
      if (tokenRecord.status === 'used') {
        return { success: false, error: 'Token already used', changes: 0 };
      }
      return { success: false, error: `Token status mismatch. Expected: ${expectedStatus}, Actual: ${tokenRecord.status}`, changes: 0 };
    }

    return { success: true, changes: result.changes };
  },

  // ============================================
  // FRAUD DETECTION
  // ============================================

  createFraudCheck: (check) => {
    return db.prepare(`
      INSERT INTO fraud_checks 
      (id, transaction_id, customer_phone, customer_email, merchant_id, agent_platform,
       risk_score, risk_level, signals, is_fraud, requires_verification)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      check.id,
      check.transaction_id,
      check.customer_phone,
      check.customer_email,
      check.merchant_id,
      check.agent_platform,
      check.risk_score,
      check.risk_level,
      check.signals,
      check.is_fraud ? 1 : 0,
      check.requires_verification ? 1 : 0
    );
  },

  getFraudCheck: (transactionId) => {
    return db.prepare('SELECT * FROM fraud_checks WHERE transaction_id = ?').get(transactionId);
  },

  getFraudChecksByCustomer: (phone, email) => {
    return db.prepare(
      'SELECT * FROM fraud_checks WHERE customer_phone = ? OR customer_email = ?'
    ).all(phone, email);
  },

  getAllFraudChecks: (limit = 100) => {
    return db.prepare('SELECT * FROM fraud_checks ORDER BY created_at DESC LIMIT ?').all(limit);
  },

  getHighRiskFraudChecks: () => {
    return db.prepare(
      'SELECT * FROM fraud_checks WHERE risk_score >= 80 AND reviewed = 0 ORDER BY created_at DESC'
    ).all();
  },

  updateFraudCheckReview: (id, reviewedBy, actionTaken) => {
    return db.prepare(`
      UPDATE fraud_checks 
      SET reviewed = 1, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, action_taken = ?
      WHERE id = ?
    `).run(reviewedBy, actionTaken, id);
  },

  // Blacklist
  addToBlacklist: (type, value, reason, addedBy = 'system') => {
    try {
      return db.prepare(`
        INSERT INTO fraud_blacklist (id, type, value, reason, added_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        require('crypto').randomBytes(16).toString('hex'),
        type,
        value,
        reason,
        addedBy
      );
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        return { changes: 0 };
      }
      throw error;
    }
  },

  removeFromBlacklist: (type, value) => {
    return db.prepare('DELETE FROM fraud_blacklist WHERE type = ? AND value = ?').run(type, value);
  },

  checkBlacklist: (type, value) => {
    return db.prepare('SELECT * FROM fraud_blacklist WHERE type = ? AND value = ?').get(type, value);
  },

  getAllBlacklisted: () => {
    return db.prepare('SELECT * FROM fraud_blacklist ORDER BY created_at DESC').all();
  },

  // Whitelist
  addToWhitelist: (type, value, addedBy = 'system') => {
    try {
      return db.prepare(`
        INSERT INTO fraud_whitelist (id, type, value, added_by)
        VALUES (?, ?, ?, ?)
      `).run(
        require('crypto').randomBytes(16).toString('hex'),
        type,
        value,
        addedBy
      );
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        return { changes: 0 };
      }
      throw error;
    }
  },

  removeFromWhitelist: (type, value) => {
    return db.prepare('DELETE FROM fraud_whitelist WHERE type = ? AND value = ?').run(type, value);
  },

  checkWhitelist: (type, value) => {
    return db.prepare('SELECT * FROM fraud_whitelist WHERE type = ? AND value = ?').get(type, value);
  },

  getAllWhitelisted: () => {
    return db.prepare('SELECT * FROM fraud_whitelist ORDER BY created_at DESC').all();
  },

  // Agent Stats
  getAgentStats: (platform) => {
    const stats = db.prepare('SELECT * FROM agent_stats WHERE platform = ?').get(platform);

    if (!stats) {
      return {
        total_transactions: 0,
        fraud_rate: 0,
        chargeback_rate: 0,
        success_rate: 0
      };
    }

    return {
      total_transactions: stats.total_transactions,
      fraud_rate: stats.total_transactions > 0 ? stats.fraud_count / stats.total_transactions : 0,
      chargeback_rate: stats.total_transactions > 0 ? stats.chargeback_count / stats.total_transactions : 0,
      success_rate: stats.total_transactions > 0 ? stats.success_count / stats.total_transactions : 0
    };
  },

  updateAgentStats: (platform, updates) => {
    const existing = db.prepare('SELECT * FROM agent_stats WHERE platform = ?').get(platform);

    if (!existing) {
      return db.prepare(`
        INSERT INTO agent_stats (platform, total_transactions, fraud_count, chargeback_count, success_count)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        platform,
        updates.total_transactions || 0,
        updates.fraud_count || 0,
        updates.chargeback_count || 0,
        updates.success_count || 0
      );
    }

    return db.prepare(`
      UPDATE agent_stats 
      SET total_transactions = total_transactions + ?,
          fraud_count = fraud_count + ?,
          chargeback_count = chargeback_count + ?,
          success_count = success_count + ?,
          last_updated = CURRENT_TIMESTAMP
      WHERE platform = ?
    `).run(
      updates.total_transactions || 0,
      updates.fraud_count || 0,
      updates.chargeback_count || 0,
      updates.success_count || 0,
      platform
    );
  },

  // Fraud Statistics
  getFraudStats: (timeframe = '24h') => {
    let sinceDate;
    const now = new Date();

    switch (timeframe) {
      case '1h':
        sinceDate = new Date(now - 60 * 60 * 1000);
        break;
      case '24h':
        sinceDate = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        sinceDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        sinceDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        sinceDate = new Date(now - 24 * 60 * 60 * 1000);
    }

    const checks = db.prepare(
      'SELECT * FROM fraud_checks WHERE created_at >= ?'
    ).all(sinceDate.toISOString());

    const total = checks.length;
    const blocked = checks.filter(c => c.is_fraud).length;
    const verified = checks.filter(c => c.requires_verification).length;
    const approved = checks.filter(c => !c.is_fraud && !c.requires_verification).length;

    const avgRiskScore = total > 0
      ? checks.reduce((sum, c) => sum + c.risk_score, 0) / total
      : 0;

    return {
      timeframe,
      total_checks: total,
      blocked_count: blocked,
      verification_required: verified,
      approved_count: approved,
      block_rate: total > 0 ? (blocked / total * 100).toFixed(2) : 0,
      avg_risk_score: avgRiskScore.toFixed(2),
      high_risk_count: checks.filter(c => c.risk_score >= 80).length,
      medium_risk_count: checks.filter(c => c.risk_score >= 50 && c.risk_score < 80).length,
      low_risk_count: checks.filter(c => c.risk_score < 50).length
    };
  },

  // ==========================================
  // FHIR RESOURCES - Healthcare Data Layer
  // ==========================================

  // Create FHIR Patient
  // RULE: Each patient must have a unique phone number (when phone is provided and not deleted)
  createFHIRPatient(patientResource) {
    const phone = patientResource.telecom?.find(t => t.system === 'phone')?.value;
    const email = patientResource.telecom?.find(t => t.system === 'email')?.value;
    const name = patientResource.name?.[0]
      ? `${patientResource.name[0].given?.join(' ')} ${patientResource.name[0].family}`.trim()
      : null;

    // RULE ENFORCEMENT: Check for duplicate phone number (phone is unique identifier)
    if (phone) {
      const existingPatient = db.prepare(`
        SELECT resource_id, name, phone FROM fhir_patients 
        WHERE phone = ? AND is_deleted = 0 
        LIMIT 1
      `).get(phone);

      if (existingPatient) {
        throw new Error(`Patient with phone number ${phone} already exists (Patient ID: ${existingPatient.resource_id}, Name: ${existingPatient.name || 'Unknown'}). Each patient must have a unique phone number.`);
      }
    }

    // CRITICAL: Verify patient ID doesn't already exist (defensive check)
    // Even though UUID v4 is unique, this provides additional safety
    const existingById = db.prepare(`
      SELECT resource_id, name, phone FROM fhir_patients 
      WHERE resource_id = ? AND is_deleted = 0 
      LIMIT 1
    `).get(patientResource.id);

    if (existingById) {
      throw new Error(`Patient with ID ${patientResource.id} already exists (Name: ${existingById.name || 'Unknown'}, Phone: ${existingById.phone || 'N/A'}). Patient IDs must be unique.`);
    }

    // Extract merchant_id from patientResource if provided (for tenant linking)
    const merchantId = patientResource.merchant_id || null;

    const stmt = db.prepare(`
      INSERT INTO fhir_patients (
        resource_id, resource_data, phone, email, name, merchant_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    try {
      return stmt.run(
        patientResource.id,
        JSON.stringify(patientResource),
        phone,
        email,
        name,
        merchantId
      );
    } catch (error) {
      // Check if error is due to unique constraint violation
      if (error.message && error.message.includes('UNIQUE constraint failed')) {
        if (phone && error.message.includes('phone')) {
          throw new Error(`Patient with phone number ${phone} already exists. Each patient must have a unique phone number.`);
        }
        if (error.message.includes('resource_id')) {
          // If we get here, it means the defensive check above didn't catch it (race condition)
          // Try to get the existing patient
          const existingPatient = db.prepare(`
            SELECT resource_id, name, phone FROM fhir_patients 
            WHERE resource_id = ? 
            LIMIT 1
          `).get(patientResource.id);

          if (existingPatient) {
            throw new Error(`Patient with ID ${patientResource.id} already exists (Name: ${existingPatient.name || 'Unknown'}, Phone: ${existingPatient.phone || 'N/A'}). Patient IDs must be unique.`);
          }
          throw new Error(`Patient with ID ${patientResource.id} already exists. Patient IDs must be unique.`);
        }
      }
      throw error;
    }
  },

  // Get FHIR Patient by ID
  getFHIRPatient(resourceId) {
    const stmt = db.prepare('SELECT * FROM fhir_patients WHERE resource_id = ? AND is_deleted = 0');
    const row = stmt.get(resourceId);
    if (!row) return null;
    return {
      ...row,
      resource_data: JSON.parse(row.resource_data)
    };
  },

  // Get FHIR Patient by Phone
  getFHIRPatientByPhone(phone) {
    const stmt = db.prepare('SELECT * FROM fhir_patients WHERE phone = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1');
    const row = stmt.get(phone);
    if (!row) return null;
    return {
      ...row,
      resource_data: JSON.parse(row.resource_data)
    };
  },

  // Get FHIR Patient by Email
  getFHIRPatientByEmail(email) {
    const stmt = db.prepare('SELECT * FROM fhir_patients WHERE email = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1');
    const row = stmt.get(email);
    if (!row) return null;
    return {
      ...row,
      resource_data: JSON.parse(row.resource_data)
    };
  },

  // Update FHIR Patient
  updateFHIRPatient(resourceId, patientResource) {
    const stmt = db.prepare(`
      UPDATE fhir_patients
      SET resource_data = ?,
          phone = ?,
          email = ?,
          name = ?,
          version_id = version_id + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE resource_id = ?
    `);

    const phone = patientResource.telecom?.find(t => t.system === 'phone')?.value;
    const email = patientResource.telecom?.find(t => t.system === 'email')?.value;
    const name = patientResource.name?.[0]
      ? `${patientResource.name[0].given?.join(' ')} ${patientResource.name[0].family}`.trim()
      : null;

    return stmt.run(
      JSON.stringify(patientResource),
      phone,
      email,
      name,
      resourceId
    );
  },

  updateFHIRPatientWallet(resourceId, walletAddress) {
    const tableInfo = db.prepare('PRAGMA table_info(fhir_patients)').all();
    if (!tableInfo.some(c => c.name === 'patient_wallet_address')) return;
    db.prepare('UPDATE fhir_patients SET patient_wallet_address = ?, updated_at = datetime("now") WHERE resource_id = ?').run(walletAddress, resourceId);
  },

  // Search FHIR Patients (Telemedicine Task 8: clinic_id limits to patients with appointments in that clinic)
  searchFHIRPatients(params = {}) {
    const hasClinicFilter = !!params.clinic_id;
    let query = hasClinicFilter
      ? 'SELECT DISTINCT p.* FROM fhir_patients p INNER JOIN appointments a ON a.patient_id = p.resource_id WHERE p.is_deleted = 0 AND a.clinic_id = ?'
      : 'SELECT * FROM fhir_patients WHERE is_deleted = 0';
    const queryParams = hasClinicFilter ? [params.clinic_id] : [];

    if (params.name) {
      // Search by name column (case-insensitive)
      query += ' AND (LOWER(name) LIKE LOWER(?) OR name LIKE ?)';
      const namePattern = `%${params.name}%`;
      queryParams.push(namePattern);
      queryParams.push(namePattern);
    }
    if (params.phone) {
      query += ' AND phone = ?';
      queryParams.push(params.phone);
    }
    if (params.email) {
      query += ' AND email = ?';
      queryParams.push(params.email);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    queryParams.push(params.limit || 50);

    const stmt = db.prepare(query);
    const rows = stmt.all(...queryParams);

    // Also search in resource_data JSON for name fields if name search didn't yield results
    let results = rows.map(row => ({
      ...row,
      resource_data: JSON.parse(row.resource_data)
    }));

    // If name search and no results, try searching in JSON
    if (params.name && results.length === 0) {
      const allPatients = db.prepare('SELECT * FROM fhir_patients WHERE is_deleted = 0 LIMIT 200').all();
      const nameLower = params.name.toLowerCase();
      results = allPatients
        .map(row => {
          try {
            const resourceData = JSON.parse(row.resource_data);
            const name = resourceData.name?.[0];
            if (name) {
              const given = (name.given || []).join(' ').toLowerCase();
              const family = (name.family || '').toLowerCase();
              const fullName = `${given} ${family}`.trim();
              if (fullName.includes(nameLower) || given.includes(nameLower) || family.includes(nameLower)) {
                return {
                  ...row,
                  resource_data: resourceData
                };
              }
            }
            return null;
          } catch (e) {
            return null;
          }
        })
        .filter(p => p !== null)
        .slice(0, params.limit || 50);
    }

    return results;
  },

  // Create FHIR Encounter (Voice Call Session)
  createFHIREncounter(encounterResource) {
    const stmt = db.prepare(`
      INSERT INTO fhir_encounters (
        resource_id, resource_data, patient_id, status, call_id, start_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const patientId = encounterResource.subject?.reference?.replace('Patient/', '');
    const callId = encounterResource.extension?.find(
      e => e.url === 'https://doclittle.health/extension/voice-call-id'
    )?.valueString;

    return stmt.run(
      encounterResource.id,
      JSON.stringify(encounterResource),
      patientId,
      encounterResource.status,
      callId,
      encounterResource.period?.start
    );
  },

  // Get FHIR Encounter by ID
  getFHIREncounter(resourceId) {
    const stmt = db.prepare('SELECT * FROM fhir_encounters WHERE resource_id = ? AND is_deleted = 0');
    const row = stmt.get(resourceId);
    if (!row) return null;
    return {
      ...row,
      resource_data: JSON.parse(row.resource_data)
    };
  },

  // Get FHIR Encounter by Call ID
  getFHIREncounterByCallId(callId) {
    const stmt = db.prepare('SELECT * FROM fhir_encounters WHERE call_id = ? AND is_deleted = 0');
    const row = stmt.get(callId);
    if (!row) return null;
    return {
      ...row,
      resource_data: JSON.parse(row.resource_data)
    };
  },

  // Update FHIR Encounter
  updateFHIREncounter(resourceId, encounterResource) {
    const stmt = db.prepare(`
      UPDATE fhir_encounters
      SET resource_data = ?,
          status = ?,
          end_time = ?,
          version_id = version_id + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE resource_id = ?
    `);

    return stmt.run(
      JSON.stringify(encounterResource),
      encounterResource.status,
      encounterResource.period?.end,
      resourceId
    );
  },

  // Get Patient Encounters
  getPatientEncounters(patientId, limit = 20) {
    const stmt = db.prepare(`
      SELECT * FROM fhir_encounters
      WHERE patient_id = ? AND is_deleted = 0
      ORDER BY start_time DESC
      LIMIT ?
    `);
    const rows = stmt.all(patientId, limit);

    return rows.map(row => ({
      ...row,
      resource_data: JSON.parse(row.resource_data)
    }));
  },

  // Create FHIR Communication (Transcript)
  createFHIRCommunication(communicationResource) {
    const stmt = db.prepare(`
      INSERT INTO fhir_communications (
        resource_id, resource_data, patient_id, encounter_id, sent_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const patientId = communicationResource.subject?.reference?.replace('Patient/', '');
    const encounterId = communicationResource.encounter?.reference?.replace('Encounter/', '');

    return stmt.run(
      communicationResource.id,
      JSON.stringify(communicationResource),
      patientId,
      encounterId,
      communicationResource.sent
    );
  },

  // Get FHIR Communication by ID
  getFHIRCommunication(resourceId) {
    const stmt = db.prepare('SELECT * FROM fhir_communications WHERE resource_id = ? AND is_deleted = 0');
    const row = stmt.get(resourceId);
    if (!row) return null;
    return {
      ...row,
      resource_data: JSON.parse(row.resource_data)
    };
  },

  // Get Encounter Communications
  getEncounterCommunications(encounterId) {
    const stmt = db.prepare(`
      SELECT * FROM fhir_communications
      WHERE encounter_id = ? AND is_deleted = 0
      ORDER BY sent_time ASC
    `);
    const rows = stmt.all(encounterId);

    return rows.map(row => ({
      ...row,
      resource_data: JSON.parse(row.resource_data)
    }));
  },

  // Create FHIR Observation (Assessment)
  createFHIRObservation(observationResource) {
    const stmt = db.prepare(`
      INSERT INTO fhir_observations (
        resource_id, resource_data, patient_id, encounter_id, code, value, effective_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const patientId = observationResource.subject?.reference?.replace('Patient/', '');
    const encounterId = observationResource.encounter?.reference?.replace('Encounter/', '');
    const code = observationResource.code?.coding?.[0]?.code;
    const value = observationResource.valueInteger || observationResource.valueString;

    return stmt.run(
      observationResource.id,
      JSON.stringify(observationResource),
      patientId,
      encounterId,
      code,
      JSON.stringify(value),
      observationResource.effectiveDateTime
    );
  },

  // Get Patient Observations
  getPatientObservations(patientId, limit = 50) {
    const stmt = db.prepare(`
      SELECT * FROM fhir_observations
      WHERE patient_id = ? AND is_deleted = 0
      ORDER BY effective_date DESC
      LIMIT ?
    `);
    const rows = stmt.all(patientId, limit);

    return rows.map(row => ({
      ...row,
      resource_data: JSON.parse(row.resource_data),
      value: JSON.parse(row.value)
    }));
  },

  // Create FHIR DiagnosticReport (vc-p0-1: video consult AI assessment)
  createFHIRDiagnosticReport(reportResource) {
    const tableInfo = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all();
    if (tableInfo.length === 0) return null;
    const patientId = reportResource.subject?.reference?.replace('Patient/', '');
    const encounterId = reportResource.encounter?.reference?.replace('Encounter/', '');
    const hasStatus = tableInfo.some(c => c.name === 'status');
    const hasJobId = tableInfo.some(c => c.name === 'job_id');
    if (hasStatus && hasJobId) {
      db.prepare(`
        INSERT INTO fhir_diagnostic_reports (resource_id, resource_data, patient_id, encounter_id, effective_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'final', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        reportResource.id,
        JSON.stringify(reportResource),
        patientId,
        encounterId,
        reportResource.effectiveDateTime || reportResource.issued
      );
    } else {
      db.prepare(`
        INSERT INTO fhir_diagnostic_reports (resource_id, resource_data, patient_id, encounter_id, effective_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        reportResource.id,
        JSON.stringify(reportResource),
        patientId,
        encounterId,
        reportResource.effectiveDateTime || reportResource.issued
      );
    }
    return reportResource.id;
  },

  // -------- Phase 7: Case report pending row + update by job_id --------
  insertPendingCaseReport(row) {
    const tableInfo = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all();
    const hasStatus = tableInfo.some(c => c.name === 'status');
    const hasJobId = tableInfo.some(c => c.name === 'job_id');
    if (!hasStatus || !hasJobId) return null;
    try {
      if (!tableInfo.some(c => c.name === 'retry_of_job_id')) {
        db.exec(`ALTER TABLE fhir_diagnostic_reports ADD COLUMN retry_of_job_id TEXT`);
      }
      if (!tableInfo.some(c => c.name === 'appointment_id')) {
        db.exec(`ALTER TABLE fhir_diagnostic_reports ADD COLUMN appointment_id TEXT`);
      }
    } catch (_) {}
    const resourceId = `pending-${row.job_id}`;
    const hasRetry = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all().some(c => c.name === 'retry_of_job_id');
    const hasApptId = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all().some(c => c.name === 'appointment_id');
    if (hasRetry && hasApptId) {
      db.prepare(`
        INSERT INTO fhir_diagnostic_reports (resource_id, resource_data, patient_id, encounter_id, effective_date, status, job_id, retry_of_job_id, appointment_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), 'pending', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(resourceId, '{}', row.patient_id, row.encounter_id || null, row.job_id, row.retry_of_job_id || null, row.appointment_id || null);
    } else if (hasRetry) {
      db.prepare(`
        INSERT INTO fhir_diagnostic_reports (resource_id, resource_data, patient_id, encounter_id, effective_date, status, job_id, retry_of_job_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), 'pending', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(resourceId, '{}', row.patient_id, row.encounter_id || null, row.job_id, row.retry_of_job_id || null);
    } else if (hasApptId) {
      db.prepare(`
        INSERT INTO fhir_diagnostic_reports (resource_id, resource_data, patient_id, encounter_id, effective_date, status, job_id, appointment_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), 'pending', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(resourceId, '{}', row.patient_id, row.encounter_id || null, row.job_id, row.appointment_id || null);
    } else {
      db.prepare(`
        INSERT INTO fhir_diagnostic_reports (resource_id, resource_data, patient_id, encounter_id, effective_date, status, job_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(resourceId, '{}', row.patient_id, row.encounter_id || null, row.job_id);
    }
    return row.job_id;
  },
  getPendingCaseReportsOlderThanMs(ageMs) {
    try {
      const tableInfo = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all();
      if (!tableInfo.some(c => c.name === 'job_id') || !tableInfo.some(c => c.name === 'status')) return [];
      const cutoff = new Date(Date.now() - ageMs).toISOString().slice(0, 19).replace('T', ' ');
      return db.prepare(`
        SELECT * FROM fhir_diagnostic_reports
        WHERE status = 'pending' AND created_at < ?
        ORDER BY created_at ASC
      `).all(cutoff);
    } catch (e) {
      return [];
    }
  },
  hasRetryForJobId(jobId) {
    try {
      const tableInfo = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all();
      if (!tableInfo.some(c => c.name === 'retry_of_job_id')) return false;
      const row = db.prepare('SELECT 1 FROM fhir_diagnostic_reports WHERE retry_of_job_id = ? LIMIT 1').get(jobId);
      return !!row;
    } catch (_) {
      return false;
    }
  },
  getTimedOutCaseReportsReadyForRetry(olderThanMs) {
    try {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString().slice(0, 19).replace('T', ' ');
      return db.prepare(`
        SELECT * FROM fhir_diagnostic_reports
        WHERE status = 'failed' AND error_message LIKE 'Callback timeout%' AND created_at < ?
        ORDER BY created_at ASC
      `).all(cutoff);
    } catch (_) {
      return [];
    }
  },
  getCaseReportByJobId(jobId) {
    try {
      const tableInfo = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all();
      if (!tableInfo.some(c => c.name === 'job_id')) return null;
      return db.prepare('SELECT * FROM fhir_diagnostic_reports WHERE job_id = ? LIMIT 1').get(jobId);
    } catch (e) {
      return null;
    }
  },
  updateCaseReportByJobId(jobId, updates) {
    const tableInfo = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all();
    const cols = [];
    const vals = [];
    if (updates.status != null) { cols.push('status = ?'); vals.push(updates.status); }
    if (updates.case_report_text != null) { cols.push('case_report_text = ?'); vals.push(updates.case_report_text); }
    if (updates.reasoning_chain != null) {
      cols.push('reasoning_chain = ?');
      vals.push(typeof updates.reasoning_chain === 'string' ? updates.reasoning_chain : JSON.stringify(updates.reasoning_chain || {}));
    }
    if (updates.error_message != null) { cols.push('error_message = ?'); vals.push(updates.error_message); }
    if (updates.resource_id != null) { cols.push('resource_id = ?'); vals.push(updates.resource_id); }
    if (updates.resource_data != null) { cols.push('resource_data = ?'); vals.push(typeof updates.resource_data === 'string' ? updates.resource_data : JSON.stringify(updates.resource_data || {})); }
    if (cols.length === 0) return null;
    vals.push(jobId);
    db.prepare(`UPDATE fhir_diagnostic_reports SET ${cols.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?`).run(...vals);
    return db.prepare('SELECT * FROM fhir_diagnostic_reports WHERE job_id = ? LIMIT 1').get(jobId);
  },

  // -------- Phase 8: DiagnosticReport read by encounter / patient --------
  getDiagnosticReportByEncounterId(encounterId) {
    try {
      const row = db.prepare('SELECT * FROM fhir_diagnostic_reports WHERE encounter_id = ? AND (status IS NULL OR status = ? OR status = ?) ORDER BY created_at DESC LIMIT 1').get(encounterId, 'final', 'completed');
      return row ? { ...row, resource_data: row.resource_data ? JSON.parse(row.resource_data) : null } : null;
    } catch (e) {
      return null;
    }
  },
  getDiagnosticReportsByPatientId(patientId, limit = 50) {
    try {
      const rows = db.prepare('SELECT * FROM fhir_diagnostic_reports WHERE patient_id = ? ORDER BY created_at DESC LIMIT ?').all(patientId, limit);
      return rows.map(r => ({ ...r, resource_data: r.resource_data ? JSON.parse(r.resource_data) : null }));
    } catch (e) {
      return [];
    }
  },

  getDiagnosticReportById(resourceId) {
    try {
      if (!resourceId) return null;
      const row = db.prepare('SELECT * FROM fhir_diagnostic_reports WHERE resource_id = ? LIMIT 1').get(resourceId);
      return row ? { ...row, resource_data: row.resource_data ? JSON.parse(row.resource_data) : null } : null;
    } catch (_) {
      return null;
    }
  },

  // ============================================
  // FHIR DocumentReference (portal documents)
  // ============================================
  createFHIRDocumentReference(docRefResource) {
    try {
      const patientId = docRefResource.subject?.reference?.replace('Patient/', '') || null;
      const encounterId =
        (docRefResource.context?.encounter?.[0]?.reference || '').replace(/^Encounter\//, '') || null;
      const date = docRefResource.date || new Date().toISOString();
      db.prepare(`
        INSERT OR REPLACE INTO fhir_document_references
          (resource_id, resource_data, patient_id, encounter_id, date, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        docRefResource.id,
        JSON.stringify(docRefResource),
        patientId,
        encounterId,
        date,
        docRefResource.status || 'current'
      );
      return docRefResource.id;
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },

  getFHIRDocumentReference(resourceId) {
    try {
      if (!resourceId) return null;
      const row = db.prepare(`
        SELECT * FROM fhir_document_references
        WHERE resource_id = ? AND is_deleted = 0
        LIMIT 1
      `).get(resourceId);
      if (!row) return null;
      return { ...row, resource_data: row.resource_data ? JSON.parse(row.resource_data) : null };
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },

  getFHIRDocumentReferencesByPatientId(patientId, limit = 200) {
    try {
      if (!patientId) return [];
      const rows = db.prepare(`
        SELECT * FROM fhir_document_references
        WHERE patient_id = ? AND is_deleted = 0
        ORDER BY datetime(date) DESC, created_at DESC
        LIMIT ?
      `).all(patientId, limit);
      return rows.map(r => ({ ...r, resource_data: r.resource_data ? JSON.parse(r.resource_data) : null }));
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return [];
    }
  },

  // ============================================
  // FHIR Provenance + Consent (compliance expectations)
  // ============================================
  createFHIRProvenance(provResource) {
    try {
      const patientId = provResource.patient?.reference?.replace('Patient/', '') ||
        provResource.target?.[0]?.reference?.replace(/^Patient\//, '') ||
        null;
      const target = (provResource.target && provResource.target[0] && provResource.target[0].reference) || '';
      const [targetType, targetId] = target.includes('/') ? target.split('/') : [null, null];
      db.prepare(`
        INSERT OR REPLACE INTO fhir_provenance
          (resource_id, resource_data, patient_id, target_resource_type, target_resource_id, recorded_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        provResource.id,
        JSON.stringify(provResource),
        patientId,
        targetType,
        targetId,
        provResource.recorded || new Date().toISOString()
      );
      return provResource.id;
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },

  createFHIRConsent(consentResource) {
    try {
      const patientId = consentResource.patient?.reference?.replace('Patient/', '') || null;
      const scopeCode = consentResource.scope?.coding?.[0]?.code || null;
      const categoryCode = consentResource.category?.[0]?.coding?.[0]?.code || null;
      db.prepare(`
        INSERT OR REPLACE INTO fhir_consents
          (resource_id, resource_data, patient_id, status, scope_code, category_code, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        consentResource.id,
        JSON.stringify(consentResource),
        patientId,
        consentResource.status || null,
        scopeCode,
        categoryCode
      );
      return consentResource.id;
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },

  // ============================================
  // Bulk export jobs (FHIR Bulk Data)
  // ============================================
  createFhirBulkExportJob(job) {
    try {
      db.prepare(`
        INSERT INTO fhir_bulk_export_jobs
          (id, requester_scope, requester_sub, patient_id, status, since, types, output_base_url, error, started_at, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        job.id,
        job.requester_scope || null,
        job.requester_sub || null,
        job.patient_id || null,
        job.status || 'in-progress',
        job.since || null,
        job.types || null,
        job.output_base_url || null,
        job.error || null,
        job.started_at || new Date().toISOString(),
        job.completed_at || null
      );
      return job.id;
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },

  getFhirBulkExportJob(jobId) {
    try {
      if (!jobId) return null;
      return db.prepare('SELECT * FROM fhir_bulk_export_jobs WHERE id = ? LIMIT 1').get(jobId) || null;
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },

  updateFhirBulkExportJob(jobId, updates) {
    try {
      const cols = [];
      const vals = [];
      for (const [k, v] of Object.entries(updates || {})) {
        cols.push(`${k} = ?`);
        vals.push(v);
      }
      if (!cols.length) return null;
      vals.push(jobId);
      db.prepare(`UPDATE fhir_bulk_export_jobs SET ${cols.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals);
      return db.prepare('SELECT * FROM fhir_bulk_export_jobs WHERE id = ? LIMIT 1').get(jobId) || null;
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },

  // -------- Telemedicine Phase 2: patient_uploads (Task 14) --------
  createPatientUpload(row) {
    try {
      db.prepare(`
        INSERT INTO patient_uploads (id, patient_id, appointment_id, encounter_id, filename, storage_path, file_type, mime_type, size_bytes, source, uploaded_at, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.patient_id,
        row.appointment_id || null,
        row.encounter_id || null,
        row.filename,
        row.storage_path,
        row.file_type || null,
        row.mime_type || null,
        row.size_bytes || null,
        row.source || 'portal',
        row.uploaded_at || null,
        row.uploaded_by || null
      );
      return row.id;
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },
  getPatientUploadsByPatient(patientId, appointmentId = null) {
    try {
      if (appointmentId) {
        return db.prepare('SELECT * FROM patient_uploads WHERE patient_id = ? AND appointment_id = ? ORDER BY uploaded_at DESC').all(patientId, appointmentId);
      }
      return db.prepare('SELECT * FROM patient_uploads WHERE patient_id = ? ORDER BY uploaded_at DESC').all(patientId);
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return [];
    }
  },

  // -------- Telemedicine Phase 2: upload_tokens (Task 15) --------
  createUploadToken(row) {
    try {
      db.prepare(`
        INSERT INTO upload_tokens (token, patient_id, appointment_id, expires_at, used, max_files, max_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.token,
        row.patient_id,
        row.appointment_id || null,
        row.expires_at,
        row.used ?? 0,
        row.max_files ?? 10,
        row.max_bytes ?? 52428800
      );
      return row.token;
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },
  getUploadToken(token) {
    try {
      return db.prepare('SELECT * FROM upload_tokens WHERE token = ?').get(token);
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },
  markUploadTokenUsed(token) {
    try {
      return db.prepare('UPDATE upload_tokens SET used = 1 WHERE token = ?').run(token);
    } catch (e) {
      if (!e.message?.includes('no such table')) throw e;
      return null;
    }
  },

  // Create FHIR Audit Log
  createFHIRAuditLog(action, resourceType, resourceId, userId, ipAddress, userAgent) {
    const stmt = db.prepare(`
      INSERT INTO fhir_audit_log (
        action, resource_type, resource_id, user_id, ip_address, user_agent, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(action, resourceType, resourceId, userId, ipAddress, userAgent);
    // Section 12: Also log to HIPAA access log for PHI access audit (patient_id when resource is Patient)
    try {
      this.logHipaaAccess({ user_id: userId, resource_type: resourceType, resource_id: resourceId, patient_id: resourceType === 'Patient' ? resourceId : null, action, ip_address: ipAddress });
    } catch (_) {}
    return result;
  },

  logHipaaAccess({ user_id, resource_type, resource_id, patient_id, action, ip_address }) {
    try {
      const id = require('crypto').randomBytes(16).toString('hex');
      const cols = ['id', 'user_id', 'resource_type', 'resource_id', 'action', 'ip_address'];
      const vals = [id, user_id || null, resource_type || 'unknown', resource_id || null, action || 'unknown', ip_address || null];
      const hasPatientId = db.prepare('PRAGMA table_info(hipaa_access_log)').all().some(c => c.name === 'patient_id');
      if (hasPatientId) {
        cols.push('patient_id');
        vals.push(patient_id || (resource_type === 'Patient' ? resource_id : null));
      }
      db.prepare(`INSERT INTO hipaa_access_log (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
    } catch (_) {}
  },

  // Get Audit Logs
  getFHIRAuditLogs(params = {}) {
    let query = 'SELECT * FROM fhir_audit_log WHERE 1=1';
    const queryParams = [];

    if (params.resourceType) {
      query += ' AND resource_type = ?';
      queryParams.push(params.resourceType);
    }
    if (params.resourceId) {
      query += ' AND resource_id = ?';
      queryParams.push(params.resourceId);
    }
    if (params.userId) {
      query += ' AND user_id = ?';
      queryParams.push(params.userId);
    }
    if (params.startDate) {
      query += ' AND timestamp >= ?';
      queryParams.push(params.startDate);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    queryParams.push(params.limit || 100);

    const stmt = db.prepare(query);
    return stmt.all(...queryParams);
  },

  // ============================================
  // USER MANAGEMENT
  // ============================================

  // Create user
  createUser(user) {
    const stmt = db.prepare(`
      INSERT INTO users (
        id, email, password_hash, name, role, merchant_id, picture, auth_method, google_id, clinic_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      user.id,
      user.email,
      user.password_hash || null,
      user.name,
      user.role || 'healthcare_provider',
      user.merchant_id || null,
      user.picture || null,
      user.auth_method || 'email',
      user.google_id || null,
      user.clinic_id || null
    );
  },

  // Get user by email
  getUserByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1');
    return stmt.get(email);
  },

  // Get user by ID
  getUserById(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1');
    return stmt.get(id);
  },

  // ============================================
  // CLINICS (MULTI-TENANT)
  // ============================================

  // Create clinic
  async createClinic(clinic) {
    if (usePostgres && pgPool) {
      // Postgres path
      await pgPool`
        INSERT INTO clinics (
          clinic_id, name, slug, phone_number, email, retell_agent_id, retell_agent_status,
          merchant_id, address, business_hours, services, is_active, created_at, updated_at
        ) VALUES (
          ${clinic.clinic_id},
          ${clinic.name},
          ${clinic.slug},
          ${clinic.phone_number || null},
          ${clinic.email || null},
          ${clinic.retell_agent_id || null},
          ${clinic.retell_agent_status || 'pending'},
          ${clinic.merchant_id || null},
          ${clinic.address || null},
          ${clinic.business_hours || null},
          ${toJsonValue(clinic.services)},
          ${toBoolean(clinic.is_active !== undefined ? clinic.is_active : 1)},
          ${clinic.created_at || new Date().toISOString()},
          ${clinic.updated_at || new Date().toISOString()}
        )
      `;
      return { changes: 1, lastInsertRowid: clinic.clinic_id };
    } else {
      // SQLite path
      const stmt = db.prepare(`
        INSERT INTO clinics (
          clinic_id, name, slug, phone_number, email, retell_agent_id, retell_agent_status,
          merchant_id, address, business_hours, services, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        clinic.clinic_id,
        clinic.name,
        clinic.slug,
        clinic.phone_number || null,
        clinic.email || null,
        clinic.retell_agent_id || null,
        clinic.retell_agent_status || 'pending',
        clinic.merchant_id || null,
        clinic.address || null,
        clinic.business_hours || null,
        clinic.services || null,
        clinic.is_active !== undefined ? clinic.is_active : 1
      );
    }
  },

  // Get clinic by ID
  async getClinicById(id) {
    if (usePostgres && pgPool) {
      const results = await pgPool`SELECT * FROM clinics WHERE clinic_id = ${id}`;
      return results[0] || null;
    } else {
      const stmt = db.prepare('SELECT * FROM clinics WHERE clinic_id = ?');
      return stmt.get(id);
    }
  },

  // Get clinic by slug
  async getClinicBySlug(slug) {
    if (usePostgres && pgPool) {
      const results = await pgPool`SELECT * FROM clinics WHERE slug = ${slug}`;
      return results[0] || null;
    } else {
      const stmt = db.prepare('SELECT * FROM clinics WHERE slug = ?');
      return stmt.get(slug);
    }
  },

  // Get clinic by phone number
  async getClinicByPhoneNumber(phoneNumber) {
    if (usePostgres && pgPool) {
      const results = await pgPool`SELECT * FROM clinics WHERE phone_number = ${phoneNumber} AND is_active = true`;
      return results[0] || null;
    } else {
      const stmt = db.prepare('SELECT * FROM clinics WHERE phone_number = ? AND is_active = 1');
      return stmt.get(phoneNumber);
    }
  },

  // Update clinic
  updateClinic(id, updates) {
    const fields = [];
    const values = [];

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) return null;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`UPDATE clinics SET ${fields.join(', ')} WHERE clinic_id = ?`);
    const result = stmt.run(...values);
    if (pgPool && result.changes) {
      const updatedClinic = db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(id);
      syncClinicToPostgres(updatedClinic);
    }
    return result;
  },

  // Create clinic phone number
  createClinicPhoneNumber(phoneData) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO clinic_phone_numbers (
        phone_number, clinic_id, is_primary
      ) VALUES (?, ?, ?)
    `);
    const result = stmt.run(
      phoneData.phone_number,
      phoneData.clinic_id,
      phoneData.is_primary !== undefined ? phoneData.is_primary : 1
    );
    if (pgPool) {
      const phoneRow = db.prepare('SELECT * FROM clinic_phone_numbers WHERE phone_number = ?').get(phoneData.phone_number);
      syncClinicPhoneToPostgres(phoneRow);
    }
    return result;
  },

  // Get clinic phone number by phone
  getClinicPhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    const normalized = normalizePhoneNumber(phoneNumber);
    const digitsOnly = String(phoneNumber).replace(/\D/g, '');
    const plusDigits = digitsOnly ? `+${digitsOnly}` : null;
    const plusOneDigits = digitsOnly && digitsOnly.length === 10 ? `+1${digitsOnly}` : null;

    const candidates = Array.from(
      new Set(
        [phoneNumber, normalized, digitsOnly, plusDigits, plusOneDigits]
          .filter((v) => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      )
    );

    const placeholders = candidates.map(() => '?').join(', ');
    const stmt = db.prepare(`
      SELECT cpn.*, c.name as clinic_name, c.slug as clinic_slug
      FROM clinic_phone_numbers cpn
      JOIN clinics c ON cpn.clinic_id = c.clinic_id
      WHERE cpn.phone_number IN (${placeholders}) AND c.is_active = 1
      LIMIT 1
    `);
    return stmt.get(...candidates);
  },

  // Get all phone numbers for a clinic
  getClinicPhoneNumbers(clinicId) {
    const stmt = db.prepare(`
      SELECT * FROM clinic_phone_numbers
      WHERE clinic_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(clinicId);
  },

  // ============================================
  // STRIPE ISSUING: CARDHOLDERS AND CARDS
  // ============================================

  // Create Stripe cardholder
  createStripeCardholder(cardholder) {
    const stmt = db.prepare(`
      INSERT INTO stripe_cardholders (
        id, patient_id, clinic_id, stripe_cardholder_id, type, name, email, phone,
        billing_address, status, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      cardholder.id,
      cardholder.patient_id,
      cardholder.clinic_id || null,
      cardholder.stripe_cardholder_id,
      cardholder.type || 'individual',
      cardholder.name,
      cardholder.email || null,
      cardholder.phone || null,
      cardholder.billing_address ? JSON.stringify(cardholder.billing_address) : null,
      cardholder.status || 'active',
      cardholder.metadata ? JSON.stringify(cardholder.metadata) : null
    );
  },

  // Get cardholder by patient ID
  getCardholderByPatientId(patientId) {
    const stmt = db.prepare(`
      SELECT * FROM stripe_cardholders
      WHERE patient_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(patientId);
  },

  // Get cardholder by Stripe ID
  getCardholderByStripeId(stripeCardholderId) {
    const stmt = db.prepare('SELECT * FROM stripe_cardholders WHERE stripe_cardholder_id = ?');
    return stmt.get(stripeCardholderId);
  },

  // Create Stripe card
  createStripeCard(card) {
    const stmt = db.prepare(`
      INSERT INTO stripe_cards (
        id, patient_id, clinic_id, cardholder_id, stripe_card_id, type, currency,
        status, last4, brand, expiry_month, expiry_year, spending_controls, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      card.id,
      card.patient_id,
      card.clinic_id || null,
      card.cardholder_id,
      card.stripe_card_id,
      card.type || 'virtual',
      card.currency || 'usd',
      card.status || 'active',
      card.last4 || null,
      card.brand || null,
      card.expiry_month || null,
      card.expiry_year || null,
      card.spending_controls ? JSON.stringify(card.spending_controls) : null,
      card.metadata ? JSON.stringify(card.metadata) : null
    );
  },

  // Get cards by patient ID
  getCardsByPatientId(patientId) {
    const stmt = db.prepare(`
      SELECT c.*, ch.name as cardholder_name, ch.email as cardholder_email
      FROM stripe_cards c
      JOIN stripe_cardholders ch ON c.cardholder_id = ch.id
      WHERE c.patient_id = ? AND c.status = 'active'
      ORDER BY c.created_at DESC
    `);
    const cards = stmt.all(patientId);
    // Parse JSON fields
    return cards.map(card => ({
      ...card,
      spending_controls: card.spending_controls ? JSON.parse(card.spending_controls) : null,
      metadata: card.metadata ? JSON.parse(card.metadata) : null
    }));
  },

  // Get card by Stripe ID
  getCardByStripeId(stripeCardId) {
    const stmt = db.prepare('SELECT * FROM stripe_cards WHERE stripe_card_id = ?');
    const card = stmt.get(stripeCardId);
    if (!card) return null;
    // Parse JSON fields
    return {
      ...card,
      spending_controls: card.spending_controls ? JSON.parse(card.spending_controls) : null,
      metadata: card.metadata ? JSON.parse(card.metadata) : null
    };
  },

  // Get card by ID
  getCardById(cardId) {
    const stmt = db.prepare('SELECT * FROM stripe_cards WHERE id = ?');
    const card = stmt.get(cardId);
    if (!card) return null;
    // Parse JSON fields
    return {
      ...card,
      spending_controls: card.spending_controls ? JSON.parse(card.spending_controls) : null,
      metadata: card.metadata ? JSON.parse(card.metadata) : null
    };
  },

  // Update card status
  updateCardStatus(cardId, status) {
    const stmt = db.prepare(`
      UPDATE stripe_cards
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(status, cardId);
  },

  // Update card spending controls
  updateCardSpendingControls(cardId, spendingControls) {
    const stmt = db.prepare(`
      UPDATE stripe_cards
      SET spending_controls = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(JSON.stringify(spendingControls), cardId);
  },

  // Create card transaction
  createCardTransaction(transaction) {
    const stmt = db.prepare(`
      INSERT INTO stripe_card_transactions (
        id, card_id, patient_id, clinic_id, stripe_transaction_id, amount, currency,
        merchant_name, merchant_category, status, authorization_code, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      transaction.id,
      transaction.card_id,
      transaction.patient_id,
      transaction.clinic_id || null,
      transaction.stripe_transaction_id,
      transaction.amount,
      transaction.currency || 'usd',
      transaction.merchant_name || null,
      transaction.merchant_category || null,
      transaction.status || null,
      transaction.authorization_code || null,
      transaction.metadata ? JSON.stringify(transaction.metadata) : null
    );
  },

  // Get transactions by card ID
  getTransactionsByCardId(cardId) {
    const stmt = db.prepare(`
      SELECT * FROM stripe_card_transactions
      WHERE card_id = ?
      ORDER BY created_at DESC
    `);
    const transactions = stmt.all(cardId);
    // Parse JSON fields
    return transactions.map(tx => ({
      ...tx,
      metadata: tx.metadata ? JSON.parse(tx.metadata) : null
    }));
  },

  // Get transactions by patient ID
  getTransactionsByPatientId(patientId) {
    const stmt = db.prepare(`
      SELECT t.*, c.last4, c.brand
      FROM stripe_card_transactions t
      JOIN stripe_cards c ON t.card_id = c.id
      WHERE t.patient_id = ?
      ORDER BY t.created_at DESC
    `);
    const transactions = stmt.all(patientId);
    // Parse JSON fields
    return transactions.map(tx => ({
      ...tx,
      metadata: tx.metadata ? JSON.parse(tx.metadata) : null
    }));
  },

  // Get user by Google ID
  getUserByGoogleId(googleId) {
    const stmt = db.prepare('SELECT * FROM users WHERE google_id = ? AND is_active = 1');
    return stmt.get(googleId);
  },

  getUserCalendarSettingsByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1');
    return stmt.get(email);
  },

  getFirstCalendarConnectedUser() {
    const stmt = db.prepare(`
      SELECT *
      FROM users
      WHERE google_calendar_connected = 1
        AND google_refresh_token IS NOT NULL
        AND is_active = 1
      ORDER BY google_calendar_sync_at DESC, updated_at DESC
      LIMIT 1
    `);
    return stmt.get();
  },

  setUserCalendarConnection(userId, settings) {
    const fields = [
      'google_calendar_connected = ?',
      'google_calendar_email = ?',
      'google_calendar_id = ?',
      'google_calendar_name = ?',
      'google_calendar_timezone = ?',
      'google_calendar_scopes = ?',
      'google_calendar_sync_at = CURRENT_TIMESTAMP',
      'google_calendar_last_error = NULL',
      'updated_at = CURRENT_TIMESTAMP'
    ];

    const values = [
      settings.connected ? 1 : 0,
      settings.calendar_email || null,
      settings.calendar_id || null,
      settings.calendar_name || null,
      settings.calendar_timezone || null,
      Array.isArray(settings.scopes) ? settings.scopes.join(' ') : settings.scopes || null
    ];

    if (settings.refresh_token !== undefined) {
      fields.push('google_refresh_token = ?');
      values.push(settings.refresh_token || null);
    }

    if (settings.access_token !== undefined) {
      fields.push('google_access_token = ?');
      values.push(settings.access_token || null);
    }

    if (settings.token_expiry !== undefined) {
      fields.push('google_token_expiry = ?');
      values.push(settings.token_expiry || null);
    }

    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    values.push(userId);
    return db.prepare(query).run(...values);
  },

  updateUserCalendarTokens(userId, tokens) {
    const fields = [];
    const values = [];

    if (tokens.access_token !== undefined) {
      fields.push('google_access_token = ?');
      values.push(tokens.access_token || null);
    }
    if (tokens.refresh_token !== undefined) {
      fields.push('google_refresh_token = ?');
      values.push(tokens.refresh_token || null);
    }
    if (tokens.token_expiry !== undefined) {
      fields.push('google_token_expiry = ?');
      values.push(tokens.token_expiry || null);
    }
    if (tokens.error_message !== undefined) {
      fields.push('google_calendar_last_error = ?');
      values.push(tokens.error_message || null);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    values.push(userId);
    return db.prepare(query).run(...values);
  },

  updateUserCalendarSelection(userId, selection) {
    const stmt = db.prepare(`
      UPDATE users
      SET google_calendar_id = ?,
          google_calendar_name = ?,
          google_calendar_timezone = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(
      selection.calendar_id || null,
      selection.calendar_name || null,
      selection.calendar_timezone || null,
      userId
    );
  },

  clearUserCalendarConnection(userId) {
    const stmt = db.prepare(`
      UPDATE users
      SET google_calendar_connected = 0,
          google_calendar_email = NULL,
          google_calendar_id = NULL,
          google_calendar_name = NULL,
          google_calendar_timezone = NULL,
          google_refresh_token = NULL,
          google_access_token = NULL,
          google_token_expiry = NULL,
          google_calendar_scopes = NULL,
          google_calendar_sync_at = NULL,
          google_calendar_last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(userId);
  },

  // Update user
  updateUser(id, updates) {
    const fields = [];
    const values = [];

    if (updates.name) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.picture !== undefined) {
      fields.push('picture = ?');
      values.push(updates.picture);
    }
    if (updates.role) {
      fields.push('role = ?');
      values.push(updates.role);
    }
    if (updates.merchant_id !== undefined) {
      fields.push('merchant_id = ?');
      values.push(updates.merchant_id);
    }
    if (updates.password_hash) {
      fields.push('password_hash = ?');
      values.push(updates.password_hash);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = CURRENT_TIMESTAMP');

    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    return db.prepare(query).run(...values);
  },

  // Update last login
  updateUserLastLogin(id) {
    const stmt = db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?');
    return stmt.run(id);
  },

  // Get all users
  getAllUsers() {
    const stmt = db.prepare('SELECT id, email, name, role, merchant_id, picture, auth_method, created_at, last_login FROM users WHERE is_active = 1 ORDER BY created_at DESC');
    return stmt.all();
  },

  // Deactivate user (soft delete)
  deactivateUser(id) {
    const stmt = db.prepare('UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    return stmt.run(id);
  },

  // ============================================
  // APPOINTMENTS
  // ============================================

  // Create new appointment
  async createAppointment(appointment) {
    try {
      const { enforceCanonicalPatientPhone } = require('./services/patient-contact-canonical');
      enforceCanonicalPatientPhone(appointment, { logTag: '[createAppointment]' });
    } catch (e) {
      console.warn('[createAppointment] Canonical patient phone skipped:', e.message);
    }

    // Store buffer times in notes as JSON if not already JSON
    let notes = appointment.notes || '';
    if (appointment.buffer_before_minutes || appointment.buffer_after_minutes) {
      try {
        const notesObj = notes ? JSON.parse(notes) : {};
        notesObj.buffer_before_minutes = appointment.buffer_before_minutes;
        notesObj.buffer_after_minutes = appointment.buffer_after_minutes;
        notesObj.timezone = appointment.timezone;
        notes = JSON.stringify(notesObj);
      } catch (e) {
        // If notes is not JSON, append buffer info
        notes = `${notes}\nBuffer: ${appointment.buffer_before_minutes || 0}min before, ${appointment.buffer_after_minutes || 0}min after`.trim();
      }
    }

    if (usePostgres && pgPool) {
      // Postgres path (visit_mode added Phase 2.4; primary_icd10, primary_cpt from triage)
      await pgPool`
        INSERT INTO appointments (
          id, clinic_id, customer_id, patient_name, patient_phone, patient_email, patient_id,
          appointment_type, date, time, start_time, end_time,
          duration_minutes, provider, status, notes,
          calendar_event_id, calendar_link, video_room_name, visit_mode,
          primary_icd10, primary_cpt, created_at
        ) VALUES (
          ${appointment.id},
          ${appointment.clinic_id || null},
          ${appointment.customer_id || null},
          ${appointment.patient_name},
          ${appointment.patient_phone},
          ${appointment.patient_email},
          ${appointment.patient_id || null},
          ${appointment.appointment_type},
          ${appointment.date},
          ${appointment.time},
          ${appointment.start_time},
          ${appointment.end_time},
          ${appointment.duration_minutes},
          ${appointment.provider},
          ${appointment.status},
          ${notes},
          ${appointment.calendar_event_id},
          ${appointment.calendar_link},
          ${appointment.video_room_name || null},
          ${appointment.visit_mode || 'sync_video'},
          ${appointment.primary_icd10 || null},
          ${appointment.primary_cpt || null},
          ${appointment.created_at || new Date().toISOString()}
        )
      `;
      return { changes: 1, lastInsertRowid: appointment.id };
    } else {
      // SQLite path (Task 4: practitioner_id, Task 51: timezone, Phase 2: visit_mode, Phase 4: slot_state) - optional columns from migration
      const info = db.prepare('PRAGMA table_info(appointments)').all();
      const hasPractitioner = info.some(c => c.name === 'practitioner_id');
      const hasTimezone = info.some(c => c.name === 'timezone');
      const hasVisitMode = info.some(c => c.name === 'visit_mode');
      const hasSlotState = info.some(c => c.name === 'slot_state');
      const hasPrimaryIcd10 = info.some(c => c.name === 'primary_icd10');
      const hasPrimaryCpt = info.some(c => c.name === 'primary_cpt');
      const hasCalendarSource = info.some(c => c.name === 'calendar_source');
      const hasCalendarConfidence = info.some(c => c.name === 'calendar_confidence');
      const baseCols = 'id, clinic_id, customer_id, patient_name, patient_phone, patient_email, patient_id, appointment_type, date, time, start_time, end_time, duration_minutes, provider';
      const baseVals = [appointment.id, appointment.clinic_id || null, appointment.customer_id || null, appointment.patient_name, appointment.patient_phone, appointment.patient_email, appointment.patient_id || null, appointment.appointment_type, appointment.date, appointment.time, appointment.start_time, appointment.end_time, appointment.duration_minutes, appointment.provider];
      let cols = baseCols + (hasPractitioner ? ', practitioner_id' : '') + ', status, notes, calendar_event_id, calendar_link, video_room_name' + (hasTimezone ? ', timezone' : '') + (hasVisitMode ? ', visit_mode' : '') + (hasSlotState ? ', slot_state' : '') + (hasPrimaryIcd10 ? ', primary_icd10' : '') + (hasPrimaryCpt ? ', primary_cpt' : '') + (hasCalendarSource ? ', calendar_source' : '') + (hasCalendarConfidence ? ', calendar_confidence' : '') + ', created_at';
      let vals = [...baseVals];
      if (hasPractitioner) vals.push(appointment.practitioner_id || null);
      vals.push(appointment.status, notes, appointment.calendar_event_id, appointment.calendar_link, appointment.video_room_name || null);
      if (hasTimezone) vals.push(appointment.timezone || 'America/New_York');
      if (hasVisitMode) vals.push(appointment.visit_mode || 'sync_video');
      if (hasSlotState) vals.push(appointment.slot_state || 'soft_reserved');
      if (hasPrimaryIcd10) vals.push(appointment.primary_icd10 || null);
      if (hasPrimaryCpt) vals.push(appointment.primary_cpt || null);
      if (hasCalendarSource) vals.push(appointment.calendar_source || null);
      if (hasCalendarConfidence) vals.push(appointment.calendar_confidence || null);
      vals.push(appointment.created_at);
      const placeholders = vals.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO appointments (${cols}) VALUES (${placeholders})`);
      return stmt.run(...vals);
    }
  },

  // Normalize appointment so video_room_name is always set (for agent + patient/provider UI)
  _normalizeAppointmentVideoRoom(row) {
    if (!row) return row;
    if (!row.video_room_name && row.id) {
      row.video_room_name = row.id.toString().startsWith('appt-') ? row.id : `appt-${row.id}`;
    }
    return row;
  },

  // Get appointment by ID
  // Get appointment by ID (supports both clinicId and customerId for tenant isolation)
  async getAppointment(id, clinicId = null, customerId = null) {
    let row;
    if (usePostgres && pgPool) {
      let query;
      if (customerId) {
        query = pgPool`SELECT * FROM appointments WHERE id = ${id} AND customer_id = ${customerId} AND deleted_at IS NULL`;
      } else if (clinicId) {
        query = pgPool`SELECT * FROM appointments WHERE id = ${id} AND clinic_id = ${clinicId} AND deleted_at IS NULL`;
      } else {
        query = pgPool`SELECT * FROM appointments WHERE id = ${id} AND deleted_at IS NULL`;
      }
      const results = await query;
      row = results[0] || null;
    } else {
      let query = 'SELECT * FROM appointments WHERE (id = ? OR id LIKE ?) AND deleted_at IS NULL';
      const params = [id, `%${id}%`];
      if (customerId) { query += ' AND customer_id = ?'; params.push(customerId); }
      else if (clinicId) { query += ' AND clinic_id = ?'; params.push(clinicId); }
      const stmt = db.prepare(query);
      row = stmt.get(...params);
    }
    return this._normalizeAppointmentVideoRoom(row);
  },

  // Get appointments by date (Task 4: optional practitionerId for provider-level availability)
  // When practitionerId given: return only appointments that block that provider (same practitioner_id or null)
  async getAppointmentsByDate(date, clinicId = null, practitionerId = null) {
    if (usePostgres && pgPool) {
      let query;
      if (clinicId) {
        query = pgPool`SELECT * FROM appointments WHERE date = ${date} AND clinic_id = ${clinicId} AND deleted_at IS NULL ORDER BY time ASC`;
      } else {
        query = pgPool`SELECT * FROM appointments WHERE date = ${date} AND deleted_at IS NULL ORDER BY time ASC`;
      }
      let rows = await query;
      if (practitionerId) {
        rows = rows.filter(r => r.practitioner_id == null || r.practitioner_id === practitionerId);
      }
      return rows.map(r => this._normalizeAppointmentVideoRoom(r));
    } else {
      // SQLite path
      let query = 'SELECT * FROM appointments WHERE date = ? AND deleted_at IS NULL';
      const params = [date];

      if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }

      query += ' ORDER BY time ASC';

      const stmt = db.prepare(query);
      let rows = stmt.all(...params);
      if (practitionerId) {
        const hasCol = db.prepare("PRAGMA table_info(appointments)").all().some(c => c.name === 'practitioner_id');
        if (hasCol) {
          rows = rows.filter(r => !r.practitioner_id || r.practitioner_id === practitionerId);
        }
      }
      return rows.map(r => this._normalizeAppointmentVideoRoom(r));
    }
  },

  // Phase 2.4: Async review queue - appointments pending specialist review
  async getAsyncReviewQueue(clinicId = null) {
    const SLA_HOURS = 4; // Target response within 4 hours
    const addSla = (r) => {
      const created = r.created_at ? new Date(r.created_at) : null;
      const slaDue = created ? new Date(created.getTime() + SLA_HOURS * 60 * 60 * 1000) : null;
      return {
        ...this._normalizeAppointmentVideoRoom(r),
        sla_due_at: slaDue ? slaDue.toISOString() : null,
        sla_hours: SLA_HOURS,
        sla_countdown_minutes: slaDue ? Math.max(0, Math.round((slaDue - new Date()) / 60000)) : null
      };
    };
    if (usePostgres && pgPool) {
      let rows;
      if (clinicId) {
        rows = await pgPool`
          SELECT * FROM appointments
          WHERE visit_mode = 'async_review' AND status = 'pending_review' AND clinic_id = ${clinicId} AND deleted_at IS NULL
          ORDER BY created_at ASC
        `;
      } else {
        rows = await pgPool`
          SELECT * FROM appointments
          WHERE visit_mode = 'async_review' AND status = 'pending_review' AND deleted_at IS NULL
          ORDER BY created_at ASC
        `;
      }
      return rows.map(addSla);
    } else {
      let query = `SELECT * FROM appointments WHERE visit_mode = 'async_review' AND status = 'pending_review' AND deleted_at IS NULL`;
      const params = [];
      if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }
      query += ' ORDER BY created_at ASC';
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return rows.map(addSla);
    }
  },

  // Search appointments by phone or email (supports both clinicId and customerId for tenant isolation)
  async searchAppointments(searchTerm, clinicId = null, customerId = null) {
    if (usePostgres && pgPool) {
      // Postgres path
      const searchPattern = `%${searchTerm}%`;
      let query;
      if (customerId) {
        query = pgPool`
          SELECT * FROM appointments
          WHERE (patient_phone LIKE ${searchPattern} OR patient_email LIKE ${searchPattern})
            AND customer_id = ${customerId}
            AND deleted_at IS NULL
          ORDER BY date DESC, time DESC
        `;
      } else if (clinicId) {
        query = pgPool`
          SELECT * FROM appointments
          WHERE (patient_phone LIKE ${searchPattern} OR patient_email LIKE ${searchPattern})
            AND clinic_id = ${clinicId}
            AND deleted_at IS NULL
          ORDER BY date DESC, time DESC
        `;
      } else {
        query = pgPool`
          SELECT * FROM appointments
          WHERE (patient_phone LIKE ${searchPattern} OR patient_email LIKE ${searchPattern})
            AND deleted_at IS NULL
          ORDER BY date DESC, time DESC
        `;
      }
      const results = await query;
      return results.map(r => this._normalizeAppointmentVideoRoom(r));
    } else {
      // SQLite path
      let query = `
        SELECT * FROM appointments
        WHERE (patient_phone LIKE ? OR patient_email LIKE ?)
          AND deleted_at IS NULL
      `;
      const params = [`%${searchTerm}%`, `%${searchTerm}%`];

      if (customerId) {
        query += ' AND customer_id = ?';
        params.push(customerId);
      } else if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }

      query += ' ORDER BY date DESC, time DESC';

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return rows.map(r => this._normalizeAppointmentVideoRoom(r));
    }
  },

  // Get all appointments (with optional filters) — G-1: require tenant scope
  getAllAppointments(filters = {}) {
    let query = `
      SELECT
        a.*,
        (
          SELECT j.status
          FROM ehr_sync_jobs j
          WHERE j.appointment_id = a.id
          ORDER BY datetime(j.updated_at) DESC, datetime(j.created_at) DESC
          LIMIT 1
        ) AS ehr_sync_status,
        (
          SELECT j.last_error
          FROM ehr_sync_jobs j
          WHERE j.appointment_id = a.id
          ORDER BY datetime(j.updated_at) DESC, datetime(j.created_at) DESC
          LIMIT 1
        ) AS ehr_sync_last_error
      FROM appointments a
      WHERE a.deleted_at IS NULL
    `;
    const params = [];

    // Tenant isolation: Require customer_id or clinic_id (G-1) to avoid cross-tenant leak
    const hasTenantScope = !!(filters.customer_id || filters.clinic_id);
    if (!hasTenantScope) return [];

    if (filters.customer_id) {
      query += ' AND a.customer_id = ?';
      params.push(filters.customer_id);
    }
    if (filters.clinic_id) {
      query += ' AND a.clinic_id = ?';
      params.push(filters.clinic_id);
    }

    if (filters.status) {
      query += ' AND a.status = ?';
      params.push(filters.status);
    }

    if (filters.date) {
      query += ' AND a.date = ?';
      params.push(filters.date);
    }
    if (filters.start_date) {
      query += ' AND a.date >= ?';
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      query += ' AND a.date <= ?';
      params.push(filters.end_date);
    }

    if (filters.provider) {
      // Accept either provider display name or provider email in the filter.
      // Some appointments persist display_name, while UI/users may type email.
      query += `
        AND (
          a.provider = ?
          OR a.provider IN (
            SELECT p.display_name
            FROM provider_profiles p
            WHERE p.email = ?
          )
          OR a.provider IN (
            SELECT p.email
            FROM provider_profiles p
            WHERE p.display_name = ?
          )
        )
      `;
      params.push(filters.provider, filters.provider, filters.provider);
    }

    query += ' ORDER BY a.date DESC, a.time DESC';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map(r => this._normalizeAppointmentVideoRoom(r));
  },

  /**
   * Get appointments for a set of FHIR patient ids (appointments.patient_id).
   * @param {string[]} patientIds
   * @param {object} [options]
   * @returns {Array}
   */
  getAppointmentsByPatientIds(patientIds = [], options = {}) {
    const ids = Array.isArray(patientIds) ? patientIds.filter(Boolean) : [];
    if (ids.length === 0) return [];

    // Postgres path (if enabled)
    // SQLite / default path
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT * FROM appointments WHERE patient_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY start_time DESC`)
      .all(...ids);
    return rows.map(r => this._normalizeAppointmentVideoRoom(r));
  },

  /**
   * Telemedicine Phase 1 — Task 8: Clinician scope.
   * Returns distinct clinic_ids that have appointments for this FHIR patient (resource_id).
   */
  getPatientClinicIds(patientId) {
    if (!patientId) return [];
    try {
      const rows = db.prepare(
        'SELECT DISTINCT clinic_id FROM appointments WHERE patient_id = ? AND clinic_id IS NOT NULL'
      ).all(patientId);
      return rows.map(r => r.clinic_id);
    } catch (e) {
      return [];
    }
  },

  // Update appointment status (supports both clinicId and customerId for tenant isolation)
  updateAppointmentStatus(id, status, reason = null, clinicId = null, customerId = null) {
    // Enforce appointment lifecycle state transitions (mvp-22)
    try {
      // Exact id first; fall back to LIKE for legacy callers passing partial ids.
      const existing =
        db.prepare(`SELECT id, status FROM appointments WHERE id = ? LIMIT 1`).get(id) ||
        db.prepare(`SELECT id, status FROM appointments WHERE id LIKE ? LIMIT 1`).get(`%${id}%`);
      if (existing && !canTransitionAppointmentStatus(existing.status, status)) {
        throw new Error(`Invalid appointment status transition: ${existing.status} -> ${status}`);
      }
    } catch (e) {
      // Surface this as a hard error to callers so routes can return 400/409 rather than silently corrupt state.
      throw e;
    }

    let query = `
      UPDATE appointments
      SET status = ?,
          cancellation_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE (id = ? OR id LIKE ?)
    `;
    const params = [status, reason, id, `%${id}%`];

    if (customerId) {
      query += ' AND customer_id = ?';
      params.push(customerId);
    } else if (clinicId) {
      query += ' AND clinic_id = ?';
      params.push(clinicId);
    }

    const stmt = db.prepare(query);
    const result = stmt.run(...params);
    if (pgPool && result.changes) {
      const updatedAppointment = db.prepare('SELECT * FROM appointments WHERE id = ? LIMIT 1').get(id);
      syncAppointmentToPostgres(updatedAppointment);
    }
    return result;
  },

  // Update appointment details (for rescheduling) - supports both clinicId and customerId for tenant isolation
  updateAppointment(id, updates, clinicId = null, customerId = null) {
    const fields = [];
    const values = [];

    if (updates.date !== undefined) {
      fields.push('date = ?');
      values.push(updates.date);
    }
    if (updates.time !== undefined) {
      fields.push('time = ?');
      values.push(updates.time);
    }
    if (updates.start_time !== undefined) {
      fields.push('start_time = ?');
      values.push(updates.start_time);
    }
    if (updates.end_time !== undefined) {
      fields.push('end_time = ?');
      values.push(updates.end_time);
    }
    // Note: appointments table has no timezone column; store timezone in notes JSON if needed
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }
    if (updates.appointment_type !== undefined) {
      fields.push('appointment_type = ?');
      values.push(updates.appointment_type);
    }
    if (updates.duration_minutes !== undefined) {
      fields.push('duration_minutes = ?');
      values.push(updates.duration_minutes);
    }
    if (updates.slot_state !== undefined) {
      fields.push('slot_state = ?');
      values.push(updates.slot_state);
    }
    if (updates.stripe_payment_intent_id !== undefined) {
      fields.push('stripe_payment_intent_id = ?');
      values.push(updates.stripe_payment_intent_id);
    }

    if (fields.length === 0) {
      return { changes: 0 };
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');

    let query = `
      UPDATE appointments
      SET ${fields.join(', ')}
      WHERE id = ? OR id LIKE ?
    `;

    const params = [...values, id, `%${id}%`];

    if (customerId) {
      query += ' AND customer_id = ?';
      params.push(customerId);
    } else if (clinicId) {
      query += ' AND clinic_id = ?';
      params.push(clinicId);
    }

    const stmt = db.prepare(query);
    const result = stmt.run(...params);
    if (pgPool && result.changes) {
      const updatedAppointment = db.prepare('SELECT * FROM appointments WHERE id = ? LIMIT 1').get(id);
      syncAppointmentToPostgres(updatedAppointment);
    }
    return result;
  },

  // Update appointment reminder sent flag (1h)
  markReminderSent(id, clinicId = null) {
    let query = `
      UPDATE appointments
      SET reminder_sent = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    const params = [id];

    if (clinicId) {
      query += ' AND clinic_id = ?';
      params.push(clinicId);
    }

    const stmt = db.prepare(query);
    const result = stmt.run(...params);
    if (pgPool && result.changes) {
      const updatedAppointment = db.prepare('SELECT * FROM appointments WHERE id = ? LIMIT 1').get(id);
      syncAppointmentToPostgres(updatedAppointment);
    }
    return result;
  },

  // Update 24h reminder sent flag (Task 52)
  markReminder24hSent(id, clinicId = null) {
    try {
      let query = 'UPDATE appointments SET reminder_24h_sent = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      const params = [id];
      if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }
      db.prepare(query).run(...params);
    } catch (_) {
      // reminder_24h_sent column may not exist yet
    }
  },

  // Telemedicine Phase 5 — Task 35: booking confirmation sent
  markReminderBookingSent(id, clinicId = null) {
    try {
      const info = db.prepare('PRAGMA table_info(appointments)').all();
      if (!info.some(c => c.name === 'reminder_booking_sent')) return;
      let query = 'UPDATE appointments SET reminder_booking_sent = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      const params = [id];
      if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }
      db.prepare(query).run(...params);
    } catch (_) {}
  },

  // Telemedicine Phase 5 — Task 37: 1h reminder sent
  markReminder1hSent(id, clinicId = null) {
    try {
      const info = db.prepare('PRAGMA table_info(appointments)').all();
      const has1h = info.some(c => c.name === 'reminder_1h_sent');
      const setCols = has1h ? 'reminder_1h_sent = 1, reminder_sent = 1' : 'reminder_sent = 1';
      let query = `UPDATE appointments SET ${setCols}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      const params = [id];
      if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }
      db.prepare(query).run(...params);
    } catch (_) {}
  },

  // Phase 6 — Tech check SMS sent
  markTechCheckSent(id, clinicId = null) {
    try {
      const info = db.prepare('PRAGMA table_info(appointments)').all();
      if (!info.some(c => c.name === 'tech_check_sent')) return;
      let query = 'UPDATE appointments SET tech_check_sent = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      const params = [id];
      if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }
      db.prepare(query).run(...params);
    } catch (_) {}
  },

  // Delete appointment (hard delete)
  deleteAppointment(id, clinicId = null) {
    let query = 'DELETE FROM appointments WHERE id = ? OR id LIKE ?';
    const params = [id, `%${id}%`];

    if (clinicId) {
      query += ' AND clinic_id = ?';
      params.push(clinicId);
    }

    const stmt = db.prepare(query);
    const result = stmt.run(...params);
    if (pgPool && result.changes) {
      deleteAppointmentFromPostgres(id);
    }
    return result;
  },

  // Get upcoming appointments (next 7 days)
  getUpcomingAppointments(limit = 10, clinicId = null) {
    const today = new Date().toISOString().split('T')[0];
    let query = `
      SELECT * FROM appointments
      WHERE date >= ? AND status IN ('scheduled', 'confirmed')
    `;
    const params = [today];

    if (clinicId) {
      query += ' AND clinic_id = ?';
      params.push(clinicId);
    }

    query += ' ORDER BY date ASC, time ASC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    return stmt.all(...params);
  },

  // ============================================
  // INSURANCE & BILLING
  // ============================================

  // Create eligibility check record
  createEligibilityCheck(eligibility) {
    const stmt = db.prepare(`
      INSERT INTO eligibility_checks (
        id, patient_id, member_id, payer_id, service_code,
        date_of_service, eligible, copay_amount, allowed_amount,
        insurance_pays, deductible_total, deductible_remaining,
        coinsurance_percent, plan_summary, oop_max, oop_met,
        response_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      eligibility.id,
      eligibility.patient_id || null,
      eligibility.member_id,
      eligibility.payer_id,
      eligibility.service_code || null,
      eligibility.date_of_service || null,
      eligibility.eligible ? 1 : 0,
      eligibility.copay_amount || 0,
      eligibility.allowed_amount || 0,
      eligibility.insurance_pays || 0,
      eligibility.deductible_total !== undefined ? eligibility.deductible_total : null,
      eligibility.deductible_remaining !== undefined ? eligibility.deductible_remaining : null,
      eligibility.coinsurance_percent !== undefined ? eligibility.coinsurance_percent : null,
      eligibility.plan_summary || null,
      eligibility.oop_max !== undefined ? eligibility.oop_max : null,
      eligibility.oop_met !== undefined ? eligibility.oop_met : null,
      eligibility.response_data || null,
      eligibility.created_at || new Date().toISOString()
    );
  },

  // Get eligibility check by ID
  getEligibilityCheck(id) {
    const stmt = db.prepare('SELECT * FROM eligibility_checks WHERE id = ?');
    return stmt.get(id);
  },

  // Get eligibility checks for a patient
  getEligibilityChecksByPatient(patientId) {
    const stmt = db.prepare(`
      SELECT * FROM eligibility_checks
      WHERE patient_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(patientId);
  },

  // Create insurance claim
  createInsuranceClaim(claim) {
    try {
      const proofHash = claim.proof_of_care_hash || null;
      const hasProofCol = db.prepare(`PRAGMA table_info(insurance_claims)`).all().some(c => c.name === 'proof_of_care_hash');
      const cols = [
        'id', 'appointment_id', 'patient_id', 'member_id', 'payer_id',
        'service_code', 'diagnosis_code', 'total_amount', 'copay_amount',
        'insurance_amount', 'status', 'x12_claim_id', 'blockchain_proof',
        'submitted_at', 'response_data', 'circle_transfer_id', 'payment_status', 'payment_amount',
        'provider_npi'
      ];
      const vals = [
        claim.id,
        claim.appointment_id || null,
        claim.patient_id || null,
        claim.member_id,
        claim.payer_id,
        claim.service_code || null,
        claim.diagnosis_code || null,
        claim.total_amount,
        claim.copay_amount || 0,
        claim.insurance_amount || 0,
        claim.status || 'submitted',
        claim.x12_claim_id || null,
        claim.blockchain_proof || null,
        claim.submitted_at || new Date().toISOString(),
        claim.response_data || null,
        claim.circle_transfer_id || null,
        claim.payment_status || 'pending',
        claim.payment_amount || null,
        claim.provider_npi || null
      ];
      if (hasProofCol) {
        cols.push('proof_of_care_hash');
        vals.push(proofHash);
      }
      const placeholders = cols.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO insurance_claims (${cols.join(', ')}) VALUES (${placeholders})`);
      const result = stmt.run(...vals);
      return result;
    } catch (error) {
      console.error('❌ Error creating insurance claim:', error);
      console.error('Claim data:', JSON.stringify(claim, null, 2));
      throw error; // Re-throw to be handled by caller
    }
  },

  // Get insurance claim by ID
  getInsuranceClaim(id) {
    const stmt = db.prepare('SELECT * FROM insurance_claims WHERE id = ?');
    return stmt.get(id);
  },

  // Get insurance claim by idempotency key
  getInsuranceClaimByIdempotency(idemKey) {
    const stmt = db.prepare('SELECT * FROM insurance_claims WHERE idempotency_key = ? ORDER BY submitted_at DESC LIMIT 1');
    return stmt.get(idemKey);
  },

  // Get claims for an appointment
  getClaimsByAppointment(appointmentId) {
    const stmt = db.prepare(`
      SELECT * FROM insurance_claims
      WHERE appointment_id = ?
      ORDER BY submitted_at DESC
    `);
    return stmt.all(appointmentId);
  },

  // Get claims for a patient
  getClaimsByPatient(patientId) {
    const stmt = db.prepare(`
      SELECT * FROM insurance_claims
      WHERE patient_id = ?
      ORDER BY submitted_at DESC
    `);
    return stmt.all(patientId);
  },

  getClaimById(claimId) {
    const stmt = db.prepare(`
      SELECT * FROM insurance_claims
      WHERE id = ?
    `);
    return stmt.get(claimId);
  },

  // Research Bounties (Pharma Data Requests - Impact-Weighted Escrow)
  createResearchBounty(bounty) {
    const { v4: uuidv4 } = require('uuid');
    const id = bounty.id || `rb_${uuidv4()}`;
    db.prepare(`
      INSERT INTO research_bounties (id, requester_id, requester_type, title, description, data_type, target_count, fulfilled_count, bounty_amount_per_unit, total_bounty_amount, status, impact_tier, escrow_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      bounty.requester_id || null,
      bounty.requester_type || 'pharma',
      bounty.title || null,
      bounty.description || null,
      bounty.data_type || null,
      bounty.target_count || 0,
      bounty.fulfilled_count ?? 0,
      bounty.bounty_amount_per_unit ?? 0,
      bounty.total_bounty_amount ?? 0,
      bounty.status || 'open',
      bounty.impact_tier ?? 1,
      bounty.escrow_hash || null
    );
    return id;
  },

  getResearchBounty(id) {
    return db.prepare('SELECT * FROM research_bounties WHERE id = ?').get(id);
  },

  listResearchBounties(filters = {}) {
    let q = 'SELECT * FROM research_bounties WHERE 1=1';
    const params = [];
    if (filters.status) { q += ' AND status = ?'; params.push(filters.status); }
    if (filters.requester_id) { q += ' AND requester_id = ?'; params.push(filters.requester_id); }
    q += ' ORDER BY created_at DESC LIMIT ?';
    params.push(filters.limit ?? 50);
    return db.prepare(q).all(...params);
  },

  updateResearchBounty(id, updates) {
    const fields = [];
    const values = [];
    const allowed = ['title', 'description', 'fulfilled_count', 'status', 'escrow_hash'];
    for (const k of Object.keys(updates)) {
      if (allowed.includes(k)) {
        fields.push(`${k} = ?`);
        values.push(updates[k]);
      }
    }
    if (fields.length === 0) return;
    fields.push('updated_at = datetime("now")');
    values.push(id);
    db.prepare(`UPDATE research_bounties SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  // Code acceptance rates (Tiba Phase 4 - φ^historical_i)
  upsertCodeAcceptance(payerId, cptCode, accepted) {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='code_acceptance_rates'`).get();
    if (!tableExists) return;
    const p = String(payerId || '').trim().toUpperCase();
    const c = String(cptCode || '').trim();
    if (!p || !c) return;
    const existing = db.prepare('SELECT acceptance_count, denial_count FROM code_acceptance_rates WHERE payer_id = ? AND cpt_code = ?').get(p, c);
    if (existing) {
      if (accepted) {
        db.prepare('UPDATE code_acceptance_rates SET acceptance_count = acceptance_count + 1, last_updated = datetime("now") WHERE payer_id = ? AND cpt_code = ?').run(p, c);
      } else {
        db.prepare('UPDATE code_acceptance_rates SET denial_count = denial_count + 1, last_updated = datetime("now") WHERE payer_id = ? AND cpt_code = ?').run(p, c);
      }
    } else {
      db.prepare(`
        INSERT INTO code_acceptance_rates (payer_id, cpt_code, acceptance_count, denial_count, last_updated)
        VALUES (?, ?, ?, ?, datetime("now"))
      `).run(p, c, accepted ? 1 : 0, accepted ? 0 : 1);
    }
  },

  getCodeAcceptanceRate(payerId, cptCode) {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='code_acceptance_rates'`).get();
    if (!tableExists) return null;
    const p = String(payerId || '').trim().toUpperCase();
    const c = String(cptCode || '').trim();
    if (!p || !c) return null;
    const row = db.prepare('SELECT acceptance_count, denial_count FROM code_acceptance_rates WHERE payer_id = ? AND cpt_code = ?').get(p, c);
    return row;
  },

  // Provider trust metrics (Tiba Phase 3.7 - τ_provider)
  upsertProviderTrustMetric(providerNpi, updates) {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='provider_trust_metrics'`).get();
    if (!tableExists) return;
    const npi = String(providerNpi || '').trim();
    if (!npi) return;
    const existing = db.prepare('SELECT trust_score, denial_rate, coding_variance, volume_anomaly_score FROM provider_trust_metrics WHERE provider_npi = ?').get(npi);
    const tau = updates.trust_score != null ? updates.trust_score : (existing?.trust_score ?? 1.0);
    const deny = updates.denial_rate != null ? updates.denial_rate : (existing?.denial_rate ?? 0);
    const cv = updates.coding_variance != null ? updates.coding_variance : (existing?.coding_variance ?? 0);
    const va = updates.volume_anomaly_score != null ? updates.volume_anomaly_score : (existing?.volume_anomaly_score ?? 0);
    if (existing) {
      db.prepare('UPDATE provider_trust_metrics SET trust_score = ?, denial_rate = ?, coding_variance = ?, volume_anomaly_score = ?, last_updated = datetime("now") WHERE provider_npi = ?').run(tau, deny, cv, va, npi);
    } else {
      db.prepare('INSERT OR REPLACE INTO provider_trust_metrics (provider_npi, trust_score, denial_rate, coding_variance, volume_anomaly_score, last_updated) VALUES (?, ?, ?, ?, ?, datetime("now"))').run(npi, tau, deny, cv, va);
    }
  },

  getProviderTrustScore(providerNpi) {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='provider_trust_metrics'`).get();
    if (!tableExists) return null;
    const npi = String(providerNpi || '').trim();
    if (!npi) return null;
    const row = db.prepare('SELECT trust_score FROM provider_trust_metrics WHERE provider_npi = ?').get(npi);
    return row?.trust_score;
  },

  getProviderDenialRate(providerNpi) {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='provider_trust_metrics'`).get();
    if (!tableExists) return null;
    const npi = String(providerNpi || '').trim();
    if (!npi) return null;
    const row = db.prepare('SELECT denial_rate FROM provider_trust_metrics WHERE provider_npi = ?').get(npi);
    return row?.denial_rate ?? 0;
  },

  // Record EOB calculation audit (full transparency of inputs/outputs)
  recordEOBCalculationAudit({ claimId, calculationInputs, calculationOutputs, triggeredBy }) {
    const { v4: uuidv4 } = require('uuid');
    const id = `eob_audit_${uuidv4()}`;
    const stmt = db.prepare(`
      INSERT INTO eob_calculation_audit (id, claim_id, calculation_inputs, calculation_outputs, triggered_by, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      id,
      claimId,
      typeof calculationInputs === 'string' ? calculationInputs : JSON.stringify(calculationInputs || {}),
      typeof calculationOutputs === 'string' ? calculationOutputs : JSON.stringify(calculationOutputs || {}),
      triggeredBy || null
    );
    return id;
  },

  getEOBCalculationAuditsByClaim(claimId, limit = 20) {
    const stmt = db.prepare(`
      SELECT * FROM eob_calculation_audit
      WHERE claim_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(claimId, limit);
  },

  // ============================================
  // INVOICE METHODS
  // ============================================

  // Create invoice
  createInvoice(invoice) {
    const { v4: uuidv4 } = require('uuid');
    const invoiceId = invoice.id || uuidv4();
    const stmt = db.prepare(`
      INSERT INTO invoices (
        id, claim_id, patient_id, invoice_number, status, amount, due_date, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    stmt.run(
      invoiceId,
      invoice.claim_id || null,
      invoice.patient_id,
      invoice.invoice_number,
      invoice.status || 'draft',
      invoice.amount,
      invoice.due_date || null,
      invoice.notes || null
    );
    return { id: invoiceId, lastInsertRowid: invoiceId };
  },

  // Get invoice by ID
  getInvoice(id) {
    const stmt = db.prepare('SELECT * FROM invoices WHERE id = ?');
    return stmt.get(id);
  },

  // Get invoice by invoice number
  getInvoiceByNumber(invoiceNumber) {
    const stmt = db.prepare('SELECT * FROM invoices WHERE invoice_number = ?');
    return stmt.get(invoiceNumber);
  },

  // Get all invoices with filters
  getInvoices(filters = {}) {
    let query = 'SELECT * FROM invoices WHERE 1=1';
    const params = [];

    if (filters.patient_id) {
      query += ' AND patient_id = ?';
      params.push(filters.patient_id);
    }

    if (filters.claim_id) {
      query += ' AND claim_id = ?';
      params.push(filters.claim_id);
    }

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.start_date) {
      query += ' AND created_at >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND created_at <= ?';
      params.push(filters.end_date);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = db.prepare(query);
    return params.length > 0 ? stmt.all(...params) : stmt.all();
  },

  // Get invoices for a patient
  getInvoicesByPatient(patientId) {
    const stmt = db.prepare(`
      SELECT * FROM invoices
      WHERE patient_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(patientId);
  },

  // Get invoices for a claim
  getInvoicesByClaim(claimId) {
    const stmt = db.prepare(`
      SELECT * FROM invoices
      WHERE claim_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(claimId);
  },

  // Update invoice
  updateInvoice(id, updates) {
    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
      if (updates.status === 'sent' && !updates.sent_at) {
        fields.push('sent_at = datetime(\'now\')');
      }
      if (updates.status === 'paid' && !updates.paid_at) {
        fields.push('paid_at = datetime(\'now\')');
      }
    }

    if (updates.due_date !== undefined) {
      fields.push('due_date = ?');
      values.push(updates.due_date);
    }

    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }

    if (updates.sent_at !== undefined) {
      fields.push('sent_at = ?');
      values.push(updates.sent_at);
    }

    if (updates.paid_at !== undefined) {
      fields.push('paid_at = ?');
      values.push(updates.paid_at);
    }

    if (updates.cancelled_at !== undefined) {
      fields.push('cancelled_at = ?');
      values.push(updates.cancelled_at);
    }

    if (fields.length === 0) return { changes: 0 };

    fields.push('updated_at = datetime(\'now\')');
    values.push(id);

    const query = `UPDATE invoices SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = db.prepare(query);
    return stmt.run(...values);
  },

  // Add invoice item
  addInvoiceItem(item) {
    const { v4: uuidv4 } = require('uuid');
    const itemId = item.id || uuidv4();
    const stmt = db.prepare(`
      INSERT INTO invoice_items (
        id, invoice_id, service_date, description, cpt_code, icd_code, quantity, unit_price, total_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      itemId,
      item.invoice_id,
      item.service_date || null,
      item.description,
      item.cpt_code || null,
      item.icd_code || null,
      item.quantity || 1,
      item.unit_price,
      item.total_price
    );
    return { id: itemId };
  },

  // Get invoice items
  getInvoiceItems(invoiceId) {
    const stmt = db.prepare(`
      SELECT * FROM invoice_items
      WHERE invoice_id = ?
      ORDER BY service_date DESC, created_at ASC
    `);
    return stmt.all(invoiceId);
  },

  // Add invoice payment
  addInvoicePayment(payment) {
    const { v4: uuidv4 } = require('uuid');
    const paymentId = payment.id || uuidv4();
    const stmt = db.prepare(`
      INSERT INTO invoice_payments (
        id, invoice_id, payment_date, amount, payment_method, reference_number, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      paymentId,
      payment.invoice_id,
      payment.payment_date,
      payment.amount,
      payment.payment_method || null,
      payment.reference_number || null,
      payment.notes || null
    );

    // Update invoice status if fully paid
    const invoice = this.getInvoice(payment.invoice_id);
    if (invoice) {
      const totalPaid = this.getInvoicePaymentsTotal(payment.invoice_id);
      if (totalPaid >= invoice.amount) {
        this.updateInvoice(payment.invoice_id, { status: 'paid', paid_at: new Date().toISOString() });
      }
    }

    return { id: paymentId };
  },

  // Get invoice payments
  getInvoicePayments(invoiceId) {
    const stmt = db.prepare(`
      SELECT * FROM invoice_payments
      WHERE invoice_id = ?
      ORDER BY payment_date DESC, created_at DESC
    `);
    return stmt.all(invoiceId);
  },

  // Get total payments for an invoice
  getInvoicePaymentsTotal(invoiceId) {
    const stmt = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM invoice_payments
      WHERE invoice_id = ?
    `);
    const result = stmt.get(invoiceId);
    return result ? result.total : 0;
  },

  // Generate next invoice number
  generateInvoiceNumber() {
    const year = new Date().getFullYear();
    const stmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM invoices
      WHERE invoice_number LIKE ?
    `);
    const result = stmt.get(`INV-${year}-%`);
    const sequence = (result.count || 0) + 1;
    return `INV-${year}-${String(sequence).padStart(6, '0')}`;
  },

  // ============================================
  // CIRCLE PAYMENT METHODS
  // ============================================

  // Create Circle account
  createCircleAccount(account) {
    const stmt = db.prepare(`
      INSERT INTO circle_accounts (
        id, entity_type, entity_id, circle_wallet_id, circle_account_id,
        currency, status, merchant_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      account.id,
      account.entity_type,
      account.entity_id,
      account.circle_wallet_id,
      account.circle_account_id || null,
      account.currency || 'USDC',
      account.status || 'active',
      account.merchant_id || null,
      account.created_at || new Date().toISOString(),
      account.updated_at || new Date().toISOString()
    );
  },

  // Get Circle account by entity
  getCircleAccountByEntity(entityType, entityId) {
    const stmt = db.prepare(`
      SELECT * FROM circle_accounts
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(entityType, entityId);
  },

  // Get Circle account by wallet ID
  getCircleAccountByWalletId(walletId) {
    const stmt = db.prepare(`
      SELECT * FROM circle_accounts
      WHERE circle_wallet_id = ?
    `);
    return stmt.get(walletId);
  },

  // Create Circle transfer
  createCircleTransfer(transfer) {
    const stmt = db.prepare(`
      INSERT INTO circle_transfers (
        id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
        circle_transfer_id, status, error_message, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      transfer.id,
      transfer.claim_id || null,
      transfer.from_wallet_id,
      transfer.to_wallet_id,
      transfer.amount,
      transfer.currency || 'USDC',
      transfer.circle_transfer_id || null,
      transfer.status || 'pending',
      transfer.error_message || null,
      transfer.created_at || new Date().toISOString(),
      transfer.completed_at || null
    );
  },

  // Update Circle transfer
  updateCircleTransfer(id, updates) {
    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.circle_transfer_id !== undefined) {
      fields.push('circle_transfer_id = ?');
      values.push(updates.circle_transfer_id);
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }
    if (updates.completed_at !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completed_at);
    }

    if (fields.length === 0) {
      return { changes: 0 };
    }

    values.push(id);
    const query = `UPDATE circle_transfers SET ${fields.join(', ')} WHERE id = ?`;
    return db.prepare(query).run(...values);
  },

  // Get Circle transfer by ID
  getCircleTransfer(id) {
    const stmt = db.prepare(`
      SELECT * FROM circle_transfers
      WHERE id = ?
    `);
    return stmt.get(id);
  },

  // Get Circle transfer by Circle transfer ID
  getCircleTransferByCircleId(circleTransferId) {
    const stmt = db.prepare(`
      SELECT * FROM circle_transfers
      WHERE circle_transfer_id = ?
    `);
    return stmt.get(circleTransferId);
  },

  getCircleTransfersPending(limit = 50) {
    const stmt = db.prepare(`
      SELECT * FROM circle_transfers
      WHERE status = 'pending' AND circle_transfer_id IS NOT NULL
      ORDER BY created_at ASC
      LIMIT ?
    `);
    return stmt.all(limit);
  },

  // Get Circle transfers by claim ID
  getCircleTransfersByClaim(claimId) {
    const stmt = db.prepare(`
      SELECT * FROM circle_transfers
      WHERE claim_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(claimId);
  },

  // Settlement Attempts State Machine (for stuck escrow recovery)
  createSettlementAttempt(attempt) {
    const stmt = db.prepare(`
      INSERT INTO settlement_attempts (
        id, claim_id, total_approved, provider_amount, revenue_amount,
        insurer_wallet_id, escrow_wallet_id, provider_wallet_id, revenue_wallet_id,
        transfer_1_status, transfer_2_status, transfer_3_status,
        transfer_1_id, transfer_2_id, transfer_3_id,
        transfer_1_circle_id, transfer_2_circle_id, transfer_3_circle_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      attempt.id,
      attempt.claim_id,
      attempt.total_approved,
      attempt.provider_amount,
      attempt.revenue_amount,
      attempt.insurer_wallet_id,
      attempt.escrow_wallet_id,
      attempt.provider_wallet_id,
      attempt.revenue_wallet_id,
      attempt.transfer_1_status || 'pending',
      attempt.transfer_2_status || 'pending',
      attempt.transfer_3_status || 'pending',
      attempt.transfer_1_id || null,
      attempt.transfer_2_id || null,
      attempt.transfer_3_id || null,
      attempt.transfer_1_circle_id || null,
      attempt.transfer_2_circle_id || null,
      attempt.transfer_3_circle_id || null,
      attempt.created_at || new Date().toISOString(),
      attempt.updated_at || new Date().toISOString()
    );
  },

  getSettlementAttemptByClaimId(claimId) {
    const stmt = db.prepare(`
      SELECT * FROM settlement_attempts
      WHERE claim_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(claimId);
  },

  updateSettlementAttempt(claimId, updates) {
    const fields = [];
    const values = [];
    
    const allowedFields = [
      'transfer_1_status', 'transfer_2_status', 'transfer_3_status',
      'transfer_1_id', 'transfer_2_id', 'transfer_3_id',
      'transfer_1_circle_id', 'transfer_2_circle_id', 'transfer_3_circle_id',
      'error_message', 'recovery_attempts', 'last_recovery_attempt',
      'completed_at'
    ];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    if (fields.length === 0) return { changes: 0 };
    
    // Always update updated_at
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    
    values.push(claimId);
    const query = `UPDATE settlement_attempts SET ${fields.join(', ')} WHERE claim_id = ?`;
    return db.prepare(query).run(...values);
  },

  // Find stuck escrows: Transfer 1 completed but Transfer 2 not completed, older than 1 hour
  getStuckEscrows(olderThanHours = 1) {
    const stmt = db.prepare(`
      SELECT * FROM settlement_attempts
      WHERE transfer_1_status = 'completed'
        AND transfer_2_status != 'completed'
        AND datetime(created_at) < datetime('now', '-' || ? || ' hours')
        AND (completed_at IS NULL OR completed_at = '')
      ORDER BY created_at ASC
    `);
    return stmt.all(olderThanHours);
  },

  // Update insurance claim
  updateInsuranceClaim(id, updates) {
    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.submitted_at !== undefined) {
      fields.push('submitted_at = ?');
      values.push(updates.submitted_at);
    }
    if (updates.status_checked_at !== undefined) {
      fields.push('status_checked_at = ?');
      values.push(updates.status_checked_at);
    }
    if (updates.approved_at !== undefined) {
      fields.push('approved_at = ?');
      values.push(updates.approved_at);
    }
    if (updates.paid_at !== undefined) {
      fields.push('paid_at = ?');
      values.push(updates.paid_at);
    }
    if (updates.response_data !== undefined) {
      fields.push('response_data = ?');
      values.push(updates.response_data);
    }
    if (updates.circle_transfer_id !== undefined) {
      fields.push('circle_transfer_id = ?');
      values.push(updates.circle_transfer_id);
    }
    if (updates.payment_status !== undefined) {
      fields.push('payment_status = ?');
      values.push(updates.payment_status);
    }
    if (updates.payment_amount !== undefined) {
      fields.push('payment_amount = ?');
      values.push(updates.payment_amount);
    }
    if (updates.real_time_plan_paid !== undefined) {
      fields.push('real_time_plan_paid = ?');
      values.push(updates.real_time_plan_paid);
    }
    if (updates.settlement_state !== undefined) {
      fields.push('settlement_state = ?');
      values.push(updates.settlement_state);
    }
    if (updates.settlement_aggregate_confidence !== undefined) {
      fields.push('settlement_aggregate_confidence = ?');
      values.push(updates.settlement_aggregate_confidence);
    }
    if (updates.settlement_amount_released !== undefined) {
      fields.push('settlement_amount_released = ?');
      values.push(updates.settlement_amount_released);
    }
    if (updates.settlement_escrow_remainder !== undefined) {
      fields.push('settlement_escrow_remainder = ?');
      values.push(updates.settlement_escrow_remainder);
    }
    if (updates.settlement_decision !== undefined) {
      fields.push('settlement_decision = ?');
      values.push(updates.settlement_decision);
    }
    if (updates.insurance_amount !== undefined) {
      fields.push('insurance_amount = ?');
      values.push(updates.insurance_amount);
    }
    if (updates.provider_npi !== undefined) {
      fields.push('provider_npi = ?');
      values.push(updates.provider_npi);
    }
    if (updates.proof_of_care_hash !== undefined) {
      fields.push('proof_of_care_hash = ?');
      values.push(updates.proof_of_care_hash);
    }

    if (fields.length === 0) {
      return { changes: 0 };
    }

    values.push(id);

    const query = `
      UPDATE insurance_claims
      SET ${fields.join(', ')}
      WHERE id = ?
    `;

    const stmt = db.prepare(query);
    return stmt.run(...values);
  },

  // Get all claims with optional filters
  getAllClaims(filters = {}) {
    let query = 'SELECT * FROM insurance_claims WHERE 1=1';
    const params = [];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.patient_id) {
      query += ' AND patient_id = ?';
      params.push(filters.patient_id);
    }

    if (filters.appointment_id) {
      query += ' AND appointment_id = ?';
      params.push(filters.appointment_id);
    }

    query += ' ORDER BY submitted_at DESC';

    const stmt = db.prepare(query);
    return stmt.all(...params);
  },

  // Task 46: Get claims for provider coding review queue (held, low-confidence, manual_review)
  getClaimsForReviewQueue(filters = {}) {
    const limit = Math.min(parseInt(filters.limit, 10) || 50, 100);
    const stmt = db.prepare(`
      SELECT * FROM insurance_claims
      WHERE status IN ('submitted', 'pending', 'draft')
      ORDER BY COALESCE(submitted_at, created_at) DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  },

  // ============================================
  // PAYER CACHE
  // ============================================

  // Upsert payer to cache
  upsertPayer(payer) {
    const stmt = db.prepare(`
      INSERT INTO insurance_payers (id, payer_id, payer_name, aliases, supported_transactions, is_active, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(payer_id) DO UPDATE SET
        payer_name = excluded.payer_name,
        aliases = excluded.aliases,
        supported_transactions = excluded.supported_transactions,
        is_active = excluded.is_active,
        last_updated = excluded.last_updated
    `);
    return stmt.run(
      payer.id,
      payer.payer_id,
      payer.payer_name,
      payer.aliases ? JSON.stringify(payer.aliases) : null,
      payer.supported_transactions ? JSON.stringify(payer.supported_transactions) : null,
      payer.is_active !== undefined ? (payer.is_active ? 1 : 0) : 1,
      new Date().toISOString()
    );
  },

  // Get payer by payer_id
  getPayerByPayerId(payerId) {
    const stmt = db.prepare('SELECT * FROM insurance_payers WHERE payer_id = ? AND is_active = 1');
    return stmt.get(payerId);
  },

  // Search payers by name (fuzzy search)
  searchPayersByName(searchTerm) {
    const stmt = db.prepare(`
      SELECT * FROM insurance_payers
      WHERE (payer_name LIKE ? OR aliases LIKE ?)
      AND is_active = 1
      ORDER BY payer_name
      LIMIT 50
    `);
    return stmt.all(`%${searchTerm}%`, `%${searchTerm}%`);
  },

  // Get all cached payers
  getAllCachedPayers(limit = 1000) {
    const stmt = db.prepare(`
      SELECT * FROM insurance_payers
      WHERE is_active = 1
      ORDER BY payer_name
      LIMIT ?
    `);
    return stmt.all(limit);
  },

  // Get payer cache count
  getPayerCacheCount() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM insurance_payers WHERE is_active = 1');
    return stmt.get().count;
  },

  // ============================================
  // PATIENT INSURANCE
  // ============================================

  // Create or update patient insurance
  upsertPatientInsurance(insurance) {
    // Check if patient already has this insurance (inline the check to avoid circular dependency)
    let existing = null;
    if (insurance.member_id) {
      const checkStmt = db.prepare(`
        SELECT * FROM patient_insurance
        WHERE patient_id = ? AND member_id = ?
        ORDER BY is_primary DESC, created_at DESC
        LIMIT 1
      `);
      existing = checkStmt.get(insurance.patient_id, insurance.member_id);
    } else {
      // Get primary insurance
      const checkStmt = db.prepare(`
        SELECT * FROM patient_insurance
        WHERE patient_id = ? AND is_primary = 1
        ORDER BY created_at DESC
        LIMIT 1
      `);
      existing = checkStmt.get(insurance.patient_id);
    }

    if (existing) {
      // Update existing
      const stmt = db.prepare(`
        UPDATE patient_insurance
        SET payer_id = ?,
            payer_name = ?,
            group_number = ?,
            plan_name = ?,
            relationship_code = ?,
            is_primary = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      return stmt.run(
        insurance.payer_id,
        insurance.payer_name || null,
        insurance.group_number || null,
        insurance.plan_name || null,
        insurance.relationship_code || 'self',
        insurance.is_primary !== undefined ? (insurance.is_primary ? 1 : 0) : 1,
        existing.id
      );
    } else {
      // Create new
      const stmt = db.prepare(`
        INSERT INTO patient_insurance (
          id, patient_id, payer_id, payer_name, member_id,
          group_number, plan_name, relationship_code, is_primary, is_verified, verified_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      return stmt.run(
        insurance.id,
        insurance.patient_id,
        insurance.payer_id,
        insurance.payer_name || null,
        insurance.member_id,
        insurance.group_number || null,
        insurance.plan_name || null,
        insurance.relationship_code || 'self',
        insurance.is_primary !== undefined ? (insurance.is_primary ? 1 : 0) : 1,
        insurance.is_verified !== undefined ? (insurance.is_verified ? 1 : 0) : 0,
        insurance.verified_at || null
      );
    }
  },

  // Get patient insurance by patient_id and member_id
  getPatientInsurance(patientId, memberId = null) {
    if (memberId) {
      const stmt = db.prepare(`
        SELECT * FROM patient_insurance
        WHERE patient_id = ? AND member_id = ?
        ORDER BY is_primary DESC, created_at DESC
        LIMIT 1
      `);
      return stmt.get(patientId, memberId);
    } else {
      // Get primary insurance
      const stmt = db.prepare(`
        SELECT * FROM patient_insurance
        WHERE patient_id = ? AND is_primary = 1
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return stmt.get(patientId);
    }
  },

  // Get all insurance for a patient
  getAllPatientInsurance(patientId) {
    const stmt = db.prepare(`
      SELECT * FROM patient_insurance
      WHERE patient_id = ?
      ORDER BY is_primary DESC, created_at DESC
    `);
    return stmt.all(patientId);
  },

  // Verify patient insurance
  verifyPatientInsurance(insuranceId) {
    const stmt = db.prepare(`
      UPDATE patient_insurance
      SET is_verified = 1,
          verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(insuranceId);
  },

  // ============================================
  // EHR INTEGRATION
  // ============================================

  // Get EHR connection
  getEHRConnection(connectionId) {
    return db.prepare('SELECT * FROM ehr_connections WHERE id = ?').get(connectionId);
  },

  // Get EHR connections by provider
  getEHRConnectionsByProvider(providerId) {
    return db.prepare('SELECT * FROM ehr_connections WHERE provider_id = ? ORDER BY connected_at DESC').all(providerId);
  },

  // Get active EHR connections
  getActiveEHRConnections() {
    return db.prepare(`
      SELECT * FROM ehr_connections 
      WHERE access_token IS NOT NULL 
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        AND connected_at IS NOT NULL
    `).all();
  },

  // Get EHR encounter by FHIR ID
  getEHREncounterByFHIRId(fhirEncounterId) {
    return db.prepare('SELECT * FROM ehr_encounters WHERE fhir_encounter_id = ?').get(fhirEncounterId);
  },

  // Get EHR encounters by appointment
  getEHREncountersByAppointment(appointmentId) {
    return db.prepare(`
      SELECT * FROM ehr_encounters 
      WHERE appointment_id = ? 
      ORDER BY start_time DESC
    `).all(appointmentId);
  },

  // Get EHR encounters by patient
  getEHREncountersByPatient(patientId) {
    return db.prepare(`
      SELECT * FROM ehr_encounters 
      WHERE patient_id = ? 
      ORDER BY start_time DESC
    `).all(patientId);
  },

  // Get conditions (ICD-10) for encounter
  getEHRConditions(encounterId) {
    return db.prepare(`
      SELECT * FROM ehr_conditions 
      WHERE ehr_encounter_id = ? 
      ORDER BY is_primary DESC, created_at
    `).all(encounterId);
  },

  // Get procedures (CPT) for encounter
  getEHRProcedures(encounterId) {
    return db.prepare(`
      SELECT * FROM ehr_procedures 
      WHERE ehr_encounter_id = ? 
      ORDER BY created_at
    `).all(encounterId);
  },

  // Get observations for encounter
  getEHRObservations(encounterId) {
    return db.prepare(`
      SELECT * FROM ehr_observations 
      WHERE ehr_encounter_id = ? 
      ORDER BY created_at
    `).all(encounterId);
  },

  // Get EHR summary for appointment
  getEHRSummaryForAppointment(appointmentId) {
    const encounter = db.prepare(`
      SELECT * FROM ehr_encounters 
      WHERE appointment_id = ? 
      LIMIT 1
    `).get(appointmentId);

    if (!encounter) {
      return null;
    }

    return {
      encounter,
      conditions: this.getEHRConditions(encounter.id),
      procedures: this.getEHRProcedures(encounter.id),
      observations: this.getEHRObservations(encounter.id)
    };
  },

  // Get EHR summary for patient
  getEHRSummaryForPatient(patientId) {
    const encounters = this.getEHREncountersByPatient(patientId);

    return encounters.map(encounter => ({
      encounter,
      conditions: this.getEHRConditions(encounter.id),
      procedures: this.getEHRProcedures(encounter.id),
      observations: this.getEHRObservations(encounter.id)
    }));
  },

  // --------------------------------------------
  // External patient ID mapping (Athena/Epic/etc)
  // --------------------------------------------
  upsertPatientExternalId({
    patient_id,
    source_system,
    tenant_id,
    external_patient_id,
    mrn = null,
    status = 'active',
    metadata_json = null
  }) {
    if (!patient_id || !source_system || !tenant_id || !external_patient_id) {
      throw new Error('Missing required fields for external patient ID mapping');
    }
    const id = require('crypto').randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO patient_external_ids
        (id, patient_id, source_system, tenant_id, external_patient_id, mrn, status, metadata_json, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(source_system, tenant_id, external_patient_id) DO UPDATE SET
        patient_id = excluded.patient_id,
        mrn = excluded.mrn,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      patient_id,
      String(source_system).toLowerCase().trim(),
      String(tenant_id).trim(),
      String(external_patient_id).trim(),
      mrn || null,
      status || 'active',
      metadata_json ? (typeof metadata_json === 'string' ? metadata_json : JSON.stringify(metadata_json)) : null
    );
    return db.prepare(`
      SELECT * FROM patient_external_ids
      WHERE source_system = ? AND tenant_id = ? AND external_patient_id = ?
      LIMIT 1
    `).get(String(source_system).toLowerCase().trim(), String(tenant_id).trim(), String(external_patient_id).trim());
  },

  getPatientExternalIds(patientId) {
    if (!patientId) return [];
    return db.prepare(`
      SELECT * FROM patient_external_ids
      WHERE patient_id = ?
      ORDER BY created_at DESC
    `).all(patientId);
  },

  getPatientByExternalId(source_system, tenant_id, external_patient_id) {
    if (!source_system || !tenant_id || !external_patient_id) return null;
    return db.prepare(`
      SELECT p.*
      FROM patient_external_ids x
      INNER JOIN fhir_patients p ON p.resource_id = x.patient_id
      WHERE x.source_system = ? AND x.tenant_id = ? AND x.external_patient_id = ?
        AND p.is_deleted = 0
      LIMIT 1
    `).get(
      String(source_system).toLowerCase().trim(),
      String(tenant_id).trim(),
      String(external_patient_id).trim()
    ) || null;
  },

  enqueueEhrSyncJob({
    event_type,
    patient_id,
    appointment_id = null,
    source_system = 'athena',
    tenant_id = 'clinic-default',
    payload_json = null,
    idempotency_key = null,
    run_at = null
  }) {
    if (!event_type || !patient_id) throw new Error('event_type and patient_id are required');
    const idem = idempotency_key ? String(idempotency_key).trim() : null;
    if (idem) {
      const existing = db.prepare(`
        SELECT id FROM ehr_sync_jobs WHERE idempotency_key = ? LIMIT 1
      `).get(idem);
      if (existing?.id) return existing.id;
    }
    const id = require('crypto').randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO ehr_sync_jobs
        (id, event_type, patient_id, appointment_id, source_system, tenant_id, payload_json, idempotency_key, status, attempts, max_attempts, run_at, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 5, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      id,
      event_type,
      patient_id,
      appointment_id || null,
      String(source_system).toLowerCase().trim(),
      String(tenant_id).trim(),
      payload_json ? (typeof payload_json === 'string' ? payload_json : JSON.stringify(payload_json)) : null,
      idem,
      run_at || null
    );
    return id;
  },

  // ============================================
  // USAGE TRACKING & LOGGING
  // ============================================

  // API Usage Logging
  logAPIUsage(usage) {
    return db.prepare(`
      INSERT INTO api_usage_log 
      (id, customer_id, api_key_id, endpoint, method, status_code, 
       response_time_ms, request_size_bytes, response_size_bytes, 
       ip_address, user_agent, request_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      usage.id || require('crypto').randomBytes(16).toString('hex'),
      usage.customer_id || null,
      usage.api_key_id || null,
      usage.endpoint,
      usage.method,
      usage.status_code || null,
      usage.response_time_ms || null,
      usage.request_size_bytes || null,
      usage.response_size_bytes || null,
      usage.ip_address || null,
      usage.user_agent || null,
      usage.request_id || null
    );
  },

  getAPIUsageByCustomer(customerId, limit = 100) {
    return db.prepare(`
      SELECT * FROM api_usage_log 
      WHERE customer_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(customerId, limit);
  },

  getAPIUsageByEndpoint(endpoint, limit = 100) {
    return db.prepare(`
      SELECT * FROM api_usage_log 
      WHERE endpoint = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(endpoint, limit);
  },

  // Voice Call Logging
  async logVoiceCall(call) {
    const callId = call.id || require('crypto').randomBytes(16).toString('hex');

    if (usePostgres && pgPool) {
      // Postgres path
      await pgPool`
        INSERT INTO voice_call_log 
        (id, customer_id, call_id, twilio_call_sid, call_duration_seconds, call_duration_minutes, 
         credits_deducted, function_calls_count, status, twilio_cost_usd, retell_cost_usd, 
         total_cost_usd, twilio_cost_calculated_usd, retell_cost_calculated_usd, cost_source, cost_updated_at, created_at)
        VALUES (
          ${callId},
          ${call.customer_id || null},
          ${call.call_id},
          ${call.twilio_call_sid || null},
          ${call.call_duration_seconds || null},
          ${call.call_duration_minutes || null},
          ${call.credits_deducted || 0},
          ${call.function_calls_count || 0},
          ${call.status || 'active'},
          ${call.twilio_cost_usd || null},
          ${call.retell_cost_usd || null},
          ${call.total_cost_usd || null},
          ${call.twilio_cost_calculated_usd || null},
          ${call.retell_cost_calculated_usd || null},
          ${call.cost_source || null},
          ${call.cost_updated_at || null},
          ${call.created_at || new Date().toISOString()}
        )
      `;
      return { changes: 1, lastInsertRowid: callId };
    } else {
      // SQLite path
      const result = db.prepare(`
        INSERT INTO voice_call_log 
        (id, customer_id, call_id, twilio_call_sid, call_duration_seconds, call_duration_minutes, 
         credits_deducted, function_calls_count, status, twilio_cost_usd, retell_cost_usd, 
         total_cost_usd, twilio_cost_calculated_usd, retell_cost_calculated_usd, cost_source, cost_updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callId,
        call.customer_id || null,
        call.call_id,
        call.twilio_call_sid || null,
        call.call_duration_seconds || null,
        call.call_duration_minutes || null,
        call.credits_deducted || 0,
        call.function_calls_count || 0,
        call.status || 'active',
        call.twilio_cost_usd || null,
        call.retell_cost_usd || null,
        call.total_cost_usd || null,
        call.twilio_cost_calculated_usd || null,
        call.retell_cost_calculated_usd || null,
        call.cost_source || null,
        call.cost_updated_at || null
      );
      return result;
    }
  },

  // Update voice call costs
  updateVoiceCallCosts(callId, costData) {
    const result = db.prepare(`
      UPDATE voice_call_log 
      SET twilio_cost_usd = ?,
          retell_cost_usd = ?,
          total_cost_usd = ?,
          twilio_cost_calculated_usd = ?,
          retell_cost_calculated_usd = ?,
          cost_source = ?,
          cost_updated_at = datetime('now')
      WHERE call_id = ?
    `).run(
      costData.twilio_cost_usd || null,
      costData.retell_cost_usd || null,
      costData.total_cost_usd || null,
      costData.twilio_cost_calculated_usd || null,
      costData.retell_cost_calculated_usd || null,
      costData.cost_source || 'calculated',
      callId
    );
    if (pgPool && result.changes) {
      const updatedCall = db.prepare('SELECT * FROM voice_call_log WHERE call_id = ? ORDER BY created_at DESC LIMIT 1').get(callId);
      syncVoiceCallToPostgres(updatedCall);
    }
    return result;
  },

  // Get voice call costs by customer
  getVoiceCallCostsByCustomer(customerId, startDate = null, endDate = null) {
    let query = `
      SELECT 
        call_id,
        twilio_call_sid,
        call_duration_minutes,
        twilio_cost_usd,
        retell_cost_usd,
        total_cost_usd,
        cost_source,
        cost_updated_at,
        created_at
      FROM voice_call_log 
      WHERE customer_id = ?
    `;
    const params = [customerId];

    if (startDate) {
      query += ' AND DATE(created_at) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND DATE(created_at) <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY created_at DESC';

    return db.prepare(query).all(...params);
  },

  // Get total costs for a customer
  getCustomerTotalCosts(customerId, startDate = null, endDate = null) {
    let query = `
      SELECT 
        COUNT(*) as total_calls,
        SUM(call_duration_minutes) as total_minutes,
        SUM(twilio_cost_usd) as total_twilio_cost,
        SUM(retell_cost_usd) as total_retell_cost,
        SUM(total_cost_usd) as total_cost
      FROM voice_call_log 
      WHERE customer_id = ? AND total_cost_usd IS NOT NULL
    `;
    const params = [customerId];

    if (startDate) {
      query += ' AND DATE(created_at) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND DATE(created_at) <= ?';
      params.push(endDate);
    }

    return db.prepare(query).get(...params);
  },

  getVoiceCallsByCustomer(customerId, limit = 100) {
    return db.prepare(`
      SELECT * FROM voice_call_log 
      WHERE customer_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(customerId, limit);
  },

  // Voice call state (medical coding agent)
  getCallState(callId) {
    const row = db.prepare(`
      SELECT * FROM voice_call_states WHERE call_id = ?
    `).get(callId);
    if (!row) return null;
    return {
      call_id: row.call_id,
      clinic_id: row.clinic_id,
      current_stage: row.current_stage || 'INTAKE',
      state_data: row.state_data ? JSON.parse(row.state_data) : {},
      updated_at: row.updated_at
    };
  },

  upsertCallState(callId, { clinic_id, current_stage, state_data }) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const stateJson = state_data != null ? JSON.stringify(state_data) : null;
    const cid = clinic_id ?? null;
    const stage = current_stage ?? null;
    db.prepare(`
      INSERT INTO voice_call_states (id, call_id, clinic_id, current_stage, state_data, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(call_id) DO UPDATE SET
        clinic_id = COALESCE(excluded.clinic_id, voice_call_states.clinic_id),
        current_stage = COALESCE(excluded.current_stage, voice_call_states.current_stage),
        state_data = COALESCE(excluded.state_data, voice_call_states.state_data),
        updated_at = datetime('now')
    `).run(id, callId, cid, stage, stateJson);
    return this.getCallState(callId);
  },

  appendConversationMemory(callId, clinic_id, role, content, extracted_entities) {
    let redactedContent = content;
    try {
      const piiRedactor = require('./utils/pii-redactor');
      if (typeof content === 'string' && piiRedactor.redact) {
        redactedContent = piiRedactor.redact(content);
      }
    } catch (_) { /* pii-redactor optional */ }
    const id = require('crypto').randomBytes(16).toString('hex');
    const turnNumber = db.prepare(`
      SELECT COALESCE(MAX(turn_number), 0) + 1 AS next FROM voice_conversation_memory WHERE call_id = ?
    `).get(callId).next;
    const entitiesJson = extracted_entities ? JSON.stringify(extracted_entities) : null;
    db.prepare(`
      INSERT INTO voice_conversation_memory (id, call_id, clinic_id, turn_number, role, content, extracted_entities)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, callId, clinic_id || null, turnNumber, role, redactedContent ?? content ?? null, entitiesJson);
  },

  getConversationHistory(callId, limit = 50) {
    return db.prepare(`
      SELECT turn_number, role, content, extracted_entities, created_at
      FROM voice_conversation_memory
      WHERE call_id = ?
      ORDER BY turn_number ASC
      LIMIT ?
    `).all(callId, limit).map(r => ({
      turn_number: r.turn_number,
      role: r.role,
      content: r.content,
      extracted_entities: r.extracted_entities ? JSON.parse(r.extracted_entities) : null,
      created_at: r.created_at
    }));
  },

  saveAgentStateSnapshot(callId, stateName, stateData) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const dataJson = stateData ? JSON.stringify(stateData) : null;
    db.prepare(`
      INSERT INTO agent_state_snapshots (id, call_id, state_name, state_data)
      VALUES (?, ?, ?, ?)
    `).run(id, callId, stateName, dataJson);
  },

  logDecision(callId, node, inputSummary, outputSummary, reasoning) {
    try {
      const tableInfo = db.prepare('PRAGMA table_info(decision_log)').all();
      if (tableInfo.length === 0) return;
      const id = require('crypto').randomBytes(16).toString('hex');
      const inputStr = typeof inputSummary === 'string' ? inputSummary : (inputSummary ? JSON.stringify(inputSummary).slice(0, 2000) : null);
      const outputStr = typeof outputSummary === 'string' ? outputSummary : (outputSummary ? JSON.stringify(outputSummary).slice(0, 2000) : null);
      const reasonStr = typeof reasoning === 'string' ? reasoning.slice(0, 4000) : null;
      db.prepare(`
        INSERT INTO decision_log (id, call_id, node, input_summary, output_summary, reasoning)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, callId, node, inputStr, outputStr, reasonStr);
    } catch (e) {
      console.warn('⚠️  decision_log insert failed:', e.message);
    }
  },

  cleanupVoiceCallStateData(retentionDays = 30) {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(1, retentionDays));
    const cutoffStr = d.toISOString().slice(0, 19).replace('T', ' ');
    let total = 0;
    const r1 = db.prepare('DELETE FROM voice_call_states WHERE updated_at < ?').run(cutoffStr);
    total += r1.changes;
    const r2 = db.prepare('DELETE FROM voice_conversation_memory WHERE created_at < ?').run(cutoffStr);
    total += r2.changes;
    const r3 = db.prepare('DELETE FROM agent_state_snapshots WHERE created_at < ?').run(cutoffStr);
    total += r3.changes;
    const r4 = db.prepare('DELETE FROM coding_decisions WHERE created_at < ?').run(cutoffStr);
    total += r4.changes;
    try {
      const r5 = db.prepare('DELETE FROM decision_log WHERE created_at < ?').run(cutoffStr);
      total += r5.changes;
    } catch (_) {}
    if (total > 0) {
      console.log(`🧹 Cleaned ${total} voice call state records (older than ${retentionDays} days)`);
    }
    return { deleted: total, retentionDays, cutoff: cutoffStr };
  },

  cleanupVideoConsultData(retentionDays = 30) {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(1, retentionDays));
    const cutoffStr = d.toISOString().slice(0, 19).replace('T', ' ');
    let total = 0;
    try {
      const r1 = db.prepare('DELETE FROM video_consult_sessions WHERE created_at < ?').run(cutoffStr);
      total += r1.changes;
      const r2 = db.prepare('DELETE FROM video_consult_ai_decisions WHERE created_at < ?').run(cutoffStr);
      total += r2.changes;
    } catch (e) {
      if (e.message && !e.message.includes('no such table')) console.warn('⚠️  cleanupVideoConsultData:', e.message);
    }
    const reviewDays = Math.min(retentionDays * 3, 90);
    const reviewCutoff = new Date();
    reviewCutoff.setDate(reviewCutoff.getDate() - reviewDays);
    const reviewCutoffStr = reviewCutoff.toISOString().slice(0, 19).replace('T', ' ');
    try {
      const r3 = db.prepare('DELETE FROM video_consult_review_tasks WHERE resolved_at IS NOT NULL AND resolved_at < ?').run(reviewCutoffStr);
      total += r3.changes;
    } catch (e) {
      if (e.message && !e.message.includes('no such table')) console.warn('⚠️  cleanupVideoConsultData review_tasks:', e.message);
    }
    if (total > 0) {
      console.log(`🧹 Cleaned ${total} video consult records (sessions/decisions: ${retentionDays}d, resolved tasks: ${reviewDays}d)`);
    }
    return { deleted: total, retentionDays, cutoff: cutoffStr };
  },

  // Video consult sessions (multimodal telehealth)
  createVideoConsultSession(roomId, options = {}) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const metaJson = options.metadata ? JSON.stringify(options.metadata) : null;
    // Resolve appointment_id from room_id if it's appt-xxx format
    let appointmentId = options.appointment_id || null;
    if (!appointmentId && roomId && roomId.startsWith('appt-')) {
      const aptId = roomId.replace(/^appt-/, '');
      try {
        const apt = this.getAppointment(aptId);
        if (apt) appointmentId = apt.id;
      } catch (_) {}
    }
    try {
      db.prepare(`
        INSERT INTO video_consult_sessions (id, room_id, appointment_id, encounter_id, clinic_id, patient_id, provider_id, session_status, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        id, roomId, appointmentId,
        options.encounter_id ?? null,
        options.clinic_id ?? null,
        options.patient_id ?? null,
        options.provider_id ?? null,
        metaJson
      );
      // Link appointment to session
      if (appointmentId) {
        try {
          db.prepare(`UPDATE appointments SET video_session_id = ? WHERE id = ?`).run(id, appointmentId);
        } catch (_) {}
      }
      return this.getVideoConsultSession(roomId);
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return this.getVideoConsultSession(roomId);
      }
      throw e;
    }
  },

  getVideoConsultSession(roomId) {
    const row = db.prepare('SELECT * FROM video_consult_sessions WHERE room_id = ?').get(roomId);
    if (!row) return null;
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
  },

  endVideoConsultSession(roomId, metadata = null) {
    const metaJson = metadata ? JSON.stringify(metadata) : null;
    db.prepare(`
      UPDATE video_consult_sessions SET session_status = 'ended', end_time = datetime('now'),
        metadata = COALESCE(?, metadata), updated_at = datetime('now')
      WHERE room_id = ?
    `).run(metaJson, roomId);
    return this.getVideoConsultSession(roomId);
  },

  insertVideoConsultAiDecision(roomId, stage, findings, codes, confidence, patientId, modelUsed) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const findingsJson = findings ? JSON.stringify(findings) : null;
    const codesJson = codes ? JSON.stringify(codes) : null;
    try {
      db.prepare(`
        INSERT INTO video_consult_ai_decisions (id, room_id, stage, findings, codes, confidence, patient_id, model_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, roomId, stage, findingsJson, codesJson, confidence ?? null, patientId ?? null, modelUsed ?? null);
      return id;
    } catch (e) {
      console.warn('⚠️  video_consult_ai_decisions insert failed:', e.message);
      return null;
    }
  },

  /**
   * Insert an audit record for an RCM/financial agent decision.
   * @param {object} payload
   * @returns {string|null} id
   */
  insertRcmAiDecision(payload = {}) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const inputRef = payload.input_ref ? JSON.stringify(payload.input_ref) : null;
    const inputSnapshot = payload.input_snapshot ? JSON.stringify(payload.input_snapshot) : null;
    const outputSnapshot = payload.output_snapshot ? JSON.stringify(payload.output_snapshot) : null;
    const explanation = payload.explanation
      ? (typeof payload.explanation === 'string' ? payload.explanation : JSON.stringify(payload.explanation))
      : null;
    try {
      db.prepare(`
        INSERT INTO ai_decisions_rcm (
          id, merchant_id, clinic_id, empi_id, patient_id,
          agent_type, operation, input_ref, input_snapshot, output_snapshot,
          explanation, confidence, requires_human_review, human_review_status,
          reviewed_by, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        payload.merchant_id ?? null,
        payload.clinic_id ?? null,
        payload.empi_id ?? null,
        payload.patient_id ?? null,
        payload.agent_type,
        payload.operation,
        inputRef,
        inputSnapshot,
        outputSnapshot,
        explanation,
        payload.confidence ?? null,
        payload.requires_human_review ? 1 : 0,
        payload.human_review_status ?? (payload.requires_human_review ? 'pending' : 'n/a'),
        payload.reviewed_by ?? null,
        payload.reviewed_at ?? null
      );
      return id;
    } catch (e) {
      console.warn('⚠️  ai_decisions_rcm insert failed:', e.message);
      return null;
    }
  },

  /**
   * List recent RCM AI decisions for a tenant/patient/EMPI.
   * @param {object} options
   * @returns {Array}
   */
  listRcmAiDecisions(options = {}) {
    const limit = Math.min(parseInt(options.limit || '50', 10) || 50, 200);
    const where = [];
    const args = [];
    if (options.merchant_id) {
      where.push('merchant_id = ?');
      args.push(options.merchant_id);
    }
    if (options.clinic_id) {
      where.push('clinic_id = ?');
      args.push(options.clinic_id);
    }
    if (options.empi_id) {
      where.push('empi_id = ?');
      args.push(options.empi_id);
    }
    if (options.patient_id) {
      where.push('patient_id = ?');
      args.push(options.patient_id);
    }
    if (options.agent_type) {
      where.push('agent_type = ?');
      args.push(options.agent_type);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(`
        SELECT * FROM ai_decisions_rcm
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(...args, limit);
    return rows.map((r) => ({
      ...r,
      input_ref: r.input_ref ? JSON.parse(r.input_ref) : null,
      input_snapshot: r.input_snapshot ? JSON.parse(r.input_snapshot) : null,
      output_snapshot: r.output_snapshot ? JSON.parse(r.output_snapshot) : null,
      explanation: (() => {
        if (!r.explanation) return null;
        try {
          return JSON.parse(r.explanation);
        } catch (_) {
          return r.explanation;
        }
      })()
    }));
  },

  /**
   * Upsert billed premium obligation for an EMPI/month.
   * @param {object} payload
   * @returns {string|null} id
   */
  upsertRcmPremiumObligation(payload = {}) {
    const empiId = payload.empi_id;
    const billingMonth = payload.billing_month;
    if (!empiId || !billingMonth) return null;
    const id = payload.id || require('crypto').randomBytes(16).toString('hex');
    try {
      db.prepare(`
        INSERT INTO rcm_premium_obligations (id, empi_id, billing_month, billed_amount, currency, payer_name, plan_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(empi_id, billing_month) DO UPDATE SET
          billed_amount = excluded.billed_amount,
          currency = excluded.currency,
          payer_name = excluded.payer_name,
          plan_id = excluded.plan_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        id,
        empiId,
        billingMonth,
        parseFloat(payload.billed_amount || 0),
        payload.currency || 'USD',
        payload.payer_name || null,
        payload.plan_id || null
      );
      const row = db.prepare('SELECT id FROM rcm_premium_obligations WHERE empi_id = ? AND billing_month = ?').get(empiId, billingMonth);
      return row?.id || id;
    } catch (e) {
      console.warn('⚠️  rcm_premium_obligations upsert failed:', e.message);
      return null;
    }
  },

  /**
   * Add a premium payment record for an EMPI/month.
   * @param {object} payload
   * @returns {string|null} id
   */
  addRcmPremiumPayment(payload = {}) {
    const empiId = payload.empi_id;
    const billingMonth = payload.billing_month;
    if (!empiId || !billingMonth) return null;
    const id = payload.id || require('crypto').randomBytes(16).toString('hex');
    try {
      db.prepare(`
        INSERT INTO rcm_premium_payments (id, empi_id, billing_month, paid_amount, currency, rail, reference)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        empiId,
        billingMonth,
        parseFloat(payload.paid_amount || 0),
        payload.currency || 'USD',
        payload.rail || null,
        payload.reference || null
      );
      return id;
    } catch (e) {
      console.warn('⚠️  rcm_premium_payments insert failed:', e.message);
      return null;
    }
  },

  /**
   * Get total billed vs paid premium for an EMPI/month.
   * @param {string} empiId
   * @param {string} billingMonth - YYYY-MM
   * @returns {{ billed_amount: number, paid_amount: number, currency: string }}
   */
  getRcmPremiumTotalsForMonth(empiId, billingMonth) {
    if (!empiId || !billingMonth) return { billed_amount: 0, paid_amount: 0, currency: 'USD' };
    try {
      const ob = db
        .prepare('SELECT billed_amount, currency FROM rcm_premium_obligations WHERE empi_id = ? AND billing_month = ?')
        .get(empiId, billingMonth);
      const pay = db
        .prepare('SELECT COALESCE(SUM(paid_amount), 0) as total_paid FROM rcm_premium_payments WHERE empi_id = ? AND billing_month = ?')
        .get(empiId, billingMonth);
      return {
        billed_amount: parseFloat(ob?.billed_amount || 0),
        paid_amount: parseFloat(pay?.total_paid || 0),
        currency: ob?.currency || 'USD'
      };
    } catch (e) {
      if (!e.message?.includes('no such table')) console.warn('⚠️  getRcmPremiumTotalsForMonth:', e.message);
      return { billed_amount: 0, paid_amount: 0, currency: 'USD' };
    }
  },

  // Incremental transcript persistence (real-time)
  insertVideoConsultTranscript(roomId, transcriptData) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const { appointment_id, participant_identity, speaker, text, timestamp, source } = transcriptData;
    try {
      db.prepare(`
        INSERT INTO video_consult_transcripts (id, room_id, appointment_id, participant_identity, speaker, text, timestamp, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, roomId, appointment_id || null, participant_identity || null,
        speaker || 'unknown', text || '', timestamp || new Date().toISOString(), source || 'agent_stt'
      );
      return id;
    } catch (e) {
      console.warn('⚠️  video_consult_transcripts insert failed:', e.message);
      return null;
    }
  },

  /** vc-4: Encounter vitals (provider-entered during video consult) */
  insertEncounterVitals(data) {
    try {
      const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='encounter_vitals'").get();
      if (!tbl) return null;
      const id = require('crypto').randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO encounter_vitals (id, encounter_id, appointment_id, room_id, blood_pressure_systolic, blood_pressure_diastolic,
          heart_rate, blood_sugar_mgdl, temperature_f, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        id,
        data.encounter_id || null,
        data.appointment_id || null,
        data.room_id || null,
        data.blood_pressure_systolic ?? null,
        data.blood_pressure_diastolic ?? null,
        data.heart_rate ?? null,
        data.blood_sugar_mgdl ?? null,
        data.temperature_f ?? null,
        data.notes || null
      );
      return id;
    } catch (e) {
      console.warn('⚠️  encounter_vitals insert failed:', e.message);
      return null;
    }
  },

  getEncounterVitals(encounterIdOrRoomId) {
    try {
      const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='encounter_vitals'").get();
      if (!tbl) return [];
      const rows = db.prepare(`
        SELECT * FROM encounter_vitals WHERE encounter_id = ? OR room_id = ? OR appointment_id = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(encounterIdOrRoomId, encounterIdOrRoomId, encounterIdOrRoomId);
      return rows;
    } catch (e) {
      return [];
    }
  },

  //
  // EMPI (Enterprise Master Patient Index) helpers
  //

  /**
   * Create a new EMPI person and optional primary_patient_id.
   * @param {string|null} primaryPatientId
   * @returns {{id: string, primary_patient_id: string|null, created_at: string, updated_at: string}}
   */
  createEmpiPerson(primaryPatientId = null) {
    const id = require('crypto').randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO empi_persons (id, primary_patient_id)
      VALUES (?, ?)
    `).run(id, primaryPatientId || null);
    return db.prepare('SELECT * FROM empi_persons WHERE id = ?').get(id);
  },

  /**
   * Find EMPI by a linked source id (e.g. FHIR Patient, internal patient).
   * @param {string} sourceSystem
   * @param {string} sourceId
   * @returns {{id: string, primary_patient_id: string|null}|null}
   */
  getEmpiBySource(sourceSystem, sourceId) {
    const link = db
      .prepare('SELECT empi_id FROM empi_links WHERE source_system = ? AND source_id = ?')
      .get(sourceSystem, sourceId);
    if (!link) return null;
    return db.prepare('SELECT * FROM empi_persons WHERE id = ?').get(link.empi_id);
  },

  /**
   * Link a source id to an EMPI person (idempotent on source_system+source_id).
   * @param {string} empiId
   * @param {string} sourceSystem
   * @param {string} sourceId
   * @param {string} [entityType]
   * @param {number} [confidence]
   * @returns {string} link id
   */
  addEmpiLink(empiId, sourceSystem, sourceId, entityType = null, confidence = 1.0) {
    const existing = db
      .prepare('SELECT id FROM empi_links WHERE source_system = ? AND source_id = ?')
      .get(sourceSystem, sourceId);
    if (existing) {
      return existing.id;
    }
    const id = require('crypto').randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO empi_links (id, empi_id, source_system, source_id, entity_type, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, empiId, sourceSystem, sourceId, entityType || null, confidence ?? 1.0);
    return id;
  },

  /**
   * Get all links for an EMPI person.
   * @param {string} empiId
   * @returns {Array<{id: string, empi_id: string, source_system: string, source_id: string, entity_type: string|null, confidence: number}>}
   */
  getEmpiLinks(empiId) {
    return db
      .prepare('SELECT * FROM empi_links WHERE empi_id = ? ORDER BY created_at ASC')
      .all(empiId);
  },

  // Get transcripts for a room/appointment
  getVideoConsultTranscripts(roomId, appointmentId = null) {
    let query = 'SELECT * FROM video_consult_transcripts WHERE room_id = ?';
    const params = [roomId];
    if (appointmentId) {
      query += ' OR appointment_id = ?';
      params.push(appointmentId);
    }
    query += ' ORDER BY timestamp ASC, created_at ASC';
    return db.prepare(query).all(...params);
  },

  // Incremental frame persistence (real-time)
  insertVideoConsultFrame(roomId, frameData) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const { appointment_id, participant_identity, frame_url, yolo_detections, timestamp } = frameData;
    const detectionsJson = yolo_detections ? JSON.stringify(yolo_detections) : null;
    try {
      db.prepare(`
        INSERT INTO video_consult_frames (id, room_id, appointment_id, participant_identity, frame_url, yolo_detections, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, roomId, appointment_id || null, participant_identity || null,
        frame_url || null, detectionsJson, timestamp || new Date().toISOString()
      );
      return id;
    } catch (e) {
      console.warn('⚠️  video_consult_frames insert failed:', e.message);
      return null;
    }
  },

  insertVideoConsultRiskEvent(roomId, riskData) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const { appointment_id, patient_id, provider_id, rule_id, level, match_snippet } = riskData;
    try {
      db.prepare(`
        INSERT INTO video_consult_risk_events (id, room_id, appointment_id, patient_id, provider_id, rule_id, level, match_snippet)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, roomId, appointment_id || null, patient_id || null, provider_id || null, rule_id || 'unknown', level || 'moderate', (match_snippet || '').slice(0, 80));
      return id;
    } catch (e) {
      console.warn('⚠️  video_consult_risk_events insert failed:', e.message);
      return null;
    }
  },

  // Get frames for a room/appointment
  getVideoConsultFrames(roomId, appointmentId = null) {
    let query = 'SELECT * FROM video_consult_frames WHERE room_id = ?';
    const params = [roomId];
    if (appointmentId) {
      query += ' OR appointment_id = ?';
      params.push(appointmentId);
    }
    query += ' ORDER BY timestamp ASC, created_at ASC';
    const rows = db.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      yolo_detections: r.yolo_detections ? JSON.parse(r.yolo_detections) : null
    }));
  },

  insertCodingDecision({ call_id, clinic_id, patient_id, clinical_note, proposed_icd10, proposed_cpt, reasoning, confidence_score, validation_status, validation_reason, rule_version, rule_hash }) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const cdInfo = db.prepare('PRAGMA table_info(coding_decisions)').all();
    const hasRuleVersion = cdInfo.some(c => c.name === 'rule_version');
    const hasRuleHash = cdInfo.some(c => c.name === 'rule_hash');
    if (hasRuleVersion && hasRuleHash) {
      db.prepare(`
        INSERT INTO coding_decisions (id, call_id, clinic_id, patient_id, clinical_note, proposed_icd10, proposed_cpt, reasoning, confidence_score, validation_status, validation_reason, rule_version, rule_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, call_id || null, clinic_id || null, patient_id || null, clinical_note || null,
        proposed_icd10 || '', proposed_cpt || '', reasoning || null, confidence_score ?? null,
        validation_status || 'unknown', validation_reason || null, rule_version || null, rule_hash || null
      );
    } else {
      db.prepare(`
        INSERT INTO coding_decisions (id, call_id, clinic_id, patient_id, clinical_note, proposed_icd10, proposed_cpt, reasoning, confidence_score, validation_status, validation_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, call_id || null, clinic_id || null, patient_id || null, clinical_note || null,
        proposed_icd10 || '', proposed_cpt || '', reasoning || null, confidence_score ?? null,
        validation_status || 'unknown', validation_reason || null
      );
    }
    if (patient_id && (proposed_icd10 || proposed_cpt)) {
      try {
        const histId = require('crypto').randomBytes(12).toString('hex');
        db.prepare(`
          INSERT INTO patient_coding_history (id, patient_id, encounter_id, clinic_id, icd10, cpt, confidence, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          histId, patient_id, call_id || null, clinic_id || null,
          typeof proposed_icd10 === 'string' ? proposed_icd10 : JSON.stringify(proposed_icd10 || []),
          typeof proposed_cpt === 'string' ? proposed_cpt : JSON.stringify(proposed_cpt || []),
          confidence_score ?? null
        );
      } catch (_) {}
    }
    return id;
  },

  insertLlmUsageLog({ call_id, clinic_id, operation, model, tokens_in, tokens_out, cost_usd, latency_ms, confidence_score }) {
    const id = require('crypto').randomBytes(16).toString('hex');
    try {
      const info = db.prepare('PRAGMA table_info(llm_usage_log)').all();
      const hasClinicId = info.some(c => c.name === 'clinic_id');
      const hasConfidence = info.some(c => c.name === 'confidence_score');
      if (hasClinicId && hasConfidence) {
        db.prepare(`
          INSERT INTO llm_usage_log (id, call_id, clinic_id, operation, model, tokens_in, tokens_out, cost_usd, latency_ms, confidence_score)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, call_id || null, clinic_id || null, operation || 'unknown', model || '',
          tokens_in ?? null, tokens_out ?? null, cost_usd ?? null, latency_ms ?? null, confidence_score ?? null
        );
      } else if (hasConfidence) {
        db.prepare(`
          INSERT INTO llm_usage_log (id, call_id, operation, model, tokens_in, tokens_out, cost_usd, latency_ms, confidence_score)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, call_id || null, operation || 'unknown', model || '', tokens_in ?? null, tokens_out ?? null,
          cost_usd ?? null, latency_ms ?? null, confidence_score ?? null
        );
      } else {
        db.prepare(`
          INSERT INTO llm_usage_log (id, call_id, operation, model, tokens_in, tokens_out, cost_usd, latency_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, call_id || null, operation || 'unknown', model || '', tokens_in ?? null, tokens_out ?? null,
          cost_usd ?? null, latency_ms ?? null
        );
      }
      if (clinic_id && (cost_usd > 0 || tokens_in > 0 || tokens_out > 0)) {
        try {
          const ym = new Date().toISOString().slice(0, 7);
          db.prepare(`
            INSERT INTO clinic_monthly_llm_cost (clinic_id, year_month, cost_usd, tokens_in, tokens_out, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(clinic_id, year_month) DO UPDATE SET
              cost_usd = clinic_monthly_llm_cost.cost_usd + excluded.cost_usd,
              tokens_in = clinic_monthly_llm_cost.tokens_in + excluded.tokens_in,
              tokens_out = clinic_monthly_llm_cost.tokens_out + excluded.tokens_out,
              updated_at = datetime('now')
          `).run(clinic_id, ym, cost_usd || 0, tokens_in || 0, tokens_out || 0);
        } catch (_) {}
      }
    } catch (e) {
      try {
        db.prepare(`
          INSERT INTO llm_usage_log (id, call_id, operation, model, tokens_in, tokens_out, cost_usd, latency_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, call_id || null, operation || 'unknown', model || '', tokens_in ?? null, tokens_out ?? null,
          cost_usd ?? null, latency_ms ?? null
        );
      } catch (e2) {
        throw e;
      }
    }
    return id;
  },

  getLlmUsageAggregates(days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const since = cutoff.toISOString().slice(0, 19).replace('T', ' ');
    const rows = db.prepare(`
      SELECT operation, model,
             COUNT(*) as calls,
             SUM(tokens_in) as total_tokens_in,
             SUM(tokens_out) as total_tokens_out,
             SUM(cost_usd) as total_cost_usd,
             AVG(latency_ms) as avg_latency_ms
      FROM llm_usage_log
      WHERE created_at >= ?
      GROUP BY operation, model
    `).all(since);
    const confRows = db.prepare(`
      SELECT
        CASE
          WHEN confidence_score IS NULL THEN 'unknown'
          WHEN confidence_score >= 0.9 THEN '0.9-1.0'
          WHEN confidence_score >= 0.8 THEN '0.8-0.9'
          WHEN confidence_score >= 0.7 THEN '0.7-0.8'
          WHEN confidence_score >= 0.5 THEN '0.5-0.7'
          ELSE '0-0.5'
        END as bucket,
        COUNT(*) as count
      FROM llm_usage_log
      WHERE created_at >= ?
      GROUP BY bucket
    `).all(since);
    // P95/P99 latency (Section 3)
    const latencies = db.prepare(`
      SELECT latency_ms FROM llm_usage_log
      WHERE created_at >= ? AND latency_ms IS NOT NULL
      ORDER BY latency_ms
    `).all(since).map(r => r.latency_ms);
    let p95_latency_ms = null, p99_latency_ms = null;
    if (latencies.length > 0) {
      const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
      const p99Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.99));
      p95_latency_ms = Math.round(latencies[p95Idx]);
      p99_latency_ms = Math.round(latencies[p99Idx]);
    }
    // Cost by model (Section 10 - groq_cost_7d, openai_cost_7d)
    const costByModel = db.prepare(`
      SELECT model, SUM(cost_usd) as total_cost
      FROM llm_usage_log WHERE created_at >= ? AND cost_usd > 0
      GROUP BY model
    `).all(since);
    const groq_cost_7d = costByModel.filter(r => /groq|llama/i.test(r.model)).reduce((s, r) => s + (r.total_cost || 0), 0);
    const openai_cost_7d = costByModel.filter(r => /openai|gpt|embedding/i.test(r.model)).reduce((s, r) => s + (r.total_cost || 0), 0);

    return {
      byOperation: rows,
      confidenceDistribution: confRows,
      p95_latency_ms,
      p99_latency_ms,
      groq_cost_7d: Math.round(groq_cost_7d * 10000) / 10000,
      openai_cost_7d: Math.round(openai_cost_7d * 10000) / 10000
    };
  },

  getClinicMonthlyLlmCost(clinicId, yearMonth = null) {
    const ym = yearMonth || new Date().toISOString().slice(0, 7);
    try {
      return db.prepare(`
        SELECT clinic_id, year_month, cost_usd, tokens_in, tokens_out
        FROM clinic_monthly_llm_cost WHERE clinic_id = ? AND year_month = ?
      `).get(clinicId, ym);
    } catch (_) { return null; }
  },
  getClinicMonthlyCostCap(clinicId) {
    try {
      const r = db.prepare('SELECT monthly_cost_cap FROM clinics WHERE clinic_id = ?').get(clinicId);
      return r?.monthly_cost_cap;
    } catch (_) { return null; }
  },

  getPatientCodingHistory(patientId, limit = 20) {
    try {
      return db.prepare(`
        SELECT * FROM patient_coding_history
        WHERE patient_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(patientId, limit);
    } catch (_) { return []; }
  },

  getPatientIdForCall(callId) {
    try {
      const r = db.prepare('SELECT patient_id FROM fhir_encounters WHERE call_id = ? AND is_deleted = 0 LIMIT 1').get(callId);
      return r?.patient_id || null;
    } catch (_) { return null; }
  },

  getClinicSetting(clinicId, key) {
    try {
      const r = db.prepare('SELECT value FROM clinic_settings WHERE clinic_id = ? AND key = ?').get(clinicId, key);
      return r?.value;
    } catch (_) { return null; }
  },
  setClinicSetting(clinicId, key, value) {
    try {
      db.prepare(`
        INSERT INTO clinic_settings (clinic_id, key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(clinic_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).run(clinicId, key, value);
    } catch (e) {
      console.warn('setClinicSetting failed:', e.message);
    }
  },

  // Function Call Logging
  async logFunctionCall(functionCall) {
    const entryId = functionCall.id || require('crypto').randomBytes(16).toString('hex');

    if (usePostgres && pgPool) {
      // Postgres path
      await pgPool`
        INSERT INTO function_call_log 
        (id, customer_id, call_id, function_name, parameters, 
         response_time_ms, success, error_message, created_at)
        VALUES (
          ${entryId},
          ${functionCall.customer_id || null},
          ${functionCall.call_id || null},
          ${functionCall.function_name},
          ${toJsonValue(functionCall.parameters)},
          ${functionCall.response_time_ms || null},
          ${toBoolean(functionCall.success)},
          ${functionCall.error_message || null},
          ${functionCall.created_at || new Date().toISOString()}
        )
      `;
      return { changes: 1, lastInsertRowid: entryId };
    } else {
      // SQLite path
      const result = db.prepare(`
        INSERT INTO function_call_log 
        (id, customer_id, call_id, function_name, parameters, 
         response_time_ms, success, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entryId,
        functionCall.customer_id || null,
        functionCall.call_id || null,
        functionCall.function_name,
        functionCall.parameters ? JSON.stringify(functionCall.parameters) : null,
        functionCall.response_time_ms || null,
        functionCall.success ? 1 : 0,
        functionCall.error_message || null
      );
      return result;
    }
  },

  getFunctionCallsByCustomer(customerId, limit = 100) {
    return db.prepare(`
      SELECT * FROM function_call_log 
      WHERE customer_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(customerId, limit);
  },

  // Usage Aggregation
  aggregateUsage(customerId, date, metricType, metricValue, costUsd = 0) {
    const id = `${customerId}_${date}_${metricType}`;
    return db.prepare(`
      INSERT INTO usage_aggregates 
      (id, customer_id, date, metric_type, metric_value, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        metric_value = metric_value + excluded.metric_value,
        cost_usd = cost_usd + excluded.cost_usd
    `).run(id, customerId, date, metricType, metricValue, costUsd);
  },

  getUsageAggregates(customerId, startDate, endDate) {
    return db.prepare(`
      SELECT * FROM usage_aggregates 
      WHERE customer_id = ? 
        AND date >= ? 
        AND date <= ?
      ORDER BY date DESC, metric_type
    `).all(customerId, startDate, endDate);
  },

  // Error Logging
  logError(error) {
    return db.prepare(`
      INSERT INTO error_log 
      (id, customer_id, error_type, error_message, stack_trace, 
       request_id, endpoint, context, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      error.id || require('crypto').randomBytes(16).toString('hex'),
      error.customer_id || null,
      error.error_type || 'Error',
      error.error_message,
      error.stack_trace || null,
      error.request_id || null,
      error.endpoint || null,
      error.context ? JSON.stringify(error.context) : null,
      error.severity || 'medium'
    );
  },

  getErrorsByCustomer(customerId, limit = 100) {
    return db.prepare(`
      SELECT * FROM error_log 
      WHERE customer_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(customerId, limit);
  },

  getUnresolvedErrors(severity = null, limit = 100) {
    let query = `
      SELECT * FROM error_log 
      WHERE resolved = 0
    `;
    const params = [];

    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return db.prepare(query).all(...params);
  },

  markErrorResolved(errorId) {
    return db.prepare(`
      UPDATE error_log 
      SET resolved = 1 
      WHERE id = ?
    `).run(errorId);
  },

  // Customer Management
  createCustomer(customer) {
    // Convert api_features array to JSON string if it's an array
    let apiFeatures = customer.api_features;
    if (Array.isArray(apiFeatures)) {
      apiFeatures = JSON.stringify(apiFeatures);
    } else if (typeof apiFeatures === 'object' && apiFeatures !== null) {
      apiFeatures = JSON.stringify(apiFeatures);
    }

    const providerProfile = customer.provider_profile
      ? (typeof customer.provider_profile === 'string' ? customer.provider_profile : JSON.stringify(customer.provider_profile))
      : null;

    return db.prepare(`
      INSERT INTO customers (
        id, name, email, phone_number, company_name, business_size, 
        use_case, api_features, plan_tier, status, email_verified, email_verified_at, provider_profile
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customer.id || require('crypto').randomBytes(16).toString('hex'),
      customer.name,
      customer.email,
      customer.phone_number || null,
      customer.company_name || null,
      customer.business_size || null,
      customer.use_case || null,
      apiFeatures || null,
      customer.plan_tier || 'starter',
      customer.status || 'pending',
      customer.email_verified ? 1 : 0,
      customer.email_verified_at || null,
      providerProfile
    );
  },

  // Customer Feature Requests
  createFeatureRequest(customerId, featureName, featureCategory = null, notes = null) {
    const { v4: uuidv4 } = require('uuid');
    return db.prepare(`
      INSERT INTO customer_feature_requests (id, customer_id, feature_name, feature_category, notes, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(uuidv4(), customerId, featureName, featureCategory, notes);
  },

  getCustomerFeatureRequests(customerId) {
    return db.prepare(`
      SELECT * FROM customer_feature_requests 
      WHERE customer_id = ? 
      ORDER BY requested_at DESC
    `).all(customerId);
  },

  updateFeatureRequestStatus(requestId, status, notes = null) {
    const updates = ['status = ?'];
    const params = [status, requestId];

    if (status === 'approved') {
      updates.push('approved_at = datetime("now")');
    }
    if (notes) {
      updates.push('notes = ?');
      params.splice(1, 0, notes);
    }

    return db.prepare(`
      UPDATE customer_feature_requests 
      SET ${updates.join(', ')} 
      WHERE id = ?
    `).run(...params);
  },

  getAllFeatureRequests(filters = {}) {
    let query = 'SELECT * FROM customer_feature_requests WHERE 1=1';
    const params = [];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.customer_id) {
      query += ' AND customer_id = ?';
      params.push(filters.customer_id);
    }

    query += ' ORDER BY requested_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  getCustomer(id) {
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  },

  getCustomerByEmail(email) {
    return db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
  },

  getCustomerByPhone(phoneNumber) {
    if (!phoneNumber) return null;
    const candidates = phoneLookupCandidates(phoneNumber);
    for (let i = 0; i < candidates.length; i += 1) {
      const row = db.prepare('SELECT * FROM customers WHERE phone_number = ?').get(candidates[i]);
      if (row) return row;
    }
    return null;
  },

  getCustomerByTwilioNumber(phoneNumber) {
    if (!phoneNumber) return null;
    const candidates = phoneLookupCandidates(phoneNumber);
    for (let i = 0; i < candidates.length; i += 1) {
      const row = db.prepare('SELECT * FROM customers WHERE twilio_phone_number = ?').get(candidates[i]);
      if (row) return row;
    }
    return null;
  },

  updateCustomer(id, updates) {
    const fields = [];
    const values = [];
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });
    if (fields.length === 0) return null;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    return db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  // Email Verification
  createEmailVerificationCode(email, code, customerId = null) {
    // Invalidate any existing codes for this email
    db.prepare(`
      UPDATE email_verification_codes 
      SET verified = 1 
      WHERE email = ? AND verified = 0 AND expires_at > datetime('now')
    `).run(email);

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
    return db.prepare(`
      INSERT INTO email_verification_codes (id, email, code, customer_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      require('crypto').randomBytes(16).toString('hex'),
      email,
      code,
      customerId || null,
      expiresAt
    );
  },

  verifyEmailCode(email, code) {
    const record = db.prepare(`
      SELECT * FROM email_verification_codes 
      WHERE email = ? AND code = ? AND verified = 0 AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `).get(email, code);

    if (record) {
      // Mark as verified
      db.prepare(`
        UPDATE email_verification_codes 
        SET verified = 1, verified_at = datetime('now')
        WHERE id = ?
      `).run(record.id);

      // Update customer email verification if customer_id exists
      if (record.customer_id) {
        db.prepare(`
          UPDATE customers 
          SET email_verified = 1, email_verified_at = datetime('now'), status = 'active', updated_at = datetime('now')
          WHERE id = ?
        `).run(record.customer_id);
      }

      return record;
    }
    return null;
  },

  getActiveEmailVerificationCode(email) {
    return db.prepare(`
      SELECT * FROM email_verification_codes 
      WHERE email = ? AND verified = 0 AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `).get(email);
  },

  // Terms Acceptance
  acceptTerms(customerId, termsVersion, ipAddress, userAgent) {
    return db.prepare(`
      INSERT INTO terms_acceptance (id, customer_id, terms_version, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      require('crypto').randomBytes(16).toString('hex'),
      customerId,
      termsVersion || '1.0',
      ipAddress || null,
      userAgent || null
    );
  },

  hasAcceptedTerms(customerId, termsVersion = '1.0') {
    return db.prepare(`
      SELECT * FROM terms_acceptance 
      WHERE customer_id = ? AND terms_version = ?
      ORDER BY accepted_at DESC LIMIT 1
    `).get(customerId, termsVersion);
  },

  getCustomerAPIKeys(customerId) {
    return db.prepare(`
      SELECT id, key_prefix, created_at, last_used_at, is_active
      FROM api_keys 
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).all(customerId);
  },

  // Customer Session Management
  createCustomerSession(customerIdOrOptions, ipAddress, userAgent) {
    // Support both object format and positional parameters for backward compatibility
    let sessionId, customerId, expiresAt, ip, ua;

    if (typeof customerIdOrOptions === 'object' && customerIdOrOptions !== null) {
      // Object format: { id, customer_id, expires_at, ip_address, user_agent }
      sessionId = customerIdOrOptions.id || require('crypto').randomBytes(32).toString('hex');
      customerId = customerIdOrOptions.customer_id;
      expiresAt = customerIdOrOptions.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      ip = customerIdOrOptions.ip_address || null;
      ua = customerIdOrOptions.user_agent || null;
    } else {
      // Positional parameters: (customerId, ipAddress, userAgent)
      customerId = customerIdOrOptions;
      sessionId = require('crypto').randomBytes(32).toString('hex');
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
      ip = ipAddress || null;
      ua = userAgent || null;
    }

    db.prepare(`
      INSERT INTO customer_sessions (id, customer_id, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, customerId, expiresAt, ip, ua);
    return sessionId;
  },

  getCustomerSession(sessionId) {
    return db.prepare(`
      SELECT * FROM customer_sessions 
      WHERE id = ? AND expires_at > datetime('now')
    `).get(sessionId);
  },

  updateCustomerSessionAccess(sessionId) {
    return db.prepare(`
      UPDATE customer_sessions 
      SET last_accessed_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);
  },

  deleteCustomerSession(sessionId) {
    return db.prepare('DELETE FROM customer_sessions WHERE id = ?').run(sessionId);
  },

  deleteCustomerSessions(customerId) {
    return db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customerId);
  },

  // Customer Retell Agent Management
  updateCustomerRetellAgent(customerId, retellAgentId, retellAgentStatus) {
    return db.prepare(`
      UPDATE customers 
      SET retell_agent_id = ?, retell_agent_status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(retellAgentId || null, retellAgentStatus || 'pending', customerId);
  },

  // Customer Credits Management
  allocateFreeCredits(customerId, freeMinutes = 100) {
    // Check if credits record exists
    const existing = db.prepare('SELECT * FROM customer_credits WHERE customer_id = ?').get(customerId);

    // Set expiration to 60 days from now
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 60);
    const expirationDateStr = expirationDate.toISOString();

    if (existing) {
      // Update existing record - only update expiration if this is new free credits
      // If they already have free credits, don't reset expiration
      const updateQuery = existing.free_credits_expires_at
        ? `UPDATE customer_credits 
           SET free_credits_allocated = free_credits_allocated + ?,
               credits_balance_minutes = credits_balance_minutes + ?,
               last_replenished_at = datetime('now'),
               updated_at = datetime('now')
           WHERE customer_id = ?`
        : `UPDATE customer_credits 
           SET free_credits_allocated = free_credits_allocated + ?,
               credits_balance_minutes = credits_balance_minutes + ?,
               free_credits_expires_at = ?,
               last_replenished_at = datetime('now'),
               updated_at = datetime('now')
           WHERE customer_id = ?`;

      if (existing.free_credits_expires_at) {
        return db.prepare(updateQuery).run(freeMinutes, freeMinutes, customerId);
      } else {
        return db.prepare(updateQuery).run(freeMinutes, freeMinutes, expirationDateStr, customerId);
      }
    } else {
      // Create new credits record with expiration
      const { v4: uuidv4 } = require('uuid');
      return db.prepare(`
        INSERT INTO customer_credits (
          id, customer_id, credits_balance_minutes, free_credits_allocated, 
          free_credits_expires_at, last_replenished_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(uuidv4(), customerId, freeMinutes, freeMinutes, expirationDateStr);
    }
  },

  getCustomerCredits(customerId) {
    return db.prepare('SELECT * FROM customer_credits WHERE customer_id = ?').get(customerId);
  },

  deductCredits(customerId, minutesToDeduct) {
    const credits = db.prepare('SELECT * FROM customer_credits WHERE customer_id = ?').get(customerId);
    if (!credits) {
      throw new Error('Customer credits not found');
    }

    // Check if free credits have expired
    if (credits.free_credits_expires_at) {
      const expirationDate = new Date(credits.free_credits_expires_at);
      const now = new Date();
      if (now > expirationDate) {
        // Free credits expired - expire them
        const expiredFreeCredits = credits.free_credits_allocated - credits.free_credits_used;
        if (expiredFreeCredits > 0) {
          // Mark expired free credits as used
          db.prepare(`
            UPDATE customer_credits 
            SET free_credits_used = free_credits_allocated,
                credits_balance_minutes = credits_balance_minutes - ?,
                updated_at = datetime('now')
            WHERE customer_id = ?
          `).run(expiredFreeCredits, customerId);

          // Refresh credits after expiration
          const updatedCredits = db.prepare('SELECT * FROM customer_credits WHERE customer_id = ?').get(customerId);
          Object.assign(credits, updatedCredits);
        }
      }
    }

    // Check if customer has payment method stored
    const customer = db.prepare('SELECT card_verified, stripe_payment_method_id FROM customers WHERE id = ?').get(customerId);
    const hasPaymentMethod = customer && customer.card_verified === 1 && customer.stripe_payment_method_id;

    // Calculate available free credits (after expiration check)
    const availableFreeCredits = Math.max(0, credits.free_credits_allocated - credits.free_credits_used);

    // If trying to use more than free credits and no payment method, block
    if (minutesToDeduct > availableFreeCredits && !hasPaymentMethod) {
      const remaining = Math.max(0, credits.credits_balance_minutes);
      throw new Error(`Insufficient credits. You have ${remaining} minutes remaining. Please add a payment method or purchase more credits to continue using the service.`);
    }

    if (credits.credits_balance_minutes < minutesToDeduct && !hasPaymentMethod) {
      const remaining = Math.max(0, credits.credits_balance_minutes);
      throw new Error(`Insufficient credits. You have ${remaining} minutes remaining. Please add a payment method or purchase more credits to continue using the service.`);
    }

    // Deduct from free credits first, then paid credits
    let freeToDeduct = Math.min(availableFreeCredits, minutesToDeduct);
    let paidToDeduct = minutesToDeduct - freeToDeduct;

    // Track monthly usage for invoicing
    // Only track overage (usage AFTER credits exhausted) for billing
    const now = new Date();
    const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Calculate available credits before deduction (availableFreeCredits already calculated above)
    const availablePaidCredits = credits.paid_credits_purchased - credits.paid_credits_used;
    const totalAvailableCredits = availableFreeCredits + availablePaidCredits;

    // Calculate overage (usage beyond available credits)
    // Overage = total usage - total available credits (if usage exceeds available)
    let overageMinutes = 0;
    if (minutesToDeduct > totalAvailableCredits) {
      // This usage exceeds available credits - calculate overage
      overageMinutes = minutesToDeduct - totalAvailableCredits;
    }

    // Track: total usage, free credits used, and overage (for billing)
    // Inline the trackMonthlyUsage logic to avoid circular reference issues
    const existing = db.prepare('SELECT * FROM monthly_usage WHERE customer_id = ? AND billing_month = ?').get(customerId, billingMonth);
    if (existing) {
      db.prepare(`
        UPDATE monthly_usage 
        SET voice_minutes_used = voice_minutes_used + ?,
            api_requests_used = api_requests_used + ?,
            free_credits_used = free_credits_used + ?,
            overage_voice_minutes = overage_voice_minutes + ?,
            overage_api_requests = overage_api_requests + ?,
            updated_at = datetime('now')
        WHERE customer_id = ? AND billing_month = ?
      `).run(minutesToDeduct, 0, freeToDeduct, overageMinutes, 0, customerId, billingMonth);
    } else {
      const { v4: uuidv4 } = require('uuid');
      db.prepare(`
        INSERT INTO monthly_usage (
          id, customer_id, billing_month, voice_minutes_used, api_requests_used,
          free_credits_used, overage_voice_minutes, overage_api_requests
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), customerId, billingMonth, minutesToDeduct, 0, freeToDeduct, overageMinutes, 0);
    }

    return db.prepare(`
      UPDATE customer_credits 
      SET free_credits_used = free_credits_used + ?,
          paid_credits_used = paid_credits_used + ?,
          credits_balance_minutes = credits_balance_minutes - ?,
          updated_at = datetime('now')
      WHERE customer_id = ?
    `).run(freeToDeduct, paidToDeduct, minutesToDeduct, customerId);
  },

  addPaidCredits(customerId, minutesToAdd) {
    const credits = db.prepare('SELECT * FROM customer_credits WHERE customer_id = ?').get(customerId);

    if (!credits) {
      // Create credits record if it doesn't exist
      const { v4: uuidv4 } = require('uuid');
      db.prepare(`
        INSERT INTO customer_credits (
          id, customer_id, credits_balance_minutes, paid_credits_purchased, last_replenished_at
        ) VALUES (?, ?, ?, ?, datetime('now'))
      `).run(uuidv4(), customerId, minutesToAdd, minutesToAdd);
    } else {
      // Update existing record
      db.prepare(`
        UPDATE customer_credits 
        SET paid_credits_purchased = paid_credits_purchased + ?,
            credits_balance_minutes = credits_balance_minutes + ?,
            last_replenished_at = datetime('now'),
            updated_at = datetime('now')
        WHERE customer_id = ?
      `).run(minutesToAdd, minutesToAdd, customerId);
    }
  },

  // Check and expire free credits that have passed expiration date
  expireFreeCredits() {
    const now = new Date().toISOString();
    const result = db.prepare(`
      SELECT customer_id, 
             (free_credits_allocated - free_credits_used) as expired_credits
      FROM customer_credits
      WHERE free_credits_expires_at IS NOT NULL 
        AND free_credits_expires_at < ?
        AND free_credits_used < free_credits_allocated
    `).all(now);

    const expired = [];
    for (const row of result) {
      if (row.expired_credits > 0) {
        db.prepare(`
          UPDATE customer_credits 
          SET free_credits_used = free_credits_allocated,
              credits_balance_minutes = credits_balance_minutes - ?,
              updated_at = datetime('now')
          WHERE customer_id = ?
        `).run(row.expired_credits, row.customer_id);
        expired.push({ customerId: row.customer_id, credits: row.expired_credits });
      }
    }
    return expired;
  },

  // Get customers who need low credit alerts (balance < 50 minutes, alert not sent in last 24 hours)
  getCustomersNeedingLowCreditAlert() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return db.prepare(`
      SELECT c.id, c.email, c.name, c.merchant_id,
             cc.credits_balance_minutes,
             cc.free_credits_allocated - cc.free_credits_used as free_remaining,
             cc.paid_credits_purchased - cc.paid_credits_used as paid_remaining,
             cc.low_credit_alert_sent_at
      FROM customers c
      INNER JOIN customer_credits cc ON c.id = cc.customer_id
      WHERE cc.credits_balance_minutes < 50
        AND (cc.low_credit_alert_sent_at IS NULL OR cc.low_credit_alert_sent_at < ?)
        AND c.status = 'active'
    `).all(oneDayAgo);
  },

  // Mark low credit alert as sent
  markLowCreditAlertSent(customerId) {
    return db.prepare(`
      UPDATE customer_credits 
      SET low_credit_alert_sent_at = datetime('now'),
          updated_at = datetime('now')
      WHERE customer_id = ?
    `).run(customerId);
  },

  // Get credit usage history for analytics
  getCreditUsageHistory(customerId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    return db.prepare(`
      SELECT 
        billing_month,
        voice_minutes_used,
        free_credits_used,
        overage_voice_minutes,
        created_at,
        updated_at
      FROM monthly_usage
      WHERE customer_id = ?
        AND created_at >= ?
      ORDER BY billing_month DESC
    `).all(customerId, startDateStr);
  },

  // Credit Purchases
  createCreditPurchase(customerId, packageName, creditsAmount, amountPaid, stripeCheckoutSessionId, stripePaymentMethodId = null) {
    const { v4: uuidv4 } = require('uuid');
    const purchaseId = uuidv4();
    db.prepare(`
      INSERT INTO credit_purchases (
        id, customer_id, package_name, credits_amount, amount_paid, 
        stripe_checkout_session_id, stripe_payment_method_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(purchaseId, customerId, packageName, creditsAmount, amountPaid, stripeCheckoutSessionId, stripePaymentMethodId);
    return { lastInsertRowid: purchaseId };
  },

  updateCreditPurchaseStatus(purchaseId, status, stripePaymentIntentId = null, purchasedAt = null) {
    return db.prepare(`
      UPDATE credit_purchases 
      SET status = ?, 
          stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
          purchased_at = COALESCE(?, purchased_at)
      WHERE id = ?
    `).run(status, stripePaymentIntentId, purchasedAt, purchaseId);
  },

  getCreditPurchaseByCheckoutSession(checkoutSessionId) {
    return db.prepare('SELECT * FROM credit_purchases WHERE stripe_checkout_session_id = ?').get(checkoutSessionId);
  },

  getCustomerCreditPurchases(customerId) {
    return db.prepare(`
      SELECT * FROM credit_purchases 
      WHERE customer_id = ? 
      ORDER BY created_at DESC
    `).all(customerId);
  },

  // Customer Payment Method Management
  updateCustomerPaymentMethod(customerId, paymentMethodId, cardLast4, cardBrand, verified = true) {
    return db.prepare(`
      UPDATE customers 
      SET stripe_payment_method_id = ?,
          card_last4 = ?,
          card_brand = ?,
          card_verified = ?,
          card_verified_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(paymentMethodId, cardLast4, cardBrand, verified ? 1 : 0, customerId);
  },

  getCustomerPaymentMethod(customerId) {
    return db.prepare(`
      SELECT stripe_payment_method_id, card_last4, card_brand, card_verified, card_verified_at
      FROM customers 
      WHERE id = ?
    `).get(customerId);
  },

  // Incomplete Signups Management (separate from admin leads)
  createIncompleteSignup(signupData) {
    const { v4: uuidv4 } = require('uuid');
    const signupId = `incomplete_${uuidv4()}`;

    // Convert api_features to JSON if array
    let apiFeatures = signupData.api_features;
    if (Array.isArray(apiFeatures)) {
      apiFeatures = JSON.stringify(apiFeatures);
    } else if (typeof apiFeatures === 'object' && apiFeatures !== null) {
      apiFeatures = JSON.stringify(apiFeatures);
    }

    // Convert metadata to JSON if object
    let metadata = signupData.metadata;
    if (typeof metadata === 'object' && metadata !== null) {
      metadata = JSON.stringify(metadata);
    }

    return db.prepare(`
      INSERT INTO incomplete_signups (
        id, name, email, phone_number, company_name, business_size, 
        use_case, api_features, customer_type, signup_step, source, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signupId,
      signupData.name || null,
      signupData.email,
      signupData.phone_number || null,
      signupData.company_name || null,
      signupData.business_size || null,
      signupData.use_case || null,
      apiFeatures || null,
      signupData.customer_type || null,
      signupData.signup_step || 'started',
      signupData.source || 'signup_page',
      metadata || null
    );
  },

  updateIncompleteSignup(id, updates) {
    const fields = [];
    const values = [];

    // Handle JSON fields
    if (updates.api_features && Array.isArray(updates.api_features)) {
      updates.api_features = JSON.stringify(updates.api_features);
    }
    if (updates.metadata && typeof updates.metadata === 'object') {
      updates.metadata = JSON.stringify(updates.metadata);
    }

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) return null;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    return db.prepare(`UPDATE incomplete_signups SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  getIncompleteSignup(id) {
    return db.prepare('SELECT * FROM incomplete_signups WHERE id = ?').get(id);
  },

  getIncompleteSignupByEmail(email) {
    return db.prepare(`
      SELECT * FROM incomplete_signups 
      WHERE email = ? AND is_completed = 0 
      ORDER BY created_at DESC LIMIT 1
    `).get(email);
  },

  markIncompleteSignupCompleted(id, customerId) {
    return db.prepare(`
      UPDATE incomplete_signups 
      SET is_completed = 1, 
          signup_completed_at = datetime('now'),
          converted_to_customer_id = ?,
          signup_step = 'completed',
          updated_at = datetime('now')
      WHERE id = ?
    `).run(customerId, id);
  },

  getAllIncompleteSignups(filters = {}) {
    let query = 'SELECT * FROM incomplete_signups WHERE 1=1';
    const params = [];

    if (filters.is_completed !== undefined) {
      query += ' AND is_completed = ?';
      params.push(filters.is_completed ? 1 : 0);
    }

    if (filters.signup_step) {
      query += ' AND signup_step = ?';
      params.push(filters.signup_step);
    }

    if (filters.source) {
      query += ' AND source = ?';
      params.push(filters.source);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  // Monthly Usage Tracking
  trackMonthlyUsage(customerId, billingMonth, voiceMinutes = 0, apiRequests = 0, freeCreditsUsed = 0, overageVoiceMinutes = 0, overageApiRequests = 0) {
    const { v4: uuidv4 } = require('uuid');
    const existing = db.prepare('SELECT * FROM monthly_usage WHERE customer_id = ? AND billing_month = ?').get(customerId, billingMonth);

    if (existing) {
      // Update existing record
      return db.prepare(`
        UPDATE monthly_usage 
        SET voice_minutes_used = voice_minutes_used + ?,
            api_requests_used = api_requests_used + ?,
            free_credits_used = free_credits_used + ?,
            overage_voice_minutes = overage_voice_minutes + ?,
            overage_api_requests = overage_api_requests + ?,
            updated_at = datetime('now')
        WHERE customer_id = ? AND billing_month = ?
      `).run(voiceMinutes, apiRequests, freeCreditsUsed, overageVoiceMinutes, overageApiRequests, customerId, billingMonth);
    } else {
      // Create new record
      return db.prepare(`
        INSERT INTO monthly_usage (
          id, customer_id, billing_month, voice_minutes_used, api_requests_used,
          free_credits_used, overage_voice_minutes, overage_api_requests
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), customerId, billingMonth, voiceMinutes, apiRequests, freeCreditsUsed, overageVoiceMinutes, overageApiRequests);
    }
  },

  getMonthlyUsage(customerId, billingMonth) {
    return db.prepare('SELECT * FROM monthly_usage WHERE customer_id = ? AND billing_month = ?').get(customerId, billingMonth);
  },

  getAllMonthlyUsage(customerId) {
    return db.prepare(`
      SELECT * FROM monthly_usage 
      WHERE customer_id = ? 
      ORDER BY billing_month DESC
    `).all(customerId);
  },

  // Calculate lead call costs for a billing month
  getLeadCallCostsForMonth(billingMonth) {
    // Get all completed lead calls in the billing month
    const [year, month] = billingMonth.split('-');
    const startDate = `${billingMonth}-01`;
    const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];

    const calls = db.prepare(`
      SELECT 
        COUNT(*) as call_count,
        COALESCE(SUM(call_cost), 0) as total_cost
      FROM lead_calls
      WHERE call_status = 'completed'
        AND DATE(created_at) >= ?
        AND DATE(created_at) <= ?
    `).get(startDate, endDate);

    return {
      lead_calls_count: calls.call_count || 0,
      lead_calls_cost: calls.total_cost || 0
    };
  },

  // Monthly Invoices
  createMonthlyInvoice(customerId, billingMonth, usage, options = {}) {
    const { v4: uuidv4 } = require('uuid');

    // Base costs (Retell + Twilio + infrastructure)
    // Retell: ~$0.02/min, Twilio: ~$0.013/min, Infrastructure: ~$0.017/min = $0.05/min total
    const retellCostPerMin = options.retellCostPerMin || 0.02;
    const twilioCostPerMin = options.twilioCostPerMin || 0.013;
    const infraCostPerMin = options.infraCostPerMin || 0.017;
    const baseCostPerMin = retellCostPerMin + twilioCostPerMin + infraCostPerMin;

    // API request costs (first 1,000 free per month)
    const apiBaseCostPer1k = options.apiBaseCostPer1k || 0.005; // Base cost for 1,000 requests

    // Calculate base costs (actual costs we pay)
    const voiceMinutesBaseCost = (usage.overage_voice_minutes || 0) * baseCostPerMin;
    const apiRequestsBaseCost = (usage.overage_api_requests || 0) / 1000 * apiBaseCostPer1k;
    const baseCosts = voiceMinutesBaseCost + apiRequestsBaseCost;

    // Get lead call costs for this billing month (these are costs, not revenue)
    const leadCalls = this.getLeadCallCostsForMonth(billingMonth);
    const leadCallsCost = leadCalls.lead_calls_cost || 0;
    const leadCallsCount = leadCalls.lead_calls_count || 0;

    // Integration costs (optional, per customer or flat fee)
    const integrationCosts = options.integrationCosts || 0;

    // Markup percentage (default 50% markup = 1.5x multiplier)
    const markupPercentage = options.markupPercentage || 50;
    const markupMultiplier = 1 + (markupPercentage / 100);

    // Calculate final prices (base costs + lead call costs + integration + markup)
    // Lead call costs are added to base costs (they're expenses, not revenue)
    const totalBaseCosts = baseCosts + leadCallsCost;
    const subtotal = (totalBaseCosts + integrationCosts) * markupMultiplier;
    const markupAmount = subtotal - (totalBaseCosts + integrationCosts);
    const total = subtotal;

    // Customer-facing prices (what we bill them)
    const voiceMinutesCost = (usage.overage_voice_minutes || 0) * 0.05; // $0.05/min billed to customer
    const apiRequestsCost = (usage.overage_api_requests || 0) / 1000 * 0.01; // $0.01/1k requests billed

    // Generate invoice number (e.g., INV-2025-11-001)
    const invoicePrefix = `INV-${billingMonth.replace('-', '-')}`;
    const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM monthly_invoices WHERE invoice_number LIKE ?').get(`${invoicePrefix}%`);
    const invoiceNumber = `${invoicePrefix}-${String((invoiceCount?.count || 0) + 1).padStart(3, '0')}`;

    // Calculate due date (15 days from now)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    return db.prepare(`
      INSERT INTO monthly_invoices (
        id, customer_id, billing_month, invoice_number,
        voice_minutes, api_requests,
        voice_minutes_cost, api_requests_cost,
        job_calls_count, job_calls_cost,
        base_costs, integration_costs, markup_percentage, markup_amount,
        subtotal, total, due_date, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      uuidv4(), customerId, billingMonth, invoiceNumber,
      usage.voice_minutes_used || 0, usage.api_requests_used || 0,
      voiceMinutesCost, apiRequestsCost,
      leadCallsCount, leadCallsCost,
      baseCosts, integrationCosts, markupPercentage, markupAmount,
      subtotal, total, dueDate.toISOString(), options.notes || null
    );
  },

  getAllInvoices(filters = {}) {
    let query = 'SELECT * FROM monthly_invoices WHERE 1=1';
    const params = [];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.billing_month) {
      query += ' AND billing_month = ?';
      params.push(filters.billing_month);
    }

    if (filters.customer_id) {
      query += ' AND customer_id = ?';
      params.push(filters.customer_id);
    }

    query += ' ORDER BY billing_month DESC, created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  approveInvoice(invoiceId, approvedBy) {
    return db.prepare(`
      UPDATE monthly_invoices 
      SET status = 'approved',
          approved_by = ?,
          approved_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(approvedBy, invoiceId);
  },

  sendInvoice(invoiceId) {
    return db.prepare(`
      UPDATE monthly_invoices 
      SET status = 'sent',
          sent_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(invoiceId);
  },

  getMonthlyInvoice(invoiceId) {
    return db.prepare('SELECT * FROM monthly_invoices WHERE id = ?').get(invoiceId);
  },

  getCustomerInvoices(customerId) {
    return db.prepare(`
      SELECT * FROM monthly_invoices 
      WHERE customer_id = ? 
      ORDER BY billing_month DESC, created_at DESC
    `).all(customerId);
  },

  getMonthlyInvoiceByCustomerAndMonth(customerId, billingMonth) {
    return db.prepare('SELECT * FROM monthly_invoices WHERE customer_id = ? AND billing_month = ?').get(customerId, billingMonth);
  },

  getMonthlyInvoicesByCustomer(customerId) {
    return db.prepare(`
      SELECT * FROM monthly_invoices 
      WHERE customer_id = ? 
      ORDER BY billing_month DESC, created_at DESC
    `).all(customerId);
  },

  updateInvoiceStatus(invoiceId, status, stripeInvoiceId = null, stripePaymentIntentId = null, paidAt = null) {
    return db.prepare(`
      UPDATE monthly_invoices 
      SET status = ?,
          stripe_invoice_id = COALESCE(?, stripe_invoice_id),
          stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
          paid_at = COALESCE(?, paid_at),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(status, stripeInvoiceId, stripePaymentIntentId, paidAt, invoiceId);
  },

  // API Key Management
  createAPIKey(apiKey) {
    return db.prepare(`
      INSERT INTO api_keys 
      (id, customer_id, key_prefix, key_hash, key_secret, scopes, 
       rate_limit_tier, ip_whitelist, is_active, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apiKey.id || require('crypto').randomBytes(16).toString('hex'),
      apiKey.customer_id,
      apiKey.key_prefix,
      apiKey.key_hash,
      apiKey.key_secret || null,
      apiKey.scopes ? JSON.stringify(apiKey.scopes) : null,
      apiKey.rate_limit_tier || 'starter',
      apiKey.ip_whitelist ? JSON.stringify(apiKey.ip_whitelist) : null,
      apiKey.is_active !== undefined ? (apiKey.is_active ? 1 : 0) : 1,
      apiKey.expires_at || null
    );
  },

  getAPIKeyByHash(keyHash) {
    return db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1').get(keyHash);
  },

  getAPIKeyById(keyId) {
    return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(keyId);
  },

  getAllAPIKeys(filters = {}) {
    let query = 'SELECT id, customer_id, key_prefix, created_at, last_used_at, is_active FROM api_keys WHERE 1=1';
    const params = [];

    if (filters.customer_id) {
      query += ' AND customer_id = ?';
      params.push(filters.customer_id);
    }

    if (filters.is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  updateAPIKeyLastUsed(keyId) {
    return db.prepare(`
      UPDATE api_keys 
      SET last_used_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(keyId);
  },

  // Leads Management (for agent calling)
  createLead(leadData) {
    const { v4: uuidv4 } = require('uuid');
    const id = leadData.id || uuidv4();

    // Keywords that indicate a clinic needs our AI billing/insurance product
    const PRODUCT_KEYWORDS = [
      'billing', 'insurance', 'medical billing', 'insurance verification', 'claims',
      'emr', 'ehr', 'electronic medical records', 'electronic health records',
      'medical records', 'patient records', 'cpt codes', 'icd codes', 'coding',
      'prior authorization', 'pre-authorization', 'eligibility', 'benefits verification',
      'claim submission', 'claim processing', 'denials', 'appeals', 'revenue cycle',
      'ar', 'accounts receivable', 'collections', 'payment posting', 'charge capture'
    ];

    // Check if job description qualifies them for our AI product
    const qualifiesFromDesc = leadData.description && PRODUCT_KEYWORDS.some(keyword =>
      leadData.description.toLowerCase().includes(keyword.toLowerCase())
    );

    // Auto-qualify: Must have (phone OR email) AND (be a clinic OR qualifies from description)
    const hasPhone = leadData.clinic_phone && leadData.clinic_phone.trim() !== '';
    const hasEmail = leadData.clinic_email && leadData.clinic_email.trim() !== '';
    const hasContact = hasPhone || hasEmail;

    const isClinic = leadData.clinic_name && (
      leadData.clinic_name.toLowerCase().includes('clinic') ||
      leadData.clinic_name.toLowerCase().includes('medical') ||
      leadData.clinic_name.toLowerCase().includes('health') ||
      leadData.clinic_name.toLowerCase().includes('dental') ||
      leadData.clinic_name.toLowerCase().includes('care')
    ) || leadData.source === 'google_search'; // Assume clinics from our search

    // Qualify if: has contact AND (is clinic OR description matches our product)
    const isQualified = hasContact && (isClinic || qualifiesFromDesc) ? 1 : 0;

    // Check if description column exists, add if not
    const tableInfo = db.prepare("PRAGMA table_info(leads)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('description')) {
      try {
        db.prepare('ALTER TABLE leads ADD COLUMN description TEXT').run();
        console.log('✅ Added description column to leads table');
      } catch (err) {
        // Column might already exist, ignore
      }
    }

    // Check if salary column exists, add if not
    if (!columnNames.includes('salary')) {
      try {
        db.prepare('ALTER TABLE leads ADD COLUMN salary TEXT').run();
        console.log('✅ Added salary column to leads table');
      } catch (err) {
        // Column might already exist, ignore
      }
    }

    // Check if specialty column exists, add if not
    if (!columnNames.includes('specialty')) {
      try {
        db.prepare('ALTER TABLE leads ADD COLUMN specialty TEXT').run();
        console.log('✅ Added specialty column to leads table');
      } catch (err) {
        // Column might already exist, ignore
      }
    }

    // Detect specialty from job description (prioritize description)
    function detectSpecialtyFromDescription(desc) {
      if (!desc || desc.trim().length < 10) return null;

      const descLower = desc.toLowerCase();

      // Dental
      if (descLower.match(/\b(dental|dentist|orthodont|oral surgery|periodont|endodont|prosthodont)\b/)) {
        return 'Dental';
      }

      // Therapy/Mental Health
      if (descLower.match(/\b(therapist|therapy|mental health|counseling|counselor|psychotherapy|psychologist|psychiatric|behavioral health|substance abuse|addiction treatment)\b/)) {
        return 'Therapy';
      }

      // Physical Therapy
      if (descLower.match(/\b(physical therapy|physiotherapy|pt|physical therapist|rehabilitation|rehab)\b/)) {
        return 'Physical Therapy';
      }

      // Occupational Therapy
      if (descLower.match(/\b(occupational therapy|ot|occupational therapist)\b/)) {
        return 'Occupational Therapy';
      }

      // Speech Therapy
      if (descLower.match(/\b(speech therapy|speech therapist|slp|speech language)\b/)) {
        return 'Speech Therapy';
      }

      // Cardiology
      if (descLower.match(/\b(cardiology|cardiac|cardiologist|heart)\b/)) {
        return 'Cardiology';
      }

      // Dermatology
      if (descLower.match(/\b(dermatology|dermatologist|skin)\b/)) {
        return 'Dermatology';
      }

      // Pediatrics
      if (descLower.match(/\b(pediatric|pediatrics|pediatrician|children|kids)\b/)) {
        return 'Pediatrics';
      }

      // Orthopedics
      if (descLower.match(/\b(orthopedic|orthopedics|orthopedic surgeon|bone|joint)\b/)) {
        return 'Orthopedics';
      }

      // Urgent Care
      if (descLower.match(/\b(urgent care|urgentcare|walk-in)\b/)) {
        return 'Urgent Care';
      }

      // Primary Care
      if (descLower.match(/\b(primary care|family practice|family medicine|general practice)\b/)) {
        return 'Primary Care';
      }

      // OB/GYN
      if (descLower.match(/\b(obgyn|ob\/gyn|obstetric|gynecology|women's health)\b/)) {
        return 'OB/GYN';
      }

      // Eye Care
      if (descLower.match(/\b(ophthalmology|ophthalmologist|eye care|optometry|vision)\b/)) {
        return 'Eye Care';
      }

      // Chiropractic
      if (descLower.match(/\b(chiropractic|chiropractor|spinal)\b/)) {
        return 'Chiropractic';
      }

      // Medical (generic fallback)
      if (descLower.match(/\b(medical|clinic|healthcare|health care)\b/)) {
        return 'Medical';
      }

      return null;
    }

    // Detect specialty from company name first (most reliable)
    function detectSpecialtyFromName(clinicName) {
      if (!clinicName) return null;
      const nameLower = clinicName.toLowerCase();

      // Wellness centers (check first - specific)
      if (nameLower.includes('wellness') || nameLower.includes('wellbeing')) {
        return 'Wellness';
      }

      // Dental (check for dental, dentist, dentistry, DMD, DDS)
      if (nameLower.includes('dental') || nameLower.includes('dentist') || nameLower.includes('dentistry') ||
        nameLower.includes(' dmd') || nameLower.includes(' dds') || nameLower.match(/\bdmd\b/) || nameLower.match(/\bdds\b/)) {
        return 'Dental';
      }

      // Physical Therapy (check before general therapy)
      if (nameLower.includes('physical therapy') || nameLower.includes('physiotherapy') || nameLower.includes('sportscare')) {
        return 'Physical Therapy';
      }

      // Occupational Therapy
      if (nameLower.includes('occupational therapy')) {
        return 'Occupational Therapy';
      }

      // Speech Therapy
      if (nameLower.includes('speech therapy') || nameLower.includes('speech language')) {
        return 'Speech Therapy';
      }

      // Urgent Care
      if (nameLower.includes('urgent care') || nameLower.includes('urgentcare') || nameLower.includes('wellnow')) {
        return 'Urgent Care';
      }

      // Therapy/Mental Health (general - check after specific therapies)
      if (nameLower.includes('therapy') || nameLower.includes('therapist') || nameLower.includes('counseling')) {
        return 'Therapy';
      }

      // Other specialties from name
      if (nameLower.includes('cardiology') || nameLower.includes('cardiac')) {
        return 'Cardiology';
      }
      if (nameLower.includes('dermatology') || nameLower.includes('dermatologist')) {
        return 'Dermatology';
      }
      if (nameLower.includes('pediatric') || nameLower.includes('pediatrics')) {
        return 'Pediatrics';
      }
      if (nameLower.includes('orthopedic') || nameLower.includes('orthopedics')) {
        return 'Orthopedics';
      }
      if (nameLower.includes('primary care') || nameLower.includes('family practice')) {
        return 'Primary Care';
      }
      if (nameLower.includes('allergy') || nameLower.includes('asthma') || nameLower.includes('sinus')) {
        return 'Allergy & Immunology';
      }
      if (nameLower.includes('healogics') || nameLower.includes('wound care')) {
        return 'Wound Care';
      }

      return null;
    }

    // Try company name first, then description
    let specialty = detectSpecialtyFromName(leadData.clinic_name);

    if (!specialty) {
      specialty = detectSpecialtyFromDescription(leadData.description);
    }

    // Determine lead_type: 'sales' for job search leads, 'customer' for signups
    const leadType = leadData.lead_type || (leadData.source === 'self_signup' ? 'customer' : 'sales');

    const result = db.prepare(`
      INSERT INTO leads (
        id, external_id, title, clinic_name, clinic_phone, clinic_email, opening_hours,
        location, source_url, status, pipeline_stage, is_qualified, priority, lead_score, source, posted_at, notes, description, salary, specialty, follow_up_date, next_action, estimated_value, owner_id, is_test, lead_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      leadData.external_id || null,
      leadData.title || leadData.clinic_name || 'Medical Clinic',
      leadData.clinic_name || 'Unknown Clinic',
      leadData.clinic_phone || null,
      leadData.clinic_email || null,
      leadData.opening_hours || null,
      leadData.location || null,
      leadData.source_url || null,
      leadData.status || 'new',
      leadData.pipeline_stage || 'new',
      isQualified,
      leadData.priority || 5,
      leadData.lead_score || 0,
      leadData.source || 'google_search',
      leadData.posted_at || null,
      leadData.notes || null,
      leadData.description || null,
      leadData.salary || null,
      specialty,
      leadData.follow_up_date || null,
      leadData.next_action || null,
      leadData.estimated_value || null,
      leadData.owner_id || null,
      leadData.is_test || 0,
      leadType
    );

    // Return result with id for consistency (SQLite returns lastInsertRowid, but we use explicit id)
    return { ...result, id: id };
  },

  getLead(id) {
    return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  },

  getLeadByExternalId(externalId) {
    return db.prepare('SELECT * FROM leads WHERE external_id = ?').get(externalId);
  },

  getAllLeads(filters = {}) {
    let query = 'SELECT * FROM leads WHERE 1=1';
    const params = [];

    // Filter out test leads by default (unless explicitly requested)
    // In production, always exclude test leads
    // In development, exclude test leads unless show_test=true
    const env = process.env.NODE_ENV || 'development';
    const isProduction = env === 'production' || env === 'prod';

    if (filters.show_test === true) {
      // Explicitly show test leads only
      query += ' AND is_test = 1';
    } else if (filters.include_test === true) {
      // Include both test and non-test (no filter)
      // No filter needed
    } else {
      // Default: exclude test leads
      query += ' AND (is_test IS NULL OR is_test = 0)';
    }

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.pipeline_stage) {
      query += ' AND pipeline_stage = ?';
      params.push(filters.pipeline_stage);
    }

    if (filters.clinic_name) {
      query += ' AND clinic_name LIKE ?';
      params.push(`%${filters.clinic_name}%`);
    }

    // Filter by lead_type: 'sales' or 'customer'
    if (filters.lead_type) {
      query += ' AND lead_type = ?';
      params.push(filters.lead_type);
    }

    // Filter: must have at least phone OR email (contactable)
    if (filters.has_contact === true) {
      query += ' AND ((clinic_phone IS NOT NULL AND LENGTH(clinic_phone) > 0) OR (clinic_email IS NOT NULL AND LENGTH(clinic_email) > 0))';
    }

    if (filters.has_phone === true) {
      query += ' AND clinic_phone IS NOT NULL AND LENGTH(clinic_phone) > 0';
    }

    if (filters.needs_followup === true) {
      query += ' AND follow_up_date IS NOT NULL AND follow_up_date <= datetime("now")';
    }

    query += ' ORDER BY priority DESC, lead_score DESC, created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  getLeadsByPipelineStage(stage) {
    return db.prepare(`
      SELECT 
        l.*,
        COALESCE(SUM(lc.call_cost), 0) as total_call_cost,
        COUNT(lc.id) as call_count
      FROM leads l
      LEFT JOIN lead_calls lc ON l.id = lc.lead_id
      WHERE l.pipeline_stage = ? 
      GROUP BY l.id
      ORDER BY l.lead_score DESC, l.priority DESC, l.created_at DESC
    `).all(stage);
  },

  getLeadByEmail(email) {
    if (!email) return null;
    return db.prepare('SELECT * FROM leads WHERE clinic_email = ?').get(email.toLowerCase());
  },

  upsertLeadFromCustomer(customer, options = {}) {
    if (!customer?.email) return null;
    const normalizedEmail = customer.email.toLowerCase();
    const existingLead = this.getLeadByEmail(normalizedEmail);

    // Mark as test lead if in development/local environment
    const env = process.env.NODE_ENV || 'development';
    const isProduction = env === 'production' || env === 'prod';
    const isTestLead = !isProduction || options.is_test === true;

    const leadPayload = {
      title: options.title || `Inbound - ${customer.use_case || 'API Signup'}`,
      clinic_name: customer.company_name || customer.name || 'DocLittle Prospect',
      clinic_phone: customer.phone_number || null,
      clinic_email: normalizedEmail,
      location: customer.business_size || customer.use_case || null,
      status: options.status || 'new',
      pipeline_stage: options.pipeline_stage || 'new',
      priority: options.priority || 5,
      lead_score: options.lead_score || 15,
      source: options.source || 'self_signup',
      notes: options.notes || null,
      follow_up_date: options.follow_up_date || null,
      next_action: options.next_action || 'Qualify inbound signup',
      estimated_value: options.estimated_value || null,
      is_test: isTestLead ? 1 : 0,
      lead_type: 'customer' // Customer signup leads are always 'customer' type
    };

    if (existingLead) {
      this.updateLead(existingLead.id, leadPayload);
      if (options.activity_description) {
        this.createLeadActivity({
          lead_id: existingLead.id,
          activity_type: options.activity_type || 'update',
          activity_subject: options.activity_subject || 'Lead updated',
          activity_description: options.activity_description
        });
      }
      return existingLead.id;
    }

    const created = this.createLead(leadPayload);
    const leadId = created.id || created.lastInsertRowid;

    // Verify lead exists in database before creating activity
    if (leadId) {
      try {
        // Verify the lead actually exists in the database
        const verifyLead = this.getLead(leadId);
        if (!verifyLead) {
          console.warn(`⚠️  Lead ${leadId} not found in database after creation. Skipping activity creation.`);
          return leadId;
        }

        // Now create activity with verified lead ID
        this.createLeadActivity({
          lead_id: leadId,
          activity_type: 'created',
          activity_subject: 'Inbound signup',
          activity_description: `${customer.name || customer.company_name || normalizedEmail} submitted the signup form.`
        });
      } catch (activityError) {
        // Log but don't fail - activity creation is non-critical
        console.warn('⚠️  Failed to create lead activity:', activityError.message);
        if (activityError.message.includes('FOREIGN KEY')) {
          console.warn(`   Lead ID: ${leadId}`);
          console.warn(`   Lead exists: ${!!this.getLead(leadId)}`);
        }
      }
    }
    return leadId;
  },

  qualifyLeadByEmail(email, options = {}) {
    if (!email) return null;
    const lead = this.getLeadByEmail(email.toLowerCase());
    if (!lead) return null;

    this.updateLead(lead.id, Object.assign({
      pipeline_stage: options.pipeline_stage || 'qualified',
      status: options.status || 'qualified',
      is_qualified: 1,
      lead_score: Math.max(lead.lead_score || 0, options.lead_score || 60),
      notes: options.notes || lead.notes
    }, options.updates || {}));

    this.createLeadActivity({
      lead_id: lead.id,
      activity_type: options.activity_type || 'qualification',
      activity_subject: options.activity_subject || 'Signup verified',
      activity_description: options.activity_description || 'Lead verified email and completed onboarding.'
    });

    return lead.id;
  },

  getLeadsNeedingFollowUp() {
    return db.prepare(`
      SELECT * FROM leads 
      WHERE follow_up_date IS NOT NULL 
        AND follow_up_date <= datetime('now')
        AND pipeline_stage NOT IN ('closed_won', 'closed_lost')
      ORDER BY follow_up_date ASC, priority DESC
    `).all();
  },

  getPipelineStats() {
    const stats = db.prepare(`
      SELECT 
        pipeline_stage,
        COUNT(*) as count,
        SUM(CASE WHEN is_qualified = 1 THEN 1 ELSE 0 END) as qualified_count,
        SUM(CASE WHEN clinic_phone IS NOT NULL AND clinic_phone != '' THEN 1 ELSE 0 END) as has_phone,
        SUM(CASE WHEN follow_up_date IS NOT NULL AND follow_up_date <= datetime('now') THEN 1 ELSE 0 END) as needs_followup,
        AVG(lead_score) as avg_score,
        SUM(estimated_value) as total_value
      FROM leads
      WHERE pipeline_stage NOT IN ('closed_won', 'closed_lost')
      GROUP BY pipeline_stage
    `).all();

    const total = db.prepare("SELECT COUNT(*) as count FROM leads WHERE pipeline_stage NOT IN ('closed_won', 'closed_lost')").get();
    const qualified = db.prepare("SELECT COUNT(*) as count FROM leads WHERE is_qualified = 1 AND pipeline_stage NOT IN ('closed_won', 'closed_lost')").get();

    return {
      stages: stats,
      total: total?.count || 0,
      qualified: qualified?.count || 0
    };
  },

  updateLead(id, updates) {
    const fields = [];
    const values = [];

    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'is_qualified') {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });

    // Re-check qualification if phone or email changed
    if (updates.clinic_phone !== undefined || updates.clinic_email !== undefined) {
      const lead = this.getLead(id);
      if (lead) {
        const hasPhone = (updates.clinic_phone || lead.clinic_phone) && (updates.clinic_phone || lead.clinic_phone).trim() !== '';
        const hasEmail = (updates.clinic_email || lead.clinic_email) && (updates.clinic_email || lead.clinic_email).trim() !== '';
        const isClinic = lead.clinic_name && (
          lead.clinic_name.toLowerCase().includes('clinic') ||
          lead.clinic_name.toLowerCase().includes('medical') ||
          lead.clinic_name.toLowerCase().includes('health')
        );
        fields.push('is_qualified = ?');
        values.push((hasPhone && hasEmail && isClinic) ? 1 : 0);
      }
    }

    if (fields.length === 0) return { changes: 0 };

    fields.push('updated_at = datetime(\'now\')');
    values.push(id);

    return db.prepare(`
      UPDATE leads 
      SET ${fields.join(', ')}
      WHERE id = ?
    `).run(...values);
  },

  deleteLead(id) {
    // First delete related records (cascade delete)
    db.prepare('DELETE FROM lead_activities WHERE lead_id = ?').run(id);
    db.prepare('DELETE FROM lead_calls WHERE lead_id = ?').run(id);
    // Then delete the lead
    return db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  },

  deleteTestLeads() {
    // Identify test leads by multiple patterns:
    // 1. is_test = 1
    // 2. Clinic names containing "Test"
    // 3. Emails containing test patterns (test@example.com, drlittlekids, gigtogigdev, doctorjay254, etc.)
    const testEmailPatterns = [
      'test@example.com',
      'drlittlekids',
      'gigtogigdev',
      'doctorjay254'
    ];

    // Build query to find test leads
    let query = `
      SELECT id FROM leads 
      WHERE is_test = 1 
         OR clinic_name LIKE '%Test%'
         OR clinic_name LIKE '%Debug%'
         OR clinic_name LIKE '%Webhook%'
    `;

    // Add email pattern matching
    const emailConditions = testEmailPatterns.map(pattern => `clinic_email LIKE '%${pattern}%'`).join(' OR ');
    if (emailConditions) {
      query += ` OR (${emailConditions})`;
    }

    const testLeads = db.prepare(query).all();
    const deletedCount = { leads: 0, calls: 0, activities: 0 };

    // Delete each test lead and related records
    for (const lead of testLeads) {
      // Count related records before deletion
      const calls = db.prepare('SELECT COUNT(*) as count FROM lead_calls WHERE lead_id = ?').get(lead.id);
      const activities = db.prepare('SELECT COUNT(*) as count FROM lead_activities WHERE lead_id = ?').get(lead.id);

      deletedCount.calls += calls?.count || 0;
      deletedCount.activities += activities?.count || 0;

      // Delete related records
      db.prepare('DELETE FROM lead_activities WHERE lead_id = ?').run(lead.id);
      db.prepare('DELETE FROM lead_calls WHERE lead_id = ?').run(lead.id);

      // Delete the lead
      db.prepare('DELETE FROM leads WHERE id = ?').run(lead.id);
      deletedCount.leads++;
    }

    return deletedCount;
  },

  // Lead Calls Management
  createLeadCall(callData) {
    const { v4: uuidv4 } = require('uuid');
    const id = callData.id || uuidv4();

    return db.prepare(`
      INSERT INTO lead_calls (
        id, lead_id, call_id, call_status, call_duration_seconds,
        call_cost, transcript_url, notes, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      callData.lead_id,
      callData.call_id || null,
      callData.call_status || 'pending',
      callData.call_duration_seconds || null,
      callData.call_cost || null,
      callData.transcript_url || null,
      callData.notes || null,
      callData.outcome || null
    );
  },

  getLeadCall(id) {
    return db.prepare('SELECT * FROM lead_calls WHERE id = ?').get(id);
  },

  getLeadCallsByLeadId(leadId) {
    return db.prepare(`
      SELECT * FROM lead_calls 
      WHERE lead_id = ? 
      ORDER BY created_at DESC
    `).all(leadId);
  },

  updateLeadCall(id, updates) {
    const fields = [];
    const values = [];

    Object.keys(updates).forEach(key => {
      if (key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) return { changes: 0 };

    fields.push('updated_at = datetime(\'now\')');
    values.push(id);

    return db.prepare(`
      UPDATE lead_calls 
      SET ${fields.join(', ')}
      WHERE id = ?
    `).run(...values);
  },

  // Monthly Call Usage Tracking (250 calls/month limit)
  getMonthlyCallUsage(billingMonth) {
    const usage = db.prepare('SELECT * FROM monthly_call_usage WHERE billing_month = ?').get(billingMonth);

    if (!usage) {
      // Initialize for this month
      const { v4: uuidv4 } = require('uuid');
      db.prepare(`
        INSERT INTO monthly_call_usage (id, billing_month, calls_used, calls_remaining)
        VALUES (?, ?, 0, 250)
      `).run(uuidv4(), billingMonth);
      return db.prepare('SELECT * FROM monthly_call_usage WHERE billing_month = ?').get(billingMonth);
    }

    return usage;
  },

  incrementCallUsage(billingMonth) {
    const usage = this.getMonthlyCallUsage(billingMonth);

    if (usage.calls_remaining <= 0) {
      throw new Error(`Monthly call limit reached (250 calls). Current usage: ${usage.calls_used}`);
    }

    return db.prepare(`
      UPDATE monthly_call_usage 
      SET calls_used = calls_used + 1,
          calls_remaining = calls_remaining - 1,
          updated_at = datetime('now')
      WHERE billing_month = ?
    `).run(billingMonth);
  },

  getCallUsageStats() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.getMonthlyCallUsage(currentMonth);
  },

  // Lead Activities Management
  createLeadActivity(activityData) {
    const { v4: uuidv4 } = require('uuid');
    const id = activityData.id || uuidv4();

    return db.prepare(`
      INSERT INTO lead_activities (
        id, lead_id, activity_type, activity_subject, activity_description,
        activity_date, created_by, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      activityData.lead_id,
      activityData.activity_type, // 'call', 'email', 'meeting', 'note', 'update'
      activityData.activity_subject || null,
      activityData.activity_description || null,
      activityData.activity_date || new Date().toISOString(),
      activityData.created_by || null,
      activityData.metadata ? JSON.stringify(activityData.metadata) : null
    );
  },

  getLeadActivities(leadId, filters = {}) {
    let query = 'SELECT * FROM lead_activities WHERE lead_id = ?';
    const params = [leadId];

    if (filters.activity_type) {
      query += ' AND activity_type = ?';
      params.push(filters.activity_type);
    }

    query += ' ORDER BY activity_date DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  // Products Management
  getAllProducts(merchantId = null) {
    if (merchantId) {
      return db.prepare('SELECT * FROM products WHERE merchant_id = ? OR merchant_id IS NULL ORDER BY created_at DESC').all(merchantId);
    }
    return db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  },

  getProduct(id) {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  },

  getProductsByMerchant(merchantId) {
    return db.prepare('SELECT * FROM products WHERE merchant_id = ? OR merchant_id IS NULL ORDER BY created_at DESC').all(merchantId);
  },

  searchProducts(query, merchantId = null) {
    // Normalize search query: remove hyphens and spaces for better matching
    // "pre rolls" will match "PRE-ROLLS" and "pre-rolls"
    const normalizedQuery = query.toLowerCase().replace(/[\s-]/g, '');
    const searchTerm = `%${normalizedQuery}%`;

    // Also search with original query for exact matches
    const originalSearchTerm = `%${query.toLowerCase()}%`;

    if (merchantId) {
      return db.prepare(`
        SELECT * FROM products 
        WHERE (merchant_id = ? OR merchant_id IS NULL)
        AND (
          REPLACE(REPLACE(LOWER(name), '-', ''), ' ', '') LIKE ? OR 
          REPLACE(REPLACE(LOWER(description), '-', ''), ' ', '') LIKE ? OR 
          REPLACE(REPLACE(LOWER(category), '-', ''), ' ', '') LIKE ? OR
          LOWER(name) LIKE ? OR 
          LOWER(description) LIKE ? OR 
          LOWER(category) LIKE ?
        )
        ORDER BY created_at DESC
      `).all(merchantId, searchTerm, searchTerm, searchTerm, originalSearchTerm, originalSearchTerm, originalSearchTerm);
    }
    return db.prepare(`
      SELECT * FROM products 
      WHERE (
        REPLACE(REPLACE(LOWER(name), '-', ''), ' ', '') LIKE ? OR 
        REPLACE(REPLACE(LOWER(description), '-', ''), ' ', '') LIKE ? OR 
        REPLACE(REPLACE(LOWER(category), '-', ''), ' ', '') LIKE ? OR
        LOWER(name) LIKE ? OR 
        LOWER(description) LIKE ? OR 
        LOWER(category) LIKE ?
      )
      ORDER BY created_at DESC
    `).all(searchTerm, searchTerm, searchTerm, originalSearchTerm, originalSearchTerm, originalSearchTerm);
  },

  createProduct(productData) {
    const { v4: uuidv4 } = require('uuid');
    const id = productData.id || uuidv4();

    return db.prepare(`
      INSERT INTO products (id, merchant_id, name, description, price, inventory, image_url, category, tags, protocol_stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      productData.merchant_id || null,
      productData.name,
      productData.description || null,
      productData.price,
      productData.inventory !== undefined ? productData.inventory : 0,
      productData.image_url || null,
      productData.category || null,
      productData.tags != null ? (typeof productData.tags === 'string' ? productData.tags : JSON.stringify(productData.tags)) : null,
      productData.protocol_stage || null
    );
  },

  updateProduct(id, updates) {
    const allowedFields = ['name', 'description', 'price', 'inventory', 'image_url', 'category', 'merchant_id', 'tags', 'protocol_stage'];
    const setParts = [];
    const values = [];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        setParts.push(`${key} = ?`);
        let v = updates[key];
        if (key === 'tags' && v != null && typeof v !== 'string') {
          v = JSON.stringify(v);
        }
        values.push(v);
      }
    }

    if (setParts.length === 0) return { changes: 0 };

    setParts.push('updated_at = datetime(\'now\')');
    values.push(id);

    return db.prepare(`UPDATE products SET ${setParts.join(', ')} WHERE id = ?`).run(...values);
  },

  updateInventory(productId, quantity) {
    return db.prepare('UPDATE products SET inventory = inventory - ?, updated_at = datetime(\'now\') WHERE id = ?').run(quantity, productId);
  },

  deleteProduct(id) {
    return db.prepare('DELETE FROM products WHERE id = ?').run(id);
  },

  // Orders Management
  getAllOrders(merchantId = null) {
    if (merchantId) {
      return db.prepare(`
        SELECT o.*, p.name as product_name, p.price as product_price
        FROM merchant_orders o
        LEFT JOIN products p ON o.product_id = p.id
        WHERE o.merchant_id = ? OR o.merchant_id IS NULL
        ORDER BY o.created_at DESC
      `).all(merchantId);
    }
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.price as product_price
      FROM merchant_orders o
      LEFT JOIN products p ON o.product_id = p.id
      ORDER BY o.created_at DESC
    `).all();
  },

  getOrder(id) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.price as product_price
      FROM merchant_orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.id = ?
    `).get(id);
  },

  getMerchantOrderByStripePaymentIntentId(piId) {
    if (!piId) return null;
    try {
      return db.prepare(`
        SELECT o.*, p.name as product_name, p.price as product_price
        FROM merchant_orders o
        LEFT JOIN products p ON o.product_id = p.id
        WHERE o.stripe_payment_intent_id = ?
        LIMIT 1
      `).get(piId);
    } catch (_) {
      return null;
    }
  },

  getMerchantOrderByVoiceCheckoutId(voiceCheckoutId) {
    if (!voiceCheckoutId) return null;
    try {
      return db.prepare(`
        SELECT o.*, p.name as product_name, p.price as product_price
        FROM merchant_orders o
        LEFT JOIN products p ON o.product_id = p.id
        WHERE o.voice_checkout_id = ?
        LIMIT 1
      `).get(voiceCheckoutId);
    } catch (_) {
      return null;
    }
  },

  getOrdersByMerchant(merchantId) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.price as product_price
      FROM merchant_orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.merchant_id = ?
      ORDER BY o.created_at DESC
    `).all(merchantId);
  },

  createOrder(orderData) {
    const { v4: uuidv4 } = require('uuid');
    const id = orderData.id || uuidv4();

    // Handle address fields (can be string or object)
    const shippingAddress = typeof orderData.shipping_address === 'object'
      ? JSON.stringify(orderData.shipping_address)
      : (orderData.shipping_address || null);

    const pickupAddress = typeof orderData.pickup_address === 'object'
      ? JSON.stringify(orderData.pickup_address)
      : (orderData.pickup_address || null);

    const dropPoint = typeof orderData.drop_point === 'object'
      ? JSON.stringify(orderData.drop_point)
      : (orderData.drop_point || orderData.shipping_address || null);

    const insertResult = db.prepare(`
      INSERT INTO merchant_orders (
        id, merchant_id, product_id, quantity, customer_email, customer_name,
        customer_phone, shipping_address, pickup_address, pickup_latitude, pickup_longitude,
        drop_point, total_amount, status, payment_status, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      orderData.merchant_id || null,
      orderData.product_id,
      orderData.quantity,
      orderData.customer_email,
      orderData.customer_name || null,
      orderData.customer_phone || null,
      shippingAddress,
      pickupAddress,
      orderData.pickup_latitude || null,
      orderData.pickup_longitude || null,
      dropPoint,
      orderData.total_amount,
      orderData.status || 'pending',
      orderData.payment_status || 'pending',
      orderData.source || 'direct'
    );
    try {
      const cols = db.prepare(`PRAGMA table_info(merchant_orders)`).all();
      const names = new Set(cols.map((c) => c.name));
      const sets = [];
      const vals = [];
      if (names.has('commerce_quote_id') && orderData.commerce_quote_id != null && orderData.commerce_quote_id !== '') {
        sets.push('commerce_quote_id = ?');
        vals.push(String(orderData.commerce_quote_id));
      }
      if (names.has('voice_checkout_id') && orderData.voice_checkout_id != null && orderData.voice_checkout_id !== '') {
        sets.push('voice_checkout_id = ?');
        vals.push(String(orderData.voice_checkout_id));
      }
      if (names.has('stripe_payment_intent_id') && orderData.stripe_payment_intent_id != null && orderData.stripe_payment_intent_id !== '') {
        sets.push('stripe_payment_intent_id = ?');
        vals.push(String(orderData.stripe_payment_intent_id));
      }
      if (names.has('external_order_id') && orderData.external_order_id != null && orderData.external_order_id !== '') {
        sets.push('external_order_id = ?');
        vals.push(String(orderData.external_order_id));
      }
      if (sets.length) {
        vals.push(id);
        db.prepare(`UPDATE merchant_orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
    } catch (_) {}
    return insertResult;
  },

  updateOrder(id, updates) {
    const allowedFields = [
      'status', 'payment_status', 'quantity', 'total_amount',
      'delivery_status', 'driver_name', 'driver_phone',
      'current_latitude', 'current_longitude', 'current_address',
      'estimated_arrival', 'last_location_update', 'tracking_events',
      'pickup_address', 'pickup_latitude', 'pickup_longitude', 'drop_point'
    ];
    const setParts = [];
    const values = [];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        setParts.push(`${key} = ?`);
        // Handle JSON fields
        if (key === 'tracking_events' && typeof updates[key] === 'object') {
          values.push(JSON.stringify(updates[key]));
        } else {
          values.push(updates[key]);
        }
      }
    }

    if (setParts.length === 0) return { changes: 0 };

    setParts.push('updated_at = datetime(\'now\')');
    values.push(id);

    return db.prepare(`UPDATE merchant_orders SET ${setParts.join(', ')} WHERE id = ?`).run(...values);
  },

  updateOrderStatus(id, status) {
    return db.prepare('UPDATE merchant_orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
  },

  getAllQualifiedLeads(filters = {}) {
    let query = 'SELECT * FROM leads WHERE is_qualified = 1';
    const params = [];

    if (filters.pipeline_stage) {
      query += ' AND pipeline_stage = ?';
      params.push(filters.pipeline_stage);
    }

    if (filters.needs_followup === true) {
      query += ' AND follow_up_date IS NOT NULL AND follow_up_date <= datetime("now")';
    }

    query += ' ORDER BY lead_score DESC, priority DESC, created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  // ============================================
  // LEAD LABELS
  // ============================================
  getAllLabels() {
    return db.prepare('SELECT * FROM lead_labels ORDER BY name').all();
  },

  getLabel(id) {
    return db.prepare('SELECT * FROM lead_labels WHERE id = ?').get(id);
  },

  createLabel(labelData) {
    const { v4: uuidv4 } = require('uuid');
    const id = labelData.id || uuidv4();
    return db.prepare(`
      INSERT INTO lead_labels (id, name, color)
      VALUES (?, ?, ?)
    `).run(id, labelData.name, labelData.color || '#3b82f6');
  },

  getLabelsForLead(leadId) {
    return db.prepare(`
      SELECT ll.*
      FROM lead_labels ll
      INNER JOIN lead_label_assignments lla ON ll.id = lla.label_id
      WHERE lla.lead_id = ?
      ORDER BY ll.name
    `).all(leadId);
  },

  assignLabelToLead(leadId, labelId) {
    try {
      return db.prepare(`
        INSERT INTO lead_label_assignments (lead_id, label_id)
        VALUES (?, ?)
      `).run(leadId, labelId);
    } catch (error) {
      // Ignore duplicate assignment errors
      if (error.message && error.message.includes('UNIQUE constraint')) {
        return { changes: 0 };
      }
      throw error;
    }
  },

  removeLabelFromLead(leadId, labelId) {
    return db.prepare(`
      DELETE FROM lead_label_assignments
      WHERE lead_id = ? AND label_id = ?
    `).run(leadId, labelId);
  },

  getLeadsByLabel(labelId) {
    return db.prepare(`
      SELECT l.*
      FROM leads l
      INNER JOIN lead_label_assignments lla ON l.id = lla.lead_id
      WHERE lla.label_id = ?
      ORDER BY l.created_at DESC
    `).all(labelId);
  },

  // ============================================
  // AUTOMATION FUNCTIONS
  // ============================================

  // Customer search by name
  getCustomerByName(name, merchantId) {
    if (!name) return null;
    const searchTerm = `%${name.toLowerCase()}%`;
    if (merchantId) {
      return db.prepare(`
        SELECT * FROM customers 
        WHERE (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)
        AND merchant_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `).all(searchTerm, searchTerm, merchantId);
    }
    return db.prepare(`
      SELECT * FROM customers 
      WHERE LOWER(name) LIKE ? OR LOWER(email) LIKE ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(searchTerm, searchTerm);
  },

  // Get orders by customer
  getOrdersByCustomer(customerId) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.price as product_price
      FROM merchant_orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.customer_id = ?
      ORDER BY o.created_at DESC
    `).all(customerId);
  },

  // Template functions
  getTemplate(id) {
    return db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  },

  getTemplates(merchantId, type = null) {
    let query = 'SELECT * FROM templates WHERE merchant_id = ?';
    const params = [merchantId];
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    query += ' ORDER BY created_at DESC';
    return db.prepare(query).all(...params);
  },

  createTemplate(template) {
    const { v4: uuidv4 } = require('uuid');
    const id = template.id || uuidv4();
    return db.prepare(`
      INSERT INTO templates (id, merchant_id, name, type, subject, content, variables)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      template.merchant_id,
      template.name,
      template.type,
      template.subject || null,
      template.content,
      template.variables ? JSON.stringify(template.variables) : null
    );
  },

  updateTemplate(id, merchantId, updates) {
    const fields = [];
    const values = [];
    const allowedFields = ['name', 'type', 'subject', 'content', 'variables'];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        if (key === 'variables' && typeof updates[key] === 'object') {
          values.push(JSON.stringify(updates[key]));
        } else {
          values.push(updates[key]);
        }
      }
    }

    if (fields.length === 0) return { changes: 0 };

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, merchantId);

    return db.prepare(`UPDATE templates SET ${fields.join(', ')} WHERE id = ? AND merchant_id = ?`).run(...values);
  },

  deleteTemplate(id, merchantId) {
    return db.prepare('DELETE FROM templates WHERE id = ? AND merchant_id = ?').run(id, merchantId);
  },

  // Automation rule functions
  getAutomationRules(merchantId) {
    return db.prepare(`
      SELECT ar.*, t.name as template_name, t.type as template_type
      FROM automation_rules ar
      LEFT JOIN templates t ON ar.template_id = t.id
      WHERE ar.merchant_id = ?
      ORDER BY ar.created_at DESC
    `).all(merchantId);
  },

  createAutomationRule(rule) {
    const { v4: uuidv4 } = require('uuid');
    const id = rule.id || uuidv4();
    return db.prepare(`
      INSERT INTO automation_rules (id, merchant_id, trigger, action, template_id, enabled, conditions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      rule.merchant_id,
      rule.trigger,
      rule.action,
      rule.template_id || null,
      rule.enabled !== undefined ? (rule.enabled ? 1 : 0) : 1,
      rule.conditions ? JSON.stringify(rule.conditions) : null
    );
  },

  updateAutomationRule(id, merchantId, updates) {
    const fields = [];
    const values = [];
    const allowedFields = ['trigger', 'action', 'template_id', 'enabled', 'conditions'];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        if (key === 'conditions' && typeof updates[key] === 'object') {
          values.push(JSON.stringify(updates[key]));
        } else if (key === 'enabled') {
          values.push(updates[key] ? 1 : 0);
        } else {
          values.push(updates[key]);
        }
      }
    }

    if (fields.length === 0) return { changes: 0 };

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, merchantId);

    return db.prepare(`UPDATE automation_rules SET ${fields.join(', ')} WHERE id = ? AND merchant_id = ?`).run(...values);
  },

  deleteAutomationRule(id, merchantId) {
    return db.prepare('DELETE FROM automation_rules WHERE id = ? AND merchant_id = ?').run(id, merchantId);
  },

  // Sequence functions (Phase 2)
  getSequence(id) {
    const result = db.prepare('SELECT * FROM sequences WHERE id = ?').get(id);
    if (result && result.steps_json) {
      result.steps = typeof result.steps_json === 'string' ? JSON.parse(result.steps_json) : result.steps_json;
    }
    return result;
  },

  getSequences(merchantId = null, enabled = null) {
    let query = 'SELECT * FROM sequences WHERE 1=1';
    const params = [];

    if (merchantId) {
      query += ' AND merchant_id = ?';
      params.push(merchantId);
    }

    if (enabled !== null) {
      query += ' AND enabled = ?';
      params.push(enabled ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';
    const results = db.prepare(query).all(...params);
    
    // Parse steps_json for each sequence
    return results.map(seq => {
      if (seq.steps_json) {
        seq.steps = typeof seq.steps_json === 'string' ? JSON.parse(seq.steps_json) : seq.steps_json;
      }
      return seq;
    });
  },

  createSequence(sequence) {
    const { v4: uuidv4 } = require('uuid');
    const id = sequence.id || uuidv4();
    const stepsJson = JSON.stringify(sequence.steps || sequence.steps_json || []);
    
    db.prepare(`
      INSERT INTO sequences (id, merchant_id, name, description, steps_json, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sequence.merchant_id || null,
      sequence.name,
      sequence.description || null,
      stepsJson,
      sequence.enabled !== undefined ? (sequence.enabled ? 1 : 0) : 1
    );
    
    // Return object with id for consistency
    return { id, changes: 1 };
  },

  updateSequence(id, merchantId, updates) {
    const fields = [];
    const values = [];
    const allowedFields = ['name', 'description', 'steps', 'steps_json', 'enabled'];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        fields.push(`${key === 'steps' ? 'steps_json' : key} = ?`);
        if (key === 'steps' || key === 'steps_json') {
          const stepsJson = typeof updates[key] === 'string' ? updates[key] : JSON.stringify(updates[key]);
          values.push(stepsJson);
        } else if (key === 'enabled') {
          values.push(updates[key] ? 1 : 0);
        } else {
          values.push(updates[key]);
        }
      }
    }

    if (fields.length === 0) return { changes: 0 };

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, merchantId || null);

    const merchantClause = merchantId ? ' AND merchant_id = ?' : ' AND (merchant_id = ? OR merchant_id IS NULL)';
    return db.prepare(`UPDATE sequences SET ${fields.join(', ')} WHERE id = ?${merchantClause}`).run(...values);
  },

  deleteSequence(id, merchantId = null) {
    if (merchantId) {
      return db.prepare('DELETE FROM sequences WHERE id = ? AND merchant_id = ?').run(id, merchantId);
    }
    return db.prepare('DELETE FROM sequences WHERE id = ?').run(id);
  },

  // Sequence execution functions
  getSequenceExecution(id) {
    const result = db.prepare('SELECT * FROM sequence_executions WHERE id = ?').get(id);
    if (result && result.metadata) {
      result.metadata = typeof result.metadata === 'string' ? JSON.parse(result.metadata) : result.metadata;
    }
    return result;
  },

  getSequenceExecutions(sequenceId = null, leadId = null, status = null) {
    let query = 'SELECT * FROM sequence_executions WHERE 1=1';
    const params = [];

    if (sequenceId) {
      query += ' AND sequence_id = ?';
      params.push(sequenceId);
    }

    if (leadId) {
      query += ' AND lead_id = ?';
      params.push(leadId);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY started_at DESC';
    const results = db.prepare(query).all(...params);
    
    // Parse metadata for each execution
    return results.map(exec => {
      if (exec.metadata) {
        exec.metadata = typeof exec.metadata === 'string' ? JSON.parse(exec.metadata) : exec.metadata;
      }
      return exec;
    });
  },

  createSequenceExecution(execution) {
    const { v4: uuidv4 } = require('uuid');
    const id = execution.id || uuidv4();
    const metadataJson = execution.metadata ? JSON.stringify(execution.metadata) : null;
    
    db.prepare(`
      INSERT INTO sequence_executions (id, sequence_id, lead_id, current_step, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      execution.sequence_id,
      execution.lead_id,
      execution.current_step || 0,
      execution.status || 'active',
      metadataJson
    );
    
    // Return object with id for consistency
    return { id, changes: 1 };
  },

  updateSequenceExecution(id, updates) {
    const fields = [];
    const values = [];
    const allowedFields = ['current_step', 'status', 'metadata', 'completed_at', 'paused_at'];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        if (key === 'metadata') {
          fields.push('metadata = ?');
          values.push(typeof updates[key] === 'string' ? updates[key] : JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      }
    }

    if (fields.length === 0) return { changes: 0 };

    values.push(id);
    return db.prepare(`UPDATE sequence_executions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  deleteSequenceExecution(id) {
    return db.prepare('DELETE FROM sequence_executions WHERE id = ?').run(id);
  },

  // Qualification rules functions (Phase 2)
  getQualificationRule(id) {
    const result = db.prepare('SELECT * FROM qualification_rules WHERE id = ?').get(id);
    if (result && result.rules_json) {
      result.rules = typeof result.rules_json === 'string' ? JSON.parse(result.rules_json) : result.rules_json;
    }
    return result;
  },

  getQualificationRules(merchantId = null, enabled = null) {
    let query = 'SELECT * FROM qualification_rules WHERE 1=1';
    const params = [];

    if (merchantId) {
      query += ' AND (merchant_id = ? OR merchant_id IS NULL)';
      params.push(merchantId);
    }

    if (enabled !== null) {
      query += ' AND enabled = ?';
      params.push(enabled ? 1 : 0);
    }

    query += ' ORDER BY priority DESC, created_at DESC';
    const results = db.prepare(query).all(...params);
    
    // Parse rules_json for each rule
    return results.map(rule => {
      if (rule.rules_json) {
        rule.rules = typeof rule.rules_json === 'string' ? JSON.parse(rule.rules_json) : rule.rules_json;
      }
      return rule;
    });
  },

  createQualificationRule(rule) {
    const { v4: uuidv4 } = require('uuid');
    const id = rule.id || uuidv4();
    const rulesJson = JSON.stringify(rule.rules || rule.rules_json || []);
    
    db.prepare(`
      INSERT INTO qualification_rules (id, merchant_id, name, description, rules_json, enabled, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      rule.merchant_id || null,
      rule.name,
      rule.description || null,
      rulesJson,
      rule.enabled !== undefined ? (rule.enabled ? 1 : 0) : 1,
      rule.priority || 5
    );
    
    // Return object with id for consistency
    return { id, changes: 1 };
  },

  updateQualificationRule(id, merchantId, updates) {
    const fields = [];
    const values = [];
    const allowedFields = ['name', 'description', 'rules', 'rules_json', 'enabled', 'priority'];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        fields.push(`${key === 'rules' ? 'rules_json' : key} = ?`);
        if (key === 'rules' || key === 'rules_json') {
          const rulesJson = typeof updates[key] === 'string' ? updates[key] : JSON.stringify(updates[key]);
          values.push(rulesJson);
        } else if (key === 'enabled') {
          values.push(updates[key] ? 1 : 0);
        } else {
          values.push(updates[key]);
        }
      }
    }

    if (fields.length === 0) return { changes: 0 };

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, merchantId || null);

    const merchantClause = merchantId ? ' AND merchant_id = ?' : ' AND (merchant_id = ? OR merchant_id IS NULL)';
    return db.prepare(`UPDATE qualification_rules SET ${fields.join(', ')} WHERE id = ?${merchantClause}`).run(...values);
  },

  deleteQualificationRule(id, merchantId = null) {
    if (merchantId) {
      return db.prepare('DELETE FROM qualification_rules WHERE id = ? AND merchant_id = ?').run(id, merchantId);
    }
    return db.prepare('DELETE FROM qualification_rules WHERE id = ?').run(id);
  },

  // Message history functions
  createMessageHistory(message) {
    const { v4: uuidv4 } = require('uuid');
    const id = message.id || uuidv4();
    return db.prepare(`
      INSERT INTO message_history (
        id, merchant_id, customer_id, type, recipient, content, subject,
        status, provider_id, sent_at, error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      message.merchant_id,
      message.customer_id || null,
      message.type,
      message.recipient,
      message.content,
      message.subject || null,
      message.status || 'pending',
      message.provider_id || null,
      message.sent_at || null,
      message.error_message || null
    );
  },

  getMessageHistory(merchantId, filters = {}) {
    let query = 'SELECT * FROM message_history WHERE merchant_id = ?';
    const params = [merchantId];

    if (filters.customer_id) {
      query += ' AND customer_id = ?';
      params.push(filters.customer_id);
    }

    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.start_date) {
      query += ' AND created_at >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND created_at <= ?';
      params.push(filters.end_date);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  // ============================================
  // PROMOTIONS FUNCTIONS
  // ============================================

  getPromotion(id) {
    return db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
  },

  getPromotions(merchantId, filters = {}) {
    let query = 'SELECT * FROM promotions WHERE merchant_id = ?';
    const params = [merchantId];

    if (filters.enabled !== undefined) {
      query += ' AND enabled = ?';
      params.push(filters.enabled ? 1 : 0);
    }

    if (filters.code) {
      query += ' AND code = ?';
      params.push(filters.code);
    }

    // Active promotions (current date between start and end, or no dates)
    if (filters.active === true) {
      query += ' AND enabled = 1 AND (start_date IS NULL OR start_date <= datetime(\'now\')) AND (end_date IS NULL OR end_date >= datetime(\'now\'))';
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  },

  createPromotion(promotion) {
    const { v4: uuidv4 } = require('uuid');
    const id = promotion.id || uuidv4();

    return db.prepare(`
      INSERT INTO promotions (
        id, merchant_id, name, description, discount_type, discount_value,
        code, product_ids, customer_segment, start_date, end_date,
        enabled, max_uses, current_uses
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      promotion.merchant_id,
      promotion.name,
      promotion.description || null,
      promotion.discount_type,
      promotion.discount_value,
      promotion.code || null,
      promotion.product_ids ? JSON.stringify(promotion.product_ids) : null,
      promotion.customer_segment || 'all',
      promotion.start_date || null,
      promotion.end_date || null,
      promotion.enabled !== undefined ? (promotion.enabled ? 1 : 0) : 1,
      promotion.max_uses || null,
      promotion.current_uses || 0
    );
  },

  updatePromotion(id, merchantId, updates) {
    const fields = [];
    const values = [];
    const allowedFields = [
      'name', 'description', 'discount_type', 'discount_value', 'code',
      'product_ids', 'customer_segment', 'start_date', 'end_date',
      'enabled', 'max_uses', 'current_uses'
    ];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        if (key === 'product_ids' && typeof updates[key] === 'object') {
          values.push(JSON.stringify(updates[key]));
        } else if (key === 'enabled') {
          values.push(updates[key] ? 1 : 0);
        } else {
          values.push(updates[key]);
        }
      }
    }

    if (fields.length === 0) return { changes: 0 };

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, merchantId);

    return db.prepare(`UPDATE promotions SET ${fields.join(', ')} WHERE id = ? AND merchant_id = ?`).run(...values);
  },

  deletePromotion(id, merchantId) {
    return db.prepare('DELETE FROM promotions WHERE id = ? AND merchant_id = ?').run(id, merchantId);
  },

  incrementPromotionUses(id) {
    return db.prepare('UPDATE promotions SET current_uses = current_uses + 1 WHERE id = ?').run(id);
  },

  // Database reference for direct access
  db
};

// ============================================
// KNOWLEDGE BASE EXTENSIONS
// ============================================

module.exports.bulkUpsertCptCodes = function bulkUpsertCptCodes(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return { inserted: 0 };
  }

  const stmt = db.prepare(`
    INSERT INTO cpt_codes (code, description, category, subcategory, is_new)
    VALUES (@code, @description, @category, @subcategory, @is_new)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      category = excluded.category,
      subcategory = excluded.subcategory,
      is_new = excluded.is_new,
      updated_at = datetime('now')
  `);

  const insertMany = db.transaction((codes) => {
    for (const item of codes) {
      if (!item || !item.code || !item.description) continue;
      stmt.run({
        code: String(item.code).toUpperCase(),
        description: item.description,
        category: item.category || null,
        subcategory: item.subcategory || null,
        is_new: item.is_new ? 1 : 0
      });
    }
  });

  insertMany(items);
  return { inserted: items.length };
};

module.exports.searchCptCodes = function searchCptCodes(query, limit = 10) {
  if (!query || !query.trim()) return [];
  const term = `%${query.trim().toLowerCase()}%`;
  return db.prepare(`
    SELECT code, description, category, subcategory
    FROM cpt_codes
    WHERE LOWER(code) LIKE ? OR LOWER(description) LIKE ?
    ORDER BY CASE WHEN LOWER(code) LIKE ? THEN 0 ELSE 1 END,
             description
    LIMIT ?
  `).all(term, term, term, limit);
};

// ICD-10 codes (Phase 2.1)
module.exports.bulkUpsertIcd10Codes = function bulkUpsertIcd10Codes(items = []) {
  if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
  const stmt = db.prepare(`
    INSERT INTO icd10_codes (code, description, category, billable, source_file)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      category = excluded.category,
      billable = excluded.billable,
      source_file = excluded.source_file
  `);
  let count = 0;
  for (const item of items) {
    if (!item || !item.code || !item.description) continue;
    stmt.run(
      String(item.code).trim().toUpperCase(),
      String(item.description).trim(),
      item.category || null,
      item.billable != null ? (item.billable ? 1 : 0) : 1,
      item.source_file || null
    );
    count++;
  }
  return { inserted: count };
};

module.exports.searchIcd10Codes = function searchIcd10Codes(query, limit = 15) {
  const q = (query || '').toString().trim();
  if (!q) return [];
  const term = `%${q.toLowerCase()}%`;
  return db.prepare(`
    SELECT code, description, category, billable
    FROM icd10_codes
    WHERE LOWER(code) LIKE ? OR LOWER(description) LIKE ?
    ORDER BY CASE WHEN LOWER(code) LIKE ? THEN 0 ELSE 1 END,
             CASE WHEN LOWER(code) = LOWER(?) THEN 0 ELSE 1 END,
             description
    LIMIT ?
  `).all(term, term, term, q, limit);
};

module.exports.getIcd10CodesCount = function getIcd10CodesCount() {
  const row = db.prepare('SELECT COUNT(*) as n FROM icd10_codes').get();
  return row ? row.n : 0;
};

// HCPCS codes (Phase 2.2)
module.exports.bulkUpsertHcpcsCodes = function bulkUpsertHcpcsCodes(items = []) {
  if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
  const stmt = db.prepare(`
    INSERT INTO hcpcs_codes (code, long_desc, short_desc, pricing_ind, coverage_cd, type, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      long_desc = excluded.long_desc,
      short_desc = excluded.short_desc,
      pricing_ind = excluded.pricing_ind,
      coverage_cd = excluded.coverage_cd,
      type = excluded.type,
      source_file = excluded.source_file
  `);
  let count = 0;
  for (const item of items) {
    if (!item || !item.code || !item.long_desc) continue;
    stmt.run(
      String(item.code).trim().toUpperCase(),
      String(item.long_desc).trim(),
      item.short_desc ? String(item.short_desc).trim() : null,
      item.pricing_ind || null,
      item.coverage_cd || null,
      item.type || null,
      item.source_file || null
    );
    count++;
  }
  return { inserted: count };
};

module.exports.searchHcpcsCodes = function searchHcpcsCodes(query, limit = 15) {
  const q = (query || '').toString().trim();
  if (!q) return [];
  const term = `%${q.toLowerCase()}%`;
  return db.prepare(`
    SELECT code, long_desc, short_desc, pricing_ind, coverage_cd, type
    FROM hcpcs_codes
    WHERE LOWER(code) LIKE ? OR LOWER(long_desc) LIKE ? OR LOWER(short_desc) LIKE ?
    ORDER BY CASE WHEN LOWER(code) LIKE ? THEN 0 ELSE 1 END,
             CASE WHEN LOWER(code) = LOWER(?) THEN 0 ELSE 1 END,
             long_desc
    LIMIT ?
  `).all(term, term, term, term, q, limit);
};

module.exports.getHcpcsCodesCount = function getHcpcsCodesCount() {
  const row = db.prepare('SELECT COUNT(*) as n FROM hcpcs_codes').get();
  return row ? row.n : 0;
};

// Code existence validation (Phase 6.1 - prevent hallucinated codes)
module.exports.codeExists = function codeExists(code, codeType) {
  if (!code || !codeType) return false;
  const raw = String(code).trim().toUpperCase();
  const noDots = raw.replace(/\./g, '');
  if (codeType === 'icd10') {
    const r = db.prepare('SELECT 1 FROM icd10_codes WHERE UPPER(TRIM(code)) = ? OR UPPER(TRIM(code)) = ?').get(raw, noDots);
    if (r) return true;
    const r2 = db.prepare("SELECT 1 FROM icd10_codes WHERE UPPER(REPLACE(TRIM(code), '.', '')) = ?").get(noDots);
    return r2 != null;
  }
  if (codeType === 'cpt') {
    return db.prepare('SELECT 1 FROM cpt_codes WHERE UPPER(TRIM(code)) = ?').get(raw) != null;
  }
  if (codeType === 'hcpcs') {
    return db.prepare('SELECT 1 FROM hcpcs_codes WHERE UPPER(TRIM(code)) = ?').get(raw) != null;
  }
  return false;
};

// Code embeddings (Phase 2.3 - optional semantic search, Layer 2 specialty filter)
function deriveSpecialtyFromCode(code, codeType) {
  if (!code || !codeType) return 'general';
  const c = String(code).toUpperCase().trim();
  if (codeType === 'icd10') {
    if (/^[ST]\d/.test(c)) return 'orthopedics';
    if (/^I\d/.test(c)) return 'cardiology';
    if (/^J\d/.test(c)) return 'pulmonology';
    if (/^G\d/.test(c)) return 'neurology';
    if (/^L\d/.test(c)) return 'dermatology';
    if (/^K\d/.test(c)) return 'gastroenterology';
    if (/^R\d/.test(c)) return 'emergency';
  }
  if (codeType === 'cpt') {
    if (/^(2[0-4]\d{3}|2[5-9]\d{3})/.test(c)) return 'orthopedics';
    if (/^(93\d{3})/.test(c)) return 'cardiology';
    if (/^(94\d{3})/.test(c)) return 'pulmonology';
  }
  return 'general';
}

module.exports.getAllCodeEmbeddings = function getAllCodeEmbeddings(codeType = null, specialty = null) {
  let rows;
  try {
    const hasSpecialty = db.prepare('PRAGMA table_info(code_embeddings)').all().some(col => col.name === 'specialty');
    if (codeType && specialty && hasSpecialty) {
      rows = db.prepare('SELECT code, code_type, description_text, embedding_json, specialty FROM code_embeddings WHERE code_type = ? AND (specialty = ? OR specialty IS NULL OR specialty = \'\')').all(codeType, specialty);
    } else if (codeType) {
      rows = db.prepare('SELECT code, code_type, description_text, embedding_json, specialty FROM code_embeddings WHERE code_type = ?').all(codeType);
    } else if (specialty && hasSpecialty) {
      rows = db.prepare('SELECT code, code_type, description_text, embedding_json, specialty FROM code_embeddings WHERE specialty = ? OR specialty IS NULL OR specialty = \'\'').all(specialty);
    } else {
      rows = db.prepare('SELECT code, code_type, description_text, embedding_json, specialty FROM code_embeddings').all();
    }
  } catch (_) {
    rows = db.prepare('SELECT code, code_type, description_text, embedding_json FROM code_embeddings').all();
  }
  return rows.filter(r => r.embedding_json).map(r => ({
    code: r.code,
    code_type: r.code_type,
    description_text: r.description_text,
    embedding: JSON.parse(r.embedding_json),
    specialty: r.specialty || null
  }));
};

module.exports.upsertCodeEmbedding = function upsertCodeEmbedding(record) {
  const id = record.id || `${record.code_type}_${record.code}`;
  const specialty = record.specialty || deriveSpecialtyFromCode(record.code, record.code_type);
  try {
    const hasSpecialty = db.prepare('PRAGMA table_info(code_embeddings)').all().some(col => col.name === 'specialty');
    if (hasSpecialty) {
      db.prepare(`
        INSERT INTO code_embeddings (id, code, code_type, description_text, embedding_json, specialty)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          description_text = excluded.description_text,
          embedding_json = excluded.embedding_json,
          specialty = excluded.specialty
      `).run(id, record.code, record.code_type, record.description_text || null, record.embedding_json || null, specialty);
    } else {
      db.prepare(`
        INSERT INTO code_embeddings (id, code, code_type, description_text, embedding_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          description_text = excluded.description_text,
          embedding_json = excluded.embedding_json
      `).run(id, record.code, record.code_type, record.description_text || null, record.embedding_json || null);
    }
  } catch (_) {
    db.prepare(`
      INSERT INTO code_embeddings (id, code, code_type, description_text, embedding_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        description_text = excluded.description_text,
        embedding_json = excluded.embedding_json
    `).run(id, record.code, record.code_type, record.description_text || null, record.embedding_json || null);
  }
  return id;
};

module.exports.getCodeEmbeddingsCount = function getCodeEmbeddingsCount() {
  const row = db.prepare('SELECT COUNT(*) as n FROM code_embeddings WHERE embedding_json IS NOT NULL').get();
  return row ? row.n : 0;
};

module.exports.backfillCodeEmbeddingSpecialty = function backfillCodeEmbeddingSpecialty() {
  const tableInfo = db.prepare('PRAGMA table_info(code_embeddings)').all();
  const hasSpecialty = tableInfo.some(c => c.name === 'specialty');
  if (!hasSpecialty) return { updated: 0, skipped: 0, reason: 'specialty_column_missing' };
  const rows = db.prepare('SELECT id, code, code_type FROM code_embeddings WHERE specialty IS NULL OR specialty = \'\'').all();
  let updated = 0;
  const updateStmt = db.prepare('UPDATE code_embeddings SET specialty = ? WHERE id = ?');
  for (const r of rows) {
    const specialty = deriveSpecialtyFromCode(r.code, r.code_type);
    updateStmt.run(specialty, r.id);
    updated++;
  }
  return { updated, skipped: 0 };
};

module.exports.getCptCodesByCodes = function getCptCodesByCodes(codes = []) {
  if (!Array.isArray(codes) || codes.length === 0) return [];
  const normalized = codes
    .map(code => String(code || '').trim().toUpperCase())
    .filter(code => code.length > 0);

  if (normalized.length === 0) return [];

  const placeholders = normalized.map(() => '?').join(', ');
  return db.prepare(
    `SELECT code, description, category, subcategory FROM cpt_codes WHERE code IN (${placeholders})`
  ).all(...normalized);
};

// Fee schedule methods (real-time adjudication)
module.exports.getFeeScheduleRate = function getFeeScheduleRate(payerId, cptCode, dateOfService = null) {
  if (!payerId || !cptCode) return null;
  const payer = String(payerId).trim().toUpperCase();
  const cpt = String(cptCode).trim().toUpperCase();
  const date = dateOfService || new Date().toISOString().split('T')[0];

  const row = db.prepare(`
    SELECT id, payer_id, cpt_code, allowed_amount, in_network, source
    FROM fee_schedules
    WHERE payer_id = ? AND cpt_code = ?
      AND (effective_date IS NULL OR effective_date <= ?)
      AND (end_date IS NULL OR end_date >= ?)
    ORDER BY effective_date DESC
    LIMIT 1
  `).get(payer, cpt, date, date);

  return row;
};

module.exports.upsertFeeSchedule = function upsertFeeSchedule(record) {
  const { v4: uuidv4 } = require('uuid');
  const id = record.id || `fs_${uuidv4()}`;
  const payerId = String(record.payer_id || '').trim().toUpperCase();
  const cptCode = String(record.cpt_code || '').trim().toUpperCase();
  const allowedAmount = parseFloat(record.allowed_amount);
  const inNetwork = record.in_network !== false ? 1 : 0;
  const source = record.source || 'manual';

  db.prepare(`
    INSERT INTO fee_schedules (id, payer_id, cpt_code, allowed_amount, in_network, effective_date, end_date, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, payerId, cptCode, allowedAmount, inNetwork, record.effective_date || null, record.end_date || null, source);

  return id;
};

module.exports.bulkUpsertFeeSchedules = function bulkUpsertFeeSchedules(items = []) {
  if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
  const { v4: uuidv4 } = require('uuid');
  let count = 0;
  const stmt = db.prepare(`
    INSERT INTO fee_schedules (id, payer_id, cpt_code, allowed_amount, in_network, effective_date, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  for (const r of items) {
    if (!r.payer_id || !r.cpt_code || r.allowed_amount == null) continue;
    const id = `fs_${uuidv4()}`;
    stmt.run(
      id,
      String(r.payer_id).trim().toUpperCase(),
      String(r.cpt_code).trim().toUpperCase(),
      parseFloat(r.allowed_amount),
      r.in_network !== false ? 1 : 0,
      r.effective_date || null,
      r.source || 'bulk'
    );
    count++;
  }
  return { inserted: count };
};

module.exports.getFeeSchedulesByPayer = function getFeeSchedulesByPayer(payerId, limit = 500) {
  if (!payerId) return [];
  return db.prepare(`
    SELECT * FROM fee_schedules
    WHERE payer_id = ?
    ORDER BY cpt_code
    LIMIT ?
  `).all(String(payerId).trim().toUpperCase(), limit);
};

// ============================================
// SPECIALIST MARKETPLACE (Phase 0)
// ============================================
function _safeParseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

module.exports.createProviderProfile = function createProviderProfile(profile) {
  const { v4: uuidv4 } = require('uuid');
  const id = profile.id || `prov-${uuidv4()}`;
  db.prepare(`
    INSERT INTO provider_profiles (
      id, clinic_id, user_id, display_name, email, phone,
      specialty, languages, license_states, credentials,
      supported_lanes, review_capacity,
      min_rate, price_tier,
      accepts_urgent, accepts_emergency_triage,
      is_active, bio, profile_photo_url,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id,
    profile.clinic_id,
    profile.user_id || null,
    profile.display_name,
    profile.email || null,
    profile.phone || null,
    JSON.stringify(profile.specialty || []),
    JSON.stringify(profile.languages || ['en']),
    JSON.stringify(profile.license_states || []),
    JSON.stringify(profile.credentials || []),
    JSON.stringify(profile.supported_lanes || ['sync']),
    profile.review_capacity || 0,
    profile.min_rate || 0,
    profile.price_tier || 2,
    profile.accepts_urgent ? 1 : 0,
    profile.accepts_emergency_triage ? 1 : 0,
    profile.is_active !== false ? 1 : 0,
    profile.bio || null,
    profile.profile_photo_url || null
  );
  return id;
};

module.exports.getProviderProfile = function getProviderProfile(id) {
  const row = db.prepare(`SELECT * FROM provider_profiles WHERE id = ?`).get(id);
  return row ? {
    ...row,
    specialty: _safeParseJson(row.specialty, []),
    languages: _safeParseJson(row.languages, ['en']),
    license_states: _safeParseJson(row.license_states, []),
    credentials: _safeParseJson(row.credentials, []),
    supported_lanes: _safeParseJson(row.supported_lanes, ['sync'])
  } : null;
};

module.exports.getProviderProfilesByClinic = function getProviderProfilesByClinic(clinicId) {
  try {
    return db.prepare(`SELECT * FROM provider_profiles WHERE clinic_id = ? AND is_active = 1`).all(clinicId)
      .map(r => ({
        ...r,
        specialty: _safeParseJson(r.specialty, []),
        languages: _safeParseJson(r.languages, ['en']),
        license_states: _safeParseJson(r.license_states, []),
        credentials: _safeParseJson(r.credentials, []),
        supported_lanes: _safeParseJson(r.supported_lanes, ['sync'])
      }));
  } catch (_) { return []; }
};

module.exports.updateProviderProfile = function updateProviderProfile(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates).map(v =>
    typeof v === 'object' && v !== null ? JSON.stringify(v) : v
  );
  db.prepare(`UPDATE provider_profiles SET ${fields}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
};

module.exports.createPrescription = function createPrescription(rx) {
  const { v4: uuidv4 } = require('uuid');
  const id = rx.id || `rx-${uuidv4()}`;
  db.prepare(`
    INSERT INTO prescriptions (
      id, case_report_id, appointment_id, patient_id, specialist_id, clinic_id,
      icd_codes, cpt_codes, diagnosis_summary, soap_note,
      medications, instructions, referrals, follow_up_days,
      media_attachment_ids, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id,
    rx.case_report_id || null,
    rx.appointment_id || null,
    rx.patient_id,
    rx.specialist_id,
    rx.clinic_id || null,
    JSON.stringify(rx.icd_codes || []),
    JSON.stringify(rx.cpt_codes || []),
    rx.diagnosis_summary || null,
    rx.soap_note || null,
    JSON.stringify(rx.medications || []),
    rx.instructions || null,
    JSON.stringify(rx.referrals || []),
    rx.follow_up_days || null,
    JSON.stringify(rx.media_attachment_ids || []),
    rx.status || 'draft'
  );
  return id;
};

module.exports.getPrescription = function getPrescription(id) {
  const row = db.prepare(`SELECT * FROM prescriptions WHERE id = ?`).get(id);
  return row ? {
    ...row,
    icd_codes: _safeParseJson(row.icd_codes, []),
    cpt_codes: _safeParseJson(row.cpt_codes, []),
    medications: _safeParseJson(row.medications, []),
    referrals: _safeParseJson(row.referrals, []),
    media_attachment_ids: _safeParseJson(row.media_attachment_ids, [])
  } : null;
};

module.exports.getPrescriptionsByPatient = function getPrescriptionsByPatient(patientId, limit = 50) {
  try {
    return db.prepare(`SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(patientId, limit)
      .map(r => ({
        ...r,
        icd_codes: _safeParseJson(r.icd_codes, []),
        cpt_codes: _safeParseJson(r.cpt_codes, []),
        medications: _safeParseJson(r.medications, []),
        referrals: _safeParseJson(r.referrals, []),
        media_attachment_ids: _safeParseJson(r.media_attachment_ids, [])
      }));
  } catch (_) { return []; }
};

module.exports.updatePrescriptionStatus = function updatePrescriptionStatus(id, status, signedAt = null) {
  db.prepare(`UPDATE prescriptions SET status = ?, signed_at = ?, updated_at = datetime('now') WHERE id = ?`).run(status, signedAt, id);
};

module.exports.createCaseReportMedia = function createCaseReportMedia(media) {
  const { v4: uuidv4 } = require('uuid');
  const id = media.id || `media-${uuidv4()}`;
  db.prepare(`
    INSERT INTO case_report_media (
      id, case_report_id, patient_id, session_id,
      media_type, mime_type, file_name, file_size_bytes,
      storage_provider, storage_key, storage_url,
      context_note, body_region, uploaded_during,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id,
    media.case_report_id || null,
    media.patient_id || null,
    media.session_id || null,
    media.media_type || 'document',
    media.mime_type || null,
    media.file_name || null,
    media.file_size_bytes || null,
    media.storage_provider || 'local',
    media.storage_key || null,
    media.storage_url || null,
    media.context_note || null,
    media.body_region || null,
    media.uploaded_during || 'triage'
  );
  return id;
};

module.exports.getCaseReportMedia = function getCaseReportMedia(caseReportId) {
  try {
    return db.prepare(`SELECT * FROM case_report_media WHERE case_report_id = ? ORDER BY created_at`).all(caseReportId);
  } catch (_) { return []; }
};

/** gap10: Get triage media (session-scoped uploads) for RAG context + provider portal */
module.exports.getTriageMediaForSession = function getTriageMediaForSession(sessionId) {
  try {
    return db.prepare(`
      SELECT id, file_name, context_note, ai_analysis, media_type, mime_type, storage_url
      FROM case_report_media
      WHERE session_id = ? AND (uploaded_during = 'triage' OR uploaded_during IS NULL)
      ORDER BY created_at
    `).all(sessionId || '');
  } catch (_) { return []; }
};

/** gap18: Get persisted preferred_language for Kelly session */
module.exports.getKellySessionLanguage = function getKellySessionLanguage(sessionId) {
  try {
    const row = db.prepare('SELECT preferred_language FROM kelly_session_meta WHERE session_id = ?').get(sessionId || '');
    return row?.preferred_language || null;
  } catch (_) { return null; }
};

/** gap18: Persist detected language for Kelly session */
module.exports.upsertKellySessionLanguage = function upsertKellySessionLanguage(sessionId, preferredLanguage) {
  if (!sessionId || !preferredLanguage) return;
  try {
    db.prepare(`
      INSERT INTO kelly_session_meta (session_id, preferred_language, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        preferred_language = excluded.preferred_language,
        updated_at = datetime('now')
    `).run(sessionId, preferredLanguage);
  } catch (_) {}
};

module.exports.updateMediaAiAnalysis = function updateMediaAiAnalysis(id, aiAnalysis) {
  db.prepare(`UPDATE case_report_media SET ai_analysis = ?, ai_analyzed_at = datetime('now') WHERE id = ?`).run(JSON.stringify(aiAnalysis), id);
};

module.exports.upsertTriageSession = function upsertTriageSession(session) {
  const { v4: uuidv4 } = require('uuid');
  const existing = db.prepare(`SELECT id FROM triage_sessions WHERE session_id = ? LIMIT 1`).get(session.session_id);
  const id = existing?.id || session.id || `triage-${uuidv4()}`;

  const critUnknowns = session.critical_unknowns != null
    ? (Array.isArray(session.critical_unknowns) ? JSON.stringify(session.critical_unknowns) : String(session.critical_unknowns))
    : null;

  db.prepare(`
      INSERT INTO triage_sessions (
        id, session_id, patient_id,
        onset, provocation, quality, radiation, severity, timing, associated_sx,
        family_history, medications, prior_diagnoses, prior_workups, allergies,
        alcohol_use, alcohol_cage_score, smoking_status, phq2_score, gad2_score,
        safety_screen, substance_use, critical_unknowns, soap_note, detected_language,
        occupation,
        rag_result_id, safety_level, urgency, target_specialty,
        media_requested, media_received, media_ids,
        opqrst_complete, triage_complete, referred_to_911,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        onset = COALESCE(excluded.onset, onset),
        provocation = COALESCE(excluded.provocation, provocation),
        quality = COALESCE(excluded.quality, quality),
        radiation = COALESCE(excluded.radiation, radiation),
        severity = COALESCE(excluded.severity, severity),
        timing = COALESCE(excluded.timing, timing),
        associated_sx = COALESCE(excluded.associated_sx, associated_sx),
        family_history = COALESCE(excluded.family_history, family_history),
        medications = COALESCE(excluded.medications, medications),
        prior_diagnoses = COALESCE(excluded.prior_diagnoses, prior_diagnoses),
        prior_workups = COALESCE(excluded.prior_workups, prior_workups),
        allergies = COALESCE(excluded.allergies, allergies),
        alcohol_use = COALESCE(excluded.alcohol_use, alcohol_use),
        alcohol_cage_score = COALESCE(excluded.alcohol_cage_score, alcohol_cage_score),
        smoking_status = COALESCE(excluded.smoking_status, smoking_status),
        phq2_score = COALESCE(excluded.phq2_score, phq2_score),
        gad2_score = COALESCE(excluded.gad2_score, gad2_score),
        safety_screen = COALESCE(excluded.safety_screen, safety_screen),
        substance_use = COALESCE(excluded.substance_use, substance_use),
        critical_unknowns = COALESCE(excluded.critical_unknowns, critical_unknowns),
        soap_note = COALESCE(excluded.soap_note, soap_note),
        detected_language = COALESCE(excluded.detected_language, detected_language),
        occupation = COALESCE(excluded.occupation, occupation),
        rag_result_id = COALESCE(excluded.rag_result_id, rag_result_id),
        safety_level = COALESCE(excluded.safety_level, safety_level),
        urgency = COALESCE(excluded.urgency, urgency),
        target_specialty = COALESCE(excluded.target_specialty, target_specialty),
        media_requested = excluded.media_requested,
        media_received = excluded.media_received,
        media_ids = excluded.media_ids,
        opqrst_complete = excluded.opqrst_complete,
        triage_complete = excluded.triage_complete,
        referred_to_911 = excluded.referred_to_911,
        updated_at = datetime('now')
    `).run(
      id, session.session_id, session.patient_id || null,
      session.onset || null, session.provocation || null,
      session.quality || null, session.radiation || null,
      session.severity ?? null, session.timing || null,
      session.associated_sx || null,
      session.family_history || null, session.medications || null,
      session.prior_diagnoses || null, session.prior_workups || null,
      session.allergies || null,
      session.alcohol_use || null, session.alcohol_cage_score ?? null,
      session.smoking_status || null, session.phq2_score ?? null, session.gad2_score ?? null,
      session.safety_screen || null, session.substance_use || null,
      critUnknowns, session.soap_note || null, session.detected_language || null,
      session.occupation || null,
      session.rag_result_id || null, session.safety_level || null,
      session.urgency || null, session.target_specialty || null,
      session.media_requested ? 1 : 0,
      session.media_received ? 1 : 0,
      JSON.stringify(session.media_ids || []),
      session.opqrst_complete ? 1 : 0,
      session.triage_complete ? 1 : 0,
      session.referred_to_911 ? 1 : 0
    );

  // Persist `intake_complete_at` without touching the main VALUES placeholder list.
  // We keep it idempotent: null means "don't overwrite".
  if (session.intake_complete_at !== undefined) {
    db.prepare(`
      UPDATE triage_sessions
      SET intake_complete_at = COALESCE(?, intake_complete_at)
      WHERE id = ?
    `).run(session.intake_complete_at || null, id);
  }

  // Skin & Care assessment columns (021 / product spec). PATCH only keys present on `session`.
  const skincareCols = [
    'skin_type',
    'skin_concerns_json',
    'pregnancy_status',
    'prior_dermatologist_json',
    'functional_impact',
    'ingredient_reactions',
    'what_has_worked',
    'hormonal_context',
    'lifestyle_notes',
    'environment_notes',
    'triggers_json'
  ];
  const skinPatch = skincareCols.filter((c) => Object.prototype.hasOwnProperty.call(session, c));
  if (skinPatch.length) {
    const setClauses = skinPatch.map((c) => `${c} = COALESCE(?, ${c})`).join(', ');
    const values = skinPatch.map((c) => {
      const v = session[c];
      if (v === undefined) return null;
      if (c === 'functional_impact') {
        if (v === null || v === '') return null;
        const n = parseInt(String(v), 10);
        return Number.isFinite(n) ? n : null;
      }
      if (typeof v === 'string') return v;
      if (v == null) return null;
      return safeStringify(v);
    });
    try {
      db.prepare(`UPDATE triage_sessions SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).run(
        ...values,
        id
      );
    } catch (e) {
      console.warn('[upsertTriageSession] skincare column patch failed:', e.message);
    }
  }

  return id;
};

module.exports.getTriageSession = function getTriageSession(sessionId) {
  const row = db.prepare(`SELECT * FROM triage_sessions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`).get(sessionId);
  if (!row) return null;
  const concernsParsed = _safeParseJson(row.skin_concerns_json, null);
  const triggersParsed = _safeParseJson(row.triggers_json, null);
  const priorParsed = _safeParseJson(row.prior_dermatologist_json, null);
  return {
    ...row,
    media_ids: _safeParseJson(row.media_ids, []),
    critical_unknowns: _safeParseJson(row.critical_unknowns, []),
    skin_concerns_json: Array.isArray(concernsParsed) ? concernsParsed : null,
    triggers_json: Array.isArray(triggersParsed) ? triggersParsed : null,
    prior_dermatologist_json:
      priorParsed && typeof priorParsed === 'object' && !Array.isArray(priorParsed) ? priorParsed : null
  };
};

module.exports.upsertPatientPricing = function upsertPatientPricing(patientId, tier, countryCode = null, currency = 'USD') {
  db.prepare(`
    INSERT INTO patient_pricing (patient_id, price_tier, country_code, currency, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(patient_id) DO UPDATE SET
      price_tier = excluded.price_tier,
      country_code = COALESCE(excluded.country_code, country_code),
      currency = excluded.currency,
      updated_at = datetime('now')
  `).run(patientId, tier, countryCode, currency);
};

module.exports.getPatientPricing = function getPatientPricing(patientId) {
  return db.prepare(`SELECT * FROM patient_pricing WHERE patient_id = ?`).get(patientId)
    || { patient_id: patientId, price_tier: 2, currency: 'USD' };
};

module.exports.createSlotAssignment = function createSlotAssignment(appointmentId, assignment) {
  db.prepare(`
    INSERT INTO appointment_slot_assignments (
      appointment_id, practitioner_id, specialty, language,
      price_tier, lane, matched_via, match_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(appointment_id) DO UPDATE SET
      practitioner_id = excluded.practitioner_id,
      specialty = excluded.specialty,
      language = excluded.language,
      price_tier = excluded.price_tier,
      lane = excluded.lane,
      matched_via = excluded.matched_via,
      match_reason = excluded.match_reason
  `).run(
    appointmentId,
    assignment.practitioner_id,
    assignment.specialty || null,
    assignment.language || 'en',
    assignment.price_tier || 2,
    assignment.lane || 'sync',
    assignment.matched_via || 'hard_filter',
    assignment.match_reason || null
  );
};

module.exports.getSlotAssignment = function getSlotAssignment(appointmentId) {
  return db.prepare(`SELECT * FROM appointment_slot_assignments WHERE appointment_id = ?`).get(appointmentId);
};

module.exports.insertIntakeStreamEvent = function insertIntakeStreamEvent(event) {
  if (!event || !event.event_id) return { success: false, error: 'event_id required' };
  try {
    db.prepare(`
      INSERT OR REPLACE INTO intake_event_stream (
        event_id, trace_id, request_id, source, event_type, session_id, room_id,
        raw_envelope_json, normalized_event_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      event.event_id,
      event.trace_id || null,
      event.request_id || null,
      event.source || 'unknown',
      event.event_type || 'unknown',
      event.session_id || null,
      event.room_id || null,
      JSON.stringify(event.raw_envelope || {}),
      JSON.stringify(event.normalized_event || {})
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

module.exports.getIntakeStreamEvents = function getIntakeStreamEvents({ session_id, room_id, trace_id, limit = 100 } = {}) {
  try {
    const n = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Number(limit))) : 100;
    if (trace_id) {
      return db.prepare(`
        SELECT * FROM intake_event_stream
        WHERE trace_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(trace_id, n);
    }
    if (session_id) {
      return db.prepare(`
        SELECT * FROM intake_event_stream
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(session_id, n);
    }
    if (room_id) {
      return db.prepare(`
        SELECT * FROM intake_event_stream
        WHERE room_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(room_id, n);
    }
    return db.prepare(`
      SELECT * FROM intake_event_stream
      ORDER BY created_at DESC
      LIMIT ?
    `).all(n);
  } catch (_) {
    return [];
  }
};

module.exports.upsertSessionStateProjection = function upsertSessionStateProjection(state) {
  if (!state?.id) return { success: false, error: 'id required' };
  try {
    db.prepare(`
      INSERT INTO session_state_projection (
        id, session_id, room_id, trace_id, source_last, event_type_last, last_event_id,
        chief_complaint, body_sites_json, severity, timeline_text, risk_flags_json, raw_last_text, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        session_id = COALESCE(excluded.session_id, session_state_projection.session_id),
        room_id = COALESCE(excluded.room_id, session_state_projection.room_id),
        trace_id = COALESCE(excluded.trace_id, session_state_projection.trace_id),
        source_last = COALESCE(excluded.source_last, session_state_projection.source_last),
        event_type_last = COALESCE(excluded.event_type_last, session_state_projection.event_type_last),
        last_event_id = COALESCE(excluded.last_event_id, session_state_projection.last_event_id),
        chief_complaint = COALESCE(excluded.chief_complaint, session_state_projection.chief_complaint),
        body_sites_json = COALESCE(excluded.body_sites_json, session_state_projection.body_sites_json),
        severity = COALESCE(excluded.severity, session_state_projection.severity),
        timeline_text = COALESCE(excluded.timeline_text, session_state_projection.timeline_text),
        risk_flags_json = COALESCE(excluded.risk_flags_json, session_state_projection.risk_flags_json),
        raw_last_text = COALESCE(excluded.raw_last_text, session_state_projection.raw_last_text),
        updated_at = datetime('now')
    `).run(
      state.id,
      state.session_id || null,
      state.room_id || null,
      state.trace_id || null,
      state.source_last || null,
      state.event_type_last || null,
      state.last_event_id || null,
      state.chief_complaint || null,
      JSON.stringify(state.body_sites || []),
      state.severity ?? null,
      state.timeline || null,
      JSON.stringify(state.risk_flags || []),
      state.raw_last_text || null
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

module.exports.getSessionStateProjection = function getSessionStateProjection({ session_id = null, room_id = null } = {}) {
  try {
    let row = null;
    if (session_id) {
      row = db.prepare(`
        SELECT * FROM session_state_projection
        WHERE session_id = ?
        ORDER BY datetime(updated_at) DESC
        LIMIT 1
      `).get(session_id);
    } else if (room_id) {
      row = db.prepare(`
        SELECT * FROM session_state_projection
        WHERE room_id = ?
        ORDER BY datetime(updated_at) DESC
        LIMIT 1
      `).get(room_id);
    } else {
      return null;
    }
    if (!row) return null;
    return {
      ...row,
      body_sites: (() => { try { return JSON.parse(row.body_sites_json || '[]'); } catch (_) { return []; } })(),
      risk_flags: (() => { try { return JSON.parse(row.risk_flags_json || '[]'); } catch (_) { return []; } })(),
      timeline: row.timeline_text || null
    };
  } catch (_) {
    return null;
  }
};

module.exports.upsertProductCatalog = function upsertProductCatalog(product) {
  const id = product?.id || `${product?.source || 'obf'}:${product?.source_product_id || require('crypto').randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO products_catalog (
        id, source, source_product_id, brand, product_name, normalized_name, inci_text, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        source = COALESCE(excluded.source, products_catalog.source),
        source_product_id = COALESCE(excluded.source_product_id, products_catalog.source_product_id),
        brand = COALESCE(excluded.brand, products_catalog.brand),
        product_name = COALESCE(excluded.product_name, products_catalog.product_name),
        normalized_name = COALESCE(excluded.normalized_name, products_catalog.normalized_name),
        inci_text = COALESCE(excluded.inci_text, products_catalog.inci_text),
        metadata_json = COALESCE(excluded.metadata_json, products_catalog.metadata_json),
        updated_at = datetime('now')
    `).run(
      id,
      product?.source || 'obf',
      product?.source_product_id || null,
      product?.brand || null,
      product?.product_name || null,
      product?.normalized_name || null,
      product?.inci_text || null,
      JSON.stringify(product?.metadata || {})
    );
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

module.exports.replaceProductIngredients = function replaceProductIngredients(productId, ingredients) {
  try {
    const del = db.prepare(`DELETE FROM product_ingredients WHERE product_id = ?`);
    const ins = db.prepare(`
      INSERT INTO product_ingredients (id, product_id, inci_name, ingredient_order, raw_ingredient, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    const tx = db.transaction((rows) => {
      del.run(productId);
      rows.forEach((ing, idx) => {
        const inci = String(ing?.inci_name || '').trim();
        if (!inci) return;
        ins.run(
          `${productId}:${idx}:${inci.toLowerCase()}`,
          productId,
          inci.toLowerCase(),
          Number.isFinite(Number(ing?.ingredient_order)) ? Number(ing.ingredient_order) : idx,
          ing?.raw_ingredient || null
        );
      });
    });
    tx(Array.isArray(ingredients) ? ingredients : []);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

module.exports.upsertCosingIngredient = function upsertCosingIngredient(row) {
  const inci = String(row?.inci_name || '').trim().toLowerCase();
  if (!inci) return { success: false, error: 'inci_name_required' };
  try {
    db.prepare(`
      INSERT INTO cosing_ingredients (inci_name, cas_number, ec_number, functions_json, restrictions_json, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(inci_name) DO UPDATE SET
        cas_number = COALESCE(excluded.cas_number, cosing_ingredients.cas_number),
        ec_number = COALESCE(excluded.ec_number, cosing_ingredients.ec_number),
        functions_json = COALESCE(excluded.functions_json, cosing_ingredients.functions_json),
        restrictions_json = COALESCE(excluded.restrictions_json, cosing_ingredients.restrictions_json),
        metadata_json = COALESCE(excluded.metadata_json, cosing_ingredients.metadata_json),
        updated_at = datetime('now')
    `).run(
      inci,
      row?.cas_number || null,
      row?.ec_number || null,
      JSON.stringify(row?.functions || []),
      JSON.stringify(row?.restrictions || []),
      JSON.stringify(row?.metadata || {})
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

module.exports.findProductCatalogByName = function findProductCatalogByName(productName, brand = null, limit = 10) {
  try {
    const n = String(productName || '').trim().toLowerCase();
    if (!n) return [];
    const lim = Math.max(1, Math.min(50, Number(limit) || 10));
    if (brand) {
      return db.prepare(`
        SELECT * FROM products_catalog
        WHERE normalized_name LIKE ? AND lower(COALESCE(brand,'')) LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(`%${n}%`, `%${String(brand).toLowerCase()}%`, lim);
    }
    return db.prepare(`
      SELECT * FROM products_catalog
      WHERE normalized_name LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(`%${n}%`, lim);
  } catch (_) {
    return [];
  }
};

module.exports.getProductIngredients = function getProductIngredients(productId) {
  try {
    return db.prepare(`
      SELECT inci_name, ingredient_order, raw_ingredient
      FROM product_ingredients
      WHERE product_id = ?
      ORDER BY ingredient_order ASC
    `).all(productId);
  } catch (_) {
    return [];
  }
};

module.exports.getCosingIngredientByInci = function getCosingIngredientByInci(inciName) {
  try {
    const row = db.prepare(`SELECT * FROM cosing_ingredients WHERE inci_name = ?`).get(String(inciName || '').trim().toLowerCase());
    if (!row) return null;
    return {
      ...row,
      functions: (() => { try { return JSON.parse(row.functions_json || '[]'); } catch (_) { return []; } })(),
      restrictions: (() => { try { return JSON.parse(row.restrictions_json || '[]'); } catch (_) { return []; } })(),
      metadata: (() => { try { return JSON.parse(row.metadata_json || '{}'); } catch (_) { return {}; } })()
    };
  } catch (_) {
    return null;
  }
};

module.exports.getCosmeticRestrictionsByInci = function getCosmeticRestrictionsByInci(inciName) {
  try {
    return db.prepare(`
      SELECT * FROM cosmetic_restrictions
      WHERE inci_name = ?
      ORDER BY annex, created_at DESC
    `).all(String(inciName || '').trim().toLowerCase());
  } catch (_) {
    return [];
  }
};

module.exports.insertCasePattern = function insertCasePattern(row = {}) {
  try {
    const id = row.id || `casepat:${require('crypto').randomUUID()}`;
    db.prepare(`
      INSERT INTO case_patterns (
        id, source, source_ref, chief_complaint, specialty, urgency, safety_level,
        body_sites_json, risk_flags_json, summary_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      row.source || 'unknown',
      row.source_ref || null,
      row.chief_complaint || null,
      row.specialty || null,
      row.urgency || null,
      row.safety_level || null,
      JSON.stringify(Array.isArray(row.body_sites) ? row.body_sites : []),
      JSON.stringify(Array.isArray(row.risk_flags) ? row.risk_flags : []),
      row.summary_text || null
    );
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

module.exports.searchCasePatterns = function searchCasePatterns(filters = {}) {
  try {
    const limit = Math.max(1, Math.min(50, Number(filters.limit) || 10));
    const where = [];
    const args = [];
    if (filters.complaint) { where.push('lower(COALESCE(chief_complaint, \'\')) LIKE ?'); args.push(`%${String(filters.complaint).toLowerCase()}%`); }
    if (filters.specialty) { where.push('lower(COALESCE(specialty, \'\')) = ?'); args.push(String(filters.specialty).toLowerCase()); }
    if (filters.urgency) { where.push('lower(COALESCE(urgency, \'\')) = ?'); args.push(String(filters.urgency).toLowerCase()); }
    if (filters.safety_level) { where.push('lower(COALESCE(safety_level, \'\')) = ?'); args.push(String(filters.safety_level).toLowerCase()); }
    if (filters.body_site) { where.push('lower(COALESCE(body_sites_json, \'[]\')) LIKE ?'); args.push(`%${String(filters.body_site).toLowerCase()}%`); }
    const sql = `
      SELECT * FROM case_patterns
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...args, limit);
    return rows.map((r) => ({
      ...r,
      body_sites: (() => { try { return JSON.parse(r.body_sites_json || '[]'); } catch (_) { return []; } })(),
      risk_flags: (() => { try { return JSON.parse(r.risk_flags_json || '[]'); } catch (_) { return []; } })()
    }));
  } catch (_) {
    return [];
  }
};

module.exports.insertFinalAssessmentArtifact = function insertFinalAssessmentArtifact(row = {}) {
  try {
    const id = row.id || `artifact:${require('crypto').randomUUID()}`;
    db.prepare(`
      INSERT INTO final_assessment_artifacts (
        id, source, session_id, room_id, trace_id, artifact_type, retrieval_key, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      row.source || 'unknown',
      row.session_id || null,
      row.room_id || null,
      row.trace_id || null,
      row.artifact_type || 'unknown',
      row.retrieval_key || null,
      JSON.stringify(row.payload || {})
    );
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

module.exports.getFinalAssessmentArtifacts = function getFinalAssessmentArtifacts({ source = null, session_id = null, room_id = null, artifact_type = null, retrieval_key = null, limit = 50 } = {}) {
  try {
    const where = [];
    const args = [];
    if (source) { where.push('source = ?'); args.push(source); }
    if (session_id) { where.push('session_id = ?'); args.push(session_id); }
    if (room_id) { where.push('room_id = ?'); args.push(room_id); }
    if (artifact_type) { where.push('artifact_type = ?'); args.push(artifact_type); }
    if (retrieval_key) { where.push('retrieval_key = ?'); args.push(retrieval_key); }
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    const sql = `
      SELECT * FROM final_assessment_artifacts
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...args, lim);
    return rows.map((r) => ({
      ...r,
      payload: (() => { try { return JSON.parse(r.payload_json || '{}'); } catch (_) { return {}; } })()
    }));
  } catch (_) {
    return [];
  }
};