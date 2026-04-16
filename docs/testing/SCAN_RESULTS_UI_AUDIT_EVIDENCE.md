# Scan Results UI Audit Evidence

Date: 2026-04-15
Scope: Phase `4.1F` scan results conversion redesign

## Current-state Playwright audit

- Spec: `middleware-platform/e2e/landing-results-visual.spec.cjs`
- Command: `npm run test:e2e:results-visual`
- Audit notes captured:
  - Results content was visually low-emphasis vs. surrounding content.
  - Hero image needed stronger fallback behavior.
  - Decision answers were not grouped in one obvious block.

## Evidence artifacts (CI/staging)

- CI artifact bundle: `landing-results-visual`
- Representative snapshots:
  - `results-known-mobile.png`
  - `results-unknown-mobile.png`
  - `results-not-found-mobile.png`
- Guard/evidence attachment is expected via the workflow artifact upload step in `.github/workflows/ci.yml`.

## Post-redesign expected checks

- Hero card is first visual block with product image + confidence + source badges.
- Structured tiles show icon-led cards with available/deferred/unavailable states.
- Decision block answers all five user questions.
- Sticky bottom action row always exposes `Use this product`, `Fix results`, `Ask Kelly`, and conditional `See alternatives`.
