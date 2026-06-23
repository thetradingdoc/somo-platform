# Kelly services

| Module | Role |
|--------|------|
| `kelly-agent-service.js` | Legacy turn loop (6k+ lines) — split deferred until Kelly rails v2 prod gates (CR-001–005) |
| `kelly-tool-executor.js` | Tool execution |
| `rails/` | Kelly rails v2 orchestrator (preferred path) |

Pre-deploy: `npm run verify:kelly-rails-env`
