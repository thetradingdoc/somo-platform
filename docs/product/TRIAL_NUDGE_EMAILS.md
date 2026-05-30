# Trial nudge emails (W4-09)

> **Last reviewed:** 2026-05-29

| Trigger | When | `nudge_key` | Send path |
|---------|------|-------------|-----------|
| Day 0 welcome | `activateTrialRecord` / trial start | `trial_welcome` | `maybeSendTrialWelcome()` |
| 50% minutes | Active trial usage | `usage_50` | `maybeSendTrialUsageNudges()` |
| 80% minutes | Active trial usage | `usage_80` | `maybeSendTrialUsageNudges()` |
| 2 days before expiry | Scheduled sweep | `day_5_warning` | `runScheduledTrialNudges()` |
| 1 day before expiry | Scheduled sweep | `day_7_morning` | `runScheduledTrialNudges()` |
| Trial expired | Expiry sweep / lifecycle | `trial_expired` | `maybeSendTrialLifecycleNudges()` |

Brand name in copy: **Somo** (override sender display via `EMAIL_FROM_NAME`).

## Commands

```bash
cd middleware-platform
npm run trial:nudge-sweep          # scheduled day-5 / day-7 + usage nudges
npm run trial:expiry-sweep:apply   # expire trials + release numbers
```

Dev: set `SMTP_*` or Azure Communication env vars; inspect `trial_nudges` table for dedupe.

See [trial-lifecycle.md](../runbooks/trial-lifecycle.md).
