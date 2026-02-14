# Intelligence Layer Architecture

**Source of Truth**: [MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md](./MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md)  
**Layer 1 Implementation**: [LAYER1_PERCEPTION_IMPLEMENTATION_GUIDE.md](./LAYER1_PERCEPTION_IMPLEMENTATION_GUIDE.md)

---

## Overview

The intelligence layer is the most vital part of the middleware. It implements a **multimodal medical AI architecture** with four layers:

1. **Layer 1: Multimodal Perception** — Transform raw inputs (images, text, audio) into unified perceptual state with cross-modal validation
2. **Layer 2: Agentic RAG & Knowledge** — Retrieve relevant codes, guidelines, similar cases from vector DB and knowledge graph
3. **Layer 3: Reasoning & Coding Agents** — Specialty-specific agents propose ICD-10/CPT codes grounded in perceptual evidence
4. **Layer 4: Reflection & Critique** — Quality gate, hallucination detection, CMS compliance validation

---

## Current vs Target

| Component | Current | Target |
|-----------|---------|--------|
| **Extraction** | Rule-based + abbreviation expansion | LLM-based + ClinicalBERT NER (future) |
| **Vision** | GPT-4o vision encoder (X-ray, MRI, dermatology) | Done |
| **Audio** | Not implemented (Retell ASR elsewhere) | Deepgram nova-2-medical (optional) |
| **Fusion** | Cross-attention (text ↔ image alignment) | Done |
| **Perceptual State** | Full JSON with findings, links, confidence, specialty_tag, review flags | Done |

---

## Build Order

1. **Layer 1 ✅** — Perception implemented; feeds `coding-orchestrator` and `medical-coding-service`
2. Use `OPENAI_API_KEY` or Azure OpenAI from env for GPT-4o (vision + cross-modal reasoning)
3. Integrate with existing `coding-graph.js` as the `perceive` node (when using LangGraph)

---

## Related Docs

- [Middleware Brain Improvements](../middleware/MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md)
- [LangChain/LangGraph Architecture](../ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md)
- [Knowledge Base](../../knowledge-base/README.md)
