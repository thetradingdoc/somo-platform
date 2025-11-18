# Comprehensive Test Suite

## Overview

The test suite validates:
- ✅ Database connectivity and queries
- ✅ Backend API endpoints
- ✅ Voice agent configuration
- ✅ Frontend files and configuration

## Running Tests

### Option 1: Run All Tests (Recommended)

```bash
cd middleware-platform
node tests/test-all.js
```

### Option 2: Run Test Script

```bash
cd middleware-platform
./tests/run-all-tests.sh
```

### Option 3: Test Individual Components

#### Database Tests
```bash
cd middleware-platform
node -e "const db = require('./database'); console.log('✅ Database connected');"
```

#### Backend API Tests
```bash
# Health check
curl http://localhost:4000/health

# Test appointment email
curl -X POST http://localhost:4000/api/test/appointment-email \
  -H "Content-Type: application/json" \
  -d '{"patient_email":"test@example.com","patient_name":"Test","appointment_type":"Test","date":"2025-11-15","time":"2:00 PM"}'
```

#### Voice Agent Tests
```bash
# Check Retell functions
cat middleware-platform/retell-functions/retell-functions.json | jq '.tools | length'

# Check agent prompt
ls -la docs/voice-agent/kelly-voice-agent-prompt.md
```

#### Frontend Tests
```bash
# Check frontend files
ls -la unified-dashboard/patients/patient-dashboard.html
ls -la unified-dashboard/patients/wallet.html
ls -la unified-dashboard/business/business-dashboard.html
```

## Test Results

The test suite outputs:
- ✅ Pass/Fail status for each test
- 📊 Summary statistics
- ❌ Error messages for failed tests

## Expected Results

### Database
- ✅ Connection: PASS
- ✅ Required Tables: PASS
- ✅ Queries: PASS

### Backend API
- ✅ Health Check: PASS (200)
- ✅ Get Patients: PASS (200 or 404)
- ✅ Test Appointment Email: PASS (200)

### Voice Agent
- ✅ Retell Functions: PASS (functions defined)
- ✅ Agent Prompt: PASS (file exists)
- ✅ WebSocket Handler: PASS (handler exists)

### Frontend
- ✅ Required Files: PASS (all files exist)
- ✅ API Configuration: PASS or WARN

## Troubleshooting

### Server Not Running
```bash
cd middleware-platform
npm start
```

### Database Errors
- Check `middleware.db` exists
- Verify database schema is up to date
- Check database permissions

### API Errors
- Verify server is running on port 4000
- Check environment variables
- Review server logs

### Voice Agent Errors
- Verify `retell-functions.json` exists
- Check Retell API key is configured
- Verify agent prompt file exists

### Frontend Errors
- Check file paths are correct
- Verify API configuration in `config.js`
- Check browser console for errors

## Continuous Testing

For development, run tests after:
- Code changes
- Database migrations
- Configuration updates
- New feature additions

---

**Last Updated:** 2025-11-12

