# UHC FLEX FHIR API - URL Migration Analysis

## Overview
UnitedHealthcare (UHC) is migrating from subdomain-based routing to path-based routing for their FLEX FHIR API endpoints. **Old URLs will be decommissioned at the end of November**, requiring all integrations to migrate to the new URL structure.

## URL Changes Summary

### 1. Public FHIR API Calls
**Old:**
```
https://public.flex.optum.com
```

**New (Two Options):**
```
https://flex.optum.com/fhirpublic
https://flex.optum.com/fhirpublic2025
```

**Analysis:**
- Two new endpoints suggest versioning strategy
- `fhirpublic2025` likely indicates a newer API version or future-proofing
- Path-based routing (`/fhirpublic`) instead of subdomain (`public.flex.optum.com`)

### 2. Sandbox FHIR API Calls
**Old:**
```
https://sandbox.fhir.flex.optum.com/R4/metadata
```

**New:**
```
https://flex.optum.com/fhir/sandbox/R4/metadata
```

**Analysis:**
- Consolidated under main domain with `/fhir/sandbox/` path
- Maintains R4 FHIR version in path
- Metadata endpoint structure preserved

### 3. OAuth Authentication
**Old:**
```
https://authz.flex.optum.com
```

**New:**
```
https://flex.optum.com/authz
```

**Analysis:**
- Simplified path-based routing
- Critical for authentication - must update before other endpoints work
- OAuth token endpoints likely at `/authz/token`, `/authz/authorize`, etc.

### 4. Production FHIR API Calls
**Old:**
```
https://fhir.flex.optum.com/R4
```

**New (Two Options):**
```
https://flex.optum.com/fhir/R4
https://flex.optum.com/fhir/[payer]/R4
```

**Analysis:**
- Generic endpoint: `/fhir/R4` (likely for multi-payer or default)
- Payer-specific endpoint: `/fhir/[payer]/R4` (payer-specific routing)
- `[payer]` parameter suggests payer-specific API instances or routing

### 5. Portal Access
**New:**
```
https://flex.optum.com/portal
```

**Analysis:**
- New portal endpoint for web-based access
- Likely for administrative/management functions

## API Access Patterns & Implications

### 1. **Authentication Flow**
```
OLD: https://authz.flex.optum.com/oauth/token
NEW: https://flex.optum.com/authz/oauth/token
```
- **Impact:** All OAuth flows must be updated
- **Action Required:** Update OAuth client configuration
- **Timeline:** Must complete before other API calls work

### 2. **FHIR Resource Access**
```
OLD: https://fhir.flex.optum.com/R4/Patient/12345
NEW: https://flex.optum.com/fhir/R4/Patient/12345
     OR
     https://flex.optum.com/fhir/UHC/R4/Patient/12345 (payer-specific)
```

**Key Questions:**
- When to use generic `/fhir/R4` vs payer-specific `/fhir/[payer]/R4`?
- What payer identifiers are valid for `[payer]` parameter?
- Are there different capabilities/endpoints per payer?

### 3. **Public vs Authenticated Endpoints**
- **Public endpoints** (`/fhirpublic`) - Likely for:
  - Public metadata
  - Unauthenticated resource discovery
  - Public capability statements
  
- **Authenticated endpoints** (`/fhir/R4`) - For:
  - Patient data access
  - Eligibility checks
  - Claims submission
  - Requires OAuth token

### 4. **Sandbox Environment**
- Sandbox now clearly separated: `/fhir/sandbox/R4/`
- Useful for testing before production migration
- May have different authentication requirements

## Integration Requirements

### Current State (Your Platform)
Your platform currently uses:
- **Stedi API** for insurance operations (X12 EDI transactions)
- **Local payer cache** for payer lookups
- **No direct UHC FHIR integration** currently

### Potential Integration Points

#### 1. **Eligibility Checks**
**Current:** Stedi X12 270/271 transactions
**Potential:** UHC FHIR Coverage/CoverageEligibilityRequest resources
```
POST https://flex.optum.com/fhir/R4/CoverageEligibilityRequest
```

#### 2. **Provider Directory**
**Current:** Local database + manual entry
**Potential:** UHC FHIR Organization/Endpoint resources
```
GET https://flex.optum.com/fhir/R4/Organization?insurance=UHC
```

