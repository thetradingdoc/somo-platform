# Architecture Documentation

System architecture, design decisions, and technical documentation.

---

## 📚 Documentation Index

### Vision & Overview
- **[vision/VISION.md](./vision/VISION.md)** — Platform vision, goals, roadmap

### Core Architecture
- **[database/DATABASE_SCHEMA_APPROACH.md](./database/DATABASE_SCHEMA_APPROACH.md)** — Database design, multi-tenancy
- **[multi-tenant/MULTI_TENANT_VOICE_AGENT.md](./multi-tenant/MULTI_TENANT_VOICE_AGENT.md)** — Multi-tenant architecture
- **[payments/PAYMENT_ARCHITECTURE.md](./payments/PAYMENT_ARCHITECTURE.md)** — Payment processing, orchestrator

### Hybrid (Voice + Video + PDF)
- **[HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md)** — One-page: entry points, how codes are obtained, shared RAG/FHIR, boundaries
- **[HYBRID_ARCHITECTURE_IMPROVEMENTS.md](./HYBRID_ARCHITECTURE_IMPROVEMENTS.md)** — Implemented improvements summary
- **[VIDEO_CONSULT.md](./VIDEO_CONSULT.md)** — Video consult: flow, env vars, runbook (single doc)
- **[LANDING_TRY_NOW_LIVEKIT.md](./LANDING_TRY_NOW_LIVEKIT.md)** — Skin & Care landing Try now: camera + orb PiP, LiveKit token, not video-consult agents
- **[VISION_UV_R_AND_D.md](./VISION_UV_R_AND_D.md)** — UV imaging as separate hardware/calibration validation track

### Layer-Specific
- **[intelligence-layer/README.md](./intelligence-layer/README.md)** — Multimodal medical AI (Layers 1–4), perception, RAG, coding agents
- **[financial/FINANCIAL_LAYER_ARCHITECTURE.md](./financial/FINANCIAL_LAYER_ARCHITECTURE.md)** — Insurance, claims, EOB, coding, settlement, Tiba
- **[healthcare/HEALTHCARE_ASSESSMENT.md](./healthcare/HEALTHCARE_ASSESSMENT.md)** — Healthcare platform assessment
- **[media/MEDIA_LAYER_ARCHITECTURE.md](./media/MEDIA_LAYER_ARCHITECTURE.md)** — Retell, Twilio, LiveKit
- **[ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md](./ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md)** — LangChain, LangGraph, RAG, state, memory, evaluation

### Implementation & Maintenance
- **[middleware/MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md](./middleware/MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md)** — Brain improvements implementation
- **[maintenance/ARCHITECTURE_ISSUES.md](./maintenance/ARCHITECTURE_ISSUES.md)** — Known architecture issues
- **[FIXES_APPLIED.md](../archive/FIXES_APPLIED.md)** — Applied fixes log (archived)

### Voice Agent & Retell
- **[voice-agent/RUNBOOK.md](./voice-agent/RUNBOOK.md)** — Medical coding runbook
- **[voice-agent/TOOL_SCHEMAS.md](./voice-agent/TOOL_SCHEMAS.md)** — Retell function schemas
- **[voice-agent/AUTOMATED_RETELL_AGENT_CREATION.md](./voice-agent/AUTOMATED_RETELL_AGENT_CREATION.md)** — Agent provisioning

### Financial Layer (Tiba)
- **[financial/TIBA_AND_BILLING_TODO.md](./financial/TIBA_AND_BILLING_TODO.md)** — Tiba gaps, remediation, billing
- **[financial/STATIC_RECORDS_AUDIT.md](./financial/STATIC_RECORDS_AUDIT.md)**

### Stripe
- **[integrations/stripe/issuing/STRIPE_ISSUING.md](../../integrations/stripe/issuing/STRIPE_ISSUING.md)** — Stripe Issuing (consolidated)

---

## 🏗️ Architecture Overview

- **Multi-tenant** architecture
- **Voice-first** interface via Retell
- **Payment orchestration** layer
- **FHIR-compliant** healthcare data
- **Microservices** approach

---

## 🔗 Related Documentation

- **API:** `../api/README.md`
- **Deployment:** `../deployment/README.md`
- **Main Docs:** `../README.md`

---

**Last Updated:** April 9, 2026
