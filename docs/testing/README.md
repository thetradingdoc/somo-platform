# Testing Documentation

Test results, test suites, and testing guides.

## Test Suites

Tests live in `middleware-platform/tests/`:

- **Medical coding**: `tests/medical-coding/` — evaluation, voice flow tests
- **Tenant isolation**: `tests/test-tenant-isolation.js` — multi-tenant regression
- **Voice agent flow**: `tests/test-voice-agent-flow.js` — Twilio + Retell simulation
- **LangGraph**: `scripts/test-langgraph.js` — LangGraph state machine

## Running Tests

```bash
cd middleware-platform
npm test
# Or run specific suites
node scripts/test-langgraph.js
```

## Related Documentation

- [Architecture Voice Agent](../architecture/voice-agent/RUNBOOK.md) — medical coding runbook
- [LangGraph & LangSmith](../middleware-platform/LANGGRAPH_LANGSMITH.md)
- [Main Docs](../README.md)

---

**Last Updated:** January 2026
