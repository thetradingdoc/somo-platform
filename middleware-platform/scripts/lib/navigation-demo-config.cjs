'use strict';

const METRO_ENTITY_ID = 'ent_metro_health_plus';
const METRO_PAYER_ID = 'METRO-HEALTH-PLUS';

const METRO_ALIASES = [
  { id: 'alias_mhp_metro_health_plus', alias: 'Metro Health Plus', normalized: 'metro health plus' },
  { id: 'alias_mhp_hmo', alias: 'Metro Health Plus HMO', normalized: 'metro health plus hmo' },
  { id: 'alias_mhp_metro_plus', alias: 'Metro Plus', normalized: 'metro plus' },
  { id: 'alias_mhp_mhp', alias: 'MHP', normalized: 'mhp' },
];

const PROVIDERS = [
  {
    email: 'dental.nav@doclittle.example',
    specialty: 'Dental',
    name: 'Dr. Alex Rivera',
    phone: '212-555-0140',
    hours: 'Mon–Fri 9am–6pm',
    zip: '10001',
    match_reason: 'general dentistry near you'
  },
  {
    email: 'ortho.nav@doclittle.example',
    specialty: 'Orthodontics',
    name: 'Dr. Elena Rivera',
    phone: '212-555-0142',
    hours: 'Mon–Thu 8am–5pm',
    zip: '10002',
    match_reason: 'orthodontist for braces'
  },
  {
    email: 'optometry.nav@doclittle.example',
    specialty: 'Optometry',
    name: 'Dr. Priya Nair',
    phone: '212-555-0150',
    hours: 'Tue–Sat 10am–7pm',
    zip: '10003',
    match_reason: 'in-network eye care'
  },
  {
    email: 'psychiatry.nav@doclittle.example',
    specialty: 'Psychiatry',
    name: 'Dr. Marcus Webb',
    phone: '212-555-0160',
    hours: 'Mon–Fri 8am–4pm',
    zip: '10001',
    match_reason: 'mental health specialist'
  },
  {
    email: 'primary.nav@doclittle.example',
    specialty: 'PrimaryCare',
    name: 'Dr. Sofia Reyes',
    phone: '212-555-0170',
    hours: 'Mon–Sat 8am–8pm',
    zip: '10002',
    match_reason: 'primary care near you'
  },
];

const EXPECTED_SPECIALTIES = ['Dental', 'Orthodontics', 'Optometry', 'Psychiatry', 'PrimaryCare'];

function resolveNavCustomerId() {
  return process.env.NAVIGATION_CUSTOMER_ID || 'cust-navigation-demo';
}

function resolveNavDid() {
  return (
    process.env.NAVIGATION_DID ||
    process.env.TWILIO_PHONE_NUMBER ||
    process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER ||
    '+13639990205'
  );
}

function resolveNavClinicId(db) {
  const fromEnv = process.env.NAVIGATION_CLINIC_ID;
  if (fromEnv) return fromEnv;
  const customerId = resolveNavCustomerId();
  const customer = db.getCustomer?.(customerId);
  if (!customer?.merchant_id) return null;
  const row = db.db
    .prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? ORDER BY created_at ASC LIMIT 1')
    .get(customer.merchant_id);
  return row?.clinic_id || null;
}

module.exports = {
  METRO_ENTITY_ID,
  METRO_PAYER_ID,
  METRO_ALIASES,
  PROVIDERS,
  EXPECTED_SPECIALTIES,
  resolveNavCustomerId,
  resolveNavDid,
  resolveNavClinicId,
};
