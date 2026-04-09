# Testing Documentation

Test results, test suites, and testing guides.

## Automated tests

Jest suites live under `middleware-platform/__tests__/` (e.g. reasoning-map, session orchestration, security redaction). Playwright E2E specs live under `middleware-platform/e2e/`.

## Running tests

```bash
cd middleware-platform
npm test                    # jest --passWithNoTests (all __tests__)
npm run test:reasoning-map  # focused Jest suite
npm run test:session-orchestration
```

## Related documentation

- [Architecture Voice Agent](../architecture/voice-agent/RUNBOOK.md) — medical coding runbook
- [LangGraph & LangSmith](../middleware-platform/LANGGRAPH_LANGSMITH.md)
- [Main Docs](../README.md)

---

**Last Updated:** April 9, 2026
