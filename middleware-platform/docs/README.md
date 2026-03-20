# Middleware Platform Developer Docs

This folder is the developer-facing source of truth for Kelly and payment flow behavior.

## Contents

- `standards.md` - coding and API consistency rules
- `architecture-kelly-payment.md` - end-to-end flow and state transitions
- `runbook-kelly-loops.md` - triage/booking loop debugging guide
- `runbook-payment-settlement.md` - checkout, verify, process-payment troubleshooting

## Change policy

When changing Kelly triage or payment behavior:

1. Update the relevant architecture section.
2. Update the relevant runbook checklist.
3. Keep route/service contracts backward compatible unless explicitly versioned.
