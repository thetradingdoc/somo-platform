# teamkelly — face apparent-age inference service

This package is **only** the GPU-side **inference API** (FaceAge-style: face crop → age regression). It is **not** the Little Lab middleware or landing app.

**Marketing / demo page (static):** see `website/` — serve with `python3 -m http.server 8080 -d website`, open `http://127.0.0.1:8080/`, click **Call Kelly** to open the FaceAge-style **photo read** flow (`face-age.html`). That page calls the API on port **8765** (CORS is allowed for `:8080` by default). Run `./scripts/setup-and-run.sh` in another terminal first.

**Upstream reference (research):** [AIM-Harvard/FaceAge](https://github.com/AIM-Harvard/FaceAge) — same *idea* (face photo → apparent age). This service ships a **runnable baseline**: OpenCV DNN + the public **Levi & Hassner** Caffe `age_net` (8 age buckets → weighted years), Haar frontal-face crop. Not identical to Harvard’s trained FaceAge weights; good for **end-to-end demos** on CPU or before you swap in PyTorch on the GPU.

## What belongs here vs doclittle-platform

| Location | Contents |
|----------|----------|
| **This repo (`teamkelly`)** | Python service, Dockerfile, model weights (or download script), GPU inference only. |
| **doclittle-platform** | Middleware proxy route, landing UI, Kelly prompts — **do not duplicate** here. |

## API (contract for middleware)

- `GET /health` — liveness; no GPU required.
- `POST /v1/face-read` — multipart field `image` (JPEG/PNG). Returns JSON: `apparent_age_estimate`, `model_id`, `model_version`, `quality` (`ok` \| `no_face` \| …), `inference_ms`.

Middleware sets `FACE_READ_INFERENCE_BASE_URL` to this service’s base URL.

## GPU (NVIDIA DGX Spark / GB10, aarch64)

Install PyTorch (or your stack) with **CUDA wheels that match aarch64 + your driver**. See NVIDIA docs for GB10. The FaceAge **original** conda env is x86/legacy-TF oriented; this service is meant to be **modern PyTorch** unless you containerize their exact stack elsewhere.

## Run (development)

**One-time model download (~45MB):** `./scripts/setup-and-run.sh` does this automatically, or run `bash scripts/download-face-age-models.sh` after `pip install`.

```bash
cd teamkelly
chmod +x scripts/setup-and-run.sh
./scripts/setup-and-run.sh
```

Or manually:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
bash scripts/download-face-age-models.sh
uvicorn main:app --host 0.0.0.0 --port 8765
```

**Smoke test:** `curl -s http://127.0.0.1:8765/health` should show `"age_model_ready": true`. Then POST a JPEG with a visible face:

`curl -s -X POST http://127.0.0.1:8765/v1/face-read -F "image=@/path/to/photo.jpg"`

## Docker

```bash
docker build -t teamkelly-face .
docker run --gpus all -p 8765:8765 teamkelly-face
```

(Adjust `--gpus` / runtime per your NVIDIA container toolkit.)

## Models

Weights are **not** committed (large binary). `scripts/download-face-age-models.sh` fetches:

- `age_deploy.prototxt` (learnopencv)
- `age_net.caffemodel` ([GilLevi/AgeGenderDeepLearning](https://github.com/GilLevi/AgeGenderDeepLearning), Levi & Hassner)

Override paths with `FACE_AGE_PROTO` / `FACE_AGE_CAFFE` if needed. Third-party weight terms apply.

## Pushing **only** this service to `github.com/richiejeremiah/teamkelly`

Do **not** push `middleware-platform` or the rest of doclittle-platform to that repo.

**Option A — this folder is the repo (simplest)**  
On your machine:

1. `git clone https://github.com/richiejeremiah/teamkelly.git && cd teamkelly`
2. Copy the contents of `doclittle-platform/teamkelly/` **into** that clone (overwrite/add files), commit, push.

**Option B — keep one workspace**  
Initialize a separate git repo **only** inside `doclittle-platform/teamkelly/` with its own `.git` and remote `origin` = `teamkelly` (advanced; avoid if you are unsure).

## License

MIT (match the existing [teamkelly LICENSE](https://github.com/richiejeremiah/teamkelly/blob/main/LICENSE)). Third-party model weights may have separate terms.
