# Agentic checkout — accessibility smoke (manual)

Use **Chrome DevTools** → device toolbar for width; **Reduce motion**: macOS System Settings → Accessibility → Display → Reduce motion (or DevTools rendering).

## Web (`unified-dashboard/patients/checkout-chat.html`)

| Check | 375px | 320px |
|-------|-------|-------|
| No horizontal scroll on main column | ☐ | ☐ |
| Composer + primary actions reachable without overlap | ☐ | ☐ |
| Focus visible on Send, Switch, Pay, footer links | ☐ | ☐ |
| Price updates announced (`aria-live` on `#productPrice`) | ☐ | ☐ |
| New chat messages announced (`aria-live` on `#chatLog`) | ☐ | ☐ |
| With **Reduce motion**: shimmer / typing dots / quote pulse disabled | ☐ | ☐ |

## Native (`patient-app`)

- Dynamic type: verify header + Pay hero do not clip on small heights.
- VoiceOver / TalkBack: header, Pay, Send, Switch row labels read sensibly.
