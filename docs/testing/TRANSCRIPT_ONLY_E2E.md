# Phase 10 Task 63 — Transcript-only path: end-to-end test

Verify that when a patient completes a consult with **no document uploads**, the DiagnosticReport is created with the **TRANSCRIPT-ONLY REPORT** header and **no hallucinated lab/imaging findings**.

## Prerequisites

- Middleware running with `CASE_REPORT_SERVICE_URL` and `CASE_REPORT_SERVICE_TOKEN` set
- Case report service running (Phase 6)
- JWT auth optional for local test

## Manual test steps

1. **Book appointment** (voice or dashboard) for a test patient. Do **not** send upload link or upload any documents.
2. **Complete the consult** (e.g. end video session so that `store_fhir` runs and `trigger_case_report` fires).
3. **Wait** for case report callback (or run case report service with transcript-only input).
4. **Verify**:
   - `fhir_diagnostic_reports` has a row for that encounter with `status = 'completed'`.
   - `case_report_text` starts with `# TRANSCRIPT-ONLY REPORT` and contains no fabricated lab values or imaging findings.
   - No differentials generated from empty visual/lab data (per Phase 6 Task 42).

## Automated check (case report service)

The case report service (Phase 6) implements the transcript-only guard: when `signal_analysis` is empty and there are no visual findings, it runs `_run_transcript_only_path()`, which:

- Sets header: `# TRANSCRIPT-ONLY REPORT`
- Adds: *"(No imaging or lab data provided; findings from transcript only.)"*
- Does not generate differentials from empty data.

To assert in tests: POST to case report service with `file_paths: []` and a transcript; expect `report_markdown` to contain `TRANSCRIPT-ONLY REPORT` and no lab/imaging conclusions.

## Middleware verification query

After callback, check the report content:

```sql
SELECT id, job_id, status, substr(case_report_text, 1, 200) AS report_preview
FROM fhir_diagnostic_reports
WHERE encounter_id = ? AND status = 'completed'
ORDER BY created_at DESC LIMIT 1;
```

Expect `report_preview` to start with `# TRANSCRIPT-ONLY REPORT`.
