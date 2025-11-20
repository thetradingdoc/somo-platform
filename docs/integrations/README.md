# Integrations Documentation

This directory contains documentation for third-party integrations and APIs.

## 📁 Files

### [STEDI_API_ENDPOINTS.md](./STEDI_API_ENDPOINTS.md)
Complete documentation of STEDI API integration for healthcare insurance operations:

**Endpoints Available:**
1. **Eligibility Check** (X12 270/271) - `POST /x12/translate/270-to-edi`
2. **Claim Submission** (X12 837) - `POST /x12/translate/837-to-edi`
3. **Claim Status** (X12 276/277) - `POST /x12/translate/276-to-edi`
4. **Payer Directory** - `GET /payers` or `GET /v1/payers`

**STEDI Sandbox Data Format:**
- Member IDs: `TEST` + 6 digits (e.g., `TEST999888`)
- Payer IDs: `UHC`, `BCBS`, `AETNA`, `CIGNA`
- Service Codes: CPT codes (e.g., `90834`, `99213`)

**Production Connection:**
- Base URL: `https://api.stedi.com`
- Authentication: Bearer token via `STEDI_API_KEY`
- Environment: `STEDI_API_BASE`, `STEDI_API_KEY`

## 🔗 Related Documentation

- [STEDI vs UHC FHIR Comparison](./STEDI_VS_UHC_FHIR_DATA_COMPARISON.md)
- [UHC Flex FHIR API Analysis](./UHC_FLEX_FHIR_API_ANALYSIS.md)
- [Patient Journey](../patient-journey/) - Insurance usage in patient workflows
