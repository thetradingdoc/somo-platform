# Invoice Generation Workflow Guide

## Overview

This guide explains the complete workflow for generating and managing invoices from medical claims in the DocLittle platform.

## Workflow: PDF → Claim → Invoice → Send → Payment

### Step 1: Upload PDF and Extract Codes

1. Navigate to **Scan** (PDF Coding) page
2. Select a patient from the dropdown
3. Upload a PDF document containing medical coding information
4. The system extracts:
   - ICD-10 diagnosis codes
   - CPT procedure codes
   - Service dates
   - Pricing information

### Step 2: Create Claim from PDF

1. Review the extracted codes displayed on the page
2. Click **"Create Claim"** button
3. The system:
   - Creates an insurance claim record
   - Links to patient's primary insurance
   - Calculates EOB (Explanation of Benefits)
   - Determines patient responsibility

4. **Optional:** After claim creation, you'll be prompted:
   - **"Generate Invoice Now?"** - Click OK to create invoice immediately
   - **Cancel** - View the claim first, then generate invoice later

### Step 3: Generate Invoice from Claim

**Option A: From PDF Coding Page**
- After claim creation, confirm invoice generation when prompted

**Option B: From Claims Page**
1. Navigate to **Billing** → View patient's EOB
2. Click on a claim to view details
3. Click **"🧾 Generate Invoice"** button
4. System creates invoice with:
   - Invoice number (e.g., INV-00001)
   - Patient responsibility amount (from EOB)
   - Line items from claim services
   - Due date (30 days from creation)

### Step 4: Review and Send Invoice

1. Navigate to **Invoices** page
2. Find the invoice (status: `draft`)
3. Click **"View"** to see details:
   - Invoice number
   - Patient information
   - Line items with CPT/ICD codes
   - Total amount and balance
4. Click **"Send"** to email invoice to patient
   - Email includes HTML invoice summary
   - PDF attachment (if PDFKit installed)
   - Payment instructions

### Step 5: Track Payments

1. When patient makes payment, click **"Pay"** button on invoice
2. Enter payment details:
   - Payment amount
   - Payment method (cash, check, credit_card, bank_transfer)
   - Reference number (optional)
   - Notes (optional)
3. System automatically:
   - Records payment
   - Updates invoice balance
   - Changes status to `paid` when fully paid

## Invoice Statuses

- **Draft**: Created but not sent to patient
- **Sent**: Email sent to patient, awaiting payment
- **Paid**: Fully paid, no balance remaining
- **Overdue**: Past due date with outstanding balance

## Invoice Management Features

### Filtering and Search

On the **Invoices** page, you can:
- **Search** by invoice number, patient name, or claim ID
- **Filter** by status (draft, sent, paid, overdue)
- **Filter** by date range
- **Filter** by patient

### Invoice Actions

- **View**: See full invoice details with line items and payment history
- **Send**: Email invoice to patient (draft invoices only)
- **Pay**: Record payment (sent/overdue invoices)
- **Resend**: Send invoice email again (sent invoices)

## Best Practices

1. **Review EOB Before Generating Invoice**
   - Check that patient responsibility is correct
   - Verify insurance coverage and copay amounts

2. **Send Invoices Promptly**
   - Send invoices within 24-48 hours of claim creation
   - Include clear payment instructions

3. **Track Payments Regularly**
   - Record payments as soon as received
   - Follow up on overdue invoices

4. **Use Notes Field**
   - Add notes for special payment arrangements
   - Document payment plan agreements

## Troubleshooting

### Invoice Not Generating

- **Check:** Patient has primary insurance configured
- **Check:** Claim has valid EOB calculation
- **Check:** Patient responsibility > $0

### Email Not Sending

- **Check:** Patient has valid email address in profile
- **Check:** Email service is configured (SMTP or Azure)
- **Check:** Invoice status is `draft` (can't resend if already sent)

### Payment Not Recording

- **Check:** Payment amount doesn't exceed invoice balance
- **Check:** Invoice exists and is not voided
- **Check:** Payment date is valid

## Related Pages

- **Scan (PDF Coding)**: Upload PDFs and create claims
- **Billing**: View claims and EOB for all patients
- **Invoices**: Manage all invoices
- **Patients**: View patient details and insurance

## Support

For issues or questions:
1. Check the API documentation: `/docs/api/INVOICE_API.md`
2. Review error messages in browser console
3. Contact support with invoice number and error details

