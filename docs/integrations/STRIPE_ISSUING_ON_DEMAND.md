# Stripe Issuing - On-Demand Card Creation

## Overview

Stripe Issuing cards are now created **on-demand** only for **insured patients** when they have bills or copays to pay. Cards are **NOT** automatically created at patient signup.

## Changes Made

### ✅ Removed Auto-Creation
- **Before:** Cards were automatically created for every patient at signup
- **After:** Cards are only created when needed (bills/copays)

### ✅ Insurance Check
- Cards are only created for patients who have insurance
- Uninsured patients don't get cards

### ✅ On-Demand Creation
- Cards created when bills are generated
- Cards created when copays are due
- Cards created when claims are submitted

## When Cards Are Created

### 1. **When Insurance Claim is Submitted**
- **Location:** `insurance-service.js` → `submitClaim()`
- **Trigger:** Claim submitted with patient responsibility amount
- **Logic:**
  - If patient owes money after insurance → Create card for bill amount
  - If copay is due → Create card for copay amount
  - Only if patient has insurance

### 2. **When Appointment Checkout is Created**
- **Location:** `server.js` → `/voice/appointments/checkout`
- **Trigger:** Appointment checkout with copay/patient responsibility
- **Logic:**
  - If copay amount matches eligibility → Create card for copay
  - If patient responsibility amount → Create card for bill
  - Only if patient has insurance

### 3. **Manual Creation (API)**
- **Endpoint:** `POST /api/patient/:patientId/cards`
- **Trigger:** Patient or admin requests card
- **Logic:**
  - Checks if patient has insurance
  - Creates card with specified limit

## Card Creation Logic

### Insurance Check
```javascript
// Only create cards for insured patients
if (!patientHasInsurance(patientId)) {
  return { error: 'Patient does not have insurance' };
}
```

### Bill-Specific Cards
```javascript
// Card limit = bill amount + 10% buffer
const spendingLimit = Math.ceil(billAmount * 110); // In cents
```

### Copay-Specific Cards
```javascript
// Card limit = copay amount + 10% buffer
const spendingLimit = Math.ceil(copayAmount * 110); // In cents
```

## Code Changes

### `fhir-service.js`
- ✅ Removed auto-creation at patient signup
- ✅ Added `patientHasInsurance()` helper
- ✅ Added `createCardForBill()` method
- ✅ Added `createCardForCopay()` method
- ✅ Updated `createPatientCard()` to check insurance

### `insurance-service.js`
- ✅ Added card creation when claim is submitted
- ✅ Creates card for patient responsibility amount
- ✅ Creates card for copay if applicable

### `server.js`
- ✅ Added card creation in appointment checkout
- ✅ Creates card for copay/patient responsibility

## Flow Examples

### Example 1: Patient Books Appointment with Insurance
1. Patient books appointment → No card created yet
2. Appointment scheduled → No card created yet
3. Claim submitted → Patient owes $50 copay
4. **Card created** → Limit: $55 (copay + 10% buffer)
5. Patient pays copay using card

### Example 2: Patient Books Appointment without Insurance
1. Patient books appointment → No card created
2. Appointment scheduled → No card created
3. Claim submitted → No insurance, no card created
4. Patient pays via other method (payment link, etc.)

### Example 3: Patient Has Bill After Claim Processing
1. Claim processed → Insurance pays $100, patient owes $50
2. **Card created** → Limit: $55 (bill + 10% buffer)
3. Patient pays bill using card

## Benefits

1. **Lower Risk:** No unused cards sitting around
2. **Lower Cost:** Only create cards when needed
3. **Better Tracking:** Cards tied to specific bills/copays
4. **Insurance-Only:** Cards only for insured patients
5. **On-Demand:** Cards created when payment is needed

## API Methods

### Check if Patient Has Insurance
```javascript
FHIRService.patientHasInsurance(patientId)
// Returns: boolean
```

### Create Card for Bill
```javascript
FHIRService.createCardForBill(patientId, billAmount, {
  claim_id: 'claim-123',
  appointment_id: 'appt-456'
})
```

### Create Card for Copay
```javascript
FHIRService.createCardForCopay(patientId, copayAmount, {
  appointment_id: 'appt-456'
})
```

## Summary

- ✅ **No auto-creation** at patient signup
- ✅ **Insurance check** before card creation
- ✅ **On-demand creation** when bills/copays are due
- ✅ **Bill-specific limits** (amount + 10% buffer)
- ✅ **Better for medical billing assistant** use case




