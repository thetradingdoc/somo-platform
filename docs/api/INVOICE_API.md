# Invoice API Documentation

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

