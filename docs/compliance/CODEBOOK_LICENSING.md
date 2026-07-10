# Codebook licensing — AMA CPT, MPFS, ADA CDT

> **Last updated:** 2026-07-10  
> **Tasks:** CODING-FOUNDATION N-01, B-08  
> **Owner:** Legal + Engineering  
> **Status:** Documented gap — commercial AMA CPT and ADA CDT licenses **not yet procured**

## Purpose

Somo stores and retrieves US medical and dental procedure/diagnosis codes in SQLite (`icd10_codes`, `cpt_codes`, `hcpcs_codes`, `cdt_codes`) and uses short descriptions for voice coding, quotes, and claims. This document records **what we ship today**, **copyright boundaries**, and **licensing actions required** before full commercial codebook coverage.

---

## Summary matrix

| Code set | Source in repo | Row count (dev target) | Copyright holder | License status |
|----------|----------------|------------------------|------------------|----------------|
| **ICD-10-CM** | CDC/NCHS FY release (`import-icd10-codes.js`) | ~74k | Public domain (US govt) | OK for storage + display |
| **CPT (as imported)** | CMS **MPFS** RVU files (`import-cpt-codes.js --source mpfs`) | ~17k Medicare PFS subset | AMA (descriptions); CMS distribution under CMS/AMA agreement | **Partial** — MPFS ≠ full AMA CPT |
| **HCPCS Level II** | CMS annual file (`import-hcpcs-codes.js`) | ~9k | Mixed — includes AMA CPT excerpts and ADA CDT excerpts per CMS file notices | **Partial** — follow CMS/AMA and CMS/ADA terms |
| **CDT** | ADA seed + `synthesizeAdaCdtRange()` interim (`import-cdt-codes.js`) | ~9.9k rows @ ~97% synthetic tier-2 | American Dental Association | **Partial** — licensed ADA PDF extraction deferred (B-05); synthetic descriptions for dev/demo only |

---

## AMA CPT vs Medicare Physician Fee Schedule (MPFS)

### What we import

Production path imports CPT **descriptions and codes present in CMS MPFS RVU files** (e.g. `Knowledge/fee-schedules/PPRRVU.csv`, `RVU26A.csv`):

```bash
node scripts/import-cpt-codes.js --source mpfs --file ../Knowledge/fee-schedules/PPRRVU.csv
```

This yields ~17,170 rows — the **Medicare Physician Fee Schedule payable subset**, not the full AMA CPT code set (~10k+ commercial-only and category III codes may be absent).

### Why MPFS is not sufficient alone

| Concern | Detail |
|---------|--------|
| **Coverage gap** | Commercial payers may require CPT codes outside MPFS (e.g. some Category III, payer-specific add-ons). |
| **Description quality** | MPFS uses CMS abbreviations (`Office o/p est low 20 min`). Lay-language phrase maps compensate but do not replace licensed long descriptors. |
| **Copyright** | HCPCS and MPFS file headers state CPT descriptions are used per the **CMS/AMA agreement**; uses outside that agreement may require a separate **AMA CPT license**. |
| **Wrong legacy path** | DHS addendum import (~1,299 rows) is **not** licensed as a substitute and lacks E/M codes — do not use in prod. |

### Required actions (B-08)

| # | Action | Owner | Acceptance |
|---|--------|-------|------------|
| 1 | Confirm with counsel whether MPFS-only storage + voice paraphrase (not verbatim AMA long descriptors in UI) satisfies current product scope | Legal | Written opinion on file |
| 2 | If commercial CPT completeness required, procure **AMA CPT license** (annual) | Legal/Ops | License PDF in secure vault; renewal calendar |
| 3 | Document permitted uses: SQLite storage, embedding text, Pinecone metadata codes-only, claim 837P submission via Stedi | Legal + Eng | This doc § Permitted use |
| 4 | Add annual CPT/MPFS refresh to [CODEBOOK_REFRESH_CALENDAR.md](../Medical%20Coding/CODEBOOK_REFRESH_CALENDAR.md) | Ops | Owner assigned |

