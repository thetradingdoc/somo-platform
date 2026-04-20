# api — consolidated documentation

**Single file:** All former `docs/api/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [API Documentation (`API_DOCUMENTATION.md`)](#api-documentation)
- [Invoice API Documentation (`INVOICE_API.md`)](#invoice-api)
- [API Documentation (`README.md`)](#readme)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="api-documentation"></a>

## API Documentation

*Former path: `docs/api/API_DOCUMENTATION.md`*

## OpenAPI Specification

**Full API specification**: See `middleware-platform/openapi.yaml` for complete OpenAPI 3.0 specification.

You can view the interactive API documentation using:
- [Swagger UI](https://editor.swagger.io/) - Upload `openapi.yaml`
- [Redoc](https://redocly.com/) - Upload `openapi.yaml`
- Or use any OpenAPI-compatible tool

## Base URL

**Production**: Configure per deployment (Azure App Service or Railway)  
**Local**: `http://localhost:4000`

---

## Authentication

Most endpoints require API key authentication (optional for public endpoints):

```bash
# Header
X-API-Key: your_api_key_here

# OR Authorization header
Authorization: Bearer your_api_key_here

# OR Query parameter
?api_key=your_api_key_here
```

---

## Rate Limits

- **General API**: 100 requests per 15 minutes per IP
- **Authentication**: 5 attempts per 15 minutes per IP
- **Payment**: 10 requests per hour per IP
- **Voice**: 20 requests per minute per IP

---

## Voice Agent Endpoints

### Appointment Booking

#### Schedule Appointment
```http
POST /voice/appointments/schedule
Content-Type: application/json

{
  "patient_name": "John Doe",
  "patient_phone": "+1234567890",
  "patient_email": "john@example.com",
  "date": "2024-12-15",
  "time": "14:00",
  "appointment_type": "Mental Health Consultation"
}
```

**Response**:
```json
{
  "success": true,
  "appointment": {
    "id": "appt-xxx",
    "patient_name": "John Doe",
    "date": "2024-12-15",
    "time": "14:00",
    "status": "scheduled"
  }
}
```

#### Get Available Slots
```http
POST /voice/appointments/available-slots
Content-Type: application/json

{
  "date": "2024-12-15"
}
```

#### Confirm Appointment
```http
POST /voice/appointments/confirm
Content-Type: application/json

{
  "appointment_id": "appt-xxx"
}
```

#### Cancel Appointment
```http
POST /voice/appointments/cancel
Content-Type: application/json

{
  "appointment_id": "appt-xxx",
  "reason": "Patient requested"
}
```

#### Reschedule Appointment
```http
POST /voice/appointments/reschedule
Content-Type: application/json

{
  "appointment_id": "appt-xxx",
  "new_date": "2024-12-16",
  "new_time": "15:00"
}
```

---

### Insurance Endpoints

#### Collect Insurance Information
```http
POST /voice/insurance/collect
Content-Type: application/json

{
  "patient_name": "John Doe",
  "member_id": "CIGNA901234",
  "payer_name": "Cigna"
}
```

#### Check Eligibility
```http
POST /voice/insurance/check-eligibility
Content-Type: application/json

{
  "patient_id": "patient-xxx",
  "service_code": "90837",
  "date_of_service": "2024-12-15"
}
```

#### Submit Claim
```http
POST /voice/insurance/submit-claim
Content-Type: application/json

{
  "appointment_id": "appt-xxx",
  "patient_id": "patient-xxx",
  "service_code": "90837",
  "diagnosis_code": "F41.1"
}
```

---

### Payment Endpoints

#### Create Checkout
```http
POST /voice/appointments/checkout
Content-Type: application/json

{
  "appointment_id": "appt-xxx",
  "patient_phone": "+1234567890",
  "patient_email": "john@example.com"
}
```

**Response**:
```json
{
  "success": true,
  "checkout_id": "checkout-xxx",
  "amount": 39.99,
  "payment_token": "token-xxx",
  "requires_verification": true,
  "email_sent": true
}
```

