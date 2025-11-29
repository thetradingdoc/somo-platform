# Multi-Tenant Google OAuth Setup

## Your Architecture

```
doclittle.site/clinicA  → Clinic A's dashboard
doclittle.site/clinicB  → Clinic B's dashboard
doclittle.site/clinicC  → Clinic C's dashboard
```

Each clinic is a separate tenant, but they all use the same DocLittle platform.

---

## Google OAuth Setup (One Time)

### Register ONE Redirect URI

In Google Cloud Console, add **ONE redirect URI** that handles all clinics:

```
https://doclittle.site/auth/google/calendar/callback
```

**Do NOT** register separate URIs for each clinic. The system already handles routing back to the correct clinic.

---

## How It Works

### Flow for Clinic A

1. **User at Clinic A** (`doclittle.site/clinicA`) clicks "Connect Google Calendar"
2. **System** redirects to Google OAuth with:
   - Redirect URI: `https://doclittle.site/auth/google/calendar/callback` (same for all)
   - State parameter: Contains `returnUrl: doclittle.site/clinicA/settings`
3. **User** authorizes on Google
4. **Google** redirects back to: `https://doclittle.site/auth/google/calendar/callback`
5. **System** processes OAuth, stores tokens
6. **System** redirects user back to: `doclittle.site/clinicA/settings` (from state)

### Flow for Clinic B

1. **User at Clinic B** (`doclittle.site/clinicB`) clicks "Connect Google Calendar"
2. **System** redirects to Google OAuth with:
   - Redirect URI: `https://doclittle.site/auth/google/calendar/callback` (same)
   - State parameter: Contains `returnUrl: doclittle.site/clinicB/settings`
3. **User** authorizes on Google
4. **Google** redirects back to: `https://doclittle.site/auth/google/calendar/callback`
5. **System** processes OAuth, stores tokens for Clinic B user
6. **System** redirects user back to: `doclittle.site/clinicB/settings` (from state)

---

## Google Cloud Console Configuration

### Authorized Redirect URIs

Add **only these**:

```
http://localhost:4000/auth/google/calendar/callback
https://doclittle.site/auth/google/calendar/callback
```

**That's it!** No need to add:
- ❌ `https://doclittle.site/clinicA/auth/google/calendar/callback`
- ❌ `https://doclittle.site/clinicB/auth/google/calendar/callback`
- ❌ Each clinic separately

---

## Environment Variables

### Development (.env)
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/calendar/callback
```

### Production (.env)
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://doclittle.site/auth/google/calendar/callback
```

---

## How Routing Works

The system already handles this! Here's the code flow:

1. **Connect Request** (`/auth/google/calendar/connect`)
   - Receives `returnUrl` parameter (e.g., `doclittle.site/clinicA/settings`)
   - Encodes it in the OAuth `state` parameter
   - Redirects to Google

2. **Callback** (`/auth/google/calendar/callback`)
   - Google redirects to: `https://doclittle.site/auth/google/calendar/callback`
   - System decodes `state` to get original `returnUrl`
   - Processes OAuth, stores tokens
   - Redirects user back to: `doclittle.site/clinicA/settings`

---

## Multi-Tenant Token Storage

Each clinic's users have separate tokens:

```
Clinic A:
  - user1@clinicA.com → Token A1
  - user2@clinicA.com → Token A2

Clinic B:
  - user1@clinicB.com → Token B1
  - user2@clinicB.com → Token B2
```

Tokens are stored per user, isolated by clinic/user identity.

---

## Summary

✅ **One OAuth App**: DocLittle has one OAuth app
✅ **One Redirect URI**: `https://doclittle.site/auth/google/calendar/callback`
✅ **Multi-Tenant Routing**: System routes back to correct clinic via `returnUrl` in state
✅ **Per-User Tokens**: Each user's tokens stored separately
✅ **Scalable**: Add unlimited clinics without updating Google Cloud Console

---

## Checklist

- [ ] Add `https://doclittle.site/auth/google/calendar/callback` to Google Cloud Console
- [ ] Set `GOOGLE_REDIRECT_URI=https://doclittle.site/auth/google/calendar/callback` in production `.env`
- [ ] Test with Clinic A: Should redirect back to `doclittle.site/clinicA/settings`
- [ ] Test with Clinic B: Should redirect back to `doclittle.site/clinicB/settings`
- [ ] Verify tokens are stored per user/clinic

---

## Important Notes

1. **Don't add clinic-specific redirect URIs** - The single callback handles all clinics
2. **The `returnUrl` in state** handles routing back to the correct clinic
3. **Each clinic's users** get their own tokens, completely isolated
4. **Scalable**: New clinics work automatically without Google Cloud Console changes

