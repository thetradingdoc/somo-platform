# Commerce PSTN Replay 100 — Validation Report

**Generated:** 2026-06-24T14:43:06.531Z
**Fixture version:** 2026-06-24T14:43:06.458Z
**Git SHA:** 6cdfda9

**Status:** PASS

---

## Acceptance criteria (plan)

| Criterion | Status |
|-----------|--------|
| 100 entries in commerce-pstn-replay-100.json | PASS |
| Min turns (voice ≥12, chat ≥14) | PASS |
| Every turn has text for both speakers | PASS |
| Zero bracket placeholders in caller text | PASS (0 found) |
| All 34 functions meet minimum call counts | PASS |
| commerce-pstn-function-coverage.json present | PASS |
| TRANSCRIPT_BOOK.md generated | PASS |

---

## Channel split

| Channel | Count | Plan overview note |
|---------|-------|-------------------|
| voice | 81 | Plan overview said 85; block tables sum to 81 |
| chat | 19 | Plan overview said 15; block tables sum to 19 |
| **total** | **100** | |

---

## Per-block summary

| Block | Calls | Voice | Chat | Avg turns |
|-------|-------|-------|------|-----------|
| Block 1: Voice supplement purchase | 15 | 15 | 0 | 14.3 |
| Block 2: Chat supplement purchase | 15 | 0 | 15 | 15.5 |
| Block 3: Voice appointment booking | 18 | 18 | 0 | 15.3 |
| Block 4: Cancel / reschedule / outbound | 12 | 12 | 0 | 12.3 |
| Block 5: Appointment payments | 8 | 8 | 0 | 13.3 |
| Block 6: Complaints / vent / handoff | 12 | 11 | 1 | 12.3 |
| Block 7: Multi-intent / edge / capstone | 20 | 17 | 3 | 15.3 |

---

## Function coverage

| Function | Actual | Required | Status |
|----------|--------|----------|--------|
| `add_to_cart` | 8 | 4 | OK |
| `cancel_appointment` | 4 | 4 | OK |
| `clear_cart` | 3 | 2 | OK |
| `collect_insurance` | 5 | 3 | OK |
| `confirm_appointment` | 2 | 2 | OK |
| `create_appointment_checkout` | 6 | 4 | OK |
| `create_checkout` | 24 | 8 | OK |
| `end_call` | 100 | 100 | OK |
| `get_available_payment_methods` | 2 | 2 | OK |
| `get_available_slots` | 24 | 4 | OK |
| `get_cart` | 5 | 3 | OK |
| `get_checkout_payment_status` | 2 | 2 | OK |
| `get_order_tracking` | 2 | 2 | OK |
| `get_patient_claims` | 1 | 1 | OK |
| `get_patient_intake_status` | 2 | 1 | OK |
| `get_product_quote` | 10 | 4 | OK |
| `get_triage_session` | 1 | 1 | OK |
| `patient_intake` | 2 | 2 | OK |
| `prepare_commerce_checkout` | 17 | 5 | OK |
| `remove_cart_item` | 2 | 2 | OK |
| `request_patient_payment` | 3 | 2 | OK |
| `reschedule_appointment` | 3 | 3 | OK |
| `run_triage_rag` | 2 | 2 | OK |
| `save_shipping_address` | 2 | 2 | OK |
| `schedule_appointment` | 20 | 6 | OK |
| `search_appointments` | 7 | 2 | OK |
| `search_products` | 26 | 8 | OK |
| `send_commerce_verification_code` | 3 | 2 | OK |
| `send_document_upload_link` | 1 | 1 | OK |
| `store_triage_opqrst` | 2 | 2 | OK |
| `transfer_call` | 16 | 4 | OK |
| `update_cart_item` | 2 | 2 | OK |
| `verify_checkout_code` | 3 | 3 | OK |
| `verify_commerce_code` | 3 | 2 | OK |

---

## Artifact paths

| Artifact | Path |
|----------|------|
| Replay pack | `middleware-platform/tests/fixtures/commerce-pstn-replay-100.json` |
| Function coverage | `middleware-platform/tests/fixtures/commerce-pstn-function-coverage.json` |
| Call schema | `middleware-platform/tests/fixtures/commerce-pstn-replay-schema.json` |
| Transcript book | `docs/qa/commerce-pstn-replay-100-TRANSCRIPT_BOOK.md` |
| This report | `docs/qa/commerce-pstn-replay-100-VALIDATION_REPORT.md` |
