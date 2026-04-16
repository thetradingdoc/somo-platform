# RAG Integration: File Extraction vs Translation Layer

**Context**: Middleware runs 24/7 on Azure. Colab is ephemeral—it cannot run as a live RAG server. Two approaches compared against the current implementation.

---

## Current Implementation (What Exists)

### 1. Live RAG Path (Designed for Colab/Render)

| Component | Location | Expectation |
|-----------|----------|-------------|
| `remote-rag-client.js` | `services/layer2-rag/` | `POST RAG_API_URL/retrieve` → expects `{ icd10: [...], cpt: [...], hcpcs: [...] }` |
| `knowledge-service.js` | `getCandidatesForCoding()` | If `RAG_API_URL` set → call Colab; else local fallback |
| `rag-proxy.js` | `routes/` | Forwards `/api/rag/*` to `COLAB_RAG_URL` |

**Problem**: Colab cannot stay running. `RAG_API_URL` would need a deployed service (Render, GCP, etc.), not Colab.

### 2. Local Knowledge (Already Works)

| File/Source | Loaded By | Purpose |
|-------------|-----------|---------|
| `icd10_reference.json` | knowledge-service | ICD-10 fallback (~271 codes) |
| `icd10_codes` table | DB | Primary ICD-10 search (~72K codes) |
| `cpt_codes` table | DB | CPT search |
| `hcpcs_codes` table | DB | HCPCS search |
| `medical-abbreviations.json` | knowledge-service | SOB→shortness of breath, etc. |
| `medical-entities.json` | knowledge-service | Synonyms, severity |
| `extraction-patterns.json` | knowledge-service | Regex for symptoms, vitals |
| `simple-coding-rules.json` | knowledge-service | Clinical pattern → ICD/CPT |
| `triage-rules.json` | triage-service | Emergent/urgent patterns |

**Hardcoded** (not file-based): `MEDICAL_PHRASES`, `PHRASE_EXPANSIONS` in knowledge-service.js (lines 196–219).

### 3. Colab-Generated Files (Present but Unused)

| File | Location | Content |
|------|----------|---------|
| `code_expansion_map.json` | `Knowledge/RAG/` | ICD parent→child expansions (e.g. G89 → G89.0, G89.1, …) |
| `terminology_lookup.json` | `Knowledge/RAG/` | CPT codes with positive_terms, anatomical, specialties, sample_sources from clinical guidelines |

**Gap**: These files exist but are **not loaded** by the middleware. Grep shows no references.

---

## Approach A: File Extraction (Recommended for Colab + Azure)

**Idea**: Colab runs periodically (e.g. weekly) to generate/update knowledge files. You export those files and add them to the middleware repo. Middleware loads them at startup—no live RAG connection.

### Why It Fits Your Setup

- Middleware on Azure runs 24/7 with no dependency on Colab.
- Colab is used as a batch job: process ontology, clinical guidelines, code expansions → output JSON files.
- You version-control the exported files in the repo and deploy with the app.
- No `RAG_API_URL`, no rag-proxy, no circuit breaker for remote RAG.

### Implementation Steps (Post–7A)

#### Step 1: Colab Export Contract

Define a stable output format and location.

**Option 1A – Single merged file** (simplest):

- Colab writes: `Knowledge/RAG/colab-export.json`
- Shape:
  ```json
  {
    "phrase_expansions": { "well child": ["routine child health"], "type 2 diabetes": ["E11"], ... },
    "medical_phrases": ["type 2 diabetes", "well child", ...],
    "code_expansions": { "G89": ["G89.0","G89.1",...], ... },
    "term_to_codes": { "creatinine clearance": ["01667"], "anesthesia kidney ureter bladder": ["00834"], ... }
  }
  ```

**Option 1B – Multiple files**:

- `Knowledge/RAG/phrase_expansions.json` — overrides PHRASE_EXPANSIONS
- `Knowledge/RAG/code_expansion_map.json` — already exists
- `Knowledge/RAG/terminology_lookup.json` — already exists (term → CPT hints)
- `Knowledge/ontology/colab-phrases.json` — optional MEDICAL_PHRASES extension

