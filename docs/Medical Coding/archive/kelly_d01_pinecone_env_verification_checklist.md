# D-01 — Pinecone Cloud Run Env Verification Checklist

**Purpose:** Close `D-01` — confirm `PINECONE_API_KEY`, `PINECONE_INDEX_HOST`, and `RAG_API_URL=disabled` are correctly bound on the prod Cloud Run service, and that this is *proven*, not assumed.

---

## Step 1 — Confirm secrets are bound (not just declared)

- [ ] Run: `gcloud run services describe somo-middleware --region us-central1 --format="value(spec.template.spec.containers[0].env)"`
- [ ] Confirm `PINECONE_API_KEY` and `PINECONE_INDEX_HOST` appear as **secret references**, not plaintext env vars.
- [ ] Confirm `RAG_API_URL` is literally the string `disabled` (a common failure mode is an empty string or unset var, which some code paths treat differently than the string `"disabled"`).

## Step 2 — Run the deploy-gate verification script

- [ ] Run `verify-pinecone-deploy-env.cjs` against the prod service (per `DP-01` in the execution plan).
- [ ] Paste or save the full output — "it ran" is not the same as "it passed."
- [ ] Confirm the script's exit code is 0, not just that it printed something that looks like success.

## Step 3 — Confirm live retrieval, not just connectivity

- [ ] Trigger a real (or synthetic) derm-specialty call end to end.
- [ ] Pull the resulting `triage_rag_results` row and confirm `remote_source: pinecone` — this is the actual proof Pinecone was queried and returned results, not just that the API key is valid.
- [ ] Cross-check the `verify-live-spine` / `verify-triage-spine` staging run mentioned in `K-06` was actually on Pinecone, and re-run against **prod** if it was only ever run on staging.

## Step 4 — Confirm tenant isolation before calling this "safe," not just "connected"

- [ ] Per `MT-03` in the execution plan: confirm `matchesTenantMetadata()` is actually wired into `pinecone-code-metadata-client.js` in the prod path, not just present in the codebase.
- [ ] Run or request the Tenant A ≠ Tenant B integration test result — this is a separate concern from "the env vars work" and shouldn't be skipped just because D-01 is scoped narrowly to env binding.

## Step 5 — Sign off

- [ ] All four steps above pass.
- [ ] `D-01` status changed from `operator_pending` → `done` in the backlog, with a link to the verification script output as evidence.

**Verified by:** _______________ **Date:** _______________
**Script output / evidence link:** _______________
