# Consumer video health (Somo)

**Last updated:** 2026-06-25

**Architecture SSOT:** `docs/architecture/HEALTH_SESSION_ARCHITECTURE.md`  
**UX SSOT:** `docs/product/HEALTH_VIDEO_UX.md`

Somo consumer surface: **Safe VideoGPT for Healthcare** — landing → consent → live session → report.

Kelly is a **physician assistant** (Groq tool-loop via `kelly-pa-video-orchestrator.js`), **not** `AgentBrainService` or LangGraph.

## Quick start

```bash
# API (from repo root)
./run

# UI dev with hot reload (second terminal, optional)
npm run health:ui:dev
# → http://localhost:5174/health-video/

# Or single server after build
npm run health:ui:build
./run
# → http://localhost:4000/health-video/
```

Open **http://localhost:4000/** when `LOCAL_DEV_ROOT=health` — redirects to `/health-video/`.

`npm run health:dev` is an alias for middleware start with `LOCAL_DEV_ROOT=health`.

## Key code

| Area | Path |
|------|------|
| Architecture | `docs/architecture/HEALTH_SESSION_ARCHITECTURE.md` |
| UX journey | `docs/product/HEALTH_VIDEO_UX.md` |
| Health session API | `middleware-platform/routes/health-session.js` |
| Kelly PA orchestrator | `middleware-platform/services/kelly-pa-video-orchestrator.js` |
| Consumer UI (React) | `unified-dashboard/health-video-landing/` |
| Built SPA | `/health-video/` on middleware |

## Acceptance

See [`docs/qa/health-video-demo.md`](../qa/health-video-demo.md).
