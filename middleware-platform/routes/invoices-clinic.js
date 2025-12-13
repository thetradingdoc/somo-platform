/**
 * CLINIC INVOICE ROUTES
 * Patient billing invoices for clinics
 * Flow: PDF Upload → Claim → Invoice → Send → Payment
 */

const express = require('express');
const db = require('../database');
const InvoiceService = require('../services/invoice-service');
const PDFInvoiceService = require('../services/pdf-invoice-service');
const EmailService = require('../services/email-service');
const rateLimiter = require('../middleware/rate-limiter').authLimiter;

const router = express.Router();

/**
 * POST /api/invoices/create-from-claim
 * Generate invoice from claim (calculates patient responsibility from EOB)
 */
router.post('/create-from-claim', rateLimiter, async (req, res) => {
  try {
    const { claim_id, due_date, notes, allow_multiple } = req.body;

    if (!claim_id) {
      return res.status(400).json({
        success: false,
        error: 'claim_id is required'
      });
    }

    const result = await InvoiceService.createInvoiceFromClaim(claim_id, {
      due_date,
      notes,
      allowMultiple: allow_multiple || false
    });

    res.json({
      success: true,
      invoice: result.invoice,
      items: result.items,
      message: 'Invoice created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating invoice from claim:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create invoice'
    });
  }
});

/**
 * GET /api/invoices
 * List all invoices with filters
 */
router.get('/', rateLimiter, async (req, res) => {
  try {
    const { status, patient_id, claim_id, start_date, end_date, limit } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (patient_id) filters.patient_id = patient_id;
    if (claim_id) filters.claim_id = claim_id;
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;
    if (limit) filters.limit = parseInt(limit) || 50;

    const invoices = db.getInvoices(filters);

    // Enrich with patient info and totals
    const enrichedInvoices = invoices.map(invoice => {
      const patient = db.getFHIRPatient(invoice.patient_id);
      const totalPaid = db.getInvoicePaymentsTotal(invoice.id);
      const balance = invoice.amount - totalPaid;

      let patientName = 'Unknown Patient';
      let patientEmail = null;
      if (patient) {
        const patientData = typeof patient.resource_data === 'string'
          ? JSON.parse(patient.resource_data)
          : patient.resource_data;
        const name = patientData.name?.[0];
        if (name) {
          patientName = `${(name.given || []).join(' ')} ${name.family || ''}`.trim();
        }
        const telecom = patientData.telecom || [];
        const emailTelecom = telecom.find(t => t.system === 'email');
        patientEmail = emailTelecom?.value || null;
      }

      return {
        ...invoice,
        patient_name: patientName,
        patient_email: patientEmail,
        total_paid: totalPaid,
        balance: balance,
        is_overdue: InvoiceService.isInvoiceOverdue(invoice)
      };
    });

    res.json({
      success: true,
      invoices: enrichedInvoices,
      count: enrichedInvoices.length
    });
  } catch (error) {
    console.error('❌ Error fetching invoices:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch invoices'
    });
  }
});

/**
 * GET /api/invoices/:id
 * Get invoice details with items and payments
 */
router.get('/:id', rateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const summary = InvoiceService.getInvoiceSummary(id);

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }

    // Get patient info
    const patient = db.getFHIRPatient(summary.invoice.patient_id);
    let patientData = null;
    if (patient) {
      patientData = typeof patient.resource_data === 'string'
        ? JSON.parse(patient.resource_data)
        : patient.resource_data;
    }

    res.json({
      success: true,
      invoice: summary.invoice,
      items: summary.items,
      payments: summary.payments,
      totals: summary.totals,
      patient: patientData
    });
  } catch (error) {
    console.error('❌ Error fetching invoice:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch invoice'
    });
  }
});

/**
 * PUT /api/invoices/:id
 * Update invoice (status, due date, notes)
 */
router.put('/:id', rateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, due_date, notes } = req.body;

    const invoice = db.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (due_date !== undefined) updates.due_date = due_date;
    if (notes !== undefined) updates.notes = notes;

    db.updateInvoice(id, updates);
    const updatedInvoice = db.getInvoice(id);

    res.json({
      success: true,
      invoice: updatedInvoice,
      message: 'Invoice updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating invoice:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update invoice'
    });
  }
});

