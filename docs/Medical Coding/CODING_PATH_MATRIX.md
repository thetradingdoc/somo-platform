# Coding path matrix

> **Last updated:** 2026-07-10  
> **SSOT:** [`resolve-visit-codes.js`](../../middleware-platform/services/resolve-visit-codes.js)  
> **Policy defaults:** [`tenant-policy.js`](../../middleware-platform/services/conversation-mode/tenant-policy.js)

## Product decisions (CODING-FOUNDATION)

| Decision | Choice |
|----------|--------|
| `healthcare_clinic` default triage | **Keep `disabled`** — admin phrase map is the primary medical path |
| Dental remote RAG | **No Pinecone** — phrase map + CDT SQL + CDT embeddings only |

## Path selection

| `use_case` | Default `triage_policy` | Coding path | Resolver |
|------------|-------------------------|-------------|----------|
| `dental` | `disabled` | `admin_dental` | `resolveDentalCdtFromReason` → CDT |
| `healthcare_clinic` | `disabled` | `admin_clinic` | `CLINIC_TRIGGER_MAP` → E/M CPT |
| `small_business` | `disabled` | `admin_clinic` | Same as healthcare_clinic |
| `dermatology` | `required` | `rag` | OPQRST → `run_triage_rag` → dual-source |
| Any | `conditional` | See triggers below | Router may escalate to `rag` |
| Wellness / no symptoms | any | `preventive` | `preventive-visit-spine.js` Z00 + 99395 |

## Conditional → RAG triggers (`triage_policy: conditional`)

Force full RAG when visit reason matches:

- Symptom language (pain, rash, fever, cough, nausea, etc.)
- Clinical copay intent tied to a condition (“copay for my back pain”)
- Specialty tenants with `required` override in `policy_json`

Otherwise: admin path for front-desk booking tenants.

## Channel RAG asymmetry (voice vs chat)

| Setting | Voice | Chat |
|---------|-------|------|
| HyDE | **Off** | On (default) |
| Remote timeout | 2000ms (`VOICE_REMOTE_RAG_TIMEOUT_MS`) | 8000ms (`REMOTE_RAG_TIMEOUT_MS`) |
| Source | [`voice-rag-config.js`](../../middleware-platform/services/voice-rag-config.js) | same module |

Voice trades recall for turn latency. Nightly `eval:coding:prod` runs full stack.

## Dental retrieval stack (no Pinecone)

1. Phrase map — [`Knowledge/rules/dental-phrase-map.json`](../../Knowledge/rules/dental-phrase-map.json)
2. CDT SQL search — `searchCdtCodes` in `medical-codes.js`
3. CDT embeddings — `code_embeddings` where `code_type='cdt'`
4. Below confidence 0.65 → HITL or `CODE_NOT_IN_STARTER_SET` deferral

## ICD-10-PCS

**Out of Kelly voice scope.** PCS rows exist for parity only; voice/quote path uses ICD-10-CM + CPT/HCPCS/CDT.
