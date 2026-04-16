# Periodic maintenance (quarterly suggested)

Use this checklist to keep **documentation** and **CI expectations** aligned as the repo evolves.

## Review

- [ ] Root **`README.md`** feature bullets still match what CI and product actually enforce.
- [ ] **`CONTRIBUTING.md`** commands still match **`.github/workflows/ci.yml`**.
- [ ] **`openapi.yaml`** still reflects important public routes (spot-check after large refactors).
- [ ] **`docs/architecture/commerce/AGENTIC_CHECKOUT_FILE_MAP.md`** if checkout or public commerce routes moved.
- [ ] Todos under **`todos/`** — close or update stale “done” narratives.

## Optional

- [ ] Dependency major upgrades (Node LTS, Expo SDK) — run full local + CI matrix before merging.
