# Skin & Care landing — Try now & LiveKit

**Last updated:** April 7, 2026

This doc describes the **marketing landing assistant** (`unified-dashboard/littlelab-landing`) and how **LiveKit** is used for optional live video. It complements **[VIDEO_CONSULT.md](./VIDEO_CONSULT.md)** (provider/telehealth pipeline with agents, transcript, vision events).

---

## 1. Two different LiveKit surfaces

| Surface | Purpose | Backend beyond LiveKit |
|--------|---------|-------------------------|
| **Landing Try now** | Public demo: camera-first preview, small **3D orb** as “provider,” optional **LiveKit** room `try-landing-{sessionSlug}` | **Kelly** via `POST /api/public/landing-assistant/turn` (HTTP). **No** `video-consult` SSE unless you add an agent posting to that API. |
| **Provider / patient video** | Scheduled visit: `appt-…` / `case-…` rooms | **`/api/video-consult/*`**, Python agents, LangGraph on `end_session`, optional YOLO/vision **only** when agents send `vision_frame`. |

The landing app **does not** call `/api/video-consult`. YOLO and frame ingestion are **not** active for `try-landing-*` unless you deploy a worker that joins those rooms and posts agent events.

---

## 2. UX flow (voice page)

1. **Invite** — Copy explains camera + orb; primary CTA **Allow camera & start**.
2. **Browser permission** — `getUserMedia` (camera + mic) for immediate full-screen **mirrored** preview.
3. **Session** — Full-screen `<video>`; **orb** in a small PiP (bottom-right); header floats over video; controls in a bottom gradient strip.
4. **LiveKit** — If `REACT_APP_API_BASE` points at middleware with `LIVEKIT_*` set, **`POST /api/livekit/token`** runs and the client connects with **`livekit-client`**. Preview tracks are **stopped only after** LiveKit’s camera track is attached (avoids a black flash).
5. **Without API base** — Local preview only; pill shows **Preview** and copy notes demo mode.

---

## 3. Key source files

| Area | Path |
|------|------|
| Shell / session | `littlelab-landing/src/AssistantExperience.jsx` |
| Voice UI + scan layout | `littlelab-landing/src/AssistantVoicePage.jsx` |
| LiveKit hook | `littlelab-landing/src/useLandingLiveKit.js` |
| Token API client | `littlelab-landing/src/landingLiveKitApi.js` |
| LiveKit toolbar / invite | `littlelab-landing/src/LiveKitPanel.jsx` |
| Orb (shared) | `littlelab-landing/src/AgentSphereCanvas.jsx`, `MagicPlasmaSphere.jsx` |
| Styles | `assistant-voice.css`, `assistant-livekit.css` |

---

## 4. Environment

| Variable | Where | Role |
|----------|--------|------|
| `REACT_APP_API_BASE` | CRA build | Middleware origin for Kelly **and** `/api/livekit/token` (e.g. `http://localhost:4000`). |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Middleware `.env` | Issuing JWTs; see [VIDEO_CONSULT.md §3](./VIDEO_CONSULT.md). |
| CSP | Static host | If you add `Content-Security-Policy`, allow `connect-src` to `wss://*.livekit.cloud` (see middleware `security.js` for API pages). |

---

## 5. Debugging

- **Black screen after connect:** Usually preview `MediaStream` was stopped before LiveKit attached. Fixed by stopping preview only when `getTrackPublication(Camera)` exists or on `LocalTrackPublished` (video). See `useLandingLiveKit.js`.
- **Token failures:** Middleware logs; enable verbose LiveKit route logs only in dev (see `routes/livekit.js` — gated in non-production unless `DEBUG_LIVEKIT=1`).
- **Kelly vs LiveKit:** Kelly turns are **HTTP**; LiveKit is **parallel** real-time A/V. They are not merged in one pipeline on the landing build.

---

## 6. Related docs

- [VIDEO_CONSULT.md](./VIDEO_CONSULT.md) — Provider video consult, agents, env, runbook  
- [HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md) — Voice vs video vs PDF  
- [kelly-phase-prompt-architecture.md](../middleware-platform/kelly-phase-prompt-architecture.md) — Landing Kelly / `kelly_flow`  
- [SKIN_CARE_TOKENS_AND_ASSETS.md](./SKIN_CARE_TOKENS_AND_ASSETS.md) — Brand tokens used by the landing shell  
