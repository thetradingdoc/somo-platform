# Production preflight census (read-only)

> **Last reviewed:** 2026-05-29  
> **Rule:** Do **not** write to production until counts are documented and signed off (D2-07).

## Purpose

Before binding Twilio or purging dev data, capture production shape so dev scripts are not run against the wrong environment.

## Environment guard

```bash
# Confirm you are NOT on prod before destructive dev scripts
echo "$DB_PATH $NODE_ENV"
# Prod: NODE_ENV=production, DB_PATH often under /home/…/middleware-prod.db
```

## Read-only queries (SQLite)

```sql
-- Tenant counts
SELECT customer_type, COUNT(*) FROM customers GROUP BY customer_type;
SELECT COUNT(*) AS merchants FROM merchants;
SELECT COUNT(*) AS clinics FROM clinics;
SELECT COUNT(*) AS users FROM users;

-- Voice readiness
SELECT COUNT(*) AS with_twilio FROM customers WHERE twilio_phone_number IS NOT NULL AND twilio_phone_number != '';
SELECT COUNT(*) AS with_retell FROM customers WHERE retell_agent_id IS NOT NULL AND retell_agent_id != '';

-- Recent calls (sample)
SELECT customer_id, COUNT(*) AS n FROM voice_call_log
WHERE created_at > datetime('now', '-7 days')
GROUP BY customer_id ORDER BY n DESC LIMIT 20;
```

## Sign-off block

```text
Date:
Reviewer:
customers (saas): 
customers (with twilio): 
customers (with retell): 
merchants:
Approved for dev Week 1 work: [ ] yes  [ ] no
```

## Related

- [ENV_AND_DB_SSOT.md](../Database/ENV_AND_DB_SSOT.md)
- [wipe-tenant-data.md](./wipe-tenant-data.md)
