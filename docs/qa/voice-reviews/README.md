# Voice review archive (Phase C)

Completed perceptual scorecards for Kelly voice sign-off. **Reviewer:** external healthcare specialist or office manager (not the implementer).

**Scorecard rubric:** [`../VOICE_QUALITY_SCORECARD.md`](../VOICE_QUALITY_SCORECARD.md)

## File naming

`YYYY-MM-DD-<en|es>-<callId>.md`

Example: `2026-06-02-es-call_abc123.md`

## Template (copy per call)

```markdown
# Voice review — <callId>

- **Date:** YYYY-MM-DD
- **Cohort:** en-happy | es-happy | es-noisy | es-low-confidence
- **Reviewer:** <name, role>
- **Recording:** <Retell URL>

| # | Dimension | Score (1–5) | Notes |
|---|-----------|-------------|-------|
| V1 | TTS naturalness | | |
| V2 | Pronunciation | | |
| V3 | Turn-taking | | |
| V4 | Brevity | | |
| V5 | Warmth | | |
| V6 | Language consistency | | |
| V7 | Clinical clarity | | |
| V8 | Trust | | |

**Pass:** Median V1–V5 ≥ 3.5; no V7 < 3; ES cohort V6 ≥ 4.
```

## Pass bars (cohort)

| Cohort | N |
|--------|---|
| EN happy path | 10 |
| ES happy path | 10 |
| ES noisy / accent | 5 |
| ES low-confidence opener | 5 |
