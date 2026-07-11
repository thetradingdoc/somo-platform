# Kelly — Coding & Copay: Consolidated Master Execution Plan

**Reconciled from:** `CODING-FOUNDATION` backlog (Tracks A–N), `Medical Coding & Payment Foundation` execution plan (Phases 1–7 / MT–PY), and the `Kelly — Coding & Copay Architecture` brief.
**Prepared:** 2026-07-10 · **Owner:** Jay · **Status:** Planning artifact — no code changed

---

## 0. Read this first — a conflict between your own docs

Before anything else on this plan gets scheduled, resolve this discrepancy. It's the highest-trust item in the whole program because it determines whether Kelly ever quotes a **wrong dollar figure** to a patient.

| Source | Claim |
|---|---|
| Backlog epic header | "**Out of epic:** Dollar-resolution precedence hotfix (separate)" |
| Backlog Track M, `M-01` | Status **done** — "Confirm `plan_rules` wins over simulate after hotfix" — `simulate-eligibility-precedence.test.js` |
| Architecture PDF, §2 and Fix #1 | "`eligibility_checks` is resolved **first**... simulate mode's flat mock copay **can override** a correct seeded `plan_rules` answer... Fix #1, cheapest fix, highest trust impact" |

These can't both be true in prod today. Two possibilities:
1. The hotfix landed and `M-01`'s test confirms it — the architecture PDF is describing **pre-fix** state and is now stale, or
2. `M-01` is marked done because the *test exists*, not because the *precedence logic* was actually changed in `resolve-amount-due` — i.e. the test may be asserting the wrong thing or testing a code path that isn't the one live traffic hits.

**Action (5 minutes, no deploy):** Run `simulate-eligibility-precedence.test.js` locally, then read `resolve-amount-due.js` and confirm which of `eligibility_checks` / `plan_rules` is queried **first** and whether a `simulate`-mode result can short-circuit before `plan_rules` is checked. Paste me the resolver order and I'll tell you definitively whether Fix #1 from the architecture doc is closed or still open. Everything else in Phase 1 assumes this is fixed — don't schedule `MT-02` (unified benefits model) until you know which state you're actually in.

---

## 1. Reconciling the three docs into one track map

The backlog epic (Tracks A–N) is **operationally closed** except three items. The execution plan (Phases 1–7) is the **next program**, not a re-do — it explicitly maps old tracks to new phases:

| Phase | Old tracks folded in | Status per backlog |
|---|---|---|
| MT (Multitenant) / PY (Payment) | M, N, A (partial) | M done, N done, A done — but MT-02/MT-03 are *new* work, not yet in backlog at all |
| DP (Deploy pipelines) | B, C, D, K | Eng done; **D-01, K-02 operator-pending** |
| CP (Conversation pipeline) | F, J, E | Eng done; **F-09 operator-pending** (clinical sign-off) |
| BL (Billing/NCCI) | G | Eng done but shallow — 32 pair rules, PDF scores this **3/10** |
| DN (Dental) | H, B-05 | Eng done but shallow — CDT 93% placeholder, PDF flags as structural gap |
| AD (Admin) | A, I, H | Eng done |

**Read on this:** "Eng complete" in the backlog is true for the *scaffolding* (routing, gates, tests exist). The architecture PDF's scorecard is the honest state of *content/data* behind that scaffolding — e.g. `G-01..G-08` are all "done" in the backlog, but the PDF scores billing validity 3/10 because 32 pair rules is a stub relative to real NCCI. Don't let "done" checkboxes in the backlog give false confidence — the Phase 1–7 plan is correctly treating those as starting points, not finished work.

---

## 2. Priority order (reconciled across all three docs)

1. **§0 above** — confirm precedence bug status. Blocking.
2. **MT-03 → MT-04** — Pinecone tenant isolation + SQLite tenant-boundary audit. This blocks `D-01` (you can't verify the Pinecone env is *safe* until isolation is proven, not just that it's *connected*) and blocks `AD-01` (admin RAG expansion).
3. **D-01 verification** (artifact prepared below — §4).
4. **MT-02** — unified benefits model. Only after §0 is resolved; otherwise you're unifying around a model that still has the override bug baked in.
5. **CP-05 → CP-12** — ranking SSOT + **F-09 clinical sign-off** (artifact prepared below — §4). This is your G1 gate and the second-highest trust item after §0, because it governs which code gets spoken, not just which dollar amount.
6. **K-02** — nightly `eval:coding:prod` green ×7 (tracking artifact below — §4). Do this in parallel with #5, not before — no point running the full-stack nightly against a ranking layer you're about to change.
7. **BL-01 → BL-03** — NCCI subset + pair rule expansion. PDF is explicit: don't do this before CP-05, or you're validating the wrong primary code.
8. **DN-01 → DN-05** — licensed CDT import + phrase map expansion. PDF is explicit: don't do this before MT-02, or you're pricing on a benefits model you're about to replace.
9. **AD-01 → AD-04** — admin path decisions (healthcare_clinic triage, sick-visit ICD mapping away from Z00.00).
10. **PY-01** — real `plan_rules` benefit ingest. This is the item that actually moves the coverage matrix (§3 of the architecture PDF) from mostly-red to mostly-green. Everything above this is prerequisite plumbing; this is where patient-facing value shows up.

