# Fraud Response Playbook (Phase 0)

## Purpose

Operational playbook for suspicious payment and sybil-pattern activity in middleware.

## Trigger Conditions

- Anti-sybil guard returns `block` on payment actions.
- Duplicate payment attempts spike above baseline.
- Webhook replay attempts are detected.
- Unusual burst in high-value retries from shared IP/device fingerprints.

## Severity

- **Sev2:** Single customer/payment path blocked; no confirmed funds loss.
- **Sev1:** Suspected active fraud campaign, replay exploit, or confirmed unauthorized charge risk.

## Immediate Actions (First 15 Minutes)

1. Acknowledge alert and assign incident commander.
2. Enable strict payment safety flags if needed:
   - enforce Twilio signature validation
   - tighten anti-sybil thresholds (temporary)
3. Freeze affected checkout/payment intents if fraud risk is high.
4. Preserve evidence:
   - idempotency key records
   - webhook headers/event ids
   - request metadata (IP, UA hash, customer identifiers)

## Investigation Checklist

- Confirm if attempts are replayed payloads or new attempts.
- Check `idempotency_keys` for collisions/in-progress storms.
- Check Stripe/Circle dashboard for matching transaction ids.
- Verify whether any duplicate charge actually settled.
- Scope impact (customers, amount at risk, timeframe).

## Containment

- Block high-risk identity and IP clusters temporarily.
- Increase challenge/friction on affected route family.
- Route flagged requests to manual review queue.
- Disable non-essential high-risk flows until mitigated.

## Customer and Internal Communication

- **Internal:** post status every 30 minutes until contained.
- **Customer support:** use payment error taxonomy and scripted responses.
- **If impact confirmed:** notify affected customers with clear remediation and ETA.

## Recovery and Postmortem

- Reconcile all impacted payment intents/checkouts.
- Refund or reverse unauthorized outcomes.
- Record remediation in incident timeline.
- Publish postmortem (Sev1/Sev2) with:
  - root cause
  - blast radius
  - customer impact
  - prevention tasks with owners/dates

## Ownership

- Engineering on-call: technical mitigation
- Security/compliance lead: risk/legal review
- Payments ops lead: reconciliation and customer remediation