#### Step 2: Colab Notebook Export Logic

At the end of your Colab pipeline:

```python
# After building phrase expansions, code map, terminology from chunks
import json

export = {
    "phrase_expansions": phrase_expansions_dict,
    "medical_phrases": list(medical_phrases_set),
    "code_expansions": code_expansion_map,  # from icd10 metadata
    "term_to_codes": term_to_codes  # from terminology_lookup: term -> [cpt_codes]
}

with open("colab-export.json", "w") as f:
    json.dump(export, f, indent=2)

# Or: download via files.download("colab-export.json")
```

#### Step 3: Middleware Loader

Add a loader in `knowledge-service.js` (or a small `rag-file-loader.js`):

```javascript
const COLAB_EXPORT_PATH = path.resolve(__dirname, '../../Knowledge/RAG/colab-export.json');
const CODE_EXPANSION_PATH = path.resolve(__dirname, '../../Knowledge/RAG/code_expansion_map.json');
const TERMINOLOGY_LOOKUP_PATH = path.resolve(__dirname, '../../Knowledge/RAG/terminology_lookup.json');

let colabPhraseExpansions = {};
let colabCodeExpansions = {};
let colabTermToCodes = {};

function loadColabExports() {
  // Load colab-export.json (single file) or individual files
  if (fs.existsSync(COLAB_EXPORT_PATH)) {
    const raw = fs.readFileSync(COLAB_EXPORT_PATH, 'utf8');
    const data = JSON.parse(raw);
    colabPhraseExpansions = data.phrase_expansions || {};
    colabCodeExpansions = data.code_expansions || {};
    colabTermToCodes = data.term_to_codes || {};
    console.log(`✅ Loaded Colab export: ${Object.keys(colabPhraseExpansions).length} phrase expansions, ${Object.keys(colabTermToCodes).length} term→code mappings`);
  }
  // Fallback: load existing files if present
  if (Object.keys(colabCodeExpansions).length === 0 && fs.existsSync(CODE_EXPANSION_PATH)) {
    const raw = fs.readFileSync(CODE_EXPANSION_PATH, 'utf8');
    const data = JSON.parse(raw);
    colabCodeExpansions = data.icd10 || {};
  }
  // ... similar for terminology_lookup
}
```

#### Step 4: Wire Into Search

- **Phrase expansions**: Merge `colabPhraseExpansions` with `PHRASE_EXPANSIONS` in `extractMedicalPhrases()`.
- **Code expansions**: When returning ICD-10 candidates, expand parent codes using `colabCodeExpansions` (e.g. if "G89" is in results, add G89.0, G89.1, etc.).
- **Term→CPT**: When extracting keywords from a note, check `colabTermToCodes`. If a term matches, look up CPT codes from DB and boost their rank.

#### Step 5: Deployment Workflow

1. Run Colab notebook when you add/change ontology, guidelines, or code mappings.
2. Export `colab-export.json` (or the chosen file set).
3. Copy into `Knowledge/RAG/` (or `Knowledge/ontology/`).
4. Commit and push; Azure deployment picks up the new files.

### Pros and Cons

| Pros | Cons |
|------|------|
| No dependency on Colab runtime | Knowledge is not real-time (batch refresh) |
| Works with Azure-only deployment | Requires manual export/deploy step |
| Versioned knowledge in git | Colab export format must stay stable |
| Uses existing Colab-generated files | |

---

## Approach B: Translation Layer (For a Deployed RAG Service)

**Idea**: RAG runs on a persistent service (Render, GCP, etc.), not Colab. RAG returns chunks with metadata (`icd10_codes`, `entities_procedures`). A translation layer converts that to `{ icd10, cpt, hcpcs }` for the middleware.

### Gap

