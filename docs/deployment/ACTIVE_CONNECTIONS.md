# Retell WebSocket activeConnections

`RetellWebSocketHandler.activeConnections` is an in-memory `Map` per Cloud Run instance.

## Implications

- Connection count is not shared across instances
- Sticky sessions are not required (Retell reconnects to same call_id)
- Horizontal scale is safe for call handling; per-instance metrics only

## Mitigation

- `CLOUDRUN_MIN_INSTANCES=1` default in `scripts/deploy-to-gcp.sh` reduces cold-start webhook failures
- Call state persisted in `voice_call_states` / `usage_events` for billing across instances
