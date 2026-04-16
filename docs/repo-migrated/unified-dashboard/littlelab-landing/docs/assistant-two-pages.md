# Skin & Care assistant — two pages

The overlay opened from **Start Analysis** is two separate UIs sharing one session:

| Page | Components | Stylesheet |
|------|------------|------------|
| **Voice** | `AssistantVoicePage.jsx` | `assistant-voice.css` (landing tokens: white, amber mic) |
| **Chat** | `AssistantChatPage.jsx` | `assistant-chat.css` (cream transcript band, brand borders) |

Colors match the main landing because `index.js` loads `skin-care-tokens.css` first; assistant CSS uses those variables (`--brand-white`, `--brand-accent`, etc.).

Shared logic and message history live in `useAssistantSession.js`. Hidden file inputs are mounted once in `AssistantExperience.jsx`.

## Hash routing

- `#assistant/voice` — voice UI (default when opening the assistant).
- `#assistant/chat` — chat UI.

The hash is updated with `history.replaceState` (no full page load). Closing the assistant clears the hash.

## Local run

1. `cd unified-dashboard/littlelab-landing && npm run build`
2. Serve via middleware (`npm start` in `middleware-platform`) so `GET /` loads the build.
3. Open **Start Analysis** and use **Open chat** to reach Page 2.

## E2E

From `middleware-platform`: `npm run test:e2e-landing-assistant` (requires build + middleware on port 4000).
