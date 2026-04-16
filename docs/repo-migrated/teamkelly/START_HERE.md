# Start here — face-read service (no experience required)

**Important:** The folder only exists where you copied it. A **Mac path** like `/Users/ojrichard/...` does **not** exist on the DGX. On the DGX you must **copy or clone** `teamkelly` first, then `cd` to **that** folder (for example `~/teamkelly`).

Do these steps **on your Mac** unless a section says **DGX**.

---

## Step 1 — Start the Python service (Terminal 1)

Open Terminal, then run **exactly** (copy the whole block):

```bash
cd "/Users/ojrichard/Voice Agent/doclittle-platform/teamkelly"
chmod +x scripts/setup-and-run.sh
./scripts/setup-and-run.sh
```

Leave this window **open**. You should see text like `Uvicorn running on http://0.0.0.0:8765`.

**Test it:** open another Terminal and run:

```bash
curl -s http://127.0.0.1:8765/health
```

You should see JSON with `"status":"ok"` and **`"age_model_ready": true`** after the first run (models download once, ~45MB).

**Face-age smoke test** (use any JPEG/PNG with a clear face):

```bash
curl -s -X POST http://127.0.0.1:8765/v1/face-read -F "image=@/path/to/your-photo.jpg"
```

Look for `"quality":"ok"` and a number in `apparent_age_estimate`. If `"quality":"no_face"`, use a straighter, well-lit photo.

---

## Step 2 — Point middleware at this service (one line in `.env`)

1. Open `middleware-platform/.env` in your editor (same folder where you already set API keys).
2. Add **this line** (or edit if it exists):

```bash
FACE_READ_INFERENCE_BASE_URL=http://127.0.0.1:8765
```

3. **Save** the file.

---

## Step 3 — Restart middleware (Terminal 2)

Stop middleware if it is running (Ctrl+C), then:

```bash
cd "/Users/ojrichard/Voice Agent/doclittle-platform/middleware-platform"
npm start
```

---

## Step 4 — Test the full chain (optional)

With **both** teamkelly (step 1) and middleware (step 3) running, in a **third** Terminal:

```bash
curl -s -X POST http://127.0.0.1:4000/api/public/face-read \
  -F "image=@$HOME/Desktop/your-photo.jpg"
```

(Change the path to any real **.jpg** or **.png** on your Mac.)

- If you forgot step 2, you get `face_read_service_not_configured`.
- If it works, you get JSON with `face_read` (stub may say `quality: not_implemented` until you add a real model on the DGX).

---

## On the NVIDIA DGX (you are logged in as `acergn100_33@gn100-d911`)

The error `No such file or directory` for `/Users/ojrichard/...` is **expected**: that is your **Mac** path. Linux has no `/Users/ojrichard`.

**1. Get the code onto the DGX** (pick one):

- **From your Mac** (in a Mac Terminal, not on the DGX), copy the folder over SSH:

  `scp -r "/Users/ojrichard/Voice Agent/doclittle-platform/teamkelly" acergn100_33@gn100-d911.local:~/teamkelly`

  Or use **Git**: on the DGX, `git clone` your `teamkelly` repo into `~/teamkelly` after you push the folder to GitHub.

**2. On the DGX**, run:

```bash
cd ~/teamkelly
chmod +x scripts/setup-and-run.sh
./scripts/setup-and-run.sh
```

If you see **`externally-managed-environment`** (PEP 668), the usual cause is a **`.venv` folder that came from your Mac** in the same `scp` transfer. macOS and Linux need separate virtualenvs. Fix it once:

```bash
cd ~/teamkelly
rm -rf .venv
./scripts/setup-and-run.sh
```

**3. Test on the DGX:**

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/
```

`/health` should include `"entrypoint":"main:app"` and **`dnn_backend`** (`cpu` with pip OpenCV, or `cuda` if your OpenCV build supports it). **`torch`** shows whether PyTorch sees the GPU (install PyTorch on the DGX separately if you want that line to prove CUDA).

If **`GET /` returns 404**, the DGX is still running an **old** server or the wrong module. Fix: copy the **latest** `teamkelly` from your Mac (including **`main.py`** and **`src/api.py`**), then `rm -rf ~/teamkelly/src/__pycache__`, restart with **`./scripts/setup-and-run.sh`** (it runs **`uvicorn main:app`**, not `src.api:app`).

**4. Point middleware (on your Mac)** at the DGX:

In `middleware-platform/.env` use the DGX IP (same network as your Mac), for example:

`FACE_READ_INFERENCE_BASE_URL=http://192.168.3.189:8765`

(Use the IP you already see on the DGX, e.g. `192.168.3.189`.) Ensure nothing blocks port **8765** between Mac and DGX.

---

## What you do **not** need to do alone

- **Pushing to GitHub** — copy `teamkelly/` into your `teamkelly` repo when ready (see main `README.md`).
- **Real age model** — the service runs; replacing the stub with a PyTorch model is a follow-up step on the GPU machine.

If something fails, note **which step** (1–4) and the **exact error message** (one screenful is enough).
