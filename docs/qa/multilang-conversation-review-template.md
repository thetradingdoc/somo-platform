# Multilang conversation human review

Native-speaker review for ES/RU scenarios after `npm run test:eval:multilang`.

## CSV schema (`docs/qa/reviews/multilang-YYYY-MM-DD.csv`)

| Column | Description |
|--------|-------------|
| `scenario_id` | e.g. `ES-2-copay` or `_meta` |
| `reviewer` | Name / role |
| `reviewed_at` | ISO date |
| `tone_score` | 1–5 |
| `naturalness_score` | 1–5 |
| `notes` | Free text |
| `ship_ok` | 1 = ok for pilot |
| `summary_hash` | Copy from `test-results/multilang-conversation-eval/_summary.json` `registry_hash` (_meta row only) |

## Gate

```bash
npm run verify:multilang-human-review
STRICT=1 npm run verify:multilang-human-review
```

Wired into `verify:phase4-pilot` for ES/RU pilot sign-off (not default CI).

Automated PASS on tool calls does **not** imply language quality sign-off.

## Automated vs human criteria (K5)

| Criterion | Automated (`CONVERSATION_EVAL_STRICT`) | Human CSV |
|-----------|----------------------------------------|-----------|
| Expected tools / forbidden tools | Yes | No |
| Reschedule (`reschedule_appointment` or legacy cancel+schedule) | Yes | No |
| AI disclosure in call language (EN/ES/RU locale) | Yes | No |
| Dashboard disposition (`lookupSessionEnrichment`) | Yes — `disposition_hook_missing` if no events | No |
| PHI over-exposure (SSN, full DOB, card PAN, full card solicit) | Yes | No |
| Reply–tool coherence (`checkReplyToolCoherence`) | Yes | No |
| Hard copay dollar in reply (`checkHardCopaySpoken`) | Yes on copay scenarios | No |
| Reply locale (`checkReplyLocale`) | Yes for ES/RU | No |
| Payment link (`request_patient_payment` + `copay_payment` tag) | Yes — `npm run test:eval:multilang:payment` | No |
| Copay desk parity (`assertSessionCopayParity`) | Yes when quote exists | No |
| ES/RU tone / naturalness | No | Yes (1–5 scores) |
| ZH handoff | Yes (`forceLanguageHandoff`) | No (see `zh-mandarin-product-gate.md`) |

Vacuous PASS is blocked: scenarios with zero actionable assertions fail with `assertion_vacuous`.
