## Retell agent inventory (canonical audit trail)

This is the canonical list of live Retell agents and their expected configuration.

**Why this exists**
- Prevent “unknown” agents running stale prompts or missing tool schemas.
- Make config drift visible before it impacts live calls.

### Source of truth
- **Machine-readable inventory**: `docs/deployment/retell-agent-inventory.json`
- **Tool schemas**: `middleware-platform/retell-functions/retell-functions.json`
- **Medical workflow prompt**: `docs/voice-agent/medical-voice-agent-prompt.md` (required; fail-fast if missing)
- **Canonical websocket path**: `/webhook/retell/llm`

### How to verify
From `middleware-platform/`:

```bash
npm run verify:agent-config
```

### Agents

| agent_id | kind | expected_websocket_url | tools_ok | prompt_ok | notes |
|---|---|---|---:|---:|---|
| (fill) | fixed \| per-clinic | `wss://<host>/webhook/retell/llm` |  |  |  |

