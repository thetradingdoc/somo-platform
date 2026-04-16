# Face apparent-age pipeline — implementation plan (skin analysis + NVIDIA)

**Status:** Planning / hackathon-first  
**Audience:** Builders aligning Little Lab skin analysis with an on-prem NVIDIA box (e.g. DGX Spark over SSH).  
**Constraint:** This document describes *how* we implement; it does not contain application source code.

---

## 1. Purpose and scope

### 1.1 What we are adding

A **voluntary** “photo read” capability: from a **face image** (still frame or upload), produce a **single apparent-age estimate** (a number with an explicit non-clinical label), optionally compare it to the user’s **stated chronological age**, and feed that **bounded fact** into the existing **skin analysis / Kelly** conversation and results story.

### 1.2 What we are not claiming

- Not a diagnosis, not a clinical “biological age” claim in the regulated sense.  
- Not a replacement for professional care.  
- Hackathon phase: **demo credibility** over production hardening.

### 1.3 Can “we” (this repo + Cursor) build it and use the NVIDIA box?

- **Application and API design:** yes, in this repository (middleware + landing).  
- **Heavy inference:** runs on **your** NVIDIA machine (e.g. SSH into DGX Spark). This environment cannot SSH into your LAN; **you** (or CI you own) execute install and runtime there.  
- **Strategy:** treat the DGX as a **dedicated inference endpoint** (or batch worker) that the middleware calls over the network once networking and trust are defined.

---

## 2. Definition of done (phased)

### Phase A — Hackathon demo (“black box works”)

- On the NVIDIA host: a documented procedure turns **one face image file** into **one numeric estimate** plus **model version id**, printed or returned as JSON.  
- No Little Lab integration required for judges if time is short: screen share or pre-recorded output is acceptable.

### Phase B — Product slice (“in the skin analysis feature”)

- From Little Lab: user **opts in**, provides or confirms **chronological age** (or reads from profile if you add it), submits a **still** face image.  
- Middleware receives the request, forwards image to inference, stores **minimal** structured result, exposes it to the UI and to **Kelly** as **context only** (not autonomous medical decisions).

### Phase C — Production hardening (post-hackathon)

- Legal review, retention policy, encryption in transit and at rest, abuse controls, fairness evaluation, model versioning, fallbacks, observability, and explicit **commercial licensing** if any third-party weights are used.

---

## 3. High-level architecture

Think of **three layers** that must agree on contracts only:

1. **Client (Little Lab landing)** — capture, consent UI, display, send one image per intentional action.  
2. **Middleware (Node, existing server)** — auth/session, rate limits, orchestration, persistence, Kelly prompt injection.  
3. **Inference service (Python on NVIDIA host)** — accept image bytes or multipart upload, run face detect + age regressor, return JSON.

**Network shape (conceptual):**

- Hackathon on same LAN: middleware running on a dev machine can call `http://192.168.x.x:PORT/infer` on the DGX if firewall allows.  
- Stricter future: TLS reverse proxy, API key or mTLS, private VPC.

**NVIDIA usage:** the inference service uses the GPU (CUDA) inside the process the framework supports (e.g. PyTorch or TensorFlow on a stack that actually installs on **aarch64** and your **CUDA 13** driver — see risks in section 9).

---

## 4. How we implement it (component by component)

### 4.1 Inference on the NVIDIA host (DGX Spark)

**Role:** Stateless “image in → JSON out.” No direct access to your production database.

**Responsibilities**

- Validate input size and MIME type; reject absurdly large payloads.  
- **Face detection / crop** (must match training preprocessing philosophy — same rough crop as model expects).  
- **Regression head** output: one float; optionally a simple confidence band if the model provides one (many do not — then use copy, not math).  
- Return: `apparent_age_estimate`, `model_id`, `model_version`, `inference_ms`, `gpu_name` (optional telemetry), `quality_flags` (e.g. too_small, no_face_detected).

**Lifecycle on the box**

- Install via **container** (recommended) or a dedicated Conda env **pinned** to what works on aarch64.  
- Run as a **systemd user service** or Docker Compose for “always on during hackathon.”  
- **Health endpoint** for middleware: lightweight route that does not run inference (or runs a tiny warmup).

**Why not “just clone FaceAge inside Node”?**

- The Harvard FaceAge reference repo targets an older stack; on **aarch64 + new CUDA/Python**, wheels and binaries may not exist. The implementation plan assumes: **same scientific idea**, **runnable stack on GB10** — which may mean a different runtime or re-exported weights, documented as `model_id` so Kelly and UI never confuse versions.

### 4.2 Middleware (existing `middleware-platform`)

**Role:** The only public entry from the internet (or from your dev UI); it owns sessions and policy.

**New responsibilities**

- **Route** (name to be chosen), e.g. a public or session-scoped “photo read” endpoint under the same patterns as other landing assistant routes.  
- **Idempotency** optional: same session + same image hash could return cached result for demo stability.  
- **Forward** image to inference URL from env var (e.g. `FACE_READ_INFERENCE_BASE_URL`), with timeouts (e.g. 15–60s depending on cold start).  
- **Persist** a small blob of metadata (see section 5) and attach to **landing session** / thread.  
- **Never** store raw images longer than policy allows; hackathon may use “no persistent image, only ephemeral processing” for simplicity.

**Kelly integration**

- Extend the **thread context** or **session snapshot** with a short structured block, e.g. “Photo read (model vX): apparent estimate ~52; user stated age 30; wellness-only.”  
- Prompt guardrails: Kelly must treat this as **one soft signal** among many, not a directive to diagnose.

