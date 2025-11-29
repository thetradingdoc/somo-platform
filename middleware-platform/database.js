const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { hashApiKey } = require('./utils/api-keys');

const usePostgres = !!process.env.POSTGRES_URL;
let pgPool = null;
let pgSql = null;
let sqliteDb = null;
let activeAdapter = null;

function normalizePhoneNumber(phone) {
  if (!phone) return phone;

  const digitsOnly = phone.replace(/\D/g, '');

  if (digitsOnly.length === 10) {
    return '+1' + digitsOnly;
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return '+' + digitsOnly;
  }

  if (phone.startsWith('+')) {
    return phone;
  }

  return '+1' + digitsOnly;
}

// Use Azure's writable directory (/home) if available, otherwise use current directory
// Azure App Service uses /home for writable files
const defaultDbDir = process.env.HOME || '/home' || __dirname;

// Environment-based database naming to separate production and test/dev data
// Production: middleware-prod.db
// Development: middleware-dev.db
// Test: middleware-test.db (if NODE_ENV=test)
const env = process.env.NODE_ENV || 'development';
let dbFileName = 'middleware.db'; // Default fallback

if (env === 'production' || env === 'prod') {
  dbFileName = 'middleware-prod.db';
} else if (env === 'test') {
  dbFileName = 'middleware-test.db';
} else {
  dbFileName = 'middleware-dev.db';
}

// Allow override via DB_NAME environment variable
if (process.env.DB_NAME) {
  dbFileName = process.env.DB_NAME;
}

const dbPath = path.join(defaultDbDir, dbFileName);
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

function syncClinicToPostgres(clinic) {
  if (!pgPool || !clinic) return;
  pgPool`
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
  `.catch(err => console.error('❌ Postgres sync [clinics] failed:', err.message));
}

function syncClinicPhoneToPostgres(phoneRow) {
  if (!pgPool || !phoneRow) return;
  pgPool`
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
  `.catch(err => console.error('❌ Postgres sync [clinic_phone_numbers] failed:', err.message));
}

function syncAppointmentToPostgres(appointment) {
  if (!pgPool || !appointment) return;
  pgPool`
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
  `.catch(err => console.error('❌ Postgres sync [appointments] failed:', err.message));
}

function deleteAppointmentFromPostgres(appointmentId) {
  if (!pgPool || !appointmentId) return;
  pgPool`
    DELETE FROM appointments WHERE id = ${appointmentId};
  `.catch(err => console.error('❌ Postgres sync [appointments-delete] failed:', err.message));
}

function syncVoiceCheckoutToPostgres(checkout) {
  if (!pgPool || !checkout) return;
  pgPool`
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
  `.catch(err => console.error('❌ Postgres sync [voice_checkouts] failed:', err.message));
}

function syncVoiceCallToPostgres(call) {
  if (!pgPool || !call) return;
  pgPool`
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
  `.catch(err => console.error('❌ Postgres sync [voice_call_log] failed:', err.message));
}

function syncFunctionCallToPostgres(funcLog) {
  if (!pgPool || !funcLog) return;
  pgPool`
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
  `.catch(err => console.error('❌ Postgres sync [function_call_log] failed:', err.message));
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
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id),
    FOREIGN KEY (fhir_patient_id) REFERENCES fhir_patients(resource_id),
    FOREIGN KEY (fhir_encounter_id) REFERENCES fhir_encounters(resource_id)
  );

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
  console.warn('⚠️  Migration check failed:', migrationError.message);
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

