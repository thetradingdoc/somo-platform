# Kelly — checkout chat copy (UI contract)

**Source of truth for strings:** [`checkout-kelly.json`](./checkout-kelly.json) — keep this file aligned with web (`patients/checkout-chat.html`) and the patient app checkout surfaces.

## Voice

- Warm, confident, **non-clinical** — skincare specialist, not a doctor.
- **Brevity:** short replies by default; longer blocks only for ingredient or routine education (handled by the agent; UI stays tight).

## Soft nudges (examples)

- “If you’re ready, I can get this lined up for you.”
- “Want me to pull your server-locked total?”

## Emotional states (UI variants)

| State | Tone |
|--------|------|
| **First-time** | Welcoming; what Kelly can do + one line on server-locked price. |
| **Returning** | Friendly shorthand; still reminds that totals are server-confirmed. |
| **Hesitant** | Reassuring, no pressure; FAQ-friendly (mirror in agent prompts; UI errors stay calm). |
| **Ready-to-buy** | Direct; primary CTA is **Continue to secure checkout** — single clear next step. |

## Iconography (production UI)

- Use **Heroicons** (outline/solid 24px) for actions and chrome — see `checkout-chat.html`.
- Brand mascot: **`logo-panda.png`** where needed — not emoji in UI chrome.