This order differs slightly from the execution plan's own Phase numbering in one place: I've pulled **F-09 sign-off** earlier (paired with CP-05) rather than leaving it at the end of Phase 3, because it's already flagged operator-pending in the backlog and the sign-off checklist can be filled in *while* CP-05 work happens — no reason to serialize a document review behind code work.

---

## 3. 12-week calendar (as originally sequenced, with §0 inserted)

```
Week 0     :  Resolve §0 precedence-bug discrepancy (no deploy, just read + confirm)
Week 1-3   :  MT-01 -> MT-03 -> MT-04 -> MT-02 -> MT-08         [+ D-01 verification, F-09 sign-off draft in parallel]
Week 2-4   :  DP-01 -> DP-02 -> DP-04                           [parallel with MT]
Week 4-6   :  CP-04 -> CP-05 -> CP-07 -> CP-12 (sign-off close)  [+ K-02 7-night tracking starts once CP-05 lands]
Week 6-8   :  BL-01 -> BL-03 -> BL-05
Week 8-10  :  DN-01 -> DN-02 -> DN-04 -> DN-05
Week 10-12 :  AD-01 -> AD-02 -> AD-04 -> PY-01
```

**Gates (do not skip, per execution plan):**

| Gate | Criteria |
|---|---|
| G0 Foundation | MT-03 + MT-04 + D-01 green |
| G1 Medical voice | CP-05 + F-09 signed + K-02 green ×7 nights |
| G2 Billing | BL-03 + pair eval category ≥95% |
| G3 Dental | DN-01 + DN-04 + dental E2E scenarios |
| G4 Admin | AD-02 + AD-08 + tenant matrix signed |
| G5 Payment | PY-01 + coverage matrix expanded |

---

## 4. Artifacts prepared for your three operator-pending items

You asked me to prepare the artifacts and you'll execute the manual steps. Three companion files are included alongside this plan:

- **`kelly_f09_clinical_signoff_template.md`** — a fillable sign-off doc for `KELLY_PHASE_C_SIGNOFF.md`, structured around the C-P0-01–07 checklist items referenced in the backlog (OPQRST→column mapping, RAG asymmetry tradeoff, age/gender guideline coverage, etc.). Hand this to your clinical lead; it's not code, it's the review instrument.
- **`kelly_d01_pinecone_env_verification_checklist.md`** — step-by-step manual verification for `PINECONE_API_KEY` / `PINECONE_INDEX_HOST` on Cloud Run, plus what "green" should look like from `verify-pinecone-deploy-env.cjs` output, so you know when D-01 is actually closable vs. just "env vars are set."
- **`kelly_k02_nightly_eval_tracking.md`** — a 7-night tracking log template for `eval:coding:prod`, so "7 consecutive green nights" (the actual DP-04 acceptance criterion) has a paper trail instead of being a vibe.

---

## 5. Risk register — do not parallelize these

Pulled directly from the execution plan's own warnings, because they're correct and worth repeating:

- **Do not** expand NCCI (`BL-01`) before ranking SSOT (`CP-05`) — you'll validate pair-correctness on the wrong primary code.
- **Do not** license/import real CDT (`DN-01`) before unified benefits (`MT-02`) — you'll get real dental codes priced against a benefits model you're about to replace.
- **Do not** enable conditional RAG for `healthcare_clinic` (`AD-01`) before Pinecone tenant filter (`MT-03`) — cross-tenant leakage risk on a wider surface.
- **New, from §0 above:** Do not build `MT-02` (unified benefits model) until the precedence-bug status is confirmed. If the bug is still live, `MT-02` *is* the fix; if it's already fixed, `MT-02` is a refactor. These are different-sized pieces of work and you should know which one you're scoping.

---

## 6. Your next manual actions

1. Run the precedence test + read the resolver order (§0) — report back, I'll confirm status.
2. Skim the three companion artifacts and tell me if you want them adjusted before you hand F-09 to a clinical lead or start the D-01/K-02 verification.
3. Confirm you want to start Week 0/1 now, or want the plan re-sequenced around something else on your plate first (e.g. touche or PPL prep timing).
