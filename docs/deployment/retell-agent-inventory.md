# Retell agent inventory (`retell-agent-inventory.json`)

The JSON file [`retell-agent-inventory.json`](./retell-agent-inventory.json) is the **machine-readable source of truth** for verifying that production Retell agents match repo expectations.

## Used by

```bash
cd middleware-platform
npm run verify:agent-config
# or: RETELL_API_KEY=... node scripts/verify-agent-config.cjs
```

Script: [`middleware-platform/scripts/verify-agent-config.cjs`](../../middleware-platform/scripts/verify-agent-config.cjs)

## What it checks

| Field | Purpose |
|-------|---------|
| `canonical.websocket_path` | Agent `llm_websocket_url` must end with `/webhook/retell/llm` |
| `canonical.required_tools` | Tool names present on agent (best-effort) |
| `canonical.prompt_markers` | Substrings expected in agent prompt |
| `agents[].agent_id` | List of agent IDs to fetch from Retell API |

## Updating

When you add or change the production Kelly agent:

1. Add an entry under `agents` with `agent_id` and a short `label`.
2. Run `node configure-retell.js` with `API_BASE_URL=https://api.myskinandcare.com`.
3. Run `npm run verify:agent-config` and fix any drift.

See also: [`VOICE_CURRENT_ARCHITECTURE.md`](./VOICE_CURRENT_ARCHITECTURE.md).
