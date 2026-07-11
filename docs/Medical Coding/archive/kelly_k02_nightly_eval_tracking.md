# K-02 — Nightly `eval:coding:prod` Tracking Log

**Purpose:** Close `K-02` / `DP-04` — the acceptance criterion is explicitly "**7 consecutive green nights**," not "the job exists." This log is the paper trail.

**Important dependency:** Per the master plan's risk register, don't start counting your 7 nights until `CP-05` (ranking SSOT) has landed — a green run against a ranking layer you're about to replace doesn't count toward confidence in the *final* system.

---

## Pre-flight (fill in once)

- [ ] `eval:coding:prod` runs on a **real DB with Pinecone + semantic search enabled** (confirm this — the backlog's own 61-case fast eval historically ran with these disabled, per the architecture PDF's honest caveat: *"the 92% pass rate reflects the local keyword path, not the full production stack"*).
- [ ] Alerting is wired: a failed nightly run notifies you (Slack/email/etc.), not just silently logged.
- [ ] Golden case count confirmed: _____ (backlog target was 150+, up from 61).

---

## 7-night log

| Night | Date | Pass/Fail | Pass rate | Notable failures | Action taken |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |

**Rule:** Any single red night resets the count to zero — the criterion is *consecutive*, not "7 out of the last 10."

---

## Sign-off

- [ ] 7 consecutive green nights achieved on the date range above.
- [ ] `K-02` status changed from `operator_pending` → `done` in the backlog.

**Verified by:** _______________ **Date range:** _______________ to _______________
