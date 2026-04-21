# Deferred / out-of-scope payor-related datasets

This note closes the loop on sources that **ship with NPPES** or appear on **data.cms.gov** but are **not** loaded into the middleware SQLite payor ER tables today.

## NPPES companion CSVs (`pl_pfile`, `othername_pfile`, …)

- **Status:** Not ingested. No `payor_source_records` or downstream ER use is defined for these files yet.
- **When to add:** After a product decision ties each file to a concrete feature (aliases, practice locations, etc.) and a target schema.

## Distinct “provider-data” bulk on data.cms.gov (non-NPPES)

- **Status:** No separate importer. **Provider directory** in this repo is driven by **NPPES `npidata`** → `nppes_directory_providers` (and provider registry flows), not by a second CMS catalog.
- **When to add:** Only if a specific dataset is required beyond NPPES; then add a source contract (see `PAYOR_SOURCE_CONTRACTS.md`), download location, parser, and table — and document how it relates (or does not relate) to `nppes_directory_providers`.
