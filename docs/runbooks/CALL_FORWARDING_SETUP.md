# Call forwarding setup — Kelly go-live

When Kelly is your AI front desk, callers dial your **office main line** (or a forwarded number) and reach Kelly on your Somo number. Configure forwarding so live staff can still answer when Kelly is paused or outside coverage hours.

## Prerequisites

- Somo dedicated line provisioned (`twilio_phone_number` on your account)
- **Warm transfer number** saved in voice setup (your office PSTN — where Kelly sends upset callers, kill-switch, and after-hours transfers)
- Kelly status **Active** (not paused) during business/coverage hours

## Option A — Forward main office line to Somo (recommended pilot)

1. In voice setup, copy your **Somo number** from Step 5.
2. On your office phone system (Verizon, AT&T, RingCentral, etc.), set **call forwarding** on your published office line to that Somo number.
3. Test: call your office line from a mobile phone — you should hear Kelly's greeting.

### Carrier quick paths

| Carrier | Typical path |
|---------|----------------|
| Verizon business | Admin portal → Numbers → Call forwarding → Forward all |
| AT&T | myAT&T for Business → Voice → Call forwarding |
| RingCentral | Phone System → Phones → Forwarding |
| Google Voice | Settings → Calls → Call forwarding |

## Option B — Somo number published; office line is transfer target

1. Publish the Somo number on your website / Google Business Profile.
2. Set **Warm transfer number** to your front desk PSTN (where humans answer).
3. When Kelly is **paused** or outside **coverage hours**, inbound calls to Somo forward to that PSTN automatically.

## Kill switch (Kelly paused)

When you pause Kelly in the dashboard:

- Inbound calls to your Somo line **dial your transfer number** (not a hangup).
- If no transfer number is configured, callers hear the unavailable message and the call ends.

## Coverage mode (part-time Kelly)

If your plan uses **coverage mode** (e.g. M/W/F lunch coverage only):

- Kelly answers only during **coverage hours** configured in voice settings.
- Outside coverage hours, calls forward to your transfer number (same as after-hours transfer when enabled).

## After-hours behavior

Configure **After-hours action** in voice settings:

| Action | Behavior |
|--------|----------|
| `message_only` | Play after-hours message, then hang up |
| `transfer` | Play message, then dial transfer number |
| `voicemail` | Play message, then hang up (voicemail on office system if forwarded) |

## Shadow week (soft launch)

Enable **Shadow reply suppress** in voice settings during pilot week:

- Kelly runs the full conversation loop for telemetry.
- Spoken replies are suppressed — a human answers on the transfer line while you compare desk notes to Kelly logs.

## Verification checklist

- [ ] Transfer number saved and E.164 format (`+1…`)
- [ ] Test call during business hours → Kelly answers
- [ ] Pause Kelly → test call forwards to office PSTN
- [ ] After-hours test → message or transfer per config
- [ ] Shadow week: replies suppressed, events logged in call detail

## Support

If forwarding fails, confirm Somo number in dashboard matches carrier forward target and that `transfer_number` is set on your clinic record.
