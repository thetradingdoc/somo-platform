# Low Confidence Spike (>10% Rejected)

## Symptoms

- Rejection rate >10% in `/api/admin/metrics` or Application Insights
- Many coding suggestions return `rejected: true` or `needs_review: true`
- `escalation_rate` or `rejection_rate` exceeds threshold
- Clinics report increased manual review workload

## Impact

- **Quality** — Low-confidence codes correctly rejected; no auto-approval of uncertain suggestions
- **Operational** — More cases escalated to human review; potential backlog
- **Model drift** — May indicate prompt or model degradation

## Diagnosis

1. **Check metrics**: `GET /api/admin/metrics` — `rejection_rate`, `escalation_rate`
2. **Check LangSmith** — Review rejected runs; inspect prompts and responses
3. **Sample rejected cases** — Look for patterns (specific CPT/ICD-10, payer, clinic)
4. **Review confidence thresholds** — `CONFIDENCE_THRESHOLD_LOW` (0.6), `CONFIDENCE_THRESHOLD_ESCALATE` (0.75)

## Mitigation

1. **Review queue** — Ensure human reviewers process escalated cases promptly
2. **Communicate** — Notify clinics that more cases need review; expected when thresholds enforced
3. **Do not lower thresholds** — Keeping 0.6/0.75 prevents hallucinated codes from auto-approval

## Resolution

1. **Tune prompts** — If pattern found, update medical-coding prompt for edge cases
2. **Evaluate accuracy** — Run `node scripts/evaluate-accuracy.js` (or `tests/medical-coding/evaluate-accuracy.js`) for baseline
3. **Model update** — If Groq model changed, re-evaluate and adjust if needed

## Prevention

- Run accuracy evaluation on each deploy
- Monitor rejection rate trend; alert if >10%
- Document common rejection patterns and prompt updates
