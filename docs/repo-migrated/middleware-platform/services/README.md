# Services - Business Logic Layer

**Last Updated:** April 9, 2026

This directory contains all business logic services for the DocLittle platform.

## Healthcare Services

### FHIR Service (`fhir-service.js`)
- FHIR R4 patient resource management
- Patient creation, retrieval, updates
- Duplicate patient detection
- Name normalization and matching
- Phone number uniqueness enforcement

### Booking Service (`booking-service.js`)
- Appointment scheduling and management
- Availability checking
- Conflict resolution
- Google Calendar integration
- Email confirmations

### Insurance Service (`insurance-service.js`)
- Stedi API integration (X12 EDI)
- Eligibility checks (270/271 transactions)
- Claim submission (837 transactions)
- Claim status checks (276/277 transactions)
- **Note**: Currently uses mock data (simulation mode)

### EHR Services
- **ehr-sync-service.js** - Epic/1upHealth EHR synchronization
- **ehr-aggregator-service.js** - EHR data aggregation
- **epic-adapter.js** - Epic SMART on FHIR adapter

## Payment Services

### Payment Orchestrator (`payment-orchestrator.js`)
- Payment flow orchestration
- Checkout creation
- Email verification flow
- Transaction management

### Payment Service (`payment-service.js`)
- Stripe payment processing
- Payment intent creation
- Payment confirmation

### Circle Service (`circle-service.js`)
- Circle USDC wallet payments
- Wallet creation and management
- USDC transfers
- Payment processing for insurance claims

### Payment Methods
- **mastercard-service.js** - Mastercard Agent Pay
- **visa-service.js** - Visa Agent Toolkit

## Medical Coding Services

### Medical Coding Service (`medical-coding-service.js`)
- Groq AI integration for ICD-10/CPT extraction
- Code validation
- Code mapping

### Coding Orchestrator (`coding-orchestrator.js`)
- Medical coding workflow
- Code extraction coordination

### PDF Coding Service (`pdf-coding-service.js`)
- PDF text extraction
- Document processing
- Code extraction from PDFs

### Diagnosis Code Mapper (`diagnosis-code-mapper.js`)
- ICD-10 code mapping
- Code descriptions

## Communication Services

### Email Service (`email-service.js`)
- SMTP email sending
- Azure Communication Services integration
- Email templates
- Verification code emails

### SMS Service (`sms-service.js`)
- Twilio SMS integration
- SMS notifications
- Verification codes

## Other Services

### Fraud Detector (`fraud-detector.js`)
- Fraud detection and risk scoring
- Signal collection
- Blacklist/whitelist management

### Reminder Scheduler (`reminder-scheduler.js`)
- Appointment reminder scheduling
- Email/SMS reminders

### Provider Service (`provider-service.js`)
- Provider dashboard data
- Today's schedule
- Next patient information
- Live statistics

### Patient Portal Service (`patient-portal-service.js`)
- Patient portal data
- Appointment management
- Profile management

### Payer Cache Service (`payer-cache-service.js`)
- Insurance payer list caching
- Payer lookup optimization

### EOB Calculation Service (`eob-calculation-service.js`)
- Explanation of Benefits calculations
- Insurance benefit breakdowns

### Knowledge Service (`knowledge-service.js`)
- Medical knowledge base
- Code reference data

### Metrics (`metrics.js`)
- System metrics collection
- Performance monitoring

### Logger (`logger.js`)
- Structured logging
- Log management

## Service Patterns

All services follow these patterns:
- Static class methods
- Error handling with try/catch
- Database integration via `database.js`
- Logging for debugging
- Return structured response objects

## Usage Example

```javascript
const BookingService = require('./services/booking-service');
const InsuranceService = require('./services/insurance-service');

// Schedule appointment
const result = await BookingService.scheduleAppointment({
  patient_name: 'John Doe',
  patient_phone: '+1234567890',
  date: '2025-11-15',
  time: '10:00'
});

// Check eligibility
const eligibility = await InsuranceService.checkEligibility({
  patientName: 'John Doe',
  memberId: '123456',
  payerId: 'CIGNA'
});
```