#### Verify Email Code
```http
POST /voice/checkout/verify
Content-Type: application/json

{
  "payment_token": "token-xxx",
  "verification_code": "123456"
}
```

**Response**:
```json
{
  "success": true,
  "payment_link": "https://.../payment/token-xxx",
  "payment_link_sent": true
}
```

---

## Admin Endpoints

### Appointments

#### Get All Appointments
```http
GET /api/admin/appointments
```

#### Get Upcoming Appointments
```http
GET /api/admin/appointments/upcoming
```

---

### Insurance & Billing

#### Get Insurance Claims
```http
GET /api/admin/insurance/claims?status=approved
```

#### Get Payers
```http
GET /api/admin/insurance/payers?search=Cigna
```

#### Sync Payers from Stedi
```http
POST /api/admin/insurance/sync-payers
```

#### Get Patient Insurance
```http
GET /api/admin/patients/:patientId/insurance
```

#### Get Eligibility Checks
```http
GET /api/admin/patients/:patientId/eligibility
```

### API Key Management

#### List Client API Keys
```http
GET /api/admin/clients/:clinicId/api-keys
```

#### Create / Rotate Client API Key
```http
POST /api/admin/clients/:clinicId/api-keys
Content-Type: application/json

{
  "label": "Voice Agent 1",
  "rotate_existing": true
}
```
> Returns `api_key` once. Copy immediately; the raw key is never persisted.

#### Revoke Client API Key
```http
POST /api/admin/clients/:clinicId/api-keys/:keyId/revoke
```

---

## Patient Portal Endpoints

### Send Verification Code
```http
POST /api/patient/verify/send
Content-Type: application/json

{
  "phone": "+1234567890"
}
```

### Confirm Verification Code
```http
POST /api/patient/verify/confirm
Content-Type: application/json

{
  "phone": "+1234567890",
  "code": "123456"
}
```

### Get Patient Appointments
```http
GET /api/patient/appointments?session_id=xxx
```

### Reschedule Appointment
```http
PUT /api/patient/appointments/:id/reschedule
Content-Type: application/json

{
  "new_date": "2024-12-16",
  "new_time": "15:00"
}
```

### Cancel Appointment
```http
DELETE /api/patient/appointments/:id
```

---

## Circle Payment Endpoints

### Create Wallet
```http
POST /api/circle/wallets
Content-Type: application/json

{
  "entityType": "patient",
  "entityId": "patient-xxx",
  "description": "Patient wallet"
}
```

### Get Wallet Balance
```http
GET /api/circle/accounts/patient/:patientId
```

### Deposit to Wallet
```http
POST /api/patient/wallet/deposit
Content-Type: application/json

{
  "patientId": "patient-xxx",
  "amount": 100.00
}
```

### Submit Claim Payment
```http
POST /api/claims/:claimId/submit-payment
```

### Approve Claim Payment
```http
POST /api/claims/:claimId/approve-payment
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

**HTTP Status Codes**:
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid API key)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

---

## Webhooks

### Stripe Webhook
Canonical endpoint: `POST /webhooks/stripe` (legacy `POST /webhook/stripe` is disabled by default; see `docs/middleware-platform/README.md#stripe-webhook-paths`).
```http
POST /webhooks/stripe
X-Stripe-Signature: signature
```

### Circle Webhook
```http
POST /webhook/circle
X-Circle-Signature: signature
```

---

## Response Format

All successful responses follow this format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

---

For more details, see the full API documentation in the codebase or contact support.



---

<a id="invoice-api"></a>

## Invoice API Documentation

*Former path: `docs/api/INVOICE_API.md`*

## Overview

The Invoice API provides endpoints for managing patient billing invoices in the clinic billing system. Invoices are generated from insurance claims and calculate patient responsibility based on Explanation of Benefits (EOB) calculations.

## Base URL

```
/api/invoices
```

