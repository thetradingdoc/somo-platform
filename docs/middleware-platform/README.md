# Middleware Platform Documentation

Documentation for the middleware-platform backend service.

## 📚 Documentation

### Configuration & Setup
- **[LangGraph & LangSmith](./LANGGRAPH_LANGSMITH.md)** — Config, what’s traced, progress, scripts, troubleshooting
- **[SIP Authentication Troubleshooting](./SIP_AUTH_TROUBLESHOOTING.md)** - Guide for troubleshooting SIP authentication issues with Twilio and Retell
- **[Retell Configuration Quick Reference](./RETELL_CONFIG_QUICK_REFERENCE.md)** - Quick reference for Retell SIP trunk configuration values
- **[Retell SIP Config Final](./RETELL_SIP_CONFIG_FINAL.md)** - Final verified configuration values for Retell SIP trunking
- **[Voice Checkout Verification](./VOICE_CHECKOUT_VERIFICATION.md)** - Voice checkout flow verification (create_checkout, email)

### Configure Retell Agent
Run from **middleware-platform/** directory:

```bash
cd middleware-platform
node configure-retell.js
```

Requires: server running (or `API_BASE_URL` for production), `RETELL_API_KEY`, `RETELL_AGENT_ID` in `.env`. Loads Kelly + medical prompt, pushes to Retell.

### Related Documentation
- See [docs/architecture/voice-agent/](../architecture/voice-agent/) for voice agent architecture, RUNBOOK, TOOL_SCHEMAS
- See [deployment/](../deployment/) for deployment guides
- See [setup/](../setup/) for setup instructions

---

**Last Updated**: February 2026