### 4.3 Client (`unified-dashboard/littlelab-landing`)

**Role:** Honest UX and a clean handoff to middleware.

**New UI flow**

1. **Opt-in screen** — separate from generic camera permission; explicit toggle “Show apparent-age estimate from my photo.”  
2. **Chronological age** — one-time field or profile field; required for your “30 vs reads 50” hook.  
3. **Capture** — still frame from existing LiveKit / file upload path; **no** continuous inference on every video frame (cost, privacy, noise).  
4. **Submit** — POST multipart or base64 per middleware contract.  
5. **Result** — headline + uncertainty copy + link to routine suggestions; optional “Read aloud” if you keep chat TTS.

**Existing code touchpoints (conceptual, not code)**

- Vision and session patterns already exist (`landingLiveKitApi`, vision session polling, thread events). The plan is to **add a parallel “photo read” event type** rather than overloading barcode tracking.

---

## 5. Data model and persistence

### 5.1 What to store (minimum viable)

- `session_id`  
- `model_id` / `model_version`  
- `apparent_age_estimate` (float)  
- `user_stated_age` (int, optional)  
- `delta` (computed in middleware for convenience, or computed in UI only)  
- `consent_photo_read_at` (ISO timestamp)  
- `quality` enum (ok, no_face, low_resolution, etc.)  
- **Do not** store full-resolution face images in hackathon unless you must — prefer ephemeral processing.

### 5.2 Where it lives

**Option aligned with current product:** mirror how **scanned product** and **thread events** attach to the landing assistant session:

- **Thread event** — append-only audit trail for Kelly (“what did the user submit”).  
- **Session result snapshot extension** — optional field block `face_photo_read` so Results page can render a card without re-parsing chat.

Exact JSON shape to be agreed when implementing; version field is mandatory.

---

## 6. End-to-end flow (sequence)

1. User opens skin / assistant experience and enables **Photo read**.  
2. User confirms **stated age** (or loads from profile).  
3. User captures **one still** (or picks a file).  
4. Client POSTs to middleware with session id + image + consent flag.  
5. Middleware validates, optionally rate-limits, forwards to **NVIDIA inference**.  
6. Inference returns JSON; middleware normalizes errors (no face, timeout).  
7. Middleware writes thread event + optional snapshot field.  
8. Client shows card; next Kelly turn includes the new context automatically or after user taps “Ask Kelly about this.”

---

## 7. Using NVIDIA specifically (operational playbook)

### 7.1 Day-to-day during build

- Developers SSH to the DGX, run the inference container or venv, tail logs.  
- Middleware on a dev laptop points to `http://<DGX-LAN-IP>:<port>` **only on trusted network**.

### 7.2 Hackathon day

- DGX on same network as demo laptop; confirm IP static or reserved.  
- Start inference service before judges arrive; hit health check from laptop.  
- Have **two** face photos pre-tested offline so live demo is not the first inference.

### 7.3 Future production

- Inference moves to **same region** as app, behind private networking, with secrets rotation — out of scope for this doc’s hackathon slice.

---

## 8. Security, privacy, abuse

- **Transport:** HTTPS or VPN between middleware and inference in any shared or non-LAN environment.  
- **Secrets:** API key from middleware → inference; rotate after hackathon.  
- **Rate limit** per session and per IP on middleware.  
- **Content:** max image dimensions and megabytes; strip EXIF if policy requires.  
- **Logging:** never log raw image bytes; log hashes and timings.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Reference FaceAge env won’t install on **aarch64** / CUDA 13 | Timebox attempt; ship hackathon with **runnable** PyTorch-style age demo or Colab backup; same UX copy. |
| Model bias / wrong number for some users | Soft language, show band or “estimate,” allow dismiss; do not gate features on the number. |
| Kelly over-interprets the number | System prompt + structured “context tier” rules; human-in-the-loop copy review. |
| Latency / cold start | Warmup endpoint; async job + polling if >10s. |
| Legal | Wellness disclaimer; separate consent; no clinical outcome claims. |

---

## 10. Testing strategy (no code — what to verify)

- **Inference host:** single known image → stable numeric output across two consecutive calls (or document nondeterminism if any).  
- **Middleware:** timeout path, no-face path, oversize image path.  
- **Client:** opt-in gating, error banners, accessibility labels for new controls.  
- **E2E (optional):** Playwright happy path: opt-in → upload fixture image → see numeric card (may mock inference in CI).

---

## 11. Rollout order (recommended build order)

1. Inference JSON API on DGX + health check + one manual `curl` from laptop.  
2. Middleware proxy route + thread event write + env-configured base URL.  
3. Landing UI: opt-in + upload + results card.  
4. Kelly: prompt + snapshot consumption.  
5. Polish: copy, limits, telemetry, demo script for judges.

---

## 12. Open decisions (to resolve before coding)

- **Commercial use:** If weights are from AIM-Harvard FaceAge, confirm license vs hackathon-only demo.  
- **Where middleware runs** during hackathon (same LAN as DGX vs cloud-only demo).  
- **Whether chronological age** lives in profile, session-only, or both.  
- **Retention:** zero retention vs 24h vs encrypted blob — pick one for demo.

---

## 13. Summary

**Yes:** we can design the full pipeline so **skin analysis + Kelly** consume a **photo-derived apparent-age signal**, while **NVIDIA** does the compute on the DGX.  

**Build order:** stand up **inference on the GPU host first**, then **middleware contract**, then **landing UI**, then **Kelly context** — each phase independently demoable.

This document is the single implementation blueprint; detailed tickets can be split per section when you start coding.
