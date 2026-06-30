# Health multi-replica deployment

Until `HEALTH_SSE_BUS=redis` is implemented:

1. Run **one** middleware replica for health video, or use **sticky sessions** by room ID.
2. In-memory SSE (`video-consult-sse`) and turn queues (`health/turn-service`) are per-process.
3. Set `HEALTH_SSE_BUS=memory` (default).

## Future

- Implement `services/health/transport/sse-redis-adapter.js`
- Pluggable turn queue backend for `health/turn-service`
