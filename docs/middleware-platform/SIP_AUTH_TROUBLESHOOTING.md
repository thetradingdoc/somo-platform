# SIP Authentication Troubleshooting Guide

## ❌ Current Issue
**Call Status**: `failed`  
**Direction**: `trunking-terminating`  
**Error**: SIP authentication failure (call reaches Twilio but is rejected)

## 🔍 Step-by-Step Fix

### Step 1: Check Twilio SIP PCAP Log
1. Go to **Twilio Console → Call Logs**
2. Find the failed call (Call SID: `CAe7716aa010ecbb09fd9d3cd532003313`)
3. Click on the call → **SIP PCAP Log** → **Download**
4. Look for:
   - `401 Unauthorized` = Wrong username/password
   - `403 Forbidden` = IP ACL blocking or credential mismatch
   - `407 Proxy Authentication Required` = Missing authentication

### Step 2: Verify Twilio Credentials
1. Go to **Twilio Console → SIP Trunking → Credential Lists**
2. Open **Retell-Auth**
3. Click on the credential (should be `doclittles`)
4. **Copy the username exactly** (including any case sensitivity)
5. **Copy the password exactly** (no extra spaces, no typos)

### Step 3: Update Retell Dashboard
1. Go to **Retell Dashboard → Settings → Telephony → SIP Trunk Configuration**
2. Fill in these **EXACT** values:

```
Phone Number: +15856202445
Termination URI: aimedicalvoiceagent.pstn.twilio.com
SIP Username: [paste from Twilio - should be "doclittles"]
SIP Password: [paste from Twilio - exact copy]
Outbound Transport: TCP
```

3. **Critical checks:**
   - ✅ Username matches Twilio **exactly** (case-sensitive)
   - ✅ Password matches Twilio **exactly** (copy-paste, no typing)
   - ✅ Termination URI has no `sip:`, no `https://`, no trailing `/`
   - ✅ No extra spaces before/after any field

### Step 4: Verify IP ACLs
1. Go to **Twilio Console → SIP Trunking → IP Access Control Lists**
2. Check **Retell-IPs** list
3. Verify Retell's IP addresses are in the list
4. If unsure, contact Retell support for their current IP addresses

### Step 5: Test Again
```bash
cd middleware-platform
node scripts/test-retell-outbound.js +18622307479
```

## 🐛 Common Issues

### Issue 1: Username Mismatch
**Symptom**: `401 Unauthorized` in SIP PCAP log  
**Fix**: 
- Check if username in Twilio is `doclittles` or `doclittle`
- Update Retell to match **exactly** (case-sensitive)

### Issue 2: Password Mismatch
**Symptom**: `401 Unauthorized` in SIP PCAP log  
**Fix**:
- Copy password directly from Twilio console
- Paste into Retell (don't type it)
- Check for hidden characters or spaces

### Issue 3: Termination URI Mismatch
**Symptom**: `404 Not Found` or connection timeout  
**Fix**:
- Must be exactly: `aimedicalvoiceagent.pstn.twilio.com`
- No protocol prefix (`sip:`, `https://`)
- No trailing slash (`/`)

### Issue 4: IP ACL Blocking
**Symptom**: `403 Forbidden` in SIP PCAP log  
**Fix**:
- Get Retell's current IP addresses from Retell support
- Add them to Twilio → IP Access Control Lists → Retell-IPs

## 📞 Next Steps

1. ✅ Check SIP PCAP log in Twilio for exact error
2. ✅ Verify credentials match exactly (username + password)
3. ✅ Update Retell dashboard with exact values
4. ✅ Test call again
5. ✅ If still failing, share SIP PCAP log error code

## 🔗 Quick Reference

- **Twilio Trunk SID**: `TKef81908ba0a83bb52eff902076f5abfc`
- **Twilio Domain**: `aimedicalvoiceagent.pstn.twilio.com`
- **Credential List**: `Retell-Auth`
- **Expected Username**: `doclittles` (verify in Twilio console)

