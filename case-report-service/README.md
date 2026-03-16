# Case report service (Phase 6)

Containerised Python service that runs the 6-layer case report pipeline (refactor of `patient_rag_pipeline_v3.2`). Consumes transcript + optional files from Azure Blob (or local), produces report markdown and reasoning chain, and POSTs the result to the middleware callback URL.

## Endpoints

- **GET /health** — `{ "status": "ok", "version", "storage_backend" }`
- **POST /report** — Body: `job_id`, `patient_id`, `encounter_id`, `appointment_id?`, `transcript?`, `transcript_endpoint?`, `transcript_endpoint_token?`, `prior_report_id?`, `callback_url`, `callback_token`. Returns `202 { "job_id", "status": "queued" }`.

## Config (env)

| Variable | Description |
|----------|-------------|
| `STORAGE_BACKEND` | `azure_blob` or `local` |
| `AZURE_STORAGE_CONNECTION_STRING` | Required for `azure_blob` |
| `LOCAL_STORAGE_BASE` | Base path for `local` (default current dir) |
| `SERVICE_VERSION` | Returned in `/health` |

## Run locally

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## Docker

```bash
docker build -t case-report-service -f Dockerfile .
docker run -p 8080:8080 -e STORAGE_BACKEND=local case-report-service
```

## Deployment

See [docs/deployment/CASE_REPORT_SERVICE_ACI.md](../docs/deployment/CASE_REPORT_SERVICE_ACI.md) for Azure Container Instance.