- Middleware expects: `{ icd10: [{ code, description, confidence }], cpt: [...], hcpcs: [...] }`
- RAG returns: chunks with metadata, e.g. `metadata.icd10_codes`, `metadata.entities_procedures`
- CPT is not in the Pinecone index (clinical corpus, not CPT codebook), so CPT comes from local DB.

### Where the Translation Lives

**Option B1 – In the RAG service** (recommended):

- RAG service receives `POST /retrieve` with `{ query, specialty, top_k }`.
- Queries Pinecone → gets chunks with metadata.
- Aggregates `icd10_codes` from chunk metadata (count occurrences, rank by confidence).
- Returns `{ icd10: [...], cpt: [], hcpcs: [] }` (CPT empty; middleware fills from local).
- Middleware stays unchanged.

**Option B2 – In the middleware**:

- Add a translation step in `remote-rag-client.js`.
- Accept a new RAG response shape: `{ chunks: [{ metadata: { icd10_codes: [...] } }] }`.
- Aggregate and convert to `{ icd10, cpt, hcpcs }` before returning to `getCandidatesForCoding()`.
- Requires changing the contract so the RAG can return raw chunks.

### Translation Logic (Pseudocode)

```javascript
// In RAG service or middleware translation layer
function chunksToCodes(chunks) {
  const icd10Counts = new Map();  // code -> { count, totalChunks }
  for (const c of chunks) {
    const codes = c.metadata?.icd10_codes || [];
    for (const code of codes) {
      icd10Counts.set(code, (icd10Counts.get(code) || 0) + 1);
    }
  }
  // Rank by frequency, return top-k with confidence = normalized count
  const sorted = [...icd10Counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top_k)
    .map(([code, count]) => ({
      code,
      description: getDescriptionFromDB(code),  // or from chunk text
      confidence: Math.min(1, count / chunks.length + 0.5)
    }));
  return { icd10: sorted, cpt: [], hcpcs: [] };  // CPT from local DB
}
```

### Pros and Cons

| Pros | Cons |
|------|------|
| Real-time retrieval from Pinecone | RAG must run 24/7 (Render, GCP, etc.) |
| Semantic search over clinical corpus | Additional hosting cost |
| Reuses existing middleware contract | Colab still cannot be the RAG host |

---

## Recommendation

| Scenario | Approach |
|----------|----------|
| Colab-only, middleware on Azure | **Approach A (file extraction)** |
| Deployed RAG (Render/GCP) in addition to Colab | **Approach B (translation layer)** in the RAG service |
| Hybrid | Use A for phrase/code expansions; use B for semantic retrieval when RAG is deployed |

---

## Immediate Action: Approach A Steps

1. **Define Colab export format**  
   - Choose single-file (`colab-export.json`) or multi-file.
   - Document the schema.

2. **Add loader in knowledge-service.js**  
   - Load from `Knowledge/RAG/` (and optionally `Knowledge/ontology/`).
   - Merge with existing `PHRASE_EXPANSIONS`, `MEDICAL_PHRASES`.
   - Use `code_expansion_map.json` for ICD expansion.
   - Use `terminology_lookup.json` for term→CPT boosting (if structure allows).

3. **Wire into `extractMedicalPhrases()` and `getCandidateIcd10Codes()`**  
   - Prefer Colab exports over hardcoded values when present.

4. **Document the workflow**  
   - When to run Colab.
   - How to export and where to place files.
   - How to deploy to Azure.

5. **Leave `RAG_API_URL` unset in production**  
   - Use local-only path so the system is self-contained on Azure.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `Knowledge/RAG/colab-export.json` | Create (or use existing files); Colab output |
| `knowledge-service.js` | Add `loadColabExports()`, wire into phrase extraction and ICD expansion |
| `docs/architecture/RAG_COLAB_EXPORT_WORKFLOW.md` | Create workflow doc |
| `remote-rag-client.js` | No change for Approach A (RAG not used) |
| `rag-proxy.js` | No change for Approach A (optional to remove if never used) |
