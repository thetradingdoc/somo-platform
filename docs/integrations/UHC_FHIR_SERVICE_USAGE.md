# UHC FHIR Service - Usage Guide

## Overview

The UHC FHIR Service (`uhc-fhir-service.js`) attempts to pull all available data from UHC FLEX FHIR API, including:
- Provider Directory (Organizations, Practitioners, Locations)
- Patient Clinical Data (Conditions, Medications, Allergies, etc.)
- Coverage Information
- Claims & EOBs
- Prior Authorization Data

## Setup

### 1. Get UHC OAuth Credentials

1. Register at: https://flex.optum.com/portal
2. Complete developer onboarding
3. Get `CLIENT_ID` and `CLIENT_SECRET`

### 2. Configure Environment Variables

```bash
# Required for authenticated endpoints
export UHC_CLIENT_ID="your-client-id"
export UHC_CLIENT_SECRET="your-client-secret"

# Optional - defaults provided
export UHC_OAUTH_URL="https://flex.optum.com/authz"
export UHC_FHIR_BASE="https://flex.optum.com/fhir/R4"
export UHC_FHIR_SANDBOX="https://flex.optum.com/fhir/sandbox/R4"
export UHC_FHIR_PUBLIC="https://flex.optum.com/fhirpublic"
```

Or add to `.env` file:
```env
UHC_CLIENT_ID=your-client-id
UHC_CLIENT_SECRET=your-client-secret
```

## Usage

### Option 1: Test Script (Recommended for Testing)

Run the comprehensive test script:

```bash
cd middleware-platform
node tests/test-uhc-fhir.js
```

This will:
- Test connection (public metadata endpoint)
- Pull provider directory
- Pull patient clinical data
- Pull coverage data
- Pull claims data
- Pull prior auth data
- Pull ALL data (comprehensive)

### Option 2: API Endpoints

Start your server and use these endpoints:

#### Test Connection (No Auth Required)
```bash
curl http://localhost:3000/api/test/uhc-fhir/connection?sandbox=true
```

#### Pull Provider Directory
```bash
# Search providers by zip code
curl "http://localhost:3000/api/test/uhc-fhir/providers?zip=10001&limit=10&sandbox=true"

# Search by specialty
curl "http://localhost:3000/api/test/uhc-fhir/providers?specialty=cardiology&sandbox=true"
```

#### Pull Patient Clinical Data
```bash
curl "http://localhost:3000/api/test/uhc-fhir/patient/test-patient-001/clinical?sandbox=true"
```

#### Pull Coverage Data
```bash
curl "http://localhost:3000/api/test/uhc-fhir/patient/test-patient-001/coverage?sandbox=true"
```

#### Pull Claims Data
```bash
curl "http://localhost:3000/api/test/uhc-fhir/patient/test-patient-001/claims?sandbox=true"
```

#### Pull ALL Data (Comprehensive)
```bash
curl "http://localhost:3000/api/test/uhc-fhir/patient/test-patient-001/all?sandbox=true"
```

### Option 3: Programmatic Usage

```javascript
const UHCFHIRService = require('./services/uhc-fhir-service');

// Test connection
const connectionTest = await UHCFHIRService.testConnection(true);

// Pull provider directory
const providers = await UHCFHIRService.pullProviderDirectory({
  useSandbox: true,
  zipCode: '10001',
  specialty: 'cardiology',
  limit: 50
});

// Pull patient clinical data
const clinicalData = await UHCFHIRService.pullPatientClinicalData('patient-id', {
  useSandbox: true
});

// Pull coverage
const coverage = await UHCFHIRService.pullCoverageData('patient-id', {
  useSandbox: true
});

// Pull claims
const claims = await UHCFHIRService.pullClaimsData('patient-id', {
  useSandbox: true
});

// Pull prior auth
const priorAuth = await UHCFHIRService.pullPriorAuthData('patient-id', {
  useSandbox: true
});

// Pull ALL data
const allData = await UHCFHIRService.pullAllPatientData('patient-id', {
  useSandbox: true
});
```

## Data Types Pulled

### 1. Provider Directory

**Resources:**
- `Organization` - Provider organizations
- `Practitioner` - Individual providers
- `Location` - Provider locations
- `PractitionerRole` - Provider-specialty relationships

**Example Response:**
```json
{
  "success": true,
  "data": {
    "organizations": [...],
    "practitioners": [...],
    "locations": [...],
    "practitionerRoles": [...]
  },
  "totalProviders": 45,
  "errors": []
}
```