## Authentication

All endpoints require authentication via session cookie (`customer_session`).

## Endpoints

### Create Invoice from Claim

Generate an invoice from an insurance claim.

**POST** `/api/invoices/create-from-claim`

**Request Body:**
```json
{
  "claim_id": "claim_123",
  "due_date": "2024-02-15T00:00:00Z",  // Optional, defaults to 30 days from now
  "notes": "Payment due within 30 days",  // Optional
  "allow_multiple": false  // Optional, prevent duplicate invoices
}
```

**Response:**
```json
{
  "success": true,
  "invoice": {
    "id": "invoice_456",
    "invoice_number": "INV-00001",
    "claim_id": "claim_123",
    "patient_id": "patient_789",
    "status": "draft",
    "amount": 150.00,
    "due_date": "2024-02-15T00:00:00Z",
    "created_at": "2024-01-15T10:00:00Z"
  },
  "items": [
    {
      "id": "item_001",
      "description": "Office Visit",
      "cpt_code": "99213",
      "icd_code": "Z00.00",
      "amount": 150.00
    }
  ],
  "message": "Invoice created successfully"
}
```

### List Invoices

Get all invoices with optional filters.

**GET** `/api/invoices`

**Query Parameters:**
- `status` (optional): Filter by status (`draft`, `sent`, `paid`, `overdue`)
- `patient_id` (optional): Filter by patient ID
- `claim_id` (optional): Filter by claim ID
- `start_date` (optional): Filter by start date (ISO format)
- `end_date` (optional): Filter by end date (ISO format)
- `limit` (optional): Limit results (default: 50)

**Response:**
```json
{
  "success": true,
  "invoices": [
    {
      "id": "invoice_456",
      "invoice_number": "INV-00001",
      "patient_id": "patient_789",
      "patient_name": "John Doe",
      "patient_email": "john@example.com",
      "status": "sent",
      "amount": 150.00,
      "total_paid": 0.00,
      "balance": 150.00,
      "due_date": "2024-02-15T00:00:00Z",
      "created_at": "2024-01-15T10:00:00Z",
      "is_overdue": false
    }
  ],
  "count": 1
}
```

### Get Invoice Details

Get detailed invoice information including line items and payment history.

**GET** `/api/invoices/:id`

**Response:**
```json
{
  "success": true,
  "invoice": {
    "id": "invoice_456",
    "invoice_number": "INV-00001",
    "claim_id": "claim_123",
    "patient_id": "patient_789",
    "status": "sent",
    "amount": 150.00,
    "due_date": "2024-02-15T00:00:00Z",
    "created_at": "2024-01-15T10:00:00Z",
    "sent_at": "2024-01-15T11:00:00Z"
  },
  "items": [
    {
      "id": "item_001",
      "service_date": "2024-01-10T00:00:00Z",
      "description": "Office Visit",
      "cpt_code": "99213",
      "icd_code": "Z00.00",
      "quantity": 1,
      "unit_price": 150.00,
      "total_price": 150.00
    }
  ],
  "payments": [
    {
      "id": "payment_001",
      "payment_date": "2024-01-20T00:00:00Z",
      "amount": 75.00,
      "payment_method": "credit_card",
      "reference_number": "TXN-12345"
    }
  ],
  "totals": {
    "amount": 150.00,
    "paid": 75.00,
    "balance": 75.00
  },
  "patient": {
    "resourceType": "Patient",
    "name": [{
      "given": ["John"],
      "family": "Doe"
    }],
    "telecom": [{
      "system": "email",
      "value": "john@example.com"
    }]
  }
}
```

### Update Invoice

Update invoice details (status, due date, notes).

**PUT** `/api/invoices/:id`

**Request Body:**
```json
{
  "status": "sent",  // Optional
  "due_date": "2024-03-15T00:00:00Z",  // Optional
  "notes": "Updated notes"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "invoice": {
    "id": "invoice_456",
    "status": "sent",
    "due_date": "2024-03-15T00:00:00Z",
    "notes": "Updated notes"
  },
  "message": "Invoice updated successfully"
}
```

