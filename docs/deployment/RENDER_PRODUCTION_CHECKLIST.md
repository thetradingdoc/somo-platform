# Render production checklist (`api.callsomo.com`)

Apply these in the **middleware** Render service environment before live claim submit.

## Required env vars

| Variable | Value | Why |
|----------|--------|-----|
| `STEDI_CLAIM_SUBMISSION_MODE` | `professional` | 837P `professionalclaims` (not institutional 837I) |
| `SEMANTIC_SEARCH_ENABLED` | `true` | Voice + local coding use hybrid semantic search over `code_embeddings` |
| `RAG_API_URL` | `disabled` | Use live Pinecone metadata (`PINECONE_*`); do **not** leave unset (old default was `localhost:4000`) |
| `REMOTE_RAG_TIMEOUT_MS` | `2000` | Cap Pinecone/remote leg for `suggest_codes_from_symptoms` (3s tool budget) |
| `STEDI_WEBHOOK_SECRET` | (from Stedi dashboard) | HMAC verification on `/webhooks/stedi/claim-status` |

Also set: `OPENAI_API_KEY`, `STEDI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX_HOST` as in dev.

**Production DB:** Run MPFS CPT import + embeddings on prod before go-live — see [PROD_DB_PARITY.md](./PROD_DB_PARITY.md). Verify with `npm run verify:prod-codebook` on the prod host.

## Stedi dashboard (manual)

1. [Stedi](https://www.stedi.com/) → webhooks → add endpoint:
   - `https://api.callsomo.com/webhooks/stedi/claim-status`
2. Copy signing secret into Render as `STEDI_WEBHOOK_SECRET`.
3. Redeploy middleware after env changes.

## Verify after deploy

```bash
# Health (replace host if different)
curl -s https://api.callsomo.com/health

# Logs: must NOT show institutional Stedi warning on startup
```

Optional on prod host:

```bash
node scripts/poll-claim-statuses.cjs --hours 24
node scripts/resubmit-telehealth-claims.cjs          # dry-run first
node scripts/resubmit-telehealth-claims.cjs --execute  # only after 837P + webhook live
```

## Production DB parity

Dev SQLite already has:

- 84,565 `code_embeddings`
- 15,272 `fee_schedules` (MPFS)
- 1.76M `provider_taxonomy_links` from `nppes_directory`

Replicate on production DB (dump/restore or re-run scripts in [MEDICAL_CODEBOOK_SETUP.md](./MEDICAL_CODEBOOK_SETUP.md)):

```bash
npm run embeddings:daemon
node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv
npm run payor:npi-dedup-directory
```
