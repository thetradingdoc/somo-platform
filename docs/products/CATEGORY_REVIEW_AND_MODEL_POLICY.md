# Category Review and Model Policy (v1)

## Queue Eligibility

A row is eligible for manual review when any condition is true:

- `route = unknown`
- `confidence_band = low`
- `review_eligible = true` from resolver output

Queue export command:

- `npm run catalog:review-queue:export`

Output includes source, barcode, suggested route, confidence, and top tags for reviewer context.

## Human Review Rubric

Reviewers must assign one final route from:

- `cosmetic`
- `hygiene`
- `non_food`
- `food`
- `supplement`
- `unknown`

Adjudication rules:

1. Prefer explicit official taxonomy tags over inferred text patterns.
2. If no reliable tags exist, use product title + top ingredient tokens.
3. If signals conflict and confidence is low, keep `unknown` and escalate for lead review.
4. Record the final decision reason in one sentence.

## Inter-rater Agreement

- Weekly sample: 50 reviewed rows.
- Two reviewers independently label each sample.
- Target agreement: >= 90%.
- If below threshold, freeze map changes and run calibration session.

## SLA and Backlog Cap

- Standard SLA: 3 business days.
- Critical queue cap: < 1000 unresolved rows older than 7 days.
- Escalation: if cap exceeded, assign temporary DRI and prioritize high-impact tags.

## Optional ML v1 Policy

- Train only on high-confidence deterministic labels.
- Auto-apply only when confidence >= 0.90.
- For 0.60-0.89, enqueue for human review.
- For < 0.60, keep `unknown`.

## LLM Policy (if used)

- Structured output only (JSON schema).
- Temperature: 0.
- No free-form user-facing claims.
- Log model version + prompt hash + timestamp for every classification attempt.
- Daily cost cap enforced by job runner budget.

## Feedback Loop

- Weekly ingest reviewer corrections.
- Convert repeated reviewer overrides into deterministic map/rule updates first.
- Re-train ML only after deterministic updates are applied.
