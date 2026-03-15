# Stuck Escrow Recovery System

## Overview

The stuck escrow recovery system prevents unrecoverable financial loss when the triple jump settlement flow fails mid-execution. It uses a state machine with durable checkpoints and idempotency keys to enable safe retries.

## Problem Statement

**Scenario**: Transfer 1 (Insurer → Escrow) succeeds, but Transfer 2 (Escrow → Provider) fails or the process crashes before recording it.

**Risk**: Funds are stuck in escrow wallet with no automatic recovery path. USDC transfers are irreversible, so manual intervention is required.

## Solution Architecture

### 1. State Machine (`settlement_attempts` table)

Tracks the state of all three transfers for each settlement attempt:

```sql
CREATE TABLE settlement_attempts (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE,
  total_approved REAL NOT NULL,
  provider_amount REAL NOT NULL,
  revenue_amount REAL NOT NULL,
  transfer_1_status TEXT DEFAULT 'pending', -- pending, completed, failed
  transfer_2_status TEXT DEFAULT 'pending',
  transfer_3_status TEXT DEFAULT 'pending',
  transfer_1_circle_id TEXT, -- Circle transaction ID
  transfer_2_circle_id TEXT,
  transfer_3_circle_id TEXT,
  recovery_attempts INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Key Design**:
- State written BEFORE each transfer executes (durable checkpoint)
- State updated AFTER each transfer completes
- If process crashes, state persists → recoverable

### 2. Idempotency Keys

**Format**: `${claimId}-transfer-{1|2|3}`

**Example**: `CLAIM-12345-transfer-2`

**Protection**: If Transfer 2 succeeds but response is lost, retry with same idempotency key returns the original transfer (no double-payment).

**Critical Insight**: Most "stuck escrows" aren't failed transfers—they're succeeded transfers where the process crashed before recording success.

### 3. Recovery Service (`escrow-recovery-service.js`)

**Functions**:
- `recoverStuckEscrow(claimId)` - Recover single claim
- `recoverAllStuckEscrows(olderThanHours)` - Batch recovery

**Recovery Logic**:
1. Find settlement attempt where `transfer_1_status = 'completed'` and `transfer_2_status != 'completed'`
2. Retry Transfer 2 using idempotency key `${claimId}-transfer-2`
3. If Transfer 2 succeeds, retry Transfer 3 using `${claimId}-transfer-3`
4. Update state after each successful retry

### 4. Recovery Endpoints

**Manual Recovery**:
```
POST /api/admin/recover-stuck-escrow/:claimId
```

**Batch Recovery** (for scheduled jobs):
```
POST /api/admin/recover-all-stuck-escrows?olderThanHours=1
```

### 5. Scheduled Job

**Script**: `scripts/scheduled-recover-escrow.js`

**Recommended Schedule**: Every 15 minutes

**Cron Example**:
```bash
*/15 * * * * cd /path/to/middleware-platform && node scripts/scheduled-recover-escrow.js 1
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  executeInstantSettlement(claimId)                          │
├─────────────────────────────────────────────────────────────┤
│  1. Create settlement_attempts record (state: all pending)  │
│  2. Transfer 1: Insurer → Escrow                            │
│     → Update state: transfer_1_status = 'completed'         │
│  3. Transfer 2 & 3: Escrow → Provider + Revenue (parallel) │
│     → Update state: transfer_2_status, transfer_3_status   │
│  4. If any fail → State persists for recovery               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    [Process Crash?]
                              │
                    ┌──────────┴──────────┐
                    │                     │
              [No Crash]            [Crash]
                    │                     │
                    ▼                     ▼
            [All Complete]    [State Persists]
                                    │
                                    ▼
                          recoverStuckEscrow()
                                    │
                                    ▼
                    [Retry with idempotency keys]
                                    │
                                    ▼
                            [Recovery Complete]
```

## Usage Examples

### Manual Recovery

```bash
curl -X POST "http://localhost:4000/api/admin/recover-stuck-escrow/CLAIM-12345"
```

**Response**:
```json
{
  "success": true,
  "claimId": "CLAIM-12345",
  "message": "Settlement fully recovered",
  "recovered": [
    {
      "transfer": "transfer_2",
      "amount": 194.0,
      "circleTransferId": "circle-tx-abc123"
    },
    {
      "transfer": "transfer_3",
      "amount": 6.0,
      "circleTransferId": "circle-tx-def456"
    }
  ]
}
```

### Scheduled Recovery

```bash
# Run recovery job
node scripts/scheduled-recover-escrow.js 1

# Output:
# 🔍 Starting scheduled escrow recovery (older than 1 hour(s))...
# ✅ Recovery complete:
#    Found: 2 stuck escrows
#    Recovered: 2
```

## Safety Guarantees

1. **Idempotency**: Same idempotency key = same transfer (no double-payment)
2. **State Persistence**: State written before transfers → crash-safe
3. **Recovery Window**: Only recovers attempts older than 1 hour (prevents premature retries)
4. **Audit Trail**: All recovery attempts logged in `settlement_attempts.recovery_attempts`

## Monitoring

**Query stuck escrows**:
```sql
SELECT claim_id, transfer_1_status, transfer_2_status, transfer_3_status, created_at
FROM settlement_attempts
WHERE transfer_1_status = 'completed'
  AND transfer_2_status != 'completed'
  AND datetime(created_at) < datetime('now', '-1 hours');
```

**Alert Threshold**: If stuck escrows > 5, investigate immediately.

## Testing

**Test stuck escrow scenario**:
1. Start settlement for a claim
2. Kill process after Transfer 1 completes but before Transfer 2
3. Wait 1 hour
4. Run recovery job
5. Verify Transfer 2 & 3 complete

**Test idempotency**:
1. Run settlement (Transfer 2 succeeds)
2. Manually set `transfer_2_status = 'pending'` in database
3. Run recovery
4. Verify no double-payment (Circle returns original transfer)

---

*Last Updated: February 2026*
