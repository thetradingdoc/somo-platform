# Deferred: location_id on CallSiteContext (A7)

**Trigger:** First multi-department clinic onboards (multiple physical sites under one `clinic_id`).

**Scope when triggered:**
- Add `location_id` to `CallSiteContext` struct and `call_site_context` table
- DID → location mapping in `clinic_phone_numbers` or dedicated table
- Pass `location_id` to scheduling tools and FHIR scope

**Until then:** Single-clinic tenants use `clinic_id` only; do not infer location from LIMIT 1 heuristics.
