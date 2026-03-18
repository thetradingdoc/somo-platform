## Patient Wallet (MVP + future)

### Purpose
The **Wallet** is the patient’s financial home in the Patient Portal:

- **Receipts**: history of payments / invoices for visits.
- **Payment methods**: card on file (cash-only MVP).
- **Balances**: show if any visit has payment due.

### MVP assumptions (cash-only)
- The patient can pay per-visit using a card/payment method (no insurer payout flows yet).
- The Wallet UI reads:
  - Receipts from `GET /api/patient/receipts`
  - Payment-due signals from `GET /api/patient/appointments` (`payment_status`)
- The Insurance UI is shown as **Coming soon** and does not block the cash-only flow.

### Future integrations (not implemented yet)
- Clearinghouse/eligibility/ERA integrations (e.g. Stedi) can enrich Wallet with:
  - Copay / deductible / coinsurance breakdowns
  - Claim status and remittance details
  - Insurer → patient payments and credits

### UX rules
- **Receipts belong in Wallet**, not in Visits/Appointments.
- **Payment card belongs in Wallet**, not on the Dashboard.
- **Help belongs in Profile** (wallet stays financial-only).

