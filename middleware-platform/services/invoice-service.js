/**
 * INVOICE SERVICE
 * Handles invoice business logic: generation, EOB calculation, email templates
 */

const db = require('../database');
const EOBCalculationService = require('./eob-calculation-service');

class InvoiceService {
  /**
   * Create invoice from claim
   * Calculates patient responsibility from EOB and creates invoice
   */
  static async createInvoiceFromClaim(claimId, options = {}) {
    try {
      // Get claim details
      const claim = db.getInsuranceClaim(claimId);
      if (!claim) {
        throw new Error('Claim not found');
      }

      // Check if invoice already exists for this claim
      const existingInvoices = db.getInvoicesByClaim(claimId);
      if (existingInvoices.length > 0 && !options.allowMultiple) {
        throw new Error('Invoice already exists for this claim');
      }

      // Get patient details
      const patient = db.getFHIRPatient(claim.patient_id);
      if (!patient) {
        throw new Error('Patient not found');
      }

      // Calculate EOB to determine patient responsibility and total billed
      const eobData = await this.calculatePatientResponsibility(claim.patient_id, claimId);
      
      // Generate invoice number
      const invoiceNumber = db.generateInvoiceNumber();

      // Calculate due date (default: 30 days from now)
      const dueDate = options.due_date || this.calculateDueDate(30);

      // Invoice amount = total billed (amountBilled) so insurance + patient payments reconcile
      // Balance after insurance payment = whatYouOwe (patient portion)
      const amountBilled = eobData.totals?.amountBilled;
      const invoiceAmount = (amountBilled != null && amountBilled > 0)
        ? amountBilled
        : (eobData.patient_responsibility || 0);
      const invoice = {
        claim_id: claimId,
        patient_id: claim.patient_id,
        invoice_number: invoiceNumber,
        status: 'draft',
        amount: invoiceAmount,
        due_date: dueDate,
        notes: options.notes || null
      };

      const result = db.createInvoice(invoice);
      const createdInvoice = db.getInvoice(result.id);

      // Add invoice items from claim/EOB data (use amount_billed so line totals = invoice total)
      if (eobData.services && eobData.services.length > 0) {
        for (const service of eobData.services) {
          const lineAmount = service.amount_billed ?? service.what_you_owe ?? 0;
          db.addInvoiceItem({
            invoice_id: result.id,
            service_date: service.date_of_service || claim.submitted_at,
            description: service.type_of_service || 'Medical service',
            cpt_code: service.cpt_code || null,
            icd_code: service.icd_code || null,
            quantity: 1,
            unit_price: lineAmount,
            total_price: lineAmount
          });
        }
      } else {
        // Fallback: create single line item from claim
        db.addInvoiceItem({
          invoice_id: result.id,
          service_date: claim.submitted_at,
          description: 'Medical service',
          cpt_code: claim.service_code || null,
          icd_code: claim.diagnosis_code || null,
          quantity: 1,
          unit_price: invoiceAmount,
          total_price: invoiceAmount
        });
      }

      return {
        success: true,
        invoice: db.getInvoice(result.id),
        items: db.getInvoiceItems(result.id)
      };
    } catch (error) {
      console.error('❌ Error creating invoice from claim:', error);
      throw error;
    }
  }