### Send Invoice

Send invoice email to patient with PDF attachment.

**POST** `/api/invoices/:id/send`

**Response:**
```json
{
  "success": true,
  "message": "Invoice sent successfully",
  "invoice": {
    "id": "invoice_456",
    "status": "sent",
    "sent_at": "2024-01-15T12:00:00Z"
  }
}
```

### Record Payment

Record a payment against an invoice.

**POST** `/api/invoices/:id/payments`

**Request Body:**
```json
{
  "amount": 75.00,
  "payment_date": "2024-01-20T00:00:00Z",  // Optional, defaults to today
  "payment_method": "credit_card",  // Optional: cash, check, credit_card, bank_transfer
  "reference_number": "TXN-12345",  // Optional
  "notes": "Partial payment"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "payment_001",
    "invoice_id": "invoice_456",
    "amount": 75.00,
    "payment_date": "2024-01-20T00:00:00Z",
    "payment_method": "credit_card"
  },
  "invoice": {
    "id": "invoice_456",
    "status": "sent",  // or "paid" if fully paid
    "amount": 150.00
  },
  "totals": {
    "amount": 150.00,
    "paid": 75.00,
    "balance": 75.00
  },
  "message": "Payment recorded successfully"
}
```

### Get Payment History

Get all payments for an invoice.

**GET** `/api/invoices/:id/payments`

**Response:**
```json
{
  "success": true,
  "payments": [
    {
      "id": "payment_001",
      "payment_date": "2024-01-20T00:00:00Z",
      "amount": 75.00,
      "payment_method": "credit_card",
      "reference_number": "TXN-12345",
      "notes": "Partial payment"
    }
  ],
  "total_paid": 75.00,
  "balance": 75.00
}
```

## Invoice Statuses

- `draft`: Invoice created but not sent
- `sent`: Invoice sent to patient
- `paid`: Invoice fully paid
- `overdue`: Invoice past due date with outstanding balance

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

**Common HTTP Status Codes:**
- `400`: Bad Request (missing required fields, invalid data)
- `404`: Not Found (invoice, patient, or claim not found)
- `500`: Internal Server Error

## Integration with Claims

Invoices are created from insurance claims using the EOB (Explanation of Benefits) calculation to determine patient responsibility:

1. Claim is created from PDF coding data
2. EOB calculates: `amount_billed - plan_paid - copay = patient_responsibility`
3. Invoice is generated with patient responsibility amount
4. Invoice line items are created from EOB service line items

## PDF Generation

PDF invoices are automatically generated when sending invoices via email. PDFKit is required:

```bash
npm install pdfkit
```

If PDFKit is not installed, emails will be sent without PDF attachments.



---

<a id="readme"></a>

## API Documentation

*Former path: `docs/api/README.md`*

Complete API reference and documentation.

---

## 📚 Documentation Index

1. **API_DOCUMENTATION.md** 📖 **MAIN REFERENCE**
   - Complete API reference
   - All endpoints documented
   - Authentication
   - Request/response formats
   - Usage examples

---

## 🔗 API Endpoints

### Voice Endpoints
- `/voice/incoming` - Incoming call handler
- `/voice/appointments/*` - Appointment management
- `/voice/insurance/*` - Insurance operations
- `/voice/checkout/*` - Checkout operations

### REST API
- `/api/admin/*` - Admin endpoints
- `/api/patient/*` - Patient endpoints
- `/api/ehr/*` - EHR integration
- `/api/circle/*` - Circle wallet

---

## 🔗 Related Documentation

- **Architecture:** `../architecture/README.md#readme`
- **Setup:** `../setup/README.md#readme`
- **Main Docs:** `../README.md#readme`

---

**Last Updated:** April 9, 2026

**Note:** OpenAPI spec is in `middleware-platform/openapi.yaml`.



