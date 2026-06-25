# Health Video UX — consumer funnel

**Last updated:** 2026-06-25

Consumer **Safe VideoGPT for Healthcare** — React funnel at `/health-video/`. **Two intentional live-session layouts** (mobile stack vs desktop grid), **one interaction contract**.

## Interaction contract (mobile + web)

| Zone | Contents |
|------|----------|
| **Header** | Logo · Connected · progress (subtle) · Private · **Finish** |
| **Stage** | Cam off: compact Kelly bar. Cam on: your video + Kelly chip top-right |
| **Chat** | **Single source of truth** — always scrollable; no duplicate transcript on desktop |
| **Bottom** | Input + mic + **one camera toggle** (no summary button) |

## Responsive layout

| Viewport | Live session |
|----------|----------------|
| **Desktop** (≥768px) | White shell; grid: stage/video left + chat **380px** right |
| **Mobile** (≤767px) | White shell; compact Kelly bar → chat → input → camera |

Breakpoint: `useMediaQuery('(min-width: 768px)')` in `LiveSession.jsx`.

### Layout components

| Layout | Component | Structure |
|--------|-----------|-----------|
| **Mobile** | `SessionLayoutMobile` | `SessionHeaderLive` → `KellyStage` → `ChatPanel` |
| **Desktop** | `SessionLayoutDesktop` | `SessionHeaderLive` → grid: `KellyPresencePanel` + `ChatPanel` |

E2E: Playwright `health-video` (1280×720) and `health-video-mobile` (390×844).

## Journey

```
/ (marketing) → /start → /name → /privacy → /session (preview → chat) → /report
```

### Camera

- Off by default; education sheet **once per session** before first voluntary camera on
- Cam on: video fills stage (mobile top ~45vh) or left panel (desktop); chat **stays visible**
- Kelly-requested: in-chat consent + body-region overlay on stage only

### Kelly identity

**Kelly · AI health assistant** — `K` avatar. SSE greetings normalized to replace “physician assistant” in UI.

### Urgency & progress

- Urgency hidden until triage signal
- Progress label in header center (after first patient message)

## Design

- White session shell (matches journey + report)
- Black ink CTAs; light gray Kelly bubbles
- **Finish** in header ends session → intake sheet → report

## Code map

| Area | Path |
|------|------|
| Live session | `LiveSession.jsx`, `SessionHeaderLive.jsx`, `SessionLayoutMobile.jsx`, `SessionLayoutDesktop.jsx`, `ChatPanel.jsx`, `SessionAVControls.jsx` |
| Styles | `session-mobile.css`, `session-desktop.css` |
