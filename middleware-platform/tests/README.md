# Testing Retell Functions

## Quick Start

1. **Make sure your server is running:**
   ```bash
   cd middleware-platform
   npm start
   ```

2. **In a new terminal, run the test script:**
   ```bash
   cd middleware-platform
   node tests/test-retell-functions.js
   ```

3. **Or if using ngrok, set the API_BASE_URL:**
   ```bash
   API_BASE_URL=https://your-ngrok-url.com node tests/test-retell-functions.js
   ```

## What It Tests

The script tests all 10 Retell functions:

1. ✅ `collect_insurance` - Collect and verify insurance information
2. ✅ `get_available_slots` - Get available appointment slots
3. ✅ `schedule_appointment` - Schedule a new appointment
4. ✅ `search_appointments` - Search for existing appointments
5. ✅ `confirm_appointment` - Confirm an appointment
6. ✅ `cancel_appointment` - Cancel an appointment
7. ✅ `reschedule_appointment` - Reschedule an appointment
8. ✅ `create_appointment_checkout` - Create payment checkout
9. ✅ `verify_checkout_code` - Verify payment code
10. ✅ `get_patient_claims` - Get patient claims/benefits

## Test Flow

The tests run in sequence and use data from previous tests:
- Creates an appointment (test 3)
- Uses that appointment ID for confirm/cancel/reschedule tests
- Creates a checkout (test 8)
- Uses that checkout token for verification test

## Expected Output

```
🚀 Starting Retell Functions Test Suite
API Base URL: http://localhost:4000
✅ Server is running (200)

================================================================================
Testing: collect_insurance
================================================================================
✅ PASSED: collect_insurance
   Response: { success: true, ... }

...

📊 TEST SUMMARY
================================================================================
✅ Passed: 10
❌ Failed: 0

🎉 All tests passed!
```

## Troubleshooting

**Error: "Server is not running"**
- Make sure `npm start` is running in another terminal
- Check if port 4000 is in use: `lsof -i :4000`

**Error: "Connection refused"**
- Check API_BASE_URL is correct
- If using ngrok, make sure tunnel is active

**Some tests fail:**
- Check server logs for detailed error messages
- Verify database is accessible
- Check environment variables are set

