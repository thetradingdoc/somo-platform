# GitHub migration: doclittle-platform → somo-platform

**Status:** Repository cutover complete (2026-05-29).

| Item | Value |
|------|--------|
| New remote | `https://github.com/richiejeremiah/somo-platform` (private) |
| Legacy remote | `doclittle-old` → `richiejeremiah/doclittle-platform` (archive after smoke) |
| Production hosts | `myskinandcare.com` / `api.myskinandcare.com` (unchanged until somopay.ai) |

## Manual follow-up

1. **GitHub Actions** — If you used repository secrets or variables on `doclittle-platform`, recreate them on `somo-platform` (Settings → Secrets and variables → Actions). Names are not exportable via API; copy values from your password manager or regenerate.
2. **Railway** — Project → Settings → connect repository `richiejeremiah/somo-platform`, branch `main` (or your deploy branch). Confirm `API_BASE_URL` / `BASE_URL` use `api.myskinandcare.com` / `myskinandcare.com`, not `doclittle.site`.
3. **Deploy API** — Push/merge includes `/privacy` route and URL fixes; deploy middleware to Cloud Run/Railway so `https://api.myskinandcare.com/privacy` returns 200.
4. **Firebase Hosting** — From repo root: `npm run deploy:landing-hosting` (uses `api.myskinandcare.com` and `littlelab-landing/build`).
5. **Archive old repo** — Only after Railway/CI succeed from `somo-platform`: GitHub → `doclittle-platform` → Settings → Archive. Then `git remote remove doclittle-old` locally.

## Clone

```bash
git clone https://github.com/richiejeremiah/somo-platform.git somo
cd somo
```
