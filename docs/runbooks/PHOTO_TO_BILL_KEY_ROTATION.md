# Photo-to-bill — key rotation runbook

**Status:** Open before public prod ([`PHOTO_TO_BILL_EXTRACTION_TODOS.md`](../../todos/pending/PHOTO_TO_BILL_EXTRACTION_TODOS.md))

## 1. OpenAI

1. Create new API key in OpenAI dashboard.
2. Update `OPENAI_API_KEY` in Cloud Run / Azure App Service / local `.env` (never commit).
3. Revoke the previously exposed key.
4. Smoke: `cd middleware-platform && npm run test -- __tests__/patient-billing-extract.test.js` (if present) or manual OCR upload.

## 2. Google service account (GCS billing storage)

1. Create new service account key or use workload identity on GCP.
2. Update `GOOGLE_SERVICE_ACCOUNT_KEY` or workload binding.
3. Revoke old key material in GCP IAM.
4. Smoke: upload test document via patient app capture flow.

## 3. Rollout gates

- Internal → beta → public with `npm run billing:test-gate` green.
- Physical device: photo → upload → OCR → timeline.

## 4. Env templates

Update `.env.example` with placeholder names only (no secrets).
