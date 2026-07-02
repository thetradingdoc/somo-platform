# Voice agent prompts

> **Last reviewed:** 2026-07-02

Markdown prompts loaded by middleware and Retell configuration.

## Files

| Prompt | Path | Loaded by |
|--------|------|-----------|
| Kelly (voice) | [kelly-voice-agent-prompt.md](./kelly-voice-agent-prompt.md) | [`configure-retell.js`](../../middleware-platform/configure-retell.js) — primary system prompt |
| Medical coding workflow | [../medical-voice-agent-prompt.md](../medical-voice-agent-prompt.md) | Appended to Kelly when file exists |
| Kelly (chat) | [kelly-chat-prompt.md](./kelly-chat-prompt.md) | **Non-canonical reference only** — not loaded by code. Runtime chat uses Kelly Rails V2 prompts (see below). |

Commerce shop voice prompt removed 2026-06-17 (legacy consumer).

## Source of truth at runtime (important)

Several paths exist; only some are canonical. Keep them aligned:

1. **Opener (canonical, all channels).** The first-contact greeting for both voice and chat comes
   from [`call-opener-resolver.js`](../../middleware-platform/services/call-opener-resolver.js)
   (`resolveCallOpeners` / `resolveFirstContactGreeting` — per-tenant, name-first, brand- and
   tone-aware). Voice reads it over the Retell WebSocket; chat reads it via the
   `/api/patient/triage/opener` and `/api/public/landing-assistant/opener` endpoints. The greeting is
   intentionally **not** synced to Retell (see `voice-settings-sync.js`).
2. **Conversation system prompt (canonical when `KELLY_RAILS_V2=1`, the production default).** Turns
   are driven by Kelly Rails V2:
   [`kelly-rails/prompts/en.js`](../../middleware-platform/services/kelly-rails/prompts/en.js) and
   [`es.js`](../../middleware-platform/services/kelly-rails/prompts/es.js) (`laneSystemPrompt`). Branding
   comes only from `providerCtx.clinicName`; the shared `FIRST_CONTACT_POLICY` carries name-first +
   acknowledge-then-ask + tone. This is where prompt-parity changes must land.
3. **Legacy / phase prompts (dev & fallback only).** `_buildSystemPromptLegacy` and
   `_buildCompactSystemPrompt` in
   [`kelly-agent-service.js`](../../middleware-platform/services/kelly-agent-service.js) and the
   `KELLY_PHASE_PROMPTS` path are only used when Rails V2 is disabled. They are kept aligned for
   parity but are **not** canonical in production.
4. **Retell-native agent prompt (fallback only).** `kelly-voice-agent-prompt.md` is pushed to the
   Retell agent and only governs calls that ever run on Retell's own LLM. Keep its greeting
   **brand-neutral and name-first** so a fallback never contradicts the canonical opener.

Greeting/persona policy (name-first: greet → ask for name → ask reason; acknowledge-then-ask; warm,
confident, unhurried) must read the same across the opener resolver, Rails prompts, and this markdown.

## Configure Retell

```bash
cd middleware-platform
# Requires RETELL_API_KEY, RETELL_AGENT_ID, API_BASE_URL (prod) or localhost:4000 (dev)
node configure-retell.js
```

Loads Kelly from `docs/voice-agent/prompts/kelly-voice-agent-prompt.md`, then appends medical workflow if present.

## Medical coding behavior

Code retrieval uses `getCodeCandidatesDualSource` — not prompt text alone. Architecture: [Medical Coding/ARCHITECTURE.md](../../Medical%20Coding/ARCHITECTURE.md).

## Related

- [voice-agent README](../README.md)
- [Retell functions](../../middleware-platform/retell-functions/retell-functions.json)
