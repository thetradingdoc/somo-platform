# SIP Trunk Configuration Guide

## ✅ Twilio Configuration (VERIFIED)

Based on the diagnostic script, your Twilio configuration is correct:

### SIP Trunk: `Retell-AI-Trunk`
- **Trunk SID**: `TKef81908ba0a83bb52eff902076f5abfc`
- **Phone Number**: `+15856202445` ✅ Attached
- **Origination URI**: `sip:sip.retellai.com` ✅ Configured
- **Termination URI**: `aimedicalvoiceagent.pstn.twilio.com` ✅ Configured (from trunk domainName)
- **Credential List**: `retell-outbound` ✅ Attached
- **IP ACLs**: `Retell-IPs` (2 lists) ✅ Attached

## ❌ Issue: Retell Dashboard Configuration

The calls are failing because **Retell dashboard needs to be configured** with the correct termination URI and credentials.

## 🔧 Retell Dashboard Configuration Steps

### 1. Go to Retell Dashboard → Settings → Telephony

### 2. Configure Termination SIP URI

**Termination URI**: `aimedicalvoiceagent.pstn.twilio.com`

This is what Retell should use when making outbound calls through Twilio.
**This matches the trunk's domainName property.**

### 3. Configure SIP Credentials

**Credential List**: `retell-outbound`
**Username**: `doclittles` (from Twilio credential list - note the "s" at the end)
**Password**: [Get from Twilio Console → SIP → Credential Lists → retell-outbound]

To get the password:
1. Go to Twilio Console → SIP → Credential Lists
2. Click on "retell-outbound"
3. Click on the credential (username: **doclittles**)
4. Copy the password (or reset it if needed)

### 4. Verify IP Addresses

**IP Access Control Lists**: `Retell-IPs`
- Retell US Block 1: `143.223.88.0`
- Retell US Block 2: `161.115.160.0`

These should already be configured in Twilio, but verify Retell is using these IPs.

## 🔍 Verification Checklist

- [ ] Retell termination URI matches: `aimedicalvoiceagent.pstn.twilio.com`
- [ ] Retell SIP username matches: `doclittles` (with "s")
- [ ] Retell SIP password matches Twilio credential
- [ ] Retell is using the correct IP addresses
- [ ] Retell trunk status shows as "Active" or "Connected"

## 🧪 Testing After Configuration

After updating Retell dashboard:

```bash
node scripts/test-retell-outbound.js +18622307479
```

Then check:
1. Retell dashboard → Call History (should show "connected" status)
2. Twilio Console → Call Logs (should show "completed" status)
3. Server logs (should show webhook calls)

## 📊 Current Status

- ✅ Twilio trunk is properly configured
- ✅ Authentication is set up (credentials + IP ACLs)
- ✅ Phone number is attached
- ❌ Retell dashboard needs termination URI and credentials configured

## 💡 Why Calls Are Failing

The calls show `trunking-terminating` direction and `failed` status because:
1. Retell is trying to use the SIP trunk (correct)
2. But Retell doesn't have the correct termination URI configured
3. OR Retell's SIP credentials don't match Twilio's credential list
4. Result: Authentication fails → Call fails immediately

## 🎯 Next Steps

1. **Configure Retell Dashboard** with the termination URI and credentials above
2. **Test the call** again
3. **Check Retell dashboard** for any error messages
4. **Monitor Twilio logs** for authentication errors

Once Retell is configured correctly, calls should connect successfully!

