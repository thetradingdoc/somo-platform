# Retell SIP Trunk Configuration - FINAL VALUES

## ❌ Current Issue
Calls are failing with **"User declined"** status. This indicates a **SIP authentication mismatch** between Retell and Twilio.

## ✅ Verified Twilio Configuration

### Trunk Details
- **Trunk SID**: `TKef81908ba0a83bb52eff902076f5abfc`
- **Trunk Name**: `Retell-AI-Trunk`
- **Domain Name**: `aimedicalvoiceagent.pstn.twilio.com`
- **Credential List**: `Retell-Auth` (SID: `CL7c71a9a98d726ae918b3d9d4f0763f75`)
- **IP ACLs**: `Retell-IPs`, `Retell-New` (attached)

## 🔧 Retell Dashboard Configuration

Go to **Retell Dashboard → Settings → Telephony → SIP Trunk Configuration**

Fill in these **EXACT** values:

### Phone Number
```
+15856202445
```

### Termination URI
```
aimedicalvoiceagent.pstn.twilio.com
```
⚠️ **CRITICAL**: Must match Twilio trunk domain exactly (no trailing slash, no protocol)

### SIP Trunk User Name
```
doclittles
```
⚠️ **CRITICAL**: Must match the username in Twilio's `Retell-Auth` credential list exactly

### SIP Trunk Password
**Get from Twilio Console:**
1. Go to **Twilio Console → SIP Trunking → Credential Lists → Retell-Auth**
2. Click on the credential (username: `doclittles`)
3. Copy the password
4. Paste it into Retell Dashboard

### Outbound Transport
```
TCP
```

### Nickname (Optional)
```
Twilio SIP Trunk
```

---

## 🔍 Verification Steps

### 1. Verify Username in Twilio
1. Go to **Twilio Console → SIP Trunking → Credential Lists**
2. Open **Retell-Auth**
3. Check the username - it should be `doclittles` (with "s")
4. If it's different, either:
   - Update Twilio to use `doclittles`, OR
   - Update Retell to match Twilio's username

### 2. Verify Password Match
- The password in Retell must **exactly match** the password in Twilio's credential list
- No extra spaces, no typos
- Copy-paste directly from Twilio console

### 3. Verify Termination URI
- Must be exactly: `aimedicalvoiceagent.pstn.twilio.com`
- No `sip:`, no `https://`, no trailing `/`
- Just the domain name

### 4. Test After Configuration
```bash
cd middleware-platform
node scripts/test-retell-outbound.js +18622307479
```

Then check:
- Retell Dashboard → Call History
- Twilio Console → Call Logs
- Look for status: should be "connected" or "speaking", not "failed"

---

## 🐛 Troubleshooting

### If calls still fail with "User declined":

1. **Double-check username/password match**
   - Go to Twilio → Credential Lists → Retell-Auth
   - Verify username is exactly `doclittles`
   - Copy password directly from Twilio
   - Paste into Retell (no extra spaces)

2. **Check IP ACLs**
   - Retell's IPs must be in Twilio's `Retell-IPs` ACL
   - Contact Retell support to get their current IP addresses
   - Add them to Twilio → SIP Trunking → IP Access Control Lists → Retell-IPs

3. **Verify Termination URI**
   - In Retell: `aimedicalvoiceagent.pstn.twilio.com`
   - In Twilio: Check trunk domain matches

4. **Check Twilio Call Logs**
   - Look at the failed call details
   - Check "SIP PCAP Log" for SIP authentication errors
   - Look for "401 Unauthorized" or "403 Forbidden" responses

---

## 📞 Next Steps

1. ✅ Update Retell Dashboard with exact values above
2. ✅ Verify username/password match between Twilio and Retell
3. ✅ Test call: `node scripts/test-retell-outbound.js +18622307479`
4. ✅ Check Retell Dashboard → Call History for status
5. ✅ If still failing, check Twilio Call Logs → SIP PCAP Log for SIP errors

