# Google Calendar Integration - User Experience

## Overview

DocLittle provides **seamless, one-click Google Calendar integration**. Users don't need any technical knowledge or setup - they just click "Connect" and we handle everything.

---

## User Journey

### Step 1: User Clicks "Connect" (5 seconds)
- User goes to **Settings** → **Connected Services**
- Sees "Google Calendar: Not connected"
- Clicks **"Connect Google Calendar"** button

### Step 2: Google Authorization (10 seconds)
- User is redirected to Google's OAuth screen
- Sees: "DocLittle wants to access your Google Calendar"
- Clicks **"Allow"** (one click)

### Step 3: Automatic Setup (Instant)
- User is redirected back to DocLittle
- Calendar status shows: **"✅ Connected"**
- **That's it!** No further action needed

---

## What Happens Automatically

Once connected, DocLittle handles **everything** automatically:

### ✅ Availability Checking
- When patients call to schedule, DocLittle checks the user's Google Calendar
- Prevents double-booking
- Respects existing calendar events

### ✅ Event Creation
- New appointments automatically create Google Calendar events
- Events include patient name, appointment type, and time
- Events are added to the user's connected calendar

### ✅ Event Updates
- When appointments are rescheduled, calendar events update automatically
- When appointments are cancelled, calendar events are deleted
- All changes sync in real-time

### ✅ Token Management
- Refresh tokens are stored securely
- Access tokens refresh automatically when expired
- No user action required for token management

### ✅ Error Handling
- If connection is lost, system attempts automatic reconnection
- Users are notified only if manual reconnection is needed
- All errors are handled gracefully

---

## Multi-User Architecture

### How It Works

```
┌─────────────────────────────────────────────┐
│  DocLittle Platform                         │
│  - ONE Google OAuth App (set up once)      │
│  - Handles all OAuth flows                  │
│  - Stores tokens per user securely          │
└─────────────────────────────────────────────┘
              │
              │ Each user connects once
              │
    ┌─────────┴─────────┐
    │                   │
    ▼                   ▼
┌─────────┐        ┌─────────┐
│ User 1  │        │ User 2  │
│ Calendar│        │ Calendar│
│ (Token) │        │ (Token) │
└─────────┘        └─────────┘
```

### Key Points

- **One OAuth App**: DocLittle sets up one Google OAuth application
- **Per-User Tokens**: Each user's tokens are stored separately and securely
- **Isolated Calendars**: Each user's calendar is completely isolated
- **No Conflicts**: Multiple users can connect without interfering with each other

---

## User Experience Examples

### Example 1: First-Time Connection

**Provider A (Dr. Smith)**
1. Logs into DocLittle
2. Goes to Settings
3. Clicks "Connect Google Calendar"
4. Authorizes on Google
5. ✅ Connected in 15 seconds

**Provider B (Dr. Jones)**
1. Logs into DocLittle (same platform)
2. Goes to Settings
3. Clicks "Connect Google Calendar"
4. Authorizes on Google
5. ✅ Connected in 15 seconds

**Result**: Both providers have their own calendars connected, completely isolated from each other.

---

### Example 2: Automatic Syncing

**Scenario**: Patient calls to schedule appointment

1. **Voice Agent**: "I can see you're available at 2 PM tomorrow. Would you like to schedule?"
2. **System**: Automatically checks Dr. Smith's Google Calendar
3. **System**: Sees 2 PM is free (no conflicts)
4. **System**: Creates appointment
5. **System**: Automatically creates Google Calendar event
6. **Result**: Dr. Smith's Google Calendar now shows the appointment

**User Action Required**: None. Everything is automatic.

---

### Example 3: Rescheduling

**Scenario**: Patient calls to reschedule

1. **Voice Agent**: "I can reschedule you to 3 PM instead"
2. **System**: Checks availability at 3 PM
3. **System**: Updates appointment in database
4. **System**: Automatically updates Google Calendar event
5. **Result**: Google Calendar event moves from 2 PM to 3 PM

**User Action Required**: None. Everything is automatic.

---

## Troubleshooting for Users

### "Calendar not syncing"

**Solution**: Click "Refresh" button in Settings. System will:
- Check connection status
- Refresh tokens if needed
- Re-sync calendar events

### "Need to reconnect"

**Solution**: Click "Disconnect" then "Connect" again. System will:
- Clear old tokens
- Start fresh OAuth flow
- Re-establish connection

### "Events not appearing"

**Solution**: Usually resolves automatically. If not:
1. Check that calendar is connected (Settings)
2. Wait 1-2 minutes for sync
3. Click "Refresh" if needed

---

## Security & Privacy

### What We Store
- ✅ Refresh tokens (encrypted)
- ✅ Calendar ID (which calendar to use)
- ✅ Last sync timestamp

### What We DON'T Store
- ❌ Calendar event content (only checks availability)
- ❌ Personal Google account information
- ❌ Passwords or sensitive data

### Token Security
- Tokens are stored per-user, isolated
- Tokens are encrypted at rest
- Tokens refresh automatically
- Users can disconnect anytime

---

## Summary

### For Users
- **One click** to connect
- **Zero maintenance** required
- **Automatic syncing** always
- **Secure** and private

### For Platform (DocLittle)
- **One-time setup** of OAuth app
- **Automatic token management**
- **Per-user isolation**
- **Scalable** to unlimited users

---

## Technical Details (For Developers)

See `docs/setup/google/GOOGLE_OAUTH_COMPLETE_GUIDE.md` for platform setup instructions.

