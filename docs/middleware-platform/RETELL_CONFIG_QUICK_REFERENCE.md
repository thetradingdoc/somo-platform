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

## 🧪 TEST AFTER CONFIGURING

```bash
node scripts/call-number.js +18622307479
```

Then check:
1. Retell Dashboard → Call History
2. Twilio Console → Call Logs
3. Server logs for webhook activity

