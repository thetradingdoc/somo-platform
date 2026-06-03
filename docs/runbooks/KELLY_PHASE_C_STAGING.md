# Kelly Phase C — Staging verification

## Kelly events

```sql
SELECT session_id, event_type, payload_json, created_at
FROM kelly_call_events
WHERE event_type IN (
  'turn_resolved',
  'language_detected',
  'language_confidence_handoff',
  'language_mismatch'
)
ORDER BY created_at DESC
LIMIT 50;
```

Runtime proof:

```bash
DB_PATH=./middleware-staging.db node scripts/verify-kelly-rails-runtime-event.cjs --session-id <session_id>
npm run verify:kelly-phase-c-staging
npm run verify:kelly-rails-prod-runtime
```

Operator call summary (admin auth):

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<staging-host>/api/admin/kelly/sessions/<session_id>/summary" | jq .
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<staging-host>/api/admin/kelly/alerts" | jq .
```

## Voice metrics (in-process)

```bash
curl -s "https://<staging-host>/api/public/landing-assistant/voice-metrics/<callId>" | jq .
curl -s "https://<staging-host>/api/public/landing-assistant/voice-metrics/dashboard" | jq .
```

## Spanish Retell test

```bash
cd middleware-platform
export RETELL_VOICE_ID_ES=<spanish-voice-id>
export RETELL_AGENT_ID_ES=<optional-separate-agent>
# Patch ES agent: language es-US — extend configure-retell.js or Retell dashboard
node configure-retell.js
```

Call staging number; first utterance: `Hola, tengo una erupción en la pierna`.

## ASR gate

Set `KELLY_ASR_MIN_CONFIDENCE=0.75` on staging. Enable debug logging: `KELLY_ASR_DEBUG=1` on the middleware process (logs metadata keys + confidence per transcript, no transcript text).

### ASR payload fields (fill after live spike)

| Field | Seen (Y/N) | Sample value | Notes |
|-------|------------|--------------|-------|
| `confidence` | | | |
| `asr_confidence` | | | |
| `transcript_confidence` | | | |
| `stt_confidence` | | | |
| `language` / `asr_language` | | | |

If all confidence fields are empty on every turn, the gate is a **no-op** (leave `KELLY_ASR_MIN_CONFIDENCE` unset in prod until Retell exposes scores).

### Mid-call ASR degradation test

1. Set `KELLY_ASR_MIN_CONFIDENCE=0.75` and confirm Retell sends confidence (see table above).
2. On a live call, trigger two consecutive sub-threshold turns (or simulate low confidence in dev).
3. Expect turn 1: clarify reply; turn 2: support handoff.

```sql
SELECT session_id, payload_json->>'mismatch_type' AS mismatch_type, created_at
FROM kelly_call_events
WHERE event_type = 'language_mismatch'
  AND payload_json->>'mismatch_type' IN ('asr_low_confidence', 'asr_low_confidence_mid_call')
ORDER BY created_at DESC
LIMIT 10;
```

### PT / ZH handoff (staging)

- PT opener: `Podemos falar em português?` → handoff message in Portuguese; no `schedule_appointment`.
- ZH opener: `我们可以用中文吗？` → handoff message in Mandarin; no booking tools.
- See [`PT_ZH_HANDOFF.md`](../clinical/PT_ZH_HANDOFF.md) for clinic callback number (fill in before demo).

## Env flags for Phase C demo

```
KELLY_RAILS_V2=1
KELLY_RAILS_ES_ENABLED=1
KELLY_OPQRST_ES_PACK=v1   # only after OPQRST_ES_SIGNOFF file exists
KELLY_LANG_MIN_CONFIDENCE=0.6
```
