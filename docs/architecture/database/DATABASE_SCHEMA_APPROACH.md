# Database Schema Approach for Multi-Tenancy

## Your Question: "Are you suggesting event tenant schema?"

I think you're asking about the database schema strategy. Let me clarify the approach.

---

## Database Schema Options

There are **three main approaches** for multi-tenant databases:

### Option 1: Shared Database, Shared Schema (RECOMMENDED)

**What it means:**
- One database
- One set of tables
- All clinics share the same tables
- Each row has a `clinic_id` column to identify which clinic it belongs to

**Example:**
```sql
-- One table for ALL clinics
CREATE TABLE appointments (
  appointment_id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,  -- This identifies which clinic
  patient_name TEXT,
  date TEXT,
  time TEXT,
  ...
);

-- Clinic A's appointments
INSERT INTO appointments VALUES ('appt-1', 'clinic-001', 'John Doe', '2025-11-12', '10:00', ...);

-- Clinic B's appointments  
INSERT INTO appointments VALUES ('appt-2', 'clinic-002', 'Jane Smith', '2025-11-12', '2:00', ...);
```

**Query Example:**
```sql
-- Get ONLY Clinic A's appointments
SELECT * FROM appointments WHERE clinic_id = 'clinic-001';

-- Get ONLY Clinic B's appointments
SELECT * FROM appointments WHERE clinic_id = 'clinic-002';
```

**Pros:**
- ✅ Simple to implement
- ✅ Easy to maintain
- ✅ Efficient (one database)
- ✅ Easy to add new clinics
- ✅ Can query across clinics (for platform admin)

**Cons:**
- ⚠️ Must always filter by `clinic_id` (but we can enforce this in code)
- ⚠️ One clinic's bad query could affect others (mitigated with proper indexing)

---

### Option 2: Shared Database, Separate Schemas

**What it means:**
- One database
- Each clinic has their own schema (namespace)
- `clinicA.appointments`, `clinicB.appointments`, etc.

**Example:**
```sql
-- Clinic A's schema
CREATE SCHEMA clinicA;
CREATE TABLE clinicA.appointments (...);

-- Clinic B's schema
CREATE SCHEMA clinicB;
CREATE TABLE clinicB.appointments (...);
```

**Pros:**
- ✅ Better isolation
- ✅ Easier to drop a clinic (drop schema)

**Cons:**
- ❌ More complex
- ❌ Harder to query across clinics
- ❌ More database objects to manage
- ❌ SQLite doesn't support schemas well

---

### Option 3: Separate Databases

**What it means:**
- Each clinic has their own database file
- `clinicA.db`, `clinicB.db`, etc.

**Example:**
```javascript
// Clinic A's database
const clinicADb = new Database('clinicA.db');

// Clinic B's database
const clinicBDb = new Database('clinicB.db');
```

**Pros:**
- ✅ Maximum isolation
- ✅ Easy to backup/restore per clinic
- ✅ Can move clinic to different server

**Cons:**
- ❌ Very complex
- ❌ Hard to query across clinics
- ❌ More database connections
- ❌ Harder to maintain

---

## Recommendation: Option 1 (Shared Schema with clinic_id)

### Why This Approach?

1. **You're using SQLite** - SQLite doesn't handle schemas well
2. **Simplicity** - Easiest to implement and maintain
3. **Efficiency** - One database, one connection pool
4. **Scalability** - Can handle thousands of clinics
5. **Flexibility** - Easy to add cross-clinic features later

---

## How It Works

### Database Structure

```
One Database: middleware.db

Tables:
├── clinics (stores clinic info)
├── clinic_phone_numbers (maps phones to clinics)
├── fhir_patients (ALL patients, with clinic_id)
├── appointments (ALL appointments, with clinic_id)
├── insurance_claims (ALL claims, with clinic_id)
└── ... (all tables have clinic_id)
```

### Data Isolation

**Clinic A's data:**
```sql
SELECT * FROM appointments WHERE clinic_id = 'clinic-001';
```

**Clinic B's data:**
```sql
SELECT * FROM appointments WHERE clinic_id = 'clinic-002';
```

**They never mix!**

---

## Implementation Pattern

### All Database Functions Accept clinic_id

**Before (Single Tenant):**
```javascript
function getAppointments() {
  return db.prepare('SELECT * FROM appointments').all();
}
```

**After (Multi-Tenant):**
```javascript
function getAppointments(clinicId) {
  return db.prepare('SELECT * FROM appointments WHERE clinic_id = ?').all(clinicId);
}
```

