# OPQRST ownership boundaries

| Domain | Owner module | Notes |
|--------|--------------|-------|
| **Consumer Somo health** | [`services/health/opqrst.js`](../../middleware-platform/services/health/opqrst.js) | Education-only; no booking gates |
| **Kelly voice (B2B)** | [`services/kelly-rails/gates/opqrst.js`](../../middleware-platform/services/kelly-rails/gates/opqrst.js) + [`conversation-mode/opqrst-subrail.js`](../../middleware-platform/services/conversation-mode/opqrst-subrail.js) | FREEZE — do not merge with health |
| **Clinical registry** | [`services/clinical-opqrst-registry.js`](../../middleware-platform/services/clinical-opqrst-registry.js) | Shared vocabulary only |
| **Field gate** | [`services/opqrst-field-gate.js`](../../middleware-platform/services/opqrst-field-gate.js) | Kelly rollout helper |

Do **not** import Kelly OPQRST gates into `services/health/**`.
