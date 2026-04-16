# ADR 003: Agentic checkout spans static web, native app, and public APIs

## Status

Accepted.

## Context

Patients may start from **LittleLab landing**, **deep links**, or the **Expo app**. Checkout must feel chat-first while using **server-locked quotes** and **Stripe** for payment.

## Decision

- **Web:** `unified-dashboard/patients/checkout-chat.html` (Skin & Care tokens).
- **Native:** `patient-app/app/checkout-chat.tsx` calling the **same** middleware endpoints as web.
- **Backend:** public quote and checkout routes plus authenticated patient checkout-chat routes; Kelly tools for quote/checkout preparation.

## Consequences

- UI or copy changes may require **two clients** unless extracted to shared docs/API-only behavior.
- Use **`docs/architecture/commerce/AGENTIC_CHECKOUT_FILE_MAP.md`** as the reviewer checklist for cross-surface changes.
