# Routes - API Endpoints

**Last Updated:** April 9, 2026

Modular Express route handlers mounted from `server.js`. **Many routes are still declared directly in `server.js`**; use repo search for a path if you do not find it here.

## Route files

### Voice Routes (`voice.js`)
- `/voice/appointments/*` - Appointment management
- `/voice/insurance/*` - Insurance operations
- `/voice/checkout/*` - Payment checkout

### Admin Routes (`admin.js`)
- `/api/admin/appointments` - Appointment management
- `/api/admin/patients/*` - Patient management
- `/api/admin/insurance/*` - Insurance operations
- `/api/admin/claims/*` - Claim management

### FHIR Routes (`fhir.js`)
- `/fhir/Patient` - FHIR patient resources
- `/fhir/Encounter` - FHIR encounter resources
- FHIR R4 compliant endpoints

### Payment Routes (`payment.js`)
- `/process-payment` - Stripe payment processing
- Payment webhooks

### PDF Coding Routes (`pdf-coding.js`)
- `/api/claims/create-from-pdf` - Create claim from PDF
- Medical coding endpoints

### Fraud Routes (`fraud.js`)
- `/api/fraud/*` - Fraud detection endpoints
- Blacklist/whitelist management

### Merchant Routes (`merchant.js`)
- `/api/merchants/*` - Merchant management

### ACP Routes (`acp.js`)
- ACP (Agent Commerce Protocol) endpoints

### AP2 Routes (`ap2.js`)
- AP2 (Agent Pay 2.0) endpoints

## Route Patterns

All routes follow these patterns:
- Express.js route handlers
- Error handling middleware
- Input validation
- Database operations via services
- Structured JSON responses

## Authentication

Most routes require authentication:
- API key authentication (optional)
- Session-based authentication
- OAuth for EHR integration

## Rate Limiting

Routes are protected by rate limiting:
- General API: 100 requests/15min
- Authentication: 5 attempts/15min
- Payment: 10 requests/hour
- Voice: 20 requests/minute

