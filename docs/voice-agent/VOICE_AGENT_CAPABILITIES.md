# Voice Agent (Kelly) - What It Actually Does

## Overview
Kelly is a multilingual medical voice assistant that handles healthcare-related phone calls through Retell AI. The agent can communicate in English, Russian, Spanish, Chinese, French, and German, automatically detecting the caller's language.

## Core Capabilities

### 1. **Insurance Collection & Verification** (`collect_insurance`)
- **What it does**: Collects and verifies patient insurance information
- **Inputs needed**: 
  - Insurance member ID (required)
  - Patient name
  - Insurance company name (e.g., Cigna, Aetna)
  - Optional: phone, email, service code
- **What it returns**:
  - Insurance coverage details
  - Deductible remaining
  - Copay amounts
  - Coinsurance percentages
  - Patient responsibility after insurance
- **When used**: When caller wants to check coverage or before booking appointments

### 2. **Appointment Scheduling** (`schedule_appointment`)
- **What it does**: Books new medical appointments
- **Inputs needed**:
  - Patient name, phone, email (all required)
  - Appointment type (e.g., "Therapy Session - Psychiatry")
  - Date (YYYY-MM-DD)
  - Time (HH:MM or 12-hour format)
  - Optional: timezone, notes
- **What it returns**:
  - Appointment ID
  - Confirmation details
  - Appointment date/time
- **When used**: When caller wants to book a new appointment

### 3. **Check Availability** (`get_available_slots`)
- **What it does**: Gets available appointment time slots for a specific date
- **Inputs needed**:
  - Date (YYYY-MM-DD)
  - Optional: appointment type, timezone
- **What it returns**:
  - List of available time slots
  - Formatted for voice presentation
- **When used**: Before scheduling to show caller available times

### 4. **Search Appointments** (`search_appointments`)
- **What it does**: Finds existing appointments by phone or email
- **Inputs needed**:
  - Search term (phone number or email)
- **What it returns**:
  - List of matching appointments
  - Appointment details (date, time, type, status)
- **When used**: When caller asks "Do I have an appointment?" or "When is my next visit?"

### 5. **Confirm Appointment** (`confirm_appointment`)
- **What it does**: Confirms an existing appointment
- **Inputs needed**:
  - Appointment ID
- **What it returns**:
  - Confirmation status
  - Appointment details
- **When used**: When caller wants to confirm their booking

### 6. **Cancel Appointment** (`cancel_appointment`)
- **What it does**: Cancels an existing appointment
- **Inputs needed**:
  - Appointment ID
  - Optional: reason for cancellation
- **What it returns**:
  - Cancellation confirmation
  - Option to reschedule
- **When used**: When caller wants to cancel their appointment

### 7. **Reschedule Appointment** (`reschedule_appointment`)
- **What it does**: Changes appointment date/time
- **Inputs needed**:
  - Appointment ID
  - New date (YYYY-MM-DD)
  - New time (HH:MM or 12-hour format)
  - Optional: reason, timezone
- **What it returns**:
  - Rescheduled appointment details
  - Confirmation
- **When used**: When caller wants to change their appointment time

### 8. **Create Payment Checkout** (`create_appointment_checkout`)
- **What it does**: Creates a payment checkout for appointment copay/patient responsibility
- **Inputs needed**:
  - Appointment ID
  - Customer email (required)
  - Customer name, phone
  - Amount (patient responsibility after insurance)
- **What it returns**:
  - Payment token
  - 6-digit verification code sent to email
- **When used**: After booking when patient needs to pay their portion

### 9. **Verify Payment Code** (`verify_checkout_code`)
- **What it does**: Verifies the 6-digit code from email to complete payment
- **Inputs needed**:
  - Payment token
  - 6-digit verification code
- **What it returns**:
  - Verification status
  - Payment link sent to email
- **When used**: When caller receives email code and wants to complete payment

### 10. **Get Patient Claims** (`get_patient_claims`)
- **What it does**: Retrieves patient's medical claims and billing history
- **Inputs needed**:
  - Insurance member ID (required)
  - Patient name (required)
  - Optional: payer name
- **What it returns**:
  - List of recent claims
  - Service details
  - Diagnosis codes
  - Payment status
  - Billing amounts
- **When used**: When caller asks "What are my recent bills?" or "Show me my claims"

### 11. **End Call** (`end_call`)
- **What it does**: Gracefully ends the conversation
- **When used**: When caller is done or conversation is complete

## Conversation Flow Example

**Typical Appointment Booking Flow:**
1. Kelly greets: "Hi, I'm Kelly. I'll be your assistant today. Can I start with kindly getting your full name?"
2. Caller provides name
3. Kelly: "Hi [Name], how can I assist you today?"
4. Caller: "I'd like to book an appointment"
5. Kelly asks for appointment type
6. Kelly: "Can I get your insurance number?"
7. Kelly calls `collect_insurance` → Gets coverage details
8. Kelly: "Your insurance covers 80% after deductible. Your copay is $25. Would you like to proceed?"
9. Kelly: "What day works best for you?"
10. Kelly calls `get_available_slots` → Shows available times
11. Caller picks a time
12. Kelly asks for email
13. Kelly calls `schedule_appointment` → Books appointment
14. Kelly: "Great! I've scheduled your appointment for [date] at [time]. You'll receive a confirmation email."
15. If payment needed: Kelly calls `create_appointment_checkout` → Sends verification code
16. Kelly: "I've sent a 6-digit code to your email. Please check and let me know the code."
17. Caller provides code
18. Kelly calls `verify_checkout_code` → Completes payment
19. Kelly: "Payment processed! You'll receive a payment confirmation email."

## Multilingual Support

Kelly automatically detects the caller's language:
- **Russian**: "Привет! Я Келли. Я буду вашим помощником сегодня."
- **Spanish**: "¡Hola! Soy Kelly. Seré su asistente hoy."
- **Chinese**: "你好！我是凯莉。我今天将是您的助手。"
- **French**: "Bonjour! Je suis Kelly. Je serai votre assistante aujourd'hui."
- **German**: "Guten Tag! Ich bin Kelly. Ich werde heute Ihre Assistentin sein."

Once language is detected, the entire conversation continues in that language.

## Technical Implementation

- **Platform**: Retell AI (voice AI platform)
- **WebSocket**: Real-time bidirectional communication
- **Function Calls**: LLM decides when to call functions based on conversation
- **Database**: SQLite (local) or PostgreSQL (production)
- **Integration**: Twilio for phone calls, Stripe for payments, FHIR for medical records

## Production Status

✅ **Deployed to**: `https://api.doclittle.site` and `https://doclittle.azurewebsites.net`
✅ **Status**: Running and responding (HTTP 200)
✅ **Functions**: All 11 functions implemented and tested

