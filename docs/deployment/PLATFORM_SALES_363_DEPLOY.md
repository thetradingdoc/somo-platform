# Platform sales line (+363) — production deploy

**SSOT routing:** [VOICE_ROUTING_SSOT.md](../voice/VOICE_ROUTING_SSOT.md)  
**Number:** `+13639990205` (`CALLSOMO_OPERATOR_TWILIO_NUMBER` / `TWILIO_PHONE_NUMBER`)  
**Routing world:** `platform_support` (`PLATFORM_INBOUND_MODE=support`, `NAVIGATION_ENABLED=0`)

## Prerequisites

- Cloud Run `somo-middleware` image includes Kelly Rails + platform sales rails (Jest: `platform-sales|somo-sales|sales-crm`)
- `CALLSOMO_OPERATOR_CUSTOMER_ID` set to operator tenant
- `CALLSOMO_OPERATOR_FALLBACK_PSTN` set for human handoff
- `RETELL_SALES_AGENT_ID` or `RETELL_AGENT_ID` for outbound CRM (separate from inbound)

## Deploy sequence (production)

Run from `middleware-platform/` against the **production DB snapshot** (GCS pull) unless noted.

### 1. Bind platform DID to operator

```bash
npm run phase1:pull-db          # repo root — refresh GCS snapshot
node scripts/bind-operator-platform-did.cjs --dry-run
node scripts/bind-operator-platform-did.cjs
# Upload DB only after review: npm run portal-e2e:upload-db:sync
```

### 2. Cloud Run environment

Ensure live service has:

| Variable | Value |
|----------|--------|
| `PLATFORM_INBOUND_MODE` | `support` |
| `NAVIGATION_ENABLED` | `0` |
| `KELLY_RAILS_V2` | `1` |
| `CONVERSATION_MODE_ROUTING` | `enforce` |
| `CALLSOMO_OPERATOR_FALLBACK_PSTN` | operator mobile E.164 |
| `CALLSOMO_OPERATOR_CUSTOMER_ID` | operator customer id |

```bash
npm run verify:kelly-rails-env   # against live Cloud Run URL
```

### 3. Sync Twilio + Retell operator voice

```bash
node scripts/callsomo-operator-sync.cjs
node scripts/fix-operator-voice-openers.cjs
npm run preflight:operator-voice
```

### 4. Deploy middleware + hosting

```bash
# From repo root — see Phase 7.9
node scripts/build-staging-hosting.cjs
node scripts/deploy-firebase-hosting.cjs
# Deploy Cloud Run image per your standard pipeline
```

### 5. Post-deploy verification (automated + manual)

```bash
node scripts/platform-routing-post-deploy-verify.cjs
node scripts/verify-crm-pipeline.cjs --api-base https://api.callsomo.com
npm test -- --testPathPattern="platform-sales|somo-sales|sales-crm"
```

**Manual (required for 10.1 / 10.2 close):**

1. Place a real inbound PSTN call to `+13639990205`
2. Confirm logs show `routing_world=platform_support` (not `navigation` / tenant Kelly)
3. Complete a short qual conversation (practice type + pain)
4. Within ~2 minutes, open `/admin/pipeline.html` → filter **Inbound platform (363)**
5. Confirm lead appears with score tier (hot ≥70, warm 40–69, cold &lt;40)
6. Optional: `node scripts/verify-crm-pipeline.cjs --session call_xxx`

## Rollback

- Revert Cloud Run revision
- Restore prior GCS DB snapshot if DID bind was wrong
- Set `PLATFORM_INBOUND_MODE=support` remains safe; do **not** re-enable navigation on 363 without product sign-off

## Related scripts

| Script | Purpose |
|--------|---------|
| `bind-operator-platform-did.cjs` | Bind +363 to operator; clear nav-demo conflict |
| `fix-operator-voice-openers.cjs` | Platform sales opener on operator tenant |
| `platform-routing-post-deploy-verify.cjs` | Env pre-flight + optional Retell session check |
| `verify-crm-pipeline.cjs` | CRM facade, TCPA gate, inbound lead tiering |
| `debug-crm-pipeline.js` | Deep scrape/enrich diagnostic |