### 2. Patient Clinical Data

**Resources:**
- `Condition` - Diagnoses and conditions
- `MedicationStatement` - Current medications
- `AllergyIntolerance` - Allergies
- `Immunization` - Vaccinations
- `Observation` - Lab results, vitals
- `Procedure` - Procedures performed
- `CarePlan` - Treatment plans

**Example Response:**
```json
{
  "success": true,
  "data": {
    "conditions": [...],
    "medications": [...],
    "allergies": [...],
    "immunizations": [...],
    "observations": [...],
    "procedures": [...],
    "carePlans": [...]
  },
  "errors": []
}
```

### 3. Coverage Data

**Resources:**
- `Coverage` - Insurance coverage details
- `CoverageEligibilityResponse` - Eligibility responses

**Example Response:**
```json
{
  "success": true,
  "data": {
    "coverage": [...],
    "eligibilityResponses": [...]
  },
  "errors": []
}
```

### 4. Claims & EOBs

**Resources:**
- `Claim` - Submitted claims
- `ClaimResponse` - Claim adjudication
- `ExplanationOfBenefit` - Detailed EOBs

**Example Response:**
```json
{
  "success": true,
  "data": {
    "claims": [...],
    "claimResponses": [...],
    "eobs": [...]
  },
  "errors": []
}
```

### 5. Prior Authorization

**Resources:**
- `ServiceRequest` - Prior auth requests
- `Task` - Prior auth workflow status

**Example Response:**
```json
{
  "success": true,
  "data": {
    "serviceRequests": [...],
    "tasks": [...]
  },
  "errors": []
}
```

## Error Handling

The service gracefully handles errors:

- **Missing Credentials:** Will attempt public endpoints, but authenticated endpoints will fail
- **OAuth Failures:** Will log error and return unauthenticated client
- **API Failures:** Each data type pull is independent - if one fails, others continue
- **Invalid Patient IDs:** Will return empty results with error messages

**Example Error Response:**
```json
{
  "success": false,
  "data": null,
  "error": "UHC OAuth credentials not configured"
}
```

## Authentication Flow

1. **First Call:** Service requests OAuth token using client credentials
2. **Token Caching:** Token is cached with expiration time
3. **Auto-Refresh:** Token is automatically refreshed if expires in < 5 minutes
4. **All Requests:** Token is added to `Authorization: Bearer [token]` header

## Sandbox vs Production

- **Sandbox:** Use for testing (default in test script)
  - URL: `https://flex.optum.com/fhir/sandbox/R4`
  - May have limited/test data
  - Safer for development

- **Production:** Use for real data
  - URL: `https://flex.optum.com/fhir/R4`
  - Real patient data (requires proper authorization)
  - Requires production credentials

## Troubleshooting

### "UHC OAuth credentials not configured"
- Set `UHC_CLIENT_ID` and `UHC_CLIENT_SECRET` environment variables
- Or register at https://flex.optum.com/portal

### "Connection failed" or "401 Unauthorized"
- Check credentials are correct
- Verify OAuth token endpoint is accessible
- Check if credentials are approved for sandbox/production

### "404 Not Found" on patient endpoints
- Patient ID may not exist in sandbox
- Try different patient ID
- Check if endpoint requires different format

### "No data returned"
- Sandbox may not have test data for that resource type
- Some endpoints may require specific scopes
- Check UHC documentation for available resources

## Next Steps

1. **Get Credentials:** Register at https://flex.optum.com/portal
2. **Test Connection:** Run `node tests/test-uhc-fhir.js`
3. **Test Provider Directory:** This is the main gap Stedi doesn't fill
4. **Integrate:** Use provider directory data in your provider search feature

## Integration Example

```javascript
// In your provider directory service
const UHCFHIRService = require('./services/uhc-fhir-service');

async function findProvidersByInsurance(payerId, zipCode) {
  // Pull UHC provider directory
  const result = await UHCFHIRService.pullProviderDirectory({
    useSandbox: false, // production
    zipCode: zipCode,
    limit: 100
  });
  
  if (result.success && result.data) {
    // Filter by payer/insurance network
    // Map FHIR resources to your provider format
    // Return to caller
    return result.data.organizations.map(org => ({
      name: org.name,
      npi: org.identifier?.find(id => id.system.includes('npi'))?.value,
      address: org.address?.[0],
      // ... map other fields
    }));
  }
  
  return [];
}
```




