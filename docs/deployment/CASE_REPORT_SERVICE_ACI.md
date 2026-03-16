# Case report service — Azure Container Instance (Phase 6 Task 50)

Deploy the case report service as an Azure Container Instance: 1 vCPU, 2 GB RAM, always-on, restart policy Always.

## Requirements

- Azure CLI logged in (`az login`)
- Resource group and container registry (or use public image from ACR/other)

## Env vars (set in ACI)

| Variable | Description |
|----------|-------------|
| `AZURE_STORAGE_CONNECTION_STRING` | For blob reads under `patient-uploads` |
| `OPENAI_API_KEY` | For pipeline (if layer logic uses OpenAI) |
| `PINECONE_API_KEY` | For RAG (if layer logic uses Pinecone) |
| `SERVICE_TOKEN` | Optional service auth |
| `STORAGE_BACKEND` | `azure_blob` or `local` |

## Example: deploy with Azure CLI

```bash
# Build and push image (example ACR)
az acr build --registry <your-acr> --image case-report-service:latest -f case-report-service/Dockerfile .

# Create ACI (1 vCPU, 2 GB RAM, always restart)
az container create \
  --resource-group <rg> \
  --name case-report-service \
  --image <your-acr>.azurecr.io/case-report-service:latest \
  --cpu 1 \
  --memory 2 \
  --ports 8080 \
  --restart-policy Always \
  --environment-variables \
    STORAGE_BACKEND=azure_blob \
    SERVICE_VERSION=0.1.0 \
  --secure-environment-variables \
    AZURE_STORAGE_CONNECTION_STRING="<connection-string>" \
    OPENAI_API_KEY="<key>" \
    PINECONE_API_KEY="<key>"

# Expose via LB or use private ACI + VNet integration
az container show --resource-group <rg> --name case-report-service --query "ipAddress.fqdn" -o tsv
```

## Health check

- **GET /health** → `{ "status": "ok", "version": "...", "storage_backend": "azure_blob" }`
- **POST /report** → `202 { "job_id": "...", "status": "queued" }`

## Middleware integration

Middleware triggers the service with:

- `POST {CASE_REPORT_SERVICE_URL}/report` with body: `job_id`, `patient_id`, `encounter_id`, `appointment_id`, `transcript_endpoint`, `transcript_endpoint_token`, `prior_report_id`, `callback_url`, `callback_token`.
- Service processes in background and POSTs result to `callback_url` with `X-Callback-Token: <callback_token>`.
