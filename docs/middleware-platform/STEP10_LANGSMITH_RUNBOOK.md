# Step 10 + LangSmith

## When traces appear

`invokeStep10` (with `STEP10_GRAPH_ENABLED=true`) creates a LangSmith run named `step10_invoke` when `LANGCHAIN_TRACING_V2` or `LANGSMITH_TRACING` is true and `LANGSMITH_API_KEY` is set.

## Tags and inputs

- Tags: `step10`, `langgraph`.
- Inputs/outputs are passed through `redaction-service.redactObject` (emails, phones, and common secret keys masked).

## Local smoke

```bash
cd middleware-platform
STEP10_GRAPH_ENABLED=false node -e "require('./services/step10-graph').invokeStep10({ patient_id: 'p1' }).then(console.log)"
npm run smoke:step10
```

## CI

`package.json` includes `smoke:step10` (stub-mode invoke). Pair with `jest` tests for routing and stub behavior.
