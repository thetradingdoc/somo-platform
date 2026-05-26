# Voice agent prompts

> **Last reviewed:** 2026-05-25

Markdown prompts loaded by middleware and Retell configuration.

## Files

| Prompt | Path | Loaded by |
|--------|------|-----------|
| Kelly (voice) | [kelly-voice-agent-prompt.md](./kelly-voice-agent-prompt.md) | [`configure-retell.js`](../../middleware-platform/configure-retell.js) — primary system prompt |
| Medical coding workflow | [../medical-voice-agent-prompt.md](../medical-voice-agent-prompt.md) | Appended to Kelly when file exists |
| Kelly (chat) | [kelly-chat-prompt.md](./kelly-chat-prompt.md) | Chat/checkout surfaces (see middleware Kelly services) |
| Shop agent | [../shop-voice-agent-prompt.md](../shop-voice-agent-prompt.md) | Commerce voice variant |

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
