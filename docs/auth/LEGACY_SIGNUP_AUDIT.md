# Legacy signup audit (W4-07 / W4-07c)

> **Last reviewed:** 2026-05-29

## Routes still using `users` table

| Route | File | Action |
|-------|------|--------|
| `POST /api/auth/signup` | auth routes | Returns **410** unless `ALLOW_LEGACY_USERS_SIGNUP=1` |
| Legacy clinic login | `users` + session | Deprecate for new tenants |

## Policy

- **New providers:** `/signup` wizard → `customers` + `provisionSaasTenant` (merchant + clinic + phone).
- **Duplicates:** If both `users` and `customers` exist for the same email:
  1. Run read-only report: `npm run audit:duplicate-identities`
  2. Prefer **customers** row as Somo SaaS identity going forward
  3. Link `users.merchant_id` / `users.clinic_id` to the canonical customer tenant if the user row is still needed for legacy login
  4. **Do not auto-delete** without ops review — document merge in Week 1 handoff

## Merge checklist (manual)

1. Confirm which row has active subscription / Twilio number / Retell agent
2. Copy missing foreign keys (`merchant_id`, `clinic_id`, `retell_agent_id`) onto the canonical **customer**
3. Disable or archive duplicate login path
4. Re-run `audit:duplicate-identities` until zero `users+customers` conflicts

## Target

Single provider identity in `customers` for Somo SaaS; `users` retained only for legacy clinic deployments.
