# SECURITY

**Last updated:** 2026-06-02


---

<a id="secret-scanning"></a>

## SECRET SCANNING

*Merged from `docs/security/SECRET_SCANNING.md` on 2026-06-02.*

# Secret scanning and dependency audit

## CI today

GitHub Actions runs **npm audit** (moderate threshold) and a **heuristic grep** for common secret-like strings in `middleware-platform/`. Both steps are **best-effort** and may use `continue-on-error` for noisy findings.

## What we recommend for production repos

- Enable **GitHub Advanced Security — secret scanning** (or equivalent) on the organization or repository.
- Optionally add **gitleaks** or similar in CI with allowlists for known false positives (test fixtures, example env keys).
- Treat **any** leaked credential as **rotate + invalidate**, even if removed from git history later.

## Local hygiene

- Never commit `.env` files; use `.env.example` without real values.
- Prefer **short-lived** API keys where possible.
