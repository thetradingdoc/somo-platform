# GitHub migration: doclittle-platform → somo-platform

**Status:** Repository cutover complete (2026-05-29).

| Item | Value |
|------|--------|
| New remote | `https://github.com/richiejeremiah/somo-platform` (private) |
| Legacy remote | `doclittle-old` → `richiejeremiah/doclittle-platform` (archive after smoke) |
| Production hosts | `myskinandcare.com` / `api.myskinandcare.com` (unchanged until somopay.ai) |

## Manual follow-up

1. **GitHub Actions** — Checked 2026-05-29: no repository secrets or variables on either `doclittle-platform` or `somo-platform` via `gh secret list`. Recreate any **environment** or **org-level** secrets manually if you use them.
2. **Railway** — CLI requires `RAILWAY_TOKEN` (or interactive `railway login`). In [Railway Dashboard](https://railway.app) → your project → **Settings** → **Connect GitHub** → `richiejeremiah/somo-platform`, branch `main`. Confirm env vars use `api.myskinandcare.com` / `myskinandcare.com`. Production API is **Cloud Run** (`myskin-middleware`); Railway may be legacy/staging only.
3. **Deploy API** — Done 2026-05-29: `gcloud run deploy myskin-middleware` from `middleware-platform/` → `https://api.myskinandcare.com/privacy` returns **200**.
4. **Firebase Hosting** — Done 2026-05-29: `npm run deploy:landing-hosting` → `myskinandcare.com` serves Somo landing build.
5. **Archive old repo** — After a green CI run on `somo-platform` `main`, archive `doclittle-platform` and run `git remote remove doclittle-old`.

## Clone

```bash
git clone https://github.com/richiejeremiah/somo-platform.git somo
cd somo
```