### Permitted use (interim, pending counsel sign-off)

Until AMA license is procured, engineering **must**:

- Import CPT descriptions **only** from CMS-distributed MPFS/HCPCS files checked into `Knowledge/`.
- Avoid exporting or reselling raw CPT long descriptions outside the platform.
- Prefer **code + abbreviated description** in operator-facing surfaces; patient-facing copy uses `patient_friendly_summary`, not AMA text.
- Not scrape or redistribute AMA CPT from non-CMS sources.

---

## ADA CDT licensing

### What we import

Dental tenants resolve CDT via phrase map + `cdt_codes` table:

```bash
node scripts/import-cdt-codes.js
```

Seed file: `Knowledge/CDT/cdt-codes-2025.txt`. Full ADA CDT guides under `Knowledge/CDT/` are PDF-only today; machine import of ~900+ codes is track **B-05 / 7.7-EXT**.

### Copyright

CDT is **copyrighted by the American Dental Association**. CMS HCPCS Level II files explicitly reference ADA CDT for the **D-series** dental codes distributed in the federal file. Storage of code + short description for internal coding search likely requires an **ADA CDT license** for:

- Full code set import beyond CMS-excerpted HCPCS rows
- Verbatim long descriptions in embeddings (`code_embeddings` where `code_type='cdt'`)
- Any customer-facing display of CDT descriptors

### Required actions (N-01)

| # | Action | Owner | Acceptance |
|---|--------|-------|------------|
| 1 | Contact ADA licensing for **CDT Annual Code Set** product terms | Legal | Quote + agreement |
| 2 | Decide: CMS HCPCS D-codes only vs full `cdt_codes` table | Product | Documented in [CODING_PATH_MATRIX.md](../Medical%20Coding/CODING_PATH_MATRIX.md) |
| 3 | Until licensed, cap CDT descriptions to CMS-excerpted text or internally authored stubs; flag HITL below 0.65 confidence | Eng | `resolveDentalCdtFromReason` behavior |
| 4 | Add CDT annual refresh to [CODEBOOK_REFRESH_CALENDAR.md](../Medical%20Coding/CODEBOOK_REFRESH_CALENDAR.md) | Ops | Calendar entry |

---

## ICD-10-CM

ICD-10-CM diagnosis codes and descriptions from the **CDC/NCHS annual release** are treated as public domain for US government works. No separate license required. Annual October FY update still requires ops runbook execution.

---

## HCPCS Level II

CMS distributes the annual HCPCS file (effective **January 1**). File layout (`HCPC2026_recordlayout.txt`) reiterates:

- Level I CPT excerpts — CMS/AMA agreement; other uses may violate AMA copyright.
- Level II includes ADA CDT excerpts — joint maintenance per CMS notice.

Import via `import-hcpcs-codes.js`. Same licensing constraints as CPT and CDT sections above apply to **verbatim descriptions**, not necessarily to **code values** used on claims.

---

## Engineering references

| Asset | Path |
|-------|------|
| CPT MPFS import | `middleware-platform/scripts/import-cpt-codes.js` |
| HCPCS import | `middleware-platform/scripts/import-hcpcs-codes.js` |
| CDT import | `middleware-platform/scripts/import-cdt-codes.js` |
| Parity gate | `middleware-platform/scripts/verify-prod-codebook.cjs` |
| Architecture | [ARCHITECTURE.md](../Medical%20Coding/ARCHITECTURE.md) § CPT source |
| Agentic finance review | [AGENTIC_FINANCE_REVIEW.md](../architecture/AGENTIC_FINANCE_REVIEW.md) |

---

## Review cadence

| Event | Review |
|-------|--------|
| New code set or import source | Legal + Eng before merge |
| Annual ICD / HCPCS / MPFS / CDT refresh | Licensing still valid; see refresh calendar |
| New tenant type (dental commercial, hospital outpatient) | Re-evaluate CPT/CDT completeness needs |
| Customer contract requiring "full CPT" | Block until AMA license on file |

**Next review due:** 2026-10-01 (before FY2026 ICD import).
