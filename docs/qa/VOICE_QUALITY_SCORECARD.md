# Voice quality scorecard (Phase C sign-off)

**Reviewer role (required):** External healthcare specialist or office manager — **not** the engineer who built the feature.

**Archive:** Save completed scorecards under [`docs/qa/voice-reviews/`](voice-reviews/README.md) — naming `YYYY-MM-DD-<en|es>-<callId>.md` (see README for template)

---

## Per-call scores (1 = poor, 5 = excellent)

| # | Dimension | Notes |
|---|-----------|--------|
| V1 | TTS naturalness | Robotic vs human pacing |
| V2 | Pronunciation | Medical terms, names |
| V3 | Turn-taking | Barge-in, dead air |
| V4 | Brevity | ~1 question, &lt;25 words typical |
| V5 | Warmth | Scripted vs empathetic |
| V6 | Language consistency | Stays in caller language |
| V7 | Clinical clarity | OPQRST understandable |
| V8 | Trust | Would continue booking |

**Record:** Retell recording URL, `callId`, date, scorer name, cohort (EN/ES/noisy/low-confidence).

---

## Sample sizes and pass bars

| Cohort | N | Pass |
|--------|---|------|
| EN happy path (rash → book) | 10 | Median V1–V5 ≥ 3.5; no V7 &lt; 3 |
| ES happy path | 10 | Same + V6 ≥ 4 |
| ES noisy / accent | 5 | ASR clarify or handoff; no wrong book |
| Low-confidence Spanish opener | 5 | Handoff or clarify; no silent wrong route |

---

## Automated SLO (terminal)

After calls, when metrics are wired:

```bash
curl "http://127.0.0.1:4000/api/public/landing-assistant/voice-metrics/<callId>"
```

Thresholds: `VOICE_SLO_*` env vars (see [`KELLY_RAILS_PHASE_C_EXECUTION.md`](../../todos/pending/KELLY_RAILS_PHASE_C_EXECUTION.md)).

---

## Tuning checklist (engineering)

- `RETELL_VOICE_ID` / `RETELL_VOICE_ID_ES`
- `enable_backchannel` true vs false
- `KELLY_VOICE_MAX_TOKENS` (e.g. 120 vs 200)
- Voice reply clamp (max 25 words, 1 `?`)