// Migration: Add eligibility detail columns if they don't exist
try {
  const eligExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='eligibility_checks'`).get();
  if (eligExists) {
    const info = db.prepare(`PRAGMA table_info(eligibility_checks)`).all();
    const needDeductTotal = !info.some(c => c.name === 'deductible_total');
    const needDeductRemain = !info.some(c => c.name === 'deductible_remaining');
    const needCoins = !info.some(c => c.name === 'coinsurance_percent');
    const needPlan = !info.some(c => c.name === 'plan_summary');
    if (needDeductTotal) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN deductible_total REAL;`);
    if (needDeductRemain) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN deductible_remaining REAL;`);
    if (needCoins) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN coinsurance_percent REAL;`);
    if (needPlan) db.exec(`ALTER TABLE eligibility_checks ADD COLUMN plan_summary TEXT;`);
  }
} catch (migrationError) {
  console.warn('⚠️  Eligibility checks migration failed:', migrationError.message);
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
    notes TEXT,
    reminder_sent BOOLEAN DEFAULT 0,
    calendar_event_id TEXT,
    calendar_link TEXT,
    cancellation_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
  );

  CREATE INDEX IF NOT EXISTS idx_portal_sessions_phone ON patient_portal_sessions(phone);
  CREATE INDEX IF NOT EXISTS idx_portal_sessions_verified ON patient_portal_sessions(verified);
  -- Note: email index will be created in migration if column is added

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
    last_replenished_at DATETIME,
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
    priority INTEGER DEFAULT 5,
    lead_score INTEGER DEFAULT 0,
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
      prompt_updated_at: 'DATETIME'
    };

    Object.keys(newColumns).forEach(colName => {
      if (!columnNames.includes(colName)) {
        console.log(`📦 Adding ${colName} column to customers table...`);
        db.prepare(`ALTER TABLE customers ADD COLUMN ${colName} ${newColumns[colName]}`).run();
      }
    });

    db.pragma('foreign_keys = ON');
    console.log('✅ Migration complete: customers table updated');
  } catch (migrationError) {
    console.warn('⚠️  Customers table migration failed:', migrationError.message);
    db.pragma('foreign_keys = ON');
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

// Run migrations on startup
migrateInsuranceClaimsTable();
migratePatientPortalSessionsEmail();
migrateMonthlyInvoicesJobCalls();
migrateLeadsPipeline();
migrateCustomersTable();
migrateVoiceCallLogCosts();
migrateAppointmentsCustomerId();

/**
 * Helper to safely stringify data
 */
function safeStringify(data) {
  if (data === null || data === undefined) return null;
  if (typeof data === 'string') return data;
  return JSON.stringify(data);
}


module.exports = {
  // Expose the database instance for direct access when needed
  db: db,

  // ============================================
  // MERCHANTS
  // ============================================
  createMerchant: (merchant) => {
    return db.prepare(`
      INSERT INTO merchants (id, name, api_key, api_url, webhook_url, enabled_platforms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      merchant.id,
      merchant.name,
      merchant.api_key,
      merchant.api_url,
      merchant.webhook_url || null,
      JSON.stringify(merchant.enabled_platforms || ['acp', 'ap2'])
    );
  },

  getMerchant: (id) => db.prepare('SELECT * FROM merchants WHERE id = ?').get(id),

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
    const fields = Object.keys(updates).map(key =>
      key === 'audit_trail' ? `${key} = ?` : `${key} = ?`
    ).join(', ');
    const values = Object.values(updates).map(v =>
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
      // Postgres path
      await pgPool`
        INSERT INTO voice_checkouts 
        (id, clinic_id, merchant_id, product_id, product_name, quantity, amount, 
         customer_phone, customer_name, customer_email, appointment_id, payment_method, status, created_at)
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
          ${checkout.created_at || new Date().toISOString()}
        )
      `;
      return { changes: 1, lastInsertRowid: checkout.id };
    } else {
      // SQLite path
      const result = db.prepare(`
        INSERT INTO voice_checkouts 
        (id, clinic_id, merchant_id, product_id, product_name, quantity, amount, 
         customer_phone, customer_name, customer_email, appointment_id, payment_method, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        checkout.status || 'pending'
      );
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
      // Postgres path - build dynamic update using sql helper
      const setParts = [];
      const values = [];
      let paramIndex = 1;

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
      if (updates.status === 'completed') {
        setParts.push('completed_at = NOW()');
      }

      if (setParts.length === 0) return { changes: 0 };

      values.push(id);
      // Build query with proper parameterized values for postgres
      const query = `UPDATE voice_checkouts SET ${setParts.join(', ')} WHERE id = $${paramIndex}`;
      // Use postgres library's unsafe method for dynamic queries
      const result = await pgPool.unsafe(query, values);
      return { changes: result.count || 0 };
    } else {
      // SQLite path
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

    if (fields.length === 0) return;

    values.push(token);
    const query = `UPDATE payment_tokens SET ${fields.join(', ')} WHERE token = ?`;
    return db.prepare(query).run(...values);
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

    const stmt = db.prepare(`
      INSERT INTO fhir_patients (
        resource_id, resource_data, phone, email, name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    try {
      return stmt.run(
        patientResource.id,
        JSON.stringify(patientResource),
        phone,
        email,
        name
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

  // Search FHIR Patients
  searchFHIRPatients(params = {}) {
    let query = 'SELECT * FROM fhir_patients WHERE is_deleted = 0';
    const queryParams = [];

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

  // Create FHIR Audit Log
  createFHIRAuditLog(action, resourceType, resourceId, userId, ipAddress, userAgent) {
    const stmt = db.prepare(`
      INSERT INTO fhir_audit_log (
        action, resource_type, resource_id, user_id, ip_address, user_agent, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    return stmt.run(action, resourceType, resourceId, userId, ipAddress, userAgent);
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
    const stmt = db.prepare(`
      SELECT cpn.*, c.name as clinic_name, c.slug as clinic_slug
      FROM clinic_phone_numbers cpn
      JOIN clinics c ON cpn.clinic_id = c.clinic_id
      WHERE cpn.phone_number = ? AND c.is_active = 1
    `);
    return stmt.get(phoneNumber);
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
      // Postgres path
      await pgPool`
        INSERT INTO appointments (
          id, clinic_id, customer_id, patient_name, patient_phone, patient_email, patient_id,
          appointment_type, date, time, start_time, end_time,
          duration_minutes, provider, status, notes,
          calendar_event_id, calendar_link, created_at
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
          ${appointment.created_at || new Date().toISOString()}
        )
      `;
      return { changes: 1, lastInsertRowid: appointment.id };
    } else {
      // SQLite path
      const stmt = db.prepare(`
        INSERT INTO appointments (
          id, clinic_id, customer_id, patient_name, patient_phone, patient_email, patient_id,
          appointment_type, date, time, start_time, end_time,
          duration_minutes, provider, status, notes,
          calendar_event_id, calendar_link, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        appointment.id,
        appointment.clinic_id || null,
        appointment.customer_id || null,
        appointment.patient_name,
        appointment.patient_phone,
        appointment.patient_email,
        appointment.patient_id || null,
        appointment.appointment_type,
        appointment.date,
        appointment.time,
        appointment.start_time,
        appointment.end_time,
        appointment.duration_minutes,
        appointment.provider,
        appointment.status,
        notes,
        appointment.calendar_event_id,
        appointment.calendar_link,
        appointment.created_at
      );
    }
  },

  // Get appointment by ID
  // Get appointment by ID (supports both clinicId and customerId for tenant isolation)
  async getAppointment(id, clinicId = null, customerId = null) {
    if (usePostgres && pgPool) {
      // Postgres path
      let query;
      if (customerId) {
        query = pgPool`SELECT * FROM appointments WHERE id = ${id} AND customer_id = ${customerId}`;
      } else if (clinicId) {
        query = pgPool`SELECT * FROM appointments WHERE id = ${id} AND clinic_id = ${clinicId}`;
      } else {
        query = pgPool`SELECT * FROM appointments WHERE id = ${id}`;
      }
      const results = await query;
      return results[0] || null;
    } else {
      // SQLite path
      let query = 'SELECT * FROM appointments WHERE (id = ? OR id LIKE ?)';
      const params = [id, `%${id}%`];

      if (customerId) {
        query += ' AND customer_id = ?';
        params.push(customerId);
      } else if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }

      const stmt = db.prepare(query);
      return stmt.get(...params);
    }
  },

  // Get appointments by date
  async getAppointmentsByDate(date, clinicId = null) {
    if (usePostgres && pgPool) {
      // Postgres path
      let query;
      if (clinicId) {
        query = pgPool`SELECT * FROM appointments WHERE date = ${date} AND clinic_id = ${clinicId} ORDER BY time ASC`;
      } else {
        query = pgPool`SELECT * FROM appointments WHERE date = ${date} ORDER BY time ASC`;
      }
      return await query;
    } else {
      // SQLite path
      let query = 'SELECT * FROM appointments WHERE date = ?';
      const params = [date];

      if (clinicId) {
        query += ' AND clinic_id = ?';
        params.push(clinicId);
      }

      query += ' ORDER BY time ASC';

      const stmt = db.prepare(query);
      return stmt.all(...params);
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
          ORDER BY date DESC, time DESC
        `;
      } else if (clinicId) {
        query = pgPool`
          SELECT * FROM appointments
          WHERE (patient_phone LIKE ${searchPattern} OR patient_email LIKE ${searchPattern})
            AND clinic_id = ${clinicId}
          ORDER BY date DESC, time DESC
        `;
      } else {
        query = pgPool`
          SELECT * FROM appointments
          WHERE (patient_phone LIKE ${searchPattern} OR patient_email LIKE ${searchPattern})
          ORDER BY date DESC, time DESC
        `;
      }
      return await query;
    } else {
      // SQLite path
      let query = `
        SELECT * FROM appointments
        WHERE (patient_phone LIKE ? OR patient_email LIKE ?)
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
      return stmt.all(...params);
    }
  },

  // Get all appointments (with optional filters)
  getAllAppointments(filters = {}) {
    let query = 'SELECT * FROM appointments WHERE 1=1';
    const params = [];

    // Tenant isolation: Filter by customer_id if provided
    if (filters.customer_id) {
      query += ' AND customer_id = ?';
      params.push(filters.customer_id);
    }

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.date) {
      query += ' AND date = ?';
      params.push(filters.date);
    }

    if (filters.provider) {
      query += ' AND provider = ?';
      params.push(filters.provider);
    }

    if (filters.clinic_id) {
      query += ' AND clinic_id = ?';
      params.push(filters.clinic_id);
    }

    query += ' ORDER BY date DESC, time DESC';

    const stmt = db.prepare(query);
    return stmt.all(...params);
  },

  // Update appointment status (supports both clinicId and customerId for tenant isolation)
  updateAppointmentStatus(id, status, reason = null, clinicId = null, customerId = null) {
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

  // Update appointment reminder sent flag
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
        coinsurance_percent, plan_summary, response_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      const stmt = db.prepare(`
        INSERT INTO insurance_claims (
          id, appointment_id, patient_id, member_id, payer_id,
          service_code, diagnosis_code, total_amount, copay_amount,
          insurance_amount, status, x12_claim_id, blockchain_proof,
          submitted_at, response_data, circle_transfer_id, payment_status, payment_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
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
        claim.payment_amount || null
      );
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

  // ============================================
  // CIRCLE PAYMENT METHODS
  // ============================================

  // Create Circle account
  createCircleAccount(account) {
    const stmt = db.prepare(`
      INSERT INTO circle_accounts (
        id, entity_type, entity_id, circle_wallet_id, circle_account_id,
        currency, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      account.id,
      account.entity_type,
      account.entity_id,
      account.circle_wallet_id,
      account.circle_account_id || null,
      account.currency || 'USDC',
      account.status || 'active',
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

  // Get Circle transfers by claim ID
  getCircleTransfersByClaim(claimId) {
    const stmt = db.prepare(`
      SELECT * FROM circle_transfers
      WHERE claim_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(claimId);
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
    if (updates.insurance_amount !== undefined) {
      fields.push('insurance_amount = ?');
      values.push(updates.insurance_amount);
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

    return db.prepare(`
      INSERT INTO customers (
        id, name, email, phone_number, company_name, business_size, 
        use_case, api_features, plan_tier, status, email_verified, email_verified_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      customer.email_verified_at || null
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

  getCustomerByTwilioNumber(phoneNumber) {
    if (!phoneNumber) return null;
    const normalized = normalizePhoneNumber(phoneNumber);
    return db.prepare('SELECT * FROM customers WHERE twilio_phone_number = ?').get(normalized);
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
  createCustomerSession(customerId, ipAddress, userAgent) {
    const sessionId = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    db.prepare(`
      INSERT INTO customer_sessions (id, customer_id, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, customerId, expiresAt, ipAddress || null, userAgent || null);
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

    if (existing) {
      // Update existing record
      return db.prepare(`
        UPDATE customer_credits 
        SET free_credits_allocated = free_credits_allocated + ?,
            credits_balance_minutes = credits_balance_minutes + ?,
            last_replenished_at = datetime('now'),
            updated_at = datetime('now')
        WHERE customer_id = ?
      `).run(freeMinutes, freeMinutes, customerId);
    } else {
      // Create new credits record
      const { v4: uuidv4 } = require('uuid');
      return db.prepare(`
        INSERT INTO customer_credits (
          id, customer_id, credits_balance_minutes, free_credits_allocated, last_replenished_at
        ) VALUES (?, ?, ?, ?, datetime('now'))
      `).run(uuidv4(), customerId, freeMinutes, freeMinutes);
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

    // Check if customer has payment method stored
    const customer = db.prepare('SELECT card_verified, stripe_payment_method_id FROM customers WHERE id = ?').get(customerId);
    const hasPaymentMethod = customer && customer.card_verified === 1 && customer.stripe_payment_method_id;

    // Calculate available free credits
    const availableFreeCredits = credits.free_credits_allocated - credits.free_credits_used;

    // If trying to use more than free credits and no payment method, block
    if (minutesToDeduct > availableFreeCredits && !hasPaymentMethod) {
      throw new Error('Insufficient credits. Please add a payment method to continue using the service.');
    }

    if (credits.credits_balance_minutes < minutesToDeduct && !hasPaymentMethod) {
      throw new Error('Insufficient credits. Please add a payment method to continue using the service.');
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