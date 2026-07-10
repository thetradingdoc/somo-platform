# Vendor BAA tracker (H-C1)

**Last updated:** 2026-07-05  
**Task:** Production plan Phase 12.3  
**Owner:** Leadership / ops (not engineering)  
**Review cadence:** Quarterly or on vendor change

Track **Business Associate Agreements** (or equivalent data-processing terms) for every subprocessors that may touch PHI.

## Status legend

| Status | Meaning |
|--------|---------|
| ✅ Signed | Executed BAA/DPA on file |
| ⏳ In progress | Legal review or vendor paperwork outstanding |
| ⚠️ Risk accepted | Leadership documented acceptance — see Notes |
| N/A | No PHI in this integration path |

## Vendor matrix

| Vendor | PHI exposure | BAA status | Document location | Evidence / engineering link | Last verified | Notes |
|--------|--------------|------------|-------------------|----------------------------|---------------|-------|
| **Google Cloud** (Cloud Run, Cloud SQL, GCS, Secret Manager) | Hosting, DB, backups | ⏳ In progress | Legal vault / GCP agreement | `scripts/verify-postgres-gcs-reconciliation.cjs`, `scripts/cloudrun-db-sync.cjs` | — | GCP offers BAA via Google Cloud HIPAA program |
| **Twilio** | Voice audio, SMS content | ⏳ In progress | Legal vault | `scripts/vertical-pstn-scenarios.cjs`, `services/sms-service.js` | — | Voice + messaging BAA required for PSTN |
| **Retell AI** | Voice transcripts, LLM prompts | ⏳ In progress | Legal vault | `webhooks/retell-websocket.js`, `scripts/verify-retell-webhook.cjs` | — | Confirm transcript retention + subprocessors |
| **Stripe** | Payment metadata (no raw PHI in metadata per Phase 0.2) | ⏳ In progress | Legal vault | `utils/stripe-config.js`, `scripts/setup-stripe-webhook.cjs` | — | BAA for payment processing |
| **Stedi** | Eligibility 270/271 | ⏳ In progress | Legal vault | `npm run test:eval:multilang:stedi-live` (blocked without `STEDI_API_KEY`) | — | X12 may contain member identifiers |
| **Groq** | LLM inference (prompts may include clinical text) | ⏳ In progress | Legal vault | `services/llm-router.js`, Kelly Rails eval harness | — | Confirm zero-retention / BAA tier |
| **Anthropic** | LLM inference (if enabled) | ⏳ In progress | Legal vault | `services/llm-router.js` (`KELLY_DEBUG_ANTHROPIC`) | — | Same as Groq |
| **OpenAI** | OCR / photo-to-bill (if enabled) | ⏳ In progress | Legal vault | `services/ocr-service.js` (if enabled) | — | Restrict to non-PHI or BAA tier |
| **Pinecone** | RAG embeddings (dermatology) | ⏳ In progress | Legal vault | `scripts/populate-code-embeddings.js` | — | Confirm index content classification |
| **LiveKit** | Somo Health video (Phase 9 deferred) | N/A | — | `docs/product/VIDEO_HEALTH.md` | — | Consumer product out of active scope |
| **Firebase Hosting** | Static UI only | N/A | — | `unified-dashboard/firebase.json` | — | No PHI at rest on hosting |
| **Henry Schein / Dentrix Ascend** | PMS sync (appointments, patients) | ⏳ In progress | API Exchange paperwork | `verify:phase3-dentrix` — **blocked on API Exchange approval** | — | Connected Accounts shows MANUAL SYNC interim only |

## Actions

1. **Legal:** Execute or renew BAAs for rows marked ⏳ before scaling PHI traffic beyond pilot.
2. **Engineering:** Do not add new PHI subprocessors without a row in this table.
3. **Ops:** After each signature, update **Last verified** and move status to ✅.
4. **Risk acceptance:** If a vendor cannot sign, record approver name + date in Notes and link leadership email/decision.

## Related templates

- [`templates/CUSTOMER_BAA_TEMPLATE.md`](./templates/CUSTOMER_BAA_TEMPLATE.md)
- [`FRONT_DESK_PHASE0_BAA_CHECKLIST.md`](./FRONT_DESK_PHASE0_BAA_CHECKLIST.md)
