# Multimodal Medical AI Agent Architecture
## Complete System Design for Clinical Coding & Decision Support

**Version**: 1.0  
**Date**: February 9, 2026  
**Use Cases**: X-rays, MRI, Dermatology Images + Clinical Text/Audio → ICD-10/CPT Coding

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture Overview](#system-architecture-overview)
3. [Layer 1: Multimodal Perception Layer](#layer-1-multimodal-perception-layer)
4. [Layer 2: Agentic RAG & Knowledge Layer](#layer-2-agentic-rag--knowledge-layer)
5. [Layer 3: Reasoning & Coding Agents](#layer-3-reasoning--coding-agents)
6. [Layer 4: Reflection & Critique](#layer-4-reflection--critique)
7. [Infrastructure & Data Flow](#infrastructure--data-flow)
8. [Implementation Roadmap](#implementation-roadmap)
9. [Compliance & Safety](#compliance--safety)
10. [Cost Analysis](#cost-analysis)

---

## Executive Summary

### Problem Statement

Current medical coding systems operate in silos:
- **Image analysis** → Radiologist interpretation → Text notes → Coding
- **Clinical text** → NLP extraction → Code suggestion
- **No true fusion** → Hallucinations, missed diagnoses, billing errors

### Solution Architecture

**Multimodal-at-the-Cognition-Level System** where visual and textual information are fused before reasoning occurs, enabling:

✅ **Cross-modal validation**: "Is the fracture mentioned in notes visible in the X-ray?"  
✅ **Grounded reasoning**: No hallucinated anatomical findings  
✅ **Audit trail**: Every coding decision traceable to source evidence  
✅ **FDA/CMS defensible**: Clear separation of perception, reasoning, and decision-making

### Key Innovation

**From**: `Image → Caption → LLM reads caption → Suggests codes`  
**To**: `Image tokens + Text tokens → Shared latent space → Agentic reasoning → Validated codes`

This is not "AI-assisted coding" — this is **medical intelligence infrastructure**.

---

## System Architecture Overview

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          INPUT LAYER                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  X-Ray   │  │   MRI    │  │  Dermat. │  │  Audio   │               │
│  │  Images  │  │  Images  │  │  Images  │  │  (STT)   │               │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘               │
│        │             │              │             │                     │
│        └─────────────┴──────────────┴─────────────┘                     │
│                              │                                           │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              LAYER 1: MULTIMODAL PERCEPTION LAYER                        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  Early Fusion via Cross-Attention                              │    │
│  │                                                                 │    │
│  │  ┌─────────────┐         ┌─────────────┐                      │    │
│  │  │ Vision      │◄────────┤  Clinical   │                      │    │
│  │  │ Encoder     │  Cross- │  Text       │                      │    │
│  │  │ (ViT/Qwen)  │  Attn   │  Encoder    │                      │    │
│  │  └──────┬──────┘         └──────┬──────┘                      │    │
│  │         │                       │                              │    │
│  │         └───────────┬───────────┘                              │    │
│  │                     ▼                                          │    │
│  │          Shared Perceptual Embedding                          │    │
│  │          {visual_findings, textual_findings,                  │    │
│  │           cross_modal_links}                                  │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Models: GPT-4o / Qwen2-VL / LLaVA-Med / Med-Gemini                    │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│         LAYER 2: AGENTIC RAG & KNOWLEDGE LAYER                          │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Routing Agent (Specialty Classification)                    │      │
│  │  • Cardiology  • Orthopedics  • Neurology  • Dermatology    │      │
│  │  • Emergency Triage  • General Medicine                      │      │
│  └────────────────────┬─────────────────────────────────────────┘      │
│                       │                                                 │
│                       ▼                                                 │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Hybrid Knowledge Retrieval                                  │      │
│  │                                                               │      │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │      │
│  │  │ Vector DB    │  │ Graph DB     │  │ Live EHR     │      │      │
│  │  │ (Semantic)   │  │ (Relations)  │  │ (API)        │      │      │
│  │  │              │  │              │  │              │      │      │
│  │  │ • Code       │  │ • ICD-CPT    │  │ • Patient    │      │      │
│  │  │   Embeddings │  │   Rules      │  │   History    │      │      │
│  │  │ • Guidelines │  │ • Anatomy    │  │ • Prior      │      │      │
│  │  │ • Similar    │  │   Ontology   │  │   Codes      │      │      │
│  │  │   Cases      │  │ • CMS 2026   │  │              │      │      │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                          │
│  Storage: pgvector (Postgres) → Pinecone (when scaling)                │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          LAYER 3: REASONING & CODING AGENTS                             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  Specialty Sub-Graphs (Conciliator Pattern)                    │    │
│  │                                                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │    │
│  │  │ Cardiology   │  │ Orthopedics  │  │ Dermatology  │  ...   │    │
│  │  │ Agent        │  │ Agent        │  │ Agent        │        │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │    │
│  │                                                                 │    │
│  │  Each agent:                                                   │    │
│  │  • Domain-specific prompts                                     │    │
│  │  • Specialty coding rules                                      │    │
│  │  • Access to relevant knowledge subgraphs                      │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Output: {proposed_icd10: [...], proposed_cpt: [...],                  │
│           reasoning_trace: [...], confidence_score: 0.XX}               │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          LAYER 4: REFLECTION & CRITIQUE                                 │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  Critique Node (Quality Gate)                                  │    │
│  │                                                                 │    │
│  │  Validates:                                                     │    │
│  │  ✓ Cross-modal consistency (image ↔ text alignment)           │    │
│  │  ✓ CMS 2026 compliance                                         │    │
│  │  ✓ Laterality correctness (left vs right)                     │    │
│  │  ✓ Acuity documentation (acute, chronic, sequela)             │    │
│  │  ✓ Code pair validity (ICD-10 ↔ CPT)                          │    │
│  │  ✓ Hallucination detection                                     │    │
│  │                                                                 │    │
│  │  Decision:                                                      │    │
│  │  • Auto-approve (confidence > 0.85)                            │    │
│  │  • Flag for review (0.60 - 0.85)                               │    │
│  │  • Reject & escalate (< 0.60)                                  │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    OUTPUT LAYER                                          │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ Approved     │  │ Flagged for  │  │ Audit Trail  │                 │
│  │ Codes        │  │ Human Review │  │ (FHIR)       │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Multimodal Perception Layer

### Purpose
**Transform raw multimodal inputs into a unified perceptual representation** where visual and textual evidence are co-present and cross-validated.

### Architecture

#### 1.1 Vision Encoder

**Model Selection Matrix**:

| Use Case | Recommended Model | Why |
|----------|-------------------|-----|
| **X-rays** | Qwen2-VL-7B or GPT-4o | Trained on medical imaging |
| **MRI** | Med-Gemini (when available) or Qwen2-VL | Multi-slice understanding |
| **Dermatology** | GPT-4o or LLaVA-Med | Lesion detection, skin texture |
| **General** | GPT-4o (multimodal) | Best cross-modal fusion |

**Recommended Stack**:
```
Primary: GPT-4o (via Azure OpenAI for HIPAA compliance)
Fallback/Fine-tuning: Qwen2-VL-7B (open-source, deployable on-prem)
```

#### 1.2 Text/Audio Encoder

**Text Processing**:
```
Clinical Text → ClinicalBERT → Text Embeddings (768d)
                ↓
         Expansion via Medical Dictionary
                ↓
         "SOB" → "shortness of breath"
         "FOOSH" → "fall on outstretched hand"
```

**Audio Processing**:
```
Audio (from call) → Deepgram STT (HIPAA-compliant)
                  → Text normalization
                  → ClinicalBERT
```

**Why ClinicalBERT stays**:
- Domain-specific understanding of medical language
- Feeds tokens into multimodal fusion model
- Does NOT make final decisions (avoids single-modality hallucination)

#### 1.3 Cross-Attention Mechanism

**Implementation** (conceptual):

```python
class MultimodalFusionLayer:
    def __init__(self):
        self.vision_encoder = Qwen2VL()  # or GPT4o
        self.text_encoder = ClinicalBERT()
        self.cross_attention = CrossAttentionBlock(
            dim=768,
            num_heads=12
        )
    
    def forward(self, image, text):
        # 1. Extract modality-specific features
        visual_tokens = self.vision_encoder(image)    # [batch, num_patches, 768]
        text_tokens = self.text_encoder(text)          # [batch, seq_len, 768]
        
        # 2. Cross-attention: text queries visual evidence
        fused = self.cross_attention(
            queries=text_tokens,      # "Is there a fracture?"
            keys=visual_tokens,       # Image patches
            values=visual_tokens      # "Yes, in these regions"
        )
        
        # 3. Bi-directional fusion (optional)
        fused_reversed = self.cross_attention(
            queries=visual_tokens,
            keys=text_tokens,
            values=text_tokens
        )
        
        return {
            'text_to_image': fused,
            'image_to_text': fused_reversed
        }
```

**Key Insight**: 
> Text asks: "Patient reports wrist pain after fall. Is there visual evidence?"  
> Visual tokens answer: "Yes, cortical discontinuity detected in distal radius, right side, probability 0.92"

This enables **grounded** code suggestions, not hallucinated ones.

#### 1.4 Output Format (Perceptual State)

**JSON Schema**:

```json
{
  "call_id": "call_12345",
  "timestamp": "2026-02-09T14:30:00Z",
  
  "visual_findings": [
    {
      "modality": "xray",
      "body_region": "distal_radius_right",
      "finding": "cortical_discontinuity",
      "confidence": 0.92,
      "bounding_box": [120, 340, 280, 450],
      "laterality": "right",
      "evidence_strength": "definitive"
    }
  ],
  
  "textual_findings": [
    {
      "concept": "FOOSH_injury",
      "mention": "fell on outstretched hand",
      "confidence": 0.87,
      "span": [45, 72]
    },
    {
      "concept": "wrist_pain",
      "severity": "moderate",
      "confidence": 0.95
    }
  ],
  
  "cross_modal_links": [
    {
      "text_concept": "wrist_pain",
      "visual_finding": "distal_radius_fracture",
      "alignment_score": 0.90,
      "supporting_evidence": "Patient-reported pain location matches fracture site"
    }
  ],
  
  "audio_metadata": {
    "speaker_diarization": ["patient", "physician"],
    "key_phrases": ["can't move my wrist", "heard a crack"],
    "sentiment": "distressed"
  }
}
```

**This perceptual state becomes the input to all downstream agents.**

---

## Layer 2: Agentic RAG & Knowledge Layer

### Purpose
**Dynamically retrieve relevant medical knowledge** based on perceptual state, routing to specialty-specific knowledge graphs.

### 2.1 Routing Agent

**Classifier Implementation**:

```javascript
class RoutingAgent {
    async classify(perceptualState) {
        const { visual_findings, textual_findings } = perceptualState;
        
        // Rule-based triage (fast path)
        const redFlags = this.detectRedFlags(textual_findings);
        if (redFlags.isEmergency) {
            return {
                urgency: 'EMERGENT',
                specialty: 'emergency',
                route: 'human_immediate_review',
                reason: redFlags.reason
            };
        }
        
        // LLM-based specialty routing
        const specialty = await this.classifySpecialty(
            visual_findings,
            textual_findings
        );
        
        return {
            urgency: this.calculateUrgency(perceptualState),
            specialty: specialty,
            route: `${specialty}_agent`,
            confidence: specialty.confidence
        };
    }
    
    detectRedFlags(findings) {
        // Chest pain + radiation → cardiology STAT
        // Stroke symptoms → neurology STAT
        // Compound fracture → orthopedics STAT + surgery consult
        // ...
    }
    
    async classifySpecialty(visualFindings, textualFindings) {
        const prompt = `
        Given:
        - Visual: ${JSON.stringify(visualFindings)}
        - Text: ${JSON.stringify(textualFindings)}
        
        Classify specialty:
        - cardiology: heart, chest pain, arrhythmia
        - orthopedics: fractures, joints, musculoskeletal
        - dermatology: skin lesions, rashes, moles
        - neurology: headaches, seizures, stroke symptoms
        - general: routine, preventive care
        
        Return JSON: {specialty: string, confidence: number}
        `;
        
        return await this.llm.invoke(prompt);
    }
}
```

**Routing Logic**:

```
IF visual_findings contains "fracture" AND body_region contains "radius|ulna|femur"
  → Route to: orthopedics_agent

IF visual_findings contains "mass|nodule" AND body_region contains "lung|mediastinum"
  → Route to: pulmonology_agent + radiology_review

IF textual_findings contains "chest_pain" AND visual_findings contains "cardiomegaly"
  → Route to: cardiology_agent + priority_high

IF dermatology_image AND visual_findings contains "melanoma_features"
  → Route to: dermatology_agent + dermatopathology_consult
```

### 2.2 Knowledge Retrieval System

**Multi-Source RAG**:

```
┌─────────────────────────────────────────────────────┐
│  Hybrid Retrieval Strategy                          │
│                                                      │
│  Query: "distal radius fracture + FOOSH injury"     │
│                                                      │
│  1. Vector DB (Semantic Search)                     │
│     → Similar cases: S52.501A, S52.521A            │
│     → Guidelines: "Colles fracture coding"          │
│                                                      │
│  2. Graph DB (Rule-based)                           │
│     → ICD-10 → CPT pairs: S52.501A → 25600        │
│     → Laterality rules: "right wrist" → code 7th   │
│                                                      │
│  3. Live EHR (Patient Context)                      │
│     → Prior fractures? Osteoporosis?               │
│     → Current medications (anticoagulants?)         │
│                                                      │
│  4. CMS Guidelines (Compliance)                     │
│     → 2026 coding updates                           │
│     → Documentation requirements                    │
└─────────────────────────────────────────────────────┘
```

#### 2.2.1 Vector Database (Semantic)

**Schema** (pgvector):

```sql
CREATE TABLE code_embeddings (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20),
    code_type VARCHAR(10),  -- 'icd10' | 'cpt' | 'hcpcs'
    description TEXT,
    embedding vector(1536),  -- OpenAI text-embedding-3-small
    source VARCHAR(20),       -- 'primary' | 'synonym' | 'guideline'
    specialty VARCHAR(50),    -- 'orthopedics' | 'cardiology' | ...
    created_at TIMESTAMP
);

CREATE INDEX ON code_embeddings USING hnsw (embedding vector_cosine_ops);

-- Similar cases
CREATE TABLE case_embeddings (
    id SERIAL PRIMARY KEY,
    case_summary TEXT,
    final_codes JSONB,        -- {icd10: [...], cpt: [...]}
    outcome VARCHAR(50),      -- 'approved' | 'revised' | 'rejected'
    embedding vector(1536),
    created_at TIMESTAMP
);
```

**Retrieval Example**:

```javascript
async retrieveRelevantCodes(perceptualState) {
    // 1. Build search query from perceptual state
    const query = this.buildSearchQuery(perceptualState);
    // "distal radius fracture right wrist acute FOOSH mechanism"
    
    // 2. Embed query
    const queryEmbedding = await this.embedText(query);
    
    // 3. Hybrid search: semantic + keyword
    const semanticResults = await this.vectorSearch(queryEmbedding, {
        specialty: perceptualState.specialty || 'all',
        limit: 10
    });
    
    const keywordResults = await this.keywordSearch(query);
    
    // 4. Merge & re-rank
    return this.mergeResults(semanticResults, keywordResults);
}

async vectorSearch(embedding, options) {
    const { specialty, limit } = options;
    
    const query = `
        SELECT 
            code,
            description,
            1 - (embedding <=> $1::vector) AS similarity,
            specialty
        FROM code_embeddings
        WHERE 
            (specialty = $2 OR $2 = 'all')
            AND 1 - (embedding <=> $1::vector) >= 0.7
        ORDER BY similarity DESC
        LIMIT $3
    `;
    
    return await this.db.query(query, [
        JSON.stringify(embedding),
        specialty,
        limit
    ]);
}
```

#### 2.2.2 Knowledge Graph (Neo4j or in-memory)

**Schema**:

```cypher
// ICD-10 Code Node
(:ICD10 {
    code: "S52.501A",
    description: "Unspecified fracture of the lower end of right radius, initial encounter",
    category: "Injury",
    body_system: "Musculoskeletal",
    laterality: "Right"
})

// CPT Code Node
(:CPT {
    code: "25600",
    description: "Closed treatment of distal radial fracture",
    rvu: 12.34,
    global_period: 90
})

// Relationships
(:ICD10 {code: "S52.501A"})-[:PAIRS_WITH {validity: 1.0}]->(:CPT {code: "25600"})
(:ICD10 {code: "S52.501A"})-[:REQUIRES_MODIFIER {modifier: "RT"}]->()
(:ICD10 {code: "S52.501A"})-[:EXCLUDES]->(:ICD10 {code: "S52.502A"})
(:ICD10 {code: "S52.501A"})-[:PARENT]->(:ICD10 {code: "S52.5"})

// Anatomy ontology
(:BodyPart {name: "distal_radius"})-[:PART_OF]->(:BodyPart {name: "wrist"})
(:BodyPart {name: "distal_radius"})-[:ADJACENT_TO]->(:BodyPart {name: "ulna"})
```

**Query Examples**:

```cypher
// Find valid CPT codes for an ICD-10
MATCH (icd:ICD10 {code: $icdCode})-[:PAIRS_WITH]->(cpt:CPT)
WHERE cpt.validity > 0.8
RETURN cpt.code, cpt.description, cpt.rvu
ORDER BY cpt.rvu DESC;

// Check laterality consistency
MATCH (icd:ICD10 {code: $icdCode})
WHERE icd.laterality = 'Right'
  AND $detectedLaterality != 'Right'
RETURN {
    valid: false,
    reason: "Laterality mismatch: code is right-specific but finding is " + $detectedLaterality
};

// Find alternative codes (differential diagnosis)
MATCH (icd:ICD10 {code: $icdCode})-[:SIMILAR_TO]->(alternative:ICD10)
RETURN alternative.code, alternative.description;
```

#### 2.2.3 CMS Guidelines Retrieval

**Ingestion Process**:

```javascript
// scripts/ingest-cms-guidelines.js
async function ingestGuidelines() {
    // 1. Download CMS ICD-10-CM Official Guidelines (PDF)
    const pdf = await fetch('https://cms.gov/files/icd10-guidelines-2026.pdf');
    
    // 2. Extract text & chunk
    const text = await extractTextFromPDF(pdf);
    const chunks = chunkText(text, {
        chunkSize: 500,
        overlap: 100
    });
    
    // 3. Embed chunks
    const embeddings = await embedBatch(chunks);
    
    // 4. Store in pgvector
    await db.query(`
        INSERT INTO guideline_chunks (section, text, embedding, year)
        VALUES ($1, $2, $3, 2026)
    `, [...]);
}
```

**Retrieval**:

```javascript
async retrieveGuidelines(perceptualState) {
    // Build query from proposed codes
    const query = `
        Coding guidelines for ${perceptualState.proposedCodes.icd10[0]} 
        in context of ${perceptualState.visual_findings[0].finding}
    `;
    
    const queryEmbedding = await this.embedText(query);
    
    const results = await this.db.query(`
        SELECT section, text, 
               1 - (embedding <=> $1::vector) AS relevance
        FROM guideline_chunks
        WHERE year = 2026
          AND 1 - (embedding <=> $1::vector) >= 0.75
        ORDER BY relevance DESC
        LIMIT 5
    `, [JSON.stringify(queryEmbedding)]);
    
    return results.rows;
}
```

### 2.3 Memory Layer (Persistent Learning)

**What to remember**:

```javascript
class PersistentMemory {
    // Physician preferences
    async rememberPhysicianPreference(physicianId, preference) {
        await this.mem0.add({
            user_id: physicianId,
            type: 'coding_preference',
            data: preference
            // e.g., "Dr. Smith prefers conservative coding for non-displaced fractures"
        });
    }
    
    // Successful code pairs
    async rememberSuccessfulPair(icdCode, cptCode, context) {
        await this.db.query(`
            INSERT INTO successful_code_pairs 
            (icd10, cpt, context_embedding, approval_count)
            VALUES ($1, $2, $3, 1)
            ON CONFLICT (icd10, cpt) 
            DO UPDATE SET approval_count = successful_code_pairs.approval_count + 1
        `, [icdCode, cptCode, await this.embedText(context)]);
    }
    
    // Rejected codes (learn from mistakes)
    async rememberRejection(proposedCodes, actualCodes, reason) {
        await this.db.query(`
            INSERT INTO code_rejections 
            (proposed_icd10, proposed_cpt, actual_icd10, actual_cpt, reason, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [...]);
    }
}
```

---

## Layer 3: Reasoning & Coding Agents

### Purpose
**Specialty-specific agents reason over perceptual state + retrieved knowledge** to propose codes with detailed justification.

### 3.1 Conciliator Architecture

**Pattern**: Central orchestrator delegates to specialty sub-graphs

```javascript
class CodingOrchestrator {
    constructor() {
        this.agents = {
            orthopedics: new OrthopedicsAgent(),
            cardiology: new CardiologyAgent(),
            dermatology: new DermatologyAgent(),
            general: new GeneralMedicineAgent()
        };
    }
    
    async route(perceptualState, classification) {
        const specialty = classification.specialty;
        const agent = this.agents[specialty] || this.agents.general;
        
        return await agent.processClaim(perceptualState);
    }
}
```

### 3.2 Specialty Agent Template

**Example: Orthopedics Agent**

```javascript
class OrthopedicsAgent {
    constructor() {
        this.llm = new ChatGroq({ model: 'llama-3.1-70b-versatile' });
        this.knowledge = new KnowledgeService();
    }
    
    async processClaim(perceptualState) {
        // 1. Retrieve orthopedics-specific knowledge
        const relevantCodes = await this.knowledge.retrieve({
            specialty: 'orthopedics',
            findings: perceptualState.visual_findings,
            symptoms: perceptualState.textual_findings
        });
        
        // 2. Build reasoning prompt
        const prompt = this.buildReasoningPrompt(
            perceptualState,
            relevantCodes
        );
        
        // 3. LLM reasoning
        const reasoning = await this.llm.invoke(prompt);
        
        // 4. Parse structured output
        return this.parseReasoningOutput(reasoning);
    }
    
    buildReasoningPrompt(state, knowledge) {
        return `
You are an expert medical coding specialist in Orthopedics.

PERCEPTUAL STATE:
${JSON.stringify(state, null, 2)}

RETRIEVED KNOWLEDGE:
${knowledge.codes.map(c => `- ${c.code}: ${c.description}`).join('\n')}

GUIDELINES:
${knowledge.guidelines.map(g => g.text).join('\n---\n')}

TASK:
Propose ICD-10 and CPT codes for this case. For each code, provide:
1. Code + description
2. Justification (reference visual/textual evidence)
3. Confidence score (0-1)
4. Alternative codes considered
5. Laterality verification

CRITICAL RULES:
- Laterality MUST match visual findings
- Acute vs chronic: use encounter context
- Initial encounter (A) vs subsequent (D) vs sequela (S)
- Check for code pair validity

Return JSON:
{
  "icd10_codes": [
    {
      "code": "S52.501A",
      "description": "...",
      "justification": "Visual finding of cortical discontinuity in distal radius (right) at coordinates [120,340,280,450] with confidence 0.92. Patient reported FOOSH mechanism. Laterality verified as 'right' from both image and clinical note.",
      "confidence": 0.88,
      "evidence": {
        "visual": ["distal_radius_fracture"],
        "textual": ["FOOSH_injury", "wrist_pain"],
        "cross_modal_alignment": 0.90
      }
    }
  ],
  "cpt_codes": [
    {
      "code": "25600",
      "description": "Closed treatment of distal radial fracture",
      "justification": "No mention of surgical reduction. Initial encounter, simple fracture pattern.",
      "confidence": 0.85
    }
  ],
  "alternatives_considered": [
    {
      "code": "S52.502A",
      "reason_rejected": "Left side specified, but finding is right-sided"
    }
  ]
}
        `;
    }
}
```

### 3.3 Code Suggestion Algorithm

**Multi-stage process**:

```javascript
class CodeSuggestionEngine {
    async suggestCodes(perceptualState, specialty) {
        // Stage 1: Candidate generation (broad)
        const candidates = await this.generateCandidates(perceptualState);
        
        // Stage 2: Filtering (narrow)
        const filtered = this.filterByRules(candidates, perceptualState);
        
        // Stage 3: Ranking (prioritize)
        const ranked = await this.rankBySimilarity(filtered, perceptualState);
        
        // Stage 4: Validation (safety)
        const validated = this.validatePairs(ranked);
        
        return validated;
    }
    
    async generateCandidates(state) {
        // Semantic search
        const semantic = await this.vectorDB.search(state, { limit: 20 });
        
        // Keyword match
        const keyword = await this.keywordSearch(state);
        
        // Historical (from similar cases)
        const historical = await this.findSimilarCases(state);
        
        // Merge (union)
        return [...new Set([...semantic, ...keyword, ...historical])];
    }
    
    filterByRules(candidates, state) {
        return candidates.filter(code => {
            // Laterality check
            if (code.laterality && code.laterality !== state.laterality) {
                return false;
            }
            
            // Acuity check (acute vs chronic)
            if (state.onset === 'sudden' && code.category === 'chronic') {
                return false;
            }
            
            // Specialty match
            if (code.specialty !== state.specialty && code.specialty !== 'general') {
                return false;
            }
            
            return true;
        });
    }
    
    async rankBySimilarity(candidates, state) {
        // Compute similarity to perceptual state
        const stateEmbedding = await this.embedState(state);
        
        return candidates.map(code => ({
            ...code,
            similarity: this.cosineSimilarity(stateEmbedding, code.embedding)
        })).sort((a, b) => b.similarity - a.similarity);
    }
    
    validatePairs(codes) {
        const icd10Codes = codes.filter(c => c.type === 'icd10');
        const cptCodes = codes.filter(c => c.type === 'cpt');
        
        const validPairs = [];
        
        for (const icd of icd10Codes) {
            for (const cpt of cptCodes) {
                const validation = this.validatePair(icd.code, cpt.code);
                if (validation.valid) {
                    validPairs.push({
                        icd10: icd,
                        cpt: cpt,
                        pairValidity: validation.score
                    });
                }
            }
        }
        
        return validPairs.sort((a, b) => 
            b.pairValidity - a.pairValidity
        ).slice(0, 5);
    }
}
```

---

## Layer 4: Reflection & Critique

### Purpose
**Quality gate that validates reasoning before codes reach billing system** — detects hallucinations, CMS violations, and cross-modal inconsistencies.

### 4.1 Critique Node Architecture

```javascript
class CritiqueNode {
    constructor() {
        this.reviewerLLM = new ChatGroq({ 
            model: 'llama-3.1-70b-versatile',
            temperature: 0.1  // Low temp for consistent validation
        });
    }
    
    async critique(codingResult, perceptualState) {
        const checks = await Promise.all([
            this.checkCrossModalConsistency(codingResult, perceptualState),
            this.checkCMSCompliance(codingResult),
            this.checkLateralityAccuracy(codingResult, perceptualState),
            this.checkHallucinationRisk(codingResult, perceptualState),
            this.checkCodePairValidity(codingResult)
        ]);
        
        const overallValid = checks.every(c => c.passed);
        const criticalFailures = checks.filter(c => c.severity === 'critical' && !c.passed);
        
        return {
            passed: overallValid && criticalFailures.length === 0,
            checks: checks,
            recommendation: this.makeDecision(checks),
            confidence: this.calculateConfidence(checks)
        };
    }
    
    async checkCrossModalConsistency(result, state) {
        // Question: Do visual findings support textual findings?
        const icd10Code = result.icd10_codes[0];
        const visualEvidence = state.visual_findings;
        const textualEvidence = state.textual_findings;
        
        const prompt = `
Review this coding decision for cross-modal consistency:

PROPOSED CODE: ${icd10Code.code} - ${icd10Code.description}

VISUAL EVIDENCE:
${JSON.stringify(visualEvidence, null, 2)}

TEXTUAL EVIDENCE:
${JSON.stringify(textualEvidence, null, 2)}

QUESTIONS:
1. Does the visual finding (${visualEvidence[0]?.finding}) match the coded diagnosis?
2. Is the location consistent? (Visual: ${visualEvidence[0]?.body_region}, Code describes: ?)
3. Is laterality consistent? (Visual: ${visualEvidence[0]?.laterality}, Code: ?)
4. Is severity aligned? (Visual confidence: ${visualEvidence[0]?.confidence}, Text severity: ${textualEvidence[0]?.severity})

Return JSON:
{
  "consistent": true/false,
  "issues": ["issue1", "issue2"],
  "severity": "critical" | "warning" | "info"
}
        `;
        
        const response = await this.reviewerLLM.invoke(prompt);
        const parsed = JSON.parse(response.content.match(/\{[\s\S]*\}/)[0]);
        
        return {
            name: 'cross_modal_consistency',
            passed: parsed.consistent,
            severity: parsed.severity,
            issues: parsed.issues
        };
    }
    
    async checkCMSCompliance(result) {
        // Retrieve relevant CMS guidelines
        const guidelines = await this.retrieveGuidelines(result.icd10_codes[0].code);
        
        const prompt = `
Review this code for 2026 CMS compliance:

CODE: ${result.icd10_codes[0].code}
JUSTIFICATION: ${result.icd10_codes[0].justification}

CMS GUIDELINES:
${guidelines.map(g => g.text).join('\n---\n')}

Check:
1. Is 7th character (encounter type) correct?
2. Are required modifiers present?
3. Is documentation sufficient per CMS rules?
4. Any coding conflicts or excludes?

Return JSON: {compliant: bool, violations: []}
        `;
        
        const response = await this.reviewerLLM.invoke(prompt);
        const parsed = JSON.parse(response.content.match(/\{[\s\S]*\}/)[0]);
        
        return {
            name: 'cms_compliance',
            passed: parsed.compliant,
            severity: parsed.violations.length > 0 ? 'critical' : 'info',
            issues: parsed.violations
        };
    }
    
    checkLateralityAccuracy(result, state) {
        const proposedLaterality = this.extractLaterality(result.icd10_codes[0].code);
        const visualLaterality = state.visual_findings[0]?.laterality;
        
        if (proposedLaterality && visualLaterality) {
            const match = proposedLaterality.toLowerCase() === visualLaterality.toLowerCase();
            return {
                name: 'laterality_check',
                passed: match,
                severity: match ? 'info' : 'critical',
                issues: match ? [] : [`Code specifies ${proposedLaterality} but visual finding shows ${visualLaterality}`]
            };
        }
        
        return { name: 'laterality_check', passed: true, severity: 'info', issues: [] };
    }
    
    async checkHallucinationRisk(result, state) {
        // Hallucination indicators:
        // 1. Code justification mentions anatomical details NOT in visual findings
        // 2. High confidence but low cross-modal alignment
        // 3. Multiple anatomical regions mentioned but only one visualized
        
        const justification = result.icd10_codes[0].justification.toLowerCase();
        const visualFindings = state.visual_findings.map(f => f.finding.toLowerCase());
        
        // Extract anatomy terms from justification
        const anatomyTerms = this.extractAnatomyTerms(justification);
        
        // Check if all mentioned anatomy is visually confirmed
        const hallucinated = anatomyTerms.filter(term => 
            !visualFindings.some(finding => finding.includes(term))
        );
        
        return {
            name: 'hallucination_check',
            passed: hallucinated.length === 0,
            severity: hallucinated.length > 0 ? 'critical' : 'info',
            issues: hallucinated.length > 0 
                ? [`Justification mentions "${hallucinated.join(', ')}" but not found in visual evidence`]
                : []
        };
    }
    
    checkCodePairValidity(result) {
        const icd = result.icd10_codes[0]?.code;
        const cpt = result.cpt_codes[0]?.code;
        
        if (!icd || !cpt) {
            return { name: 'code_pair_validity', passed: false, severity: 'critical', issues: ['Missing ICD or CPT'] };
        }
        
        const validation = this.knowledgeGraph.validatePair(icd, cpt);
        
        return {
            name: 'code_pair_validity',
            passed: validation.valid,
            severity: validation.valid ? 'info' : 'critical',
            issues: validation.valid ? [] : [validation.reason]
        };
    }
    
    makeDecision(checks) {
        const criticalFailures = checks.filter(c => c.severity === 'critical' && !c.passed);
        const warnings = checks.filter(c => c.severity === 'warning' && !c.passed);
        
        if (criticalFailures.length > 0) {
            return {
                action: 'reject',
                reason: `Critical failures: ${criticalFailures.map(c => c.name).join(', ')}`,
                next_step: 'human_review'
            };
        }
        
        if (warnings.length >= 2) {
            return {
                action: 'flag_for_review',
                reason: `Multiple warnings detected`,
                next_step: 'human_review'
            };
        }
        
        return {
            action: 'approve',
            reason: 'All checks passed',
            next_step: 'submit_to_billing'
        };
    }
    
    calculateConfidence(checks) {
        const totalChecks = checks.length;
        const passedChecks = checks.filter(c => c.passed).length;
        
        // Weight critical checks more
        const criticalChecks = checks.filter(c => c.severity === 'critical');
        const passedCritical = criticalChecks.filter(c => c.passed).length;
        
        const baseConfidence = passedChecks / totalChecks;
        const criticalConfidence = criticalChecks.length > 0 
            ? passedCritical / criticalChecks.length 
            : 1.0;
        
        // Weighted average (60% critical, 40% overall)
        return 0.6 * criticalConfidence + 0.4 * baseConfidence;
    }
}
```

### 4.2 Self-Correction Loop

**If critique fails, agent can self-correct**:

```javascript
async processCodingWithReflection(perceptualState) {
    let attempt = 0;
    const maxAttempts = 3;
    
    while (attempt < maxAttempts) {
        // Generate codes
        const result = await this.codingAgent.process(perceptualState);
        
        // Critique
        const critique = await this.critiqueNode.critique(result, perceptualState);
        
        if (critique.passed) {
            return { success: true, result, critique };
        }
        
        // Self-correct: provide critique feedback to agent
        if (attempt < maxAttempts - 1) {
            perceptualState.feedback = {
                issues: critique.checks.filter(c => !c.passed),
                suggestion: "Revise coding based on critique feedback"
            };
        }
        
        attempt++;
    }
    
    // Failed after max attempts → human review
    return {
        success: false,
        result: null,
        critique: critique,
        recommendation: 'escalate_to_human'
    };
}
```

---

## Infrastructure & Data Flow

### 5.1 Complete Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  INPUT                                                                │
│  - X-ray/MRI/Derm images (DICOM → PNG conversion)                    │
│  - Clinical notes (EHR HL7 → text)                                   │
│  - Voice call (MP3 → Deepgram STT → text)                            │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PERCEPTION LAYER (Multimodal Fusion)                                │
│  - GPT-4o or Qwen2-VL: Image → visual_tokens                         │
│  - ClinicalBERT: Text → text_tokens                                  │
│  - CrossAttention(visual_tokens, text_tokens) → perceptual_state     │
│  Output: JSON with visual_findings + textual_findings + links        │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ROUTING (LangGraph Node 1)                                          │
│  - Triage classifier: emergency vs routine                           │
│  - Specialty router: cardiology | orthopedics | dermatology | ...    │
│  Output: { specialty, urgency, route }                               │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  KNOWLEDGE RETRIEVAL (LangGraph Node 2)                              │
│  - Vector DB: Semantic search for similar codes/cases                │
│  - Graph DB: Rule-based ICD-CPT pairs, anatomy ontology              │
│  - Live EHR: Patient history via FHIR API                            │
│  - CMS Guidelines: 2026 coding rules                                 │
│  Output: { relevant_codes, guidelines, similar_cases }               │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SPECIALTY AGENT (LangGraph Node 3)                                  │
│  - Orthopedics | Cardiology | Dermatology | General                  │
│  - LLM reasoning with retrieved knowledge                            │
│  - Propose ICD-10 + CPT with justification                           │
│  Output: { icd10_codes, cpt_codes, reasoning_trace }                 │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  CRITIQUE & VALIDATION (LangGraph Node 4)                            │
│  - Cross-modal consistency check                                     │
│  - CMS compliance validation                                         │
│  - Laterality verification                                           │
│  - Hallucination detection                                           │
│  Decision: approve | flag_for_review | reject                        │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
┌─────────────────┐   ┌─────────────────────┐
│  AUTO-APPROVED  │   │  HUMAN REVIEW QUEUE │
│  → Billing      │   │  - Low confidence   │
│                 │   │  - Validation failed│
│                 │   │  - Emergent cases   │
└─────────────────┘   └─────────────────────┘
```

### 5.2 Technology Stack

| Layer | Component | Technology | Justification |
|-------|-----------|------------|---------------|
| **Perception** | Vision Encoder | GPT-4o (Azure) or Qwen2-VL-7B | HIPAA-compliant, multimodal fusion |
| | Text Encoder | ClinicalBERT | Medical domain specialization |
| | Audio STT | Deepgram | HIPAA, medical vocabulary |
| **Orchestration** | Workflow Engine | LangGraph | State management, DAG execution |
| | State Persistence | PostgresSaver | Audit trail, session recovery |
| **Knowledge** | Vector DB | pgvector (→ Pinecone) | Free, fast, scalable |
| | Embeddings | OpenAI text-embedding-3-small | $0.02 per 1M tokens |
| | Graph DB | Neo4j Community (optional) | Code relationships, ontology |
| | Guidelines | pgvector (text chunks) | CMS 2026 rules |
| **Reasoning** | LLM | Groq (Llama 3.1 70B) | Fast, cheap, good for extraction |
| | Critique LLM | Groq (Llama 3.1 70B) | Consistent validation |
| **Memory** | Session Store | Mem0 or Redis | Physician preferences |
| | Audit Log | PostgreSQL | Compliance, ML training |
| **Hosting** | Compute | AWS EC2 (GPU for Qwen) or Azure | HIPAA BAA available |
| | Storage | S3 (encrypted) | DICOM images, audio files |
| | Database | RDS PostgreSQL 16 + pgvector | Managed, backups |

### 5.3 LangGraph Implementation

**Complete Graph Definition**:

```javascript
const { StateGraph, MemorySaver, PostgresSaver } = require('@langchain/langgraph');

// State schema
const GraphState = {
    call_id: { value: (prev, next) => next || prev },
    clinic_id: { value: (prev, next) => next || prev },
    
    // Inputs
    images: { value: (prev, next) => next || prev, default: () => [] },
    clinical_text: { value: (prev, next) => next || prev, default: () => "" },
    audio_path: { value: (prev, next) => next || prev, default: () => null },
    
    // Perceptual state
    perceptual_state: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Classification
    classification: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Knowledge
    retrieved_knowledge: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Coding
    coding_result: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Validation
    critique_result: { value: (prev, next) => next || prev, default: () => ({}) },
    
    // Workflow
    current_stage: { value: (prev, next) => next || prev, default: () => 'INTAKE' },
    route: { value: (prev, next) => next || prev, default: () => 'automated' },
    
    // Metadata
    confidence: { value: (prev, next) => next || prev, default: () => 0 },
    errors: { value: (prev, next) => [...(prev || []), ...(next || [])], default: () => [] }
};

// Build graph
const graph = new StateGraph({ channels: GraphState });

// Node 1: Multimodal perception
graph.addNode('perceive', async (state) => {
    const perceptionService = require('./services/multimodal-perception-service');
    
    const perceptualState = await perceptionService.fuse({
        images: state.images,
        text: state.clinical_text,
        audio: state.audio_path
    });
    
    return {
        perceptual_state: perceptualState,
        current_stage: 'PERCEPTION_COMPLETE'
    };
});

// Node 2: Route to specialty
graph.addNode('route', async (state) => {
    const classifier = require('./services/triage-classifier');
    
    const classification = await classifier.classify(
        state.perceptual_state,
        state.clinical_text
    );
    
    return {
        classification: classification,
        route: classification.route,
        current_stage: 'ROUTING_COMPLETE'
    };
});

// Node 3: Retrieve knowledge
graph.addNode('retrieve_knowledge', async (state) => {
    const ragService = require('./services/agentic-rag-service');
    
    const knowledge = await ragService.retrieve(
        state.perceptual_state,
        state.classification
    );
    
    return {
        retrieved_knowledge: knowledge,
        current_stage: 'KNOWLEDGE_RETRIEVED'
    };
});

// Node 4: Specialty agent coding
graph.addNode('code', async (state) => {
    const orchestrator = require('./services/coding-orchestrator');
    
    const result = await orchestrator.route(
        state.perceptual_state,
        state.classification,
        state.retrieved_knowledge
    );
    
    return {
        coding_result: result,
        current_stage: 'CODING_COMPLETE',
        confidence: result.confidence
    };
});

// Node 5: Critique & validate
graph.addNode('critique', async (state) => {
    const critiqueNode = require('./services/critique-node');
    
    const critique = await critiqueNode.critique(
        state.coding_result,
        state.perceptual_state
    );
    
    return {
        critique_result: critique,
        current_stage: 'VALIDATION_COMPLETE',
        confidence: critique.confidence
    };
});

// Node 6: Human review (terminal)
graph.addNode('human_review', async (state) => {
    const db = require('./database');
    
    await db.flagForHumanReview(state.call_id, {
        reason: state.critique_result.recommendation?.reason || 'Manual review required',
        perceptual_state: state.perceptual_state,
        coding_result: state.coding_result,
        critique: state.critique_result
    });
    
    return { current_stage: 'AWAITING_HUMAN_REVIEW' };
});

// Node 7: Auto-approve (terminal)
graph.addNode('approve', async (state) => {
    const db = require('./database');
    
    await db.submitToBilling(state.call_id, {
        icd10_codes: state.coding_result.icd10_codes,
        cpt_codes: state.coding_result.cpt_codes,
        confidence: state.confidence,
        audit_trail: {
            perceptual_state: state.perceptual_state,
            reasoning: state.coding_result.reasoning_trace,
            validation: state.critique_result
        }
    });
    
    return { current_stage: 'APPROVED_AND_SUBMITTED' };
});

// Edges
graph.setEntryPoint('perceive');
graph.addEdge('perceive', 'route');

// Conditional routing
graph.addConditionalEdges(
    'route',
    (state) => state.route,
    {
        'human_immediate_review': 'human_review',
        'automated': 'retrieve_knowledge',
        'orthopedics_agent': 'retrieve_knowledge',
        'cardiology_agent': 'retrieve_knowledge',
        'dermatology_agent': 'retrieve_knowledge'
    }
);

graph.addEdge('retrieve_knowledge', 'code');
graph.addEdge('code', 'critique');

// After critique: approve or review
graph.addConditionalEdges(
    'critique',
    (state) => state.critique_result.recommendation?.action || 'approve',
    {
        'approve': 'approve',
        'reject': 'human_review',
        'flag_for_review': 'human_review'
    }
);

// Compile with PostgresSaver for persistence
const checkpointer = new PostgresSaver(process.env.POSTGRES_URL);
const compiledGraph = graph.compile({ checkpointer });

module.exports = { compiledGraph };
```

---

## Implementation Roadmap

### Phase 0: Foundation (Week 1-2) - CRITICAL PATH

**Goal**: Basic infrastructure + data pipeline

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 1. Set up cloud infrastructure | 2 days | DevOps | AWS/Azure account, VPC, RDS PostgreSQL |
| 2. Install pgvector extension | 0.5 days | Backend | `CREATE EXTENSION vector` |
| 3. DICOM → PNG conversion pipeline | 2 days | Backend | Script to convert medical images |
| 4. Audio STT integration (Deepgram) | 1 day | Backend | API wrapper, transcript storage |
| 5. Database schema design | 1 day | Backend | Tables for embeddings, cases, audit logs |
| 6. Populate code embeddings | 2 days | ML | 80K ICD-10/CPT codes embedded |
| **Total** | **8.5 days** | | **Testable end-to-end pipeline** |

**Success Criteria**:
- ✅ Image uploaded → converted to PNG
- ✅ Audio uploaded → transcribed to text
- ✅ Code search returns relevant results

---

### Phase 1: Perception Layer (Week 3-4)

**Goal**: Multimodal fusion working

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 7. Integrate GPT-4o (Azure) | 2 days | ML | API key, HIPAA BAA, test calls |
| 8. Alternative: Fine-tune Qwen2-VL | 5 days | ML | Model weights, inference server |
| 9. Build perception service | 3 days | Backend | `multimodal-perception-service.js` |
| 10. Test cross-attention outputs | 2 days | QA | Visual + text alignment verified |
| **Total** | **7-12 days** | | **Perceptual state JSON** |

**Success Criteria**:
- ✅ X-ray + clinical note → perceptual_state with cross-modal links
- ✅ Laterality correctly detected (left vs right)
- ✅ Visual findings confidence > 0.8

---

### Phase 2: Knowledge Layer (Week 5-6)

**Goal**: RAG retrieval working

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 11. Hybrid search implementation | 3 days | Backend | Semantic + keyword merged |
| 12. Ingest CMS guidelines | 2 days | ML | 2026 rules chunked & embedded |
| 13. Build knowledge graph (optional) | 4 days | Backend | Neo4j with ICD-CPT relationships |
| 14. Agentic RAG service | 2 days | Backend | Dynamic retrieval based on state |
| **Total** | **11 days** | | **Knowledge retrieval API** |

**Success Criteria**:
- ✅ Query "distal radius fracture" → top 5 relevant codes
- ✅ Guidelines retrieved for proposed codes
- ✅ Similar cases found from history

---

### Phase 3: Reasoning Agents (Week 7-8)

**Goal**: Code suggestion working

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 15. Build base coding agent | 3 days | ML | LLM-based code proposal |
| 16. Specialty agents (Ortho, Cardio, Derm) | 5 days | ML | 3 specialty prompts + logic |
| 17. Routing classifier | 2 days | ML | Triage + specialty classification |
| 18. Code pair validation | 2 days | Backend | ICD-10 ↔ CPT rules engine |
| **Total** | **12 days** | | **Coding recommendations** |

**Success Criteria**:
- ✅ End-to-end: X-ray + note → suggested codes
- ✅ Accuracy > 80% on test set (50 cases)
- ✅ Valid ICD-CPT pairs only

---

### Phase 4: Critique Layer (Week 9)

**Goal**: Validation & quality gates

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 19. Critique node implementation | 3 days | ML | All validation checks |
| 20. Self-correction loop | 2 days | Backend | Iterative refinement |
| 21. Confidence scoring | 1 day | ML | Multi-factor confidence model |
| 22. Human review UI | 3 days | Frontend | Queue for flagged cases |
| **Total** | **9 days** | | **Full validation pipeline** |

**Success Criteria**:
- ✅ Laterality mismatches caught 100%
- ✅ Hallucinations detected > 90%
- ✅ Auto-approval rate > 60% (confidence > 0.85)

---

### Phase 5: LangGraph Integration (Week 10)

**Goal**: Full orchestration

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 23. Complete graph definition | 2 days | Backend | All nodes + edges |
| 24. PostgresSaver setup | 1 day | Backend | State persistence |
| 25. End-to-end testing | 3 days | QA | 100 test cases |
| 26. Monitoring dashboard | 2 days | Frontend | Mermaid diagram, metrics |
| **Total** | **8 days** | | **Production-ready system** |

**Success Criteria**:
- ✅ Full pipeline: image + text → codes in < 30s
- ✅ State recoverable after crash
- ✅ Audit trail complete for compliance

---

### Phase 6: Production Hardening (Week 11-12)

**Goal**: Compliance, security, monitoring

| Task | Duration | Owner | Deliverable |
|------|----------|-------|-------------|
| 27. HIPAA compliance audit | 3 days | Legal/DevOps | BAAs signed, encryption verified |
| 28. Load testing | 2 days | QA | Handle 1000 concurrent cases |
| 29. Error recovery & retries | 2 days | Backend | Graceful degradation |
| 30. Logging & alerting | 2 days | DevOps | CloudWatch, PagerDuty |
| 31. Documentation | 2 days | All | API docs, runbooks |
| **Total** | **11 days** | | **Launch-ready** |

---

## Compliance & Safety

### 9.1 HIPAA Compliance Checklist

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| **Encryption at rest** | S3 buckets with AES-256, RDS encrypted | ✅ |
| **Encryption in transit** | TLS 1.3 for all API calls | ✅ |
| **Access control** | IAM roles, MFA for admin | ✅ |
| **Audit logging** | All patient data access logged to CloudWatch | ✅ |
| **BAA with vendors** | Azure (GPT-4o), Deepgram, AWS | ✅ |
| **Data retention** | 7 years per HIPAA | ✅ |
| **De-identification** | Option to strip PHI before ML training | ⚠️ Phase 2 |
| **Right to access** | Patient can request their data | ⚠️ Phase 2 |
| **Breach notification** | Automated alerts if anomalous access | ⚠️ Phase 2 |

### 9.2 FDA SaMD Classification

**Current classification**: Likely **Class II (moderate risk)**

**Justification**:
- Assists human coders, does not make final decisions
- Not used for diagnosis (only coding)
- Human-in-the-loop for high-stakes cases

**Path to approval**:
1. Submit 510(k) premarket notification
2. Demonstrate substantial equivalence to existing coding software
3. Provide clinical validation data (accuracy on test set)
4. Outline risk mitigation strategies (human review for low confidence)

**Timeline**: 6-12 months for 510(k) clearance

---

## Cost Analysis

### 10.1 One-Time Setup Costs

| Item | Cost | Notes |
|------|------|-------|
| **Embeddings** | | |
| ICD-10 codes (72K) | $0.70 | OpenAI embedding |
| CPT codes (1.3K) | $0.03 | |
| HCPCS codes (9K) | $0.09 | |
| Synonyms (20K) | $0.20 | |
| CMS guidelines (5K chunks) | $0.05 | |
| **Subtotal** | **$1.07** | |
| | | |
| **Infrastructure** | | |
| AWS setup | $0 | Free tier |
| RDS PostgreSQL (development) | $50/month | db.t3.medium |
| **Subtotal** | **$50** | |
| | | |
| **Model fine-tuning (optional)** | | |
| Qwen2-VL fine-tuning | $500 | GPU hours on Vast.ai |
| **Total One-Time** | **~$551** | |

### 10.2 Per-Document Processing Costs

| Operation | Provider | Cost per Doc | Notes |
|-----------|----------|--------------|-------|
| **Perception** | | | |
| Vision encoding (GPT-4o) | Azure | $0.0015 | ~150 tokens image |
| Text encoding (ClinicalBERT) | Self-hosted | $0 | Free |
| Audio STT (Deepgram) | Deepgram | $0.0043 | ~2 min call |
| **Subtotal** | | **$0.0058** | |
| | | | |
| **Reasoning** | | | |
| Extraction (Groq) | Groq | $0.0001 | ~1000 tokens |
| Classification (Groq) | Groq | $0.00005 | ~500 tokens |
| Code suggestion (Groq) | Groq | $0.00015 | ~1500 tokens |
| Critique (Groq) | Groq | $0.0001 | ~1000 tokens |
| **Subtotal** | | **$0.0004** | |
| | | | |
| **Knowledge** | | | |
| Embedding query | OpenAI | $0.000002 | 1 query |
| Vector DB query | pgvector | $0 | Self-hosted |
| **Subtotal** | | **$0.000002** | |
| | | | |
| **Total per Document** | | **~$0.0062** | **$6.20 per 1000 docs** |

**Comparison**:
- **Manual coding**: $15-40 per document (human coder)
- **This system**: $0.0062 per document
- **Savings**: 99.95%

### 10.3 Monthly Operating Costs (10K docs/month)

| Service | Cost | Notes |
|---------|------|-------|
| Document processing | $62 | 10K × $0.0062 |
| RDS PostgreSQL | $200 | db.r5.large for production |
| EC2 (if self-hosting Qwen) | $300 | g4dn.xlarge (GPU) |
| S3 storage | $50 | 1TB images |
| Data transfer | $30 | |
| Monitoring & logging | $20 | CloudWatch |
| **Total** | **$662/month** | |

**Per-document cost**: $0.066 (all-in)

**Break-even**: If manual coding costs $20/doc, break-even is at **34 documents/month**

---

## Next Steps

### Immediate Actions (This Week)

1. **Infrastructure setup**
   - [ ] Provision AWS/Azure account
   - [ ] Set up RDS PostgreSQL with pgvector
   - [ ] Create S3 bucket for images (encrypted)

2. **Data preparation**
   - [ ] Collect 100 sample cases (X-rays + clinical notes)
   - [ ] Label with ground-truth ICD-10/CPT codes
   - [ ] Convert DICOM images to PNG

3. **Prototype perception layer**
   - [ ] Sign up for Azure OpenAI (GPT-4o)
   - [ ] Test multimodal API with 1 X-ray + note
   - [ ] Validate cross-modal alignment

### Decision Points

**Question 1**: GPT-4o (Azure) vs Qwen2-VL (self-hosted)?

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **GPT-4o** | HIPAA-ready, best fusion, no infra | $0.0015/image, vendor lock-in | **Start here** |
| **Qwen2-VL** | Open-source, cheaper at scale | Requires GPU, fine-tuning needed | Phase 2 |

**Recommendation**: Start with GPT-4o, migrate to Qwen2-VL when processing > 100K docs/month

---

**Question 2**: Neo4j (knowledge graph) or just pgvector?

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Neo4j** | Rich relationships, complex queries | Extra service, cost | Optional |
| **pgvector only** | Simpler, one DB | Harder to model ontologies | **Start here** |

**Recommendation**: Use pgvector for Phase 1, add Neo4j if complex relationship queries become bottleneck

---

**Question 3**: Pinecone or pgvector?

| Option | Pros | Cons | When to use |
|--------|------|------|-------------|
| **pgvector** | Free, same DB, simple | Slower at > 1M vectors | < 100K codes |
| **Pinecone** | Very fast, managed | $70/month | > 1M vectors |

**Recommendation**: pgvector until you hit performance limits (> 1M vectors or > 100ms query latency)

---

## Appendix: File Structure

```
medical-coding-ai/
├── services/
│   ├── multimodal-perception-service.js    # Layer 1: Fusion
│   ├── triage-classifier.js                 # Layer 2: Routing
│   ├── agentic-rag-service.js              # Layer 2: Knowledge
│   ├── coding-orchestrator.js               # Layer 3: Specialty agents
│   ├── orthopedics-agent.js                 # Specialty agent
│   ├── cardiology-agent.js                  # Specialty agent
│   ├── dermatology-agent.js                 # Specialty agent
│   ├── critique-node.js                     # Layer 4: Validation
│   ├── semantic-search-service.js           # Embeddings & search
│   └── knowledge-service.js                 # Code retrieval
│
├── database/
│   ├── schema.sql                           # PostgreSQL schema
│   ├── migrations/                          # DB migrations
│   └── index.js                             # DB connection pool
│
├── scripts/
│   ├── populate-embeddings.js               # One-time setup
│   ├── ingest-guidelines.js                 # CMS guidelines
│   ├── dicom-to-png.js                      # Image conversion
│   └── test-perception.js                   # Testing
│
├── langgraph/
│   ├── coding-graph.js                      # Main graph definition
│   └── graph-visualizer.js                  # Mermaid export
│
├── api/
│   ├── routes/
│   │   ├── submit-case.js                   # POST /api/cases
│   │   ├── get-codes.js                     # GET /api/codes/:callId
│   │   └── human-review.js                  # GET /api/review/queue
│   └── server.js                            # Express app
│
├── config/
│   ├── models.json                          # Model configurations
│   └── specialty-prompts.json               # Agent prompts
│
└── tests/
    ├── perception.test.js
    ├── routing.test.js
    ├── coding.test.js
    └── end-to-end.test.js
```

---

## Summary

You've designed a **true multimodal medical intelligence system** where:

1. **Perception Layer** uses cross-attention to fuse visual + textual evidence *before* reasoning
2. **Agentic RAG** dynamically retrieves specialty-specific knowledge
3. **Reasoning Agents** propose codes grounded in perceptual facts, not hallucinations
4. **Critique Layer** validates cross-modal consistency, CMS compliance, and catches errors
5. **LangGraph** orchestrates the entire flow with state persistence and audit trails

This is **not AI-assisted coding** — it's **medical intelligence infrastructure** ready for FDA/CMS scrutiny.

**Total implementation time**: 10-12 weeks  
**Cost per document**: $0.0062 (vs $15-40 manual)  
**Accuracy target**: > 90% with human review for edge cases

**Next**: Share your current file structure and I'll help you map this architecture to your existing code. 🚀
