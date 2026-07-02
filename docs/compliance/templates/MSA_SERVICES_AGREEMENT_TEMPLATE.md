# Master Services Agreement — Kelly Front Desk (Template)

**Status:** Template only — have counsel review before use.  
**Version:** 1.0 — 2026-06-30

This MSA is separate from the [Business Associate Agreement](./CUSTOMER_BAA_TEMPLATE.md). Both are required for healthcare customers processing PHI.

---

## 1. Services

Somo provides an AI front desk agent ("Kelly") including, as subscribed:

- Inbound voice answering and call routing
- Appointment scheduling (Somo calendar and/or connected PMS)
- Insurance eligibility verification (clearinghouse)
- Copay quote and payment link delivery
- Provider dashboard and usage reporting

**Service tier:** `[Starter | Practice | Clinic Pro]` per [plan-catalog.json](../../../middleware-platform/config/plan-catalog.json).

## 2. Subscription and fees

| Item | Terms |
|------|-------|
| Monthly subscription | Per tier price at signup |
| Included voice minutes | Per billing cycle (see plan catalog) |
| Included eligibility checks | Per billing cycle; overage per catalog after Day 60+ general release |
| Top-up packs | Optional minute packs per catalog |
| Pilot pricing | Flat Practice fee may apply during pilot; eligibility COGS absorbed per pilot checklist |

Payment via Stripe. Past-due accounts may have voice services suspended per [billing-access](../../../middleware-platform/services/billing-access.js) rules.

## 3. Customer responsibilities

- Provide accurate practice information (NPI, transfer number, hours).
- Configure call forwarding to Somo-provided number.
- Maintain BAAs and patient consents as required by law.
- Designate an office administrator for account access.

## 4. Data and privacy

- PHI processing governed by the BAA.
- Customer may request PHI export on offboarding per Somo retention policy.
- Somo may retain de-identified usage metrics for product improvement.

## 5. Term and termination

- Month-to-month unless annual agreement specified.
- Either party may terminate per subscription terms.
- Upon termination: export window `[30]` days; then deletion per offboarding runbook.

## 6. Limitation of liability

`[STANDARD LIMITATION — COUNSEL TO DRAFT]`

## 7. Signatures

| Somo | Customer |
|------|----------|
| Name: | Practice: |
| Title: | Title: |
| Date: | Date: |