#### 3. **Claims Submission**
**Current:** Stedi X12 837 transactions
**Potential:** UHC FHIR Claim resources
```
POST https://flex.optum.com/fhir/R4/Claim
```

#### 4. **Patient Data**
**Current:** Local FHIR Patient resources
**Potential:** Sync with UHC FHIR Patient resources
```
GET https://flex.optum.com/fhir/R4/Patient/[id]
```

## Migration Checklist

### Immediate Actions (Before End of November)
- [ ] Review UHC developer documentation: https://www.uhc.com/legal/interoperability-apis
- [ ] Identify all current integrations using old URLs (if any)
- [ ] Test new endpoints in sandbox environment
- [ ] Update OAuth configuration to new `/authz` endpoint
- [ ] Update all API base URLs in configuration
- [ ] Test authentication flow with new endpoints
- [ ] Verify FHIR resource access with new URLs
- [ ] Update error handling for new endpoint responses

### Code Changes Required (If Integrating)
1. **Environment Variables:**
   ```env
   # OLD (if used)
   UHC_OAUTH_URL=https://authz.flex.optum.com
   UHC_FHIR_BASE=https://fhir.flex.optum.com/R4
   
   # NEW
   UHC_OAUTH_URL=https://flex.optum.com/authz
   UHC_FHIR_BASE=https://flex.optum.com/fhir/R4
   UHC_FHIR_PUBLIC=https://flex.optum.com/fhirpublic
   UHC_FHIR_SANDBOX=https://flex.optum.com/fhir/sandbox/R4
   ```

2. **API Client Updates:**
   - Update base URLs in HTTP clients
   - Update OAuth token endpoint
   - Add payer-specific routing logic (if using `/fhir/[payer]/R4`)

3. **Error Handling:**
   - Handle potential redirects from old URLs
   - Update error messages for new endpoint failures
   - Add fallback logic during transition period

## Key Questions to Resolve

1. **Payer-Specific Routing:**
   - What payer identifiers are valid for `/fhir/[payer]/R4`?
   - When should you use payer-specific vs generic endpoint?
   - Are there different capabilities per payer?

2. **API Versioning:**
   - What's the difference between `/fhirpublic` and `/fhirpublic2025`?
   - Should you use both or migrate to 2025 version?
   - Are there breaking changes in 2025 version?

3. **Authentication:**
   - Does OAuth flow change with new endpoints?
   - Are scopes/permissions different?
   - Is client credential flow supported?

4. **Rate Limits & Quotas:**
   - Do rate limits change with new endpoints?
   - Are there different quotas for public vs authenticated?
   - How are payer-specific endpoints rate-limited?

5. **Backward Compatibility:**
   - Will old URLs redirect to new ones?
   - Is there a grace period after November?
   - What happens to existing tokens/credentials?

## Recommendations

### If You're NOT Currently Using UHC FLEX API:
- **No immediate action required** - Your Stedi integration is unaffected
- **Future consideration:** Evaluate UHC FHIR API for direct integration benefits:
  - Real-time eligibility (vs X12 batch processing)
  - Direct provider directory access
  - Native FHIR resource support

### If You ARE Using UHC FLEX API:
1. **Immediate:** Test sandbox endpoints to understand new structure
2. **Before November:** Complete migration to new URLs
3. **Documentation:** Review full API docs at https://www.uhc.com/legal/interoperability-apis
4. **Testing:** Use sandbox environment extensively before production switch
5. **Monitoring:** Set up alerts for old URL failures after migration

## Next Steps

1. **Review Official Documentation:**
   - Visit: https://www.uhc.com/legal/interoperability-apis
   - Download API specifications
   - Review authentication requirements

2. **Sandbox Testing:**
   - Register for sandbox access (if not already)
   - Test OAuth flow with new `/authz` endpoint
   - Test FHIR resource access with new URLs
   - Verify payer-specific routing (if applicable)

3. **Production Migration:**
   - Schedule migration window before November deadline
   - Update configuration in staging first
   - Monitor for errors during transition
   - Have rollback plan ready

## References
- UHC Developer Documentation: https://www.uhc.com/legal/interoperability-apis
- Portal: https://flex.optum.com/portal
- Migration Deadline: End of November (exact date TBD)







