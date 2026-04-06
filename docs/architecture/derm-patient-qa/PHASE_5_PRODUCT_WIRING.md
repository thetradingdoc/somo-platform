# Phase 5 — Product / API wiring

## Feature flag

| Env | Meaning |
|--------|--------|
| **`DERM_EDUCATION_PIPELINE_ENABLED`** | `true` to enable the full pipeline, `/api/patient/derm-qa`, Step10 `inputs.derm_patient_qa`, and Kelly tool `run_derm_patient_qa`. |

Optional:

| Env | Meaning |
|--------|--------|
| **`DERM_QA_SKIP_LLM`** | `true` / `1` — run compose + retrieval only; no LLM answer (returns `answer_text: null`). |
| **`DERM_QA_LLM_MODEL`** | Groq model (default `llama-3.3-70b-versatile` when `GROQ_API_KEY` set). |
| **`DERM_QA_OPENAI_MODEL`** | OpenAI model when using `OPENAI_API_KEY` (default `gpt-4o-mini`). |

## Surfaces

### 1. `POST /api/patient/derm-qa`

Same auth as other patient `/api/patient/derm-qa/*` routes: `apiLimiter`, `requirePatientSession`, `requireCsrfForCookieAuth`, JSON body.

Body: same shape as compose (`message`, `imageCaption`, `imagePresent`, `triage`, `retrieval`, `skip_retrieve`, `filters`, `debug`, **`skip_llm`**).

Returns `runDermPatientQAPipeline` result: `compose`, `answer_text`, `llm_used`, `success`.

When the flag is off, returns **200** with `success: false` and `error: derm_education_pipeline_disabled` (client-friendly).

### 2. Step10 (`invokeStep10`)

If `inputs.derm_patient_qa` is an object and the pipeline flag is on, the graph **short-circuits** to the derm pipeline (runs even when `STEP10_GRAPH_ENABLED` is false). Payload fields mirror the HTTP body (`message`, `imageCaption` / `image_caption`, etc.).

Response includes `state.summary` (answer text), `derm_patient_qa` (full pipeline output), `stub: false`.

### 3. Kelly / voice (`run_derm_patient_qa`)

Registered when **`DERM_EDUCATION_PIPELINE_ENABLED`** is true at process start. `KellyToolExecutor` calls `runDermPatientQAPipeline` in-process. Result includes **`answer`** (alias of `answer_text`) for voice/chat consumption.

## Implementation

- `middleware-platform/services/derm-patient-qa-pipeline.js` — `isDermEducationPipelineEnabled`, `runDermPatientQAPipeline`
- `middleware-platform/server.js` — route registration
- `middleware-platform/services/step10-graph.js` — early branch in `invokeStep10`
- `middleware-platform/services/kelly-agent-service.js` — tool definition
- `middleware-platform/services/kelly-tool-executor.js` — `run_derm_patient_qa` case

## Production E2E — Kelly (same path as patient triage chat)

`POST /api/patient/triage/message` uses `KellyAgentService.processTurn` with **full** tool list when not in commerce-checkout mode. The derm tool is included only when `DERM_EDUCATION_PIPELINE_ENABLED=true` **at process startup** (restart middleware after changing env).

### In-process Kelly E2E (recommended for CI / dev)

Runs the **same** `processTurn` code as the server (no HTTP cookies):

```bash
cd middleware-platform
export DERM_EDUCATION_PIPELINE_ENABLED=true
export DERM_QA_E2E_LOG=1
# Optional: skip LLM inside derm pipeline only (Kelly still calls the primary LLM for tool turns)
export DERM_QA_SKIP_LLM=true
npm run test:e2e-kelly-derm
```

Requires at least one of `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`. Set `DEFAULT_CLINIC_ID` (or `CLINIC_ID=...`) to match your DB.

When the model calls `run_derm_patient_qa`, the executor logs one line:

`[DERM_QA_E2E] {"tool":"run_derm_patient_qa",...}`

Enable broader tool tracing with `DERM_QA_TOOL_LOG=true` (same log line).

### HTTP smoke (middleware must be listening)

```bash
MIDDLEWARE_BASE_URL=http://127.0.0.1:4000 npm run test:e2e-middleware-smoke
```

Expect `GET /health` OK and patient routes **401/403** without a session cookie.

Authenticated HTTP tests: obtain a patient session (e.g. demo login flow), then `POST /api/patient/triage/message` or `POST /api/patient/derm-qa` with the session cookie and CSRF as required by your deployment.