### Enforce clinic_id in All Queries

**Pattern:**
```javascript
// Always include clinic_id in WHERE clause
const appointments = db.prepare(`
  SELECT * FROM appointments 
  WHERE clinic_id = ? AND status = 'scheduled'
`).all(clinicId);
```

---

## Security: Preventing Cross-Tenant Access

### Middleware to Enforce clinic_id

```javascript
// All API routes get clinic_id from authenticated user
app.get('/api/appointments', authenticateUser, (req, res) => {
  const clinicId = req.user.clinic_id;  // From authenticated session
  
  // Automatically scoped to user's clinic
  const appointments = db.getAppointments(clinicId);
  res.json(appointments);
});
```

### Database Helper Functions

```javascript
// Helper that ALWAYS includes clinic_id
db.getAppointments = function(clinicId) {
  return db.prepare(`
    SELECT * FROM appointments 
    WHERE clinic_id = ? 
    ORDER BY date DESC
  `).all(clinicId);
};

// Can't accidentally query without clinic_id
```

---

## Migration Strategy

### Step 1: Add clinic_id to Existing Data

```sql
-- Add clinic_id column (nullable initially)
ALTER TABLE appointments ADD COLUMN clinic_id TEXT;

-- For existing data, assign to default clinic
UPDATE appointments SET clinic_id = 'default-clinic' WHERE clinic_id IS NULL;

-- Make it required
-- (SQLite doesn't support NOT NULL on existing columns easily, 
--  so we'll enforce in application code)
```

### Step 2: Update All Queries

```javascript
// Old query
db.prepare('SELECT * FROM appointments').all();

// New query (always includes clinic_id)
db.prepare('SELECT * FROM appointments WHERE clinic_id = ?').all(clinicId);
```

### Step 3: Create New Tables with clinic_id

```sql
CREATE TABLE clinics (
  clinic_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ...
);

CREATE TABLE clinic_phone_numbers (
  phone_number TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  ...
);
```

---

## Example: Complete Multi-Tenant Query

### Scenario: Get Patient's Appointments

**Single Tenant (Current):**
```javascript
function getPatientAppointments(patientId) {
  return db.prepare(`
    SELECT * FROM appointments 
    WHERE patient_id = ?
  `).all(patientId);
}
```

**Multi-Tenant (New):**
```javascript
function getPatientAppointments(patientId, clinicId) {
  return db.prepare(`
    SELECT * FROM appointments 
    WHERE patient_id = ? 
      AND clinic_id = ?  -- Ensures we only get this clinic's appointments
  `).all(patientId, clinicId);
}
```

**Why both?**
- `patient_id` - Gets the patient's appointments
- `clinic_id` - Ensures they're from the correct clinic
- Prevents Clinic A from seeing Clinic B's patient data

---

## Summary

### What I'm Suggesting

**Shared Database + Shared Schema + clinic_id Column**

- ✅ One database (`middleware.db`)
- ✅ One set of tables
- ✅ `clinic_id` column in every table
- ✅ All queries filter by `clinic_id`
- ✅ Complete data isolation through filtering

### NOT Suggesting

- ❌ Separate databases per clinic
- ❌ Separate schemas per clinic
- ❌ Any approach that requires multiple database files

### Why This Works

1. **Simple** - Easy to understand and maintain
2. **Efficient** - One database connection
3. **Secure** - Data isolation through `clinic_id` filtering
4. **Scalable** - Can handle thousands of clinics
5. **SQLite-friendly** - Works perfectly with SQLite

---

## Visual Example

```
Database: middleware.db
┌─────────────────────────────────────────────────┐
│ appointments table                              │
├─────────────┬──────────────┬────────────────────┤
│ appt_id     │ clinic_id    │ patient_name       │
├─────────────┼──────────────┼────────────────────┤
│ appt-1      │ clinic-001   │ John Doe           │ ← Clinic A
│ appt-2      │ clinic-001   │ Jane Smith        │ ← Clinic A
│ appt-3      │ clinic-002   │ Bob Jones         │ ← Clinic B
│ appt-4      │ clinic-002   │ Alice Brown       │ ← Clinic B
└─────────────┴──────────────┴────────────────────┘

Query: SELECT * FROM appointments WHERE clinic_id = 'clinic-001'
Result: Only appt-1 and appt-2 (Clinic A's data)

Query: SELECT * FROM appointments WHERE clinic_id = 'clinic-002'  
Result: Only appt-3 and appt-4 (Clinic B's data)
```

**They're in the same table, but completely isolated by clinic_id!**

