# Medicare Physician Fee Schedule (MPFS)

Download the CMS PFS relative value file from:

https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files

Example (Oct 2025 release):

```bash
curl -fsSL -o Knowledge/fee-schedules/RVU25D.zip https://www.cms.gov/files/zip/rvu25d.zip
unzip -o Knowledge/fee-schedules/RVU25D.zip PPRRVU2025_Oct.csv
cp Knowledge/fee-schedules/PPRRVU2025_Oct.csv Knowledge/fee-schedules/PPRRVU.csv
cd middleware-platform
node scripts/import-mpfs-medicare.js --file ../Knowledge/fee-schedules/PPRRVU.csv
```

Verify:

```sql
SELECT COUNT(*) FROM fee_schedules WHERE payer_id IN ('MEDICARE','CMS');
```
