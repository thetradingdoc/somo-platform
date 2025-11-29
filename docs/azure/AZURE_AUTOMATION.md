# Daily Medical Receptionist Automation

This playbook wires the new `run-medical-receptionist-search.js` helper into an Azure-scheduled job so we always capture fresh medical receptionist postings without blowing through the 250-call monthly limit.

## 1. Prerequisites

- `ADMIN_PORTAL_SECRET` set in the middleware `.env`
- Production `API_BASE_URL` (e.g. `https://doclittle.site`)
- Optional overrides:
  - `MEDICAL_RECEPTIONIST_LOCATION` (defaults to `US,NY`)
  - `MEDICAL_RECEPTIONIST_DAYS` (defaults to `1` → “today”)
  - `ADMIN_PORTAL_BASE_URL` if the admin endpoints live on a different domain
- `INTERNAL_JOB_TOKEN` (optional): when set, include the same value in the job’s `X-Internal-Job-Token` header so the script bypasses the global rate limiter.

## 2. Manual Run (Sanity Check)

```bash
cd middleware-platform
npm run search:medical
```

What happens:
1. Logs into `/api/admin/session` with `ADMIN_PORTAL_SECRET`
2. Hits `/api/admin/leads/insights/medical-receptionist?location=...&days=...`
3. Saves the lead via `/api/admin/leads/save`
4. Attempts contact extraction if the listing lacked phone/email

All output is printed with timestamps so it’s safe to stream into Azure logs.

## 3. Azure Container Apps Job

Create a lightweight job that runs the script once per day:

```bash
# Build image that contains the middleware repo (or mount via volume)
# Example uses the public `Node 22` image plus startup command.

az containerapp job create \
  --name medical-receptionist-daily \
  --resource-group <RG_NAME> \
  --environment <CONTAINER_APPS_ENV> \
  --trigger-type Schedule \
  --cron-expression "50 16 * * *" \  # 11:50 PM NYC (adjust to UTC)
  --replica-timeout 900 \
  --replica-retry-limit 1 \
  --replica-completion-count 1 \
  --parallelism 1 \
  --image mcr.microsoft.com/devcontainers/javascript-node:22 \
  --env-vars \
      ADMIN_PORTAL_SECRET=<secret> \
      ADMIN_PORTAL_BASE_URL=https://doclittle.site \
      MEDICAL_RECEPTIONIST_LOCATION=US,NY \
      MEDICAL_RECEPTIONIST_DAYS=1 \
  --command "bash" \
  --args "-lc" "cd /workspace/middleware-platform && npm install --omit=dev && npm run search:medical"
```

> Tip: Replace `/workspace/middleware-platform` with the actual path inside the image or bake the repo into a custom container so the job only runs the script.

## 4. Monitoring

- The script exits with `0` on success and `1` on failure. Azure Container Apps will flag failures automatically; add alerting on repeated failures.
- Logs show every step (`login`, `insights`, `save`, `extract`) with timestamps using the `[medical-receptionist-daily]` prefix for easy filtering.
- Since we only call the insights endpoint once per day, we remain well inside the 250-call/month ceiling.

## 5. Extending

- To target additional geographies, chain multiple jobs with different `MEDICAL_RECEPTIONIST_LOCATION` values.
- If you’d like an email/slack notification, wrap the script with another process that consumes the JSON log and routes the summary to your notification channel.

