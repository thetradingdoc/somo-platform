# Retell Configuration - Quick Reference

## ✅ CORRECT VALUES FOR RETELL DASHBOARD

Fill in the Retell SIP trunking modal with these **EXACT** values:

### Phone Number
```
+15856202445
```

### Termination URI
```
aimedicalvoiceagent.pstn.twilio.com
```

### SIP Trunk User Name
```
doclittles
```
(Note: with "s" at the end, not "doclittle")

### SIP Trunk Password
Get from: Twilio Console → SIP → Credential Lists → `Retell-Auth` → credential `doclittles`

### Outbound Transport
```
TCP
```

### Nickname (Optional)
```
Twilio SIP Trunk
```

---

## ✅ VERIFIED TWILIO CONFIGURATION

- **Trunk SID**: `TKef81908ba0a83bb52eff902076f5abfc`
- **Trunk Name**: `Retell-AI-Trunk`
- **Domain Name**: `aimedicalvoiceagent.pstn.twilio.com`
- **Phone Number**: `+15856202445` ✅ Attached
- **Credential List**: `retell-outbound` ✅ Attached
- **IP ACLs**: `Retell-IPs` ✅ Attached

---

## 🌐 Using ngrok with Retell (local dev)

When your middleware runs locally and is exposed via ngrok (e.g. `ngrok http 4000`), use your **public ngrok URL** in the Retell dashboard so Retell can reach your server.

**Example base URL:** `https://3fc2-65-88-88-201.ngrok-free.app`  
*(Replace with the Forwarding URL shown in your ngrok terminal; use the full URL including `.ngrok-free.app`.)*

### In Retell Dashboard → Your phone number → Call Agent settings

| Setting | Value |
|--------|--------|
| **Custom LLM URL** | `wss://3fc2-65-88-88-201.ngrok-free.app/webhook/retell/llm` |
| **Agent Level Webhook URL** | `https://3fc2-65-88-88-201.ngrok-free.app/webhook/retell/events` |

- **Custom LLM URL** must be **WebSocket** (`wss://`). Retell uses this to connect to your middleware for the AI conversation.
- **Agent Level Webhook URL** is **HTTPS**. Retell sends call lifecycle events (call_started, call_ended, etc.) here.

If you use a different ngrok URL, replace the host in both URLs (e.g. `https://YOUR-SUBDOMAIN.ngrok-free.app` and `wss://YOUR-SUBDOMAIN.ngrok-free.app`).

### Optional: middleware .env

So the server knows its public URL (e.g. for links in `/health`), set in `middleware-platform/.env`:

```bash
NGROK_URL=https://3fc2-65-88-88-201.ngrok-free.app
# or BASE_URL when using ngrok for testing
BASE_URL=https://3fc2-65-88-88-201.ngrok-free.app
```

---

## 🧪 TEST AFTER CONFIGURING

```bash
node scripts/call-number.js +18622307479
```

Then check:
1. Retell Dashboard → Call History
2. Twilio Console → Call Logs
3. Server logs for webhook activity