  /**
   * Calculate patient responsibility from EOB
   */
  static async calculatePatientResponsibility(patientId, claimId = null) {
    try {
      // Get latest eligibility check for patient
      const eligibilityChecks = db.getEligibilityChecksByPatient(patientId);
      const eligibility = eligibilityChecks && eligibilityChecks.length > 0 ? eligibilityChecks[0] : null;

      if (!claimId) {
        return {
          patient_responsibility: 0,
          services: [],
          totals: {},
          eligibility
        };
      }

      const claim = db.getInsuranceClaim(claimId);
      if (!claim) {
        return {
          patient_responsibility: 0,
          services: [],
          totals: {},
          eligibility
        };
      }

      let claimDetails = {};
      try {
        claimDetails = claim.response_data
          ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data)
          : {};
      } catch (_) {}

      // Alignment: when the claim is approved/paid and an EOB is already stored in response_data,
      // reuse that stored EOB to keep patient responsibility consistent with /api/claims/:id.
      if ((claim.status === 'approved' || claim.status === 'paid') && claimDetails?.eob) {
        const storedEob = claimDetails.eob;
        const patientResponsibility =
          storedEob?.totals?.whatYouOwe ?? storedEob?.totals?.what_you_owe ?? 0;

        const services = (storedEob?.lineItems || []).map((li) => ({
          date_of_service: li.dateOfService || li.date_of_service,
          type_of_service: li.typeOfService || li.type_of_service || li.description || '',
          cpt_code: li.cptCode || li.cpt_code || null,
          icd_code: li.icdCode || li.icd_code || null,
          what_you_owe: li.whatYouOwe ?? li.what_you_owe ?? 0,
          amount_billed: li.amountBilled ?? li.amount_billed ?? 0
        }));

        return {
          patient_responsibility: patientResponsibility,
          services,
          totals: storedEob?.totals || {},
          eligibility
        };
      }

      const eobResult = EOBCalculationService.calculateEOBFromClaim(claim, eligibility || {}, claimDetails);
      const patientResponsibility = eobResult.totals?.whatYouOwe ?? eobResult.totals?.what_you_owe ?? 0;

      // Map lineItems to services format expected by invoice (snake_case)
      const services = (eobResult.lineItems || []).map((li) => ({
        date_of_service: li.dateOfService,
        type_of_service: li.typeOfService || li.description,
        cpt_code: li.cptCode,
        icd_code: null,
        what_you_owe: li.whatYouOwe ?? 0,
        amount_billed: li.amountBilled ?? 0
      }));

      return {
        patient_responsibility: patientResponsibility,
        services,
        totals: eobResult.totals || {},
        eligibility
      };
    } catch (error) {
      console.error('❌ Error calculating patient responsibility:', error);
      return {
        patient_responsibility: 0,
        services: [],
        totals: {},
        eligibility: null
      };
    }
  }

  /**
   * Calculate due date (days from today)
   */
  static calculateDueDate(days = 30) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  /**
   * Check if invoice is overdue
   */
  static isInvoiceOverdue(invoice) {
    if (!invoice.due_date || invoice.status === 'paid' || invoice.status === 'cancelled') {
      return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(invoice.due_date);
    dueDate.setHours(0, 0, 0, 0);

    return dueDate < today;
  }

  /**
   * Update invoice status to overdue if past due date
   */
  static updateOverdueInvoices() {
    const invoices = db.getInvoices({ status: 'sent' });
    let updated = 0;

    for (const invoice of invoices) {
      if (this.isInvoiceOverdue(invoice)) {
        db.updateInvoice(invoice.id, { status: 'overdue' });
        updated++;
      }
    }

    return updated;
  }

  /**
   * Get invoice summary with payments
   */
  static getInvoiceSummary(invoiceId) {
    const invoice = db.getInvoice(invoiceId);
    if (!invoice) {
      return null;
    }

    const items = db.getInvoiceItems(invoiceId);
    const payments = db.getInvoicePayments(invoiceId);
    const totalPaid = db.getInvoicePaymentsTotal(invoiceId);
    const balance = invoice.amount - totalPaid;

    return {
      invoice,
      items,
      payments,
      totals: {
        amount: invoice.amount,
        paid: totalPaid,
        balance: balance,
        isPaid: balance <= 0,
        isOverdue: this.isInvoiceOverdue(invoice)
      }
    };
  }

  /**
   * Generate invoice email template
   */
  static generateEmailTemplate(invoice, patient, items) {
    const dueDate = new Date(invoice.due_date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Extract patient name from FHIR resource
    let patientName = 'Patient';
    if (patient && patient.name) {
      if (Array.isArray(patient.name) && patient.name.length > 0) {
        const name = patient.name[0];
        patientName = `${(name.given || []).join(' ')} ${name.family || ''}`.trim();
      } else if (typeof patient.name === 'string') {
        patientName = patient.name;
      }
    }
    const totalPaid = db.getInvoicePaymentsTotal(invoice.id);
    const balance = invoice.amount - totalPaid;

    return {
      subject: `Invoice ${invoice.invoice_number} from DocLittle`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
            .invoice-details { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .amount-due { font-size: 24px; font-weight: bold; color: #ef4444; margin: 20px 0; }
            .button { display: inline-block; background: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            th { background: #f3f4f6; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Invoice ${invoice.invoice_number}</h1>
            </div>
            <div class="content">
              <p>Dear ${patientName},</p>
              <p>Please find your invoice below for medical services provided.</p>
              
              <div class="invoice-details">
                <h2>Invoice Details</h2>
                <p><strong>Invoice Number:</strong> ${invoice.invoice_number}</p>
                <p><strong>Date:</strong> ${new Date(invoice.created_at).toLocaleDateString()}</p>
                <p><strong>Due Date:</strong> ${dueDate}</p>
                ${balance > 0 ? `<p class="amount-due">Amount Due: $${balance.toFixed(2)}</p>` : '<p style="color: #10b981; font-weight: bold;">Paid in Full</p>'}
                
                ${items.length > 0 ? `
                  <h3>Services</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${items.map(item => `
                        <tr>
                          <td>${item.service_date ? new Date(item.service_date).toLocaleDateString() : '—'}</td>
                          <td>${item.description}</td>
                          <td>$${item.total_price.toFixed(2)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                    <tfoot>
                      <tr style="font-weight: bold;">
                        <td colspan="2">Total</td>
                        <td>$${invoice.amount.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                ` : ''}
              </div>

              ${balance > 0 ? `
                <p>Please remit payment by ${dueDate} to avoid late fees.</p>
                <p>If you have any questions about this invoice, please contact us.</p>
              ` : ''}
            </div>
            <div class="footer">
              <p>This is an automated message from DocLittle Doctor's Portal</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Invoice ${invoice.invoice_number}

Dear ${patientName},

Please find your invoice for medical services provided.

Invoice Number: ${invoice.invoice_number}
Date: ${new Date(invoice.created_at).toLocaleDateString()}
Due Date: ${dueDate}
Amount Due: $${balance > 0 ? balance.toFixed(2) : '0.00 (Paid in Full)'}

${items.length > 0 ? items.map(item => `- ${item.description}: $${item.total_price.toFixed(2)}`).join('\n') : ''}

Total: $${invoice.amount.toFixed(2)}

${balance > 0 ? `Please remit payment by ${dueDate} to avoid late fees.` : 'This invoice has been paid in full.'}

If you have any questions, please contact us.

---
DocLittle Doctor's Portal
      `.trim()
    };
  }
}

module.exports = InvoiceService;