/**
 * POST /api/invoices/:id/send
 * Send invoice email to patient
 */
router.post('/:id/send', rateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const summary = InvoiceService.getInvoiceSummary(id);

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }

    // Get patient info
    const patient = db.getFHIRPatient(summary.invoice.patient_id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    const patientData = typeof patient.resource_data === 'string'
      ? JSON.parse(patient.resource_data)
      : patient.resource_data;

    // Get patient email
    const telecom = patientData.telecom || [];
    const emailTelecom = telecom.find(t => t.system === 'email');
    const patientEmail = emailTelecom?.value;

    if (!patientEmail) {
      return res.status(400).json({
        success: false,
        error: 'Patient email not found. Cannot send invoice.'
      });
    }

    // Generate email template
    const emailTemplate = InvoiceService.generateEmailTemplate(
      summary.invoice,
      patientData,
      summary.items
    );

    // Generate PDF invoice
    let pdfBuffer = null;
    try {
      pdfBuffer = await PDFInvoiceService.generatePDF(
        summary.invoice,
        summary.items,
        patientData,
        summary.totals
      );
    } catch (pdfError) {
      console.warn('⚠️  PDF generation failed (email will be sent without attachment):', pdfError.message);
      // Continue without PDF - email will still be sent
    }

    // Prepare email with optional PDF attachment
    const emailOptions = {
      to: patientEmail,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text
    };

    // Add PDF attachment if available
    if (pdfBuffer) {
      emailOptions.attachments = [{
        filename: `invoice-${invoice.invoice_number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }];
    }

    // Send email
    try {
      await EmailService.sendEmail(emailOptions);

      // Update invoice status
      db.updateInvoice(id, {
        status: 'sent',
        sent_at: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Invoice sent successfully',
        invoice: db.getInvoice(id)
      });
    } catch (emailError) {
      console.error('❌ Error sending invoice email:', emailError);
      res.status(500).json({
        success: false,
        error: 'Failed to send invoice email: ' + emailError.message
      });
    }
  } catch (error) {
    console.error('❌ Error sending invoice:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send invoice'
    });
  }
});

/**
 * POST /api/invoices/:id/payments
 * Record payment against invoice
 */
router.post('/:id/payments', rateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_date, amount, payment_method, reference_number, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Payment amount is required and must be greater than 0'
      });
    }

    const invoice = db.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }

    // Check if payment exceeds balance
    const totalPaid = db.getInvoicePaymentsTotal(id);
    const balance = invoice.amount - totalPaid;

    if (amount > balance) {
      return res.status(400).json({
        success: false,
        error: `Payment amount ($${amount}) exceeds invoice balance ($${balance.toFixed(2)})`
      });
    }

    // Record payment
    const payment = {
      invoice_id: id,
      payment_date: payment_date || new Date().toISOString().split('T')[0],
      amount: parseFloat(amount),
      payment_method: payment_method || null,
      reference_number: reference_number || null,
      notes: notes || null
    };

    db.addInvoicePayment(payment);

    // Get updated invoice summary
    const summary = InvoiceService.getInvoiceSummary(id);

    res.json({
      success: true,
      payment: db.getInvoicePayments(id).slice(-1)[0], // Get last payment
      invoice: summary.invoice,
      totals: summary.totals,
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    console.error('❌ Error recording payment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to record payment'
    });
  }
});

/**
 * GET /api/invoices/:id/payments
 * Get payment history for an invoice
 */
router.get('/:id/payments', rateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = db.getInvoice(id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }

    const payments = db.getInvoicePayments(id);
    const totalPaid = db.getInvoicePaymentsTotal(id);

    res.json({
      success: true,
      payments: payments,
      total_paid: totalPaid,
      balance: invoice.amount - totalPaid
    });
  } catch (error) {
    console.error('❌ Error fetching payments:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch payments'
    });
  }
});

module.exports = router;

