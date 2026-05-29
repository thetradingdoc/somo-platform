# DodgeCall demo agent architecture

**Last updated:** 2026-05-28

## Goal

Outbound demo calls from the DodgeCall landing page should **convert prospects to signup**, not run Kelly medical intake or LangGraph coding.

## Data flow

```mermaid
sequenceDiagram
  participant Landing
  participant API as dodgecall_public_API
  participant Twilio
  participant MW as middleware_voice_incoming
  participant Retell
  participant WS as retell_websocket
  participant Demo as dodgecall_demo_handler

  Landing->>API: POST request-call
  API->>Twilio: outbound call_type=dodgecall_demo
  Twilio->>MW: /voice/incoming
  MW->>Retell: connect demo agent + dynamic vars
  Retell->>WS: custom LLM WebSocket
  WS->>Demo: if dodgecall_demo and flag on
  Demo-->>Retell: conversion replies + tools
```

## Phases

| Phase | Scope | Exit criteria |
|-------|--------|----------------|
| **A** | Template registry, dedicated Twilio/Retell, WS fork (no Kelly/LangGraph) | Demo call greets as DodgeCall, not Kelly |
| **B** | Conversion orchestrator, playbook, SMS signup link | Persuasive script + `record_interest` / `send_signup_link` |
| **C** | More templates, attribution | Registry supports multiple `template_id` values |
| **D** | Hardening, tests, runbook | E2E + unit tests; rollback documented |

## Critical path

`P0 (voice + ADRs)` → `A1 registry` → `A4 configure Retell` → `A6/A7 telephony` → `A9 WS fork` → `B3 playbook` → `B4 orchestrator`

## Dependency graph

```mermaid
flowchart TD
  P0[P0_decisions]
  A1[A1_template_registry]
  A4[A4_configure_retell]
  A6[A6_outbound]
  A7[A7_inbound_demo_number]
  A9[A9_websocket_fork]
  B3[B3_playbook]
  B4[B4_orchestrator]
  P0 --> A1 --> A4
  A1 --> A6 --> A9
  A1 --> A7 --> A9
  B3 --> B4 --> A9
```

## Do not change (isolation)

See [ISOLATION_CONTRACT.md](./ISOLATION_CONTRACT.md).

| Component | Reason |
|-----------|--------|
| `kelly-agent-service.js` | Production medical brain |
| `coding-graph.js` / LangGraph on voice | Medical coding, not sales |
| `configure-retell.js` (Kelly agent) | Paying-tenant agent |
| Clinic billing gate on `/voice/incoming` | Skip only for `dodgecall_demo` |

## Code map

| Piece | Path |
|-------|------|
| Landing | `unified-dashboard/dodgecall/` |
| Public API | `middleware-platform/routes/dodgecall-public.js` |
| Demo service | `middleware-platform/services/dodgecall-demo-service.js` |
| Template registry | `middleware-platform/config/dodgecall-templates.json` |
| Registry resolver | `middleware-platform/services/dodgecall-template-registry.js` |
| Demo WS handler | `middleware-platform/webhooks/dodgecall-demo-handler.js` |
| Orchestrator | `middleware-platform/services/dodgecall-demo-orchestrator.js` |
| Configure script | `middleware-platform/scripts/configure-dodgecall-demo-retell.cjs` |
