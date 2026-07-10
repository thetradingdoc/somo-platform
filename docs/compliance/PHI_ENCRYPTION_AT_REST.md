# PHI encryption at rest (H-H1)

**Last updated:** 2026-07-05  
**Task:** Production plan Phase 12.1  
**Status:** Evaluation complete — **interim path: GCP-managed encryption**; SQLCipher deferred

## Current state

| Store | Location | Encryption today |
|-------|----------|------------------|
| Primary SQLite (dev / GCS mirror) | `middleware-platform/var/db/*.db`, GCS `middleware-*.db` | **At rest via GCS default encryption** (Google-managed keys) when uploaded |
| Cloud SQL Postgres (staging/prod path) | `somo-callsomo` Cloud SQL | **Google default encryption at rest** (AES-256) |
| Secrets | GCP Secret Manager | Encrypted at rest by platform |
| Backups | GCS lifecycle buckets | Same as object storage policy |

Application code does **not** currently use SQLCipher or field-level encryption for PHI columns. PHI boundaries are enforced by access control, redaction, retention jobs, and HIPAA access logging (Phase 0).

## Options evaluated

### A — SQLCipher on SQLite files

**Pros:** File-level encryption without migrating off SQLite; works for local dev parity.  
**Cons:** Requires native `better-sqlite3` + SQLCipher build on every deploy target; key rotation and multi-instance Cloud Run mounts are operationally heavy; does not address Postgres-primary path.

**Verdict:** **Defer** until counsel confirms file-encryption requirement *in addition to* cloud provider encryption. Suitable only if production remains SQLite-primary long term.

### B — Postgres (Cloud SQL) as PHI primary

**Pros:** Aligns with `POSTGRES_PRIMARY` direction; GCP BAA covers default encryption; IAM + VPC controls; point-in-time recovery.  
**Cons:** Migration effort (dual-write today); application must finish read-path cutover (CR-066 / Phase 7.1).

**Verdict:** **Recommended target** for production PHI tables (`triage_sessions`, `kelly_conversation_history`, `fhir_patients`, `voice_call_log`, eligibility).

### C — Application-level column encryption

**Pros:** Defense in depth for highest-sensitivity columns.  
**Cons:** Key management complexity; breaks full-text search; high engineering cost.

**Verdict:** **Not recommended** for v1 — pursue only if risk assessment mandates beyond cloud defaults.

## Decision (interim)

1. **Production:** Rely on **GCP default encryption at rest** for Cloud SQL and GCS (documented in [`VENDOR_BAA_TRACKER.md`](./VENDOR_BAA_TRACKER.md)).
2. **Roadmap:** Complete Postgres-primary cutover; retire GCS SQLite as authoritative PHI store.
3. **SQLCipher:** Revisit if a tenant requires exportable encrypted SQLite artifacts or if production stays SQLite-primary past Q4 2026.

## Verification checklist

```bash
# Cloud SQL encryption (always enabled — confirm instance exists)
gcloud sql instances describe <INSTANCE> --project=somo-callsomo --format='value(settings.dataDiskType,settings.storageAutoResize)'

# GCS bucket default encryption
gcloud storage buckets describe gs://<BUCKET> --format='json(encryption.defaultKmsKeyName)'

# No SQLCipher in runtime deps
cd middleware-platform && npm ls sqlcipher better-sqlite3 2>/dev/null | head
```

**Pass criteria:** Cloud SQL + GCS buckets show platform encryption; no plaintext PHI in object names; retention job (`cleanup-retention.js`) runs on schedule.

## Related

- [`PHI_BOUNDARY_DIAGRAM.md`](./PHI_BOUNDARY_DIAGRAM.md)
- [`runbooks/TENANT_OFFBOARDING.md`](../runbooks/TENANT_OFFBOARDING.md)
- [`Database/OPERATIONS.md`](../Database/OPERATIONS.md)
