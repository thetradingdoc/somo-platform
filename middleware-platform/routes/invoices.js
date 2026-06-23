/**
 * INVOICE ROUTES
 * Admin portal: Generate, approve, and send monthly invoices
 * User portal: View invoices and credits tracking
 */

const express = require('express');
const db = require('../database');
const EmailService = require('../services/platform/email-service');
const rateLimiter = require('../middleware/rate-limiter').authLimiter;
const { requireAdminAuth } = require('../middleware/admin-auth');

const router = express.Router();

/**
 * ADMIN ROUTES - Invoice Management
 */

/**
 * GET /api/admin/invoices
 * Get all invoices (with filters)
 */
router.get('/admin/invoices', requireAdminAuth, rateLimiter, async (req, res) => {
  try {
    const { status, billing_month, customer_id, limit } = req.query;
    
    const filters = {};
    if (status) filters.status = status;
    if (billing_month) filters.billing_month = billing_month;
    if (customer_id) filters.customer_id = customer_id;
    if (limit) filters.limit = parseInt(limit) || 50;
    
    const invoices = db.getAllInvoices(filters);
    
    // Get customer info for each invoice
    const invoicesWithCustomer = invoices.map(invoice => {
      const customer = db.getCustomer(invoice.customer_id);
      return {
        ...invoice,
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          company_name: customer.company_name
        } : null
      };
    });
    
    res.json({
      success: true,
      invoices: invoicesWithCustomer,
      total: invoicesWithCustomer.length
    });
  } catch (error) {
    console.error('❌ Get invoices error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get invoices',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/invoices/:id
 * Get invoice details
 */
router.get('/admin/invoices/:id', requireAdminAuth, rateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = db.getMonthlyInvoice(id);
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }
    
    const customer = db.getCustomer(invoice.customer_id);
    const usage = db.getMonthlyUsage(invoice.customer_id, invoice.billing_month);
    
    res.json({
      success: true,
      invoice: {
        ...invoice,
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          company_name: customer.company_name
        } : null,
        usage: usage || null
      }
    });
  } catch (error) {
    console.error('❌ Get invoice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get invoice',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/invoices/generate
 * Generate monthly invoices for a billing month
 */
router.post('/admin/invoices/generate', requireAdminAuth, rateLimiter, async (req, res) => {
  try {
    const { billing_month, options = {} } = req.body;
    
    if (!billing_month) {
      return res.status(400).json({
        success: false,
        error: 'Billing month is required (format: YYYY-MM)'
      });
    }
    
    // Get all customers with usage for this month
    const allCustomers = db.db.prepare('SELECT id FROM customers WHERE email_verified = 1').all();
    const generatedInvoices = [];
    
    for (const customerRow of allCustomers) {
      const customerId = customerRow.id;
      const usage = db.getMonthlyUsage(customerId, billing_month);
      
      // Only generate invoice if there's overage (usage beyond credits)
      if (usage && (usage.overage_voice_minutes > 0 || usage.overage_api_requests > 0)) {
        // Check if invoice already exists
        const existingInvoice = db.db.prepare(`
          SELECT * FROM monthly_invoices 
          WHERE customer_id = ? AND billing_month = ?
        `).get(customerId, billing_month);
        
        if (!existingInvoice) {
          // Generate invoice
          const invoiceResult = db.createMonthlyInvoice(customerId, billing_month, usage, options);
          const invoiceId = invoiceResult.lastInsertRowid || invoiceResult.id;
          const invoice = db.getMonthlyInvoice(invoiceId);
          
          if (invoice) {
            generatedInvoices.push(invoice);
          }
        }
      }
    }
    
    res.json({
      success: true,
      message: `Generated ${generatedInvoices.length} invoice(s) for ${billing_month}`,
      invoices: generatedInvoices,
      count: generatedInvoices.length
    });
  } catch (error) {
    console.error('❌ Generate invoices error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate invoices',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/invoices/:id/approve
 * Approve invoice (admin review before sending)
 */
router.post('/admin/invoices/:id/approve', requireAdminAuth, rateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const adminUserId = req.user?.id || 'admin';
    
    const invoice = db.getMonthlyInvoice(id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }
    
    if (invoice.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Invoice is already ${invoice.status}`
      });
    }
    
    db.approveInvoice(id, adminUserId);
    
    const updatedInvoice = db.getMonthlyInvoice(id);
    
    res.json({
      success: true,
      message: 'Invoice approved successfully',
      invoice: updatedInvoice
    });
  } catch (error) {
    console.error('❌ Approve invoice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve invoice',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/invoices/:id/send
 * Send invoice to customer email (must be approved first)
 */
router.post('/admin/invoices/:id/send', requireAdminAuth, rateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    
    const invoice = db.getMonthlyInvoice(id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }
    
    if (invoice.status !== 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Invoice must be approved before sending'
      });
    }
    
    const customer = db.getCustomer(invoice.customer_id);
    if (!customer || !customer.email) {
      return res.status(400).json({
        success: false,
        error: 'Customer email not found'
      });
    }
    
    // Send invoice email
    try {
      await EmailService.sendInvoiceEmail(customer.email, customer.name || 'Customer', invoice);
    } catch (emailError) {
      console.error('❌ Failed to send invoice email:', emailError);
      return res.status(500).json({
        success: false,
        error: 'Failed to send invoice email',
        message: emailError.message
      });
    }
    
    // Update invoice status
    db.sendInvoice(id);
    
    const updatedInvoice = db.getMonthlyInvoice(id);
    
    res.json({
      success: true,
      message: 'Invoice sent successfully',
      invoice: updatedInvoice
    });
  } catch (error) {
    console.error('❌ Send invoice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send invoice',
      message: error.message
    });
  }
});

/**
 * USER ROUTES - Invoice Viewing and Credits Tracking
 */

/**
 * GET /api/customers/me/invoices
 * Get customer's invoices
 */
router.get('/api/customers/me/invoices', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing invoices. Please visit /terms to accept.'
      });
    }
    
    const invoices = db.getCustomerInvoices(session.customer_id);
    
    res.json({
      success: true,
      invoices: invoices.map(invoice => ({
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        billing_month: invoice.billing_month,
        voice_minutes: invoice.voice_minutes,
        api_requests: invoice.api_requests,
        voice_minutes_cost: invoice.voice_minutes_cost,
        api_requests_cost: invoice.api_requests_cost,
        subtotal: invoice.subtotal,
        total: invoice.total,
        status: invoice.status,
        due_date: invoice.due_date,
        paid_at: invoice.paid_at,
        created_at: invoice.created_at
      }))
    });
  } catch (error) {
    console.error('❌ Get customer invoices error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get invoices',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/me/invoices/:id
 * Get customer's invoice details
 */
router.get('/api/customers/me/invoices/:id', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing invoice details. Please visit /terms to accept.'
      });
    }
    
    const { id } = req.params;
    const invoice = db.getMonthlyInvoice(id);
    
    if (!invoice || invoice.customer_id !== session.customer_id) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }
    
    // Get usage for this billing month
    const usage = db.getMonthlyUsage(session.customer_id, invoice.billing_month);
    
    res.json({
      success: true,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        billing_month: invoice.billing_month,
        voice_minutes: invoice.voice_minutes,
        api_requests: invoice.api_requests,
        voice_minutes_cost: invoice.voice_minutes_cost,
        api_requests_cost: invoice.api_requests_cost,
        subtotal: invoice.subtotal,
        total: invoice.total,
        status: invoice.status,
        due_date: invoice.due_date,
        paid_at: invoice.paid_at,
        created_at: invoice.created_at,
        sent_at: invoice.sent_at
      },
      usage: usage || null
    });
  } catch (error) {
    console.error('❌ Get customer invoice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get invoice',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/me/credits-and-billing
 * Get customer's credits balance and billing summary
 */
router.get('/api/customers/me/credits-and-billing', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing credits and billing. Please visit /terms to accept.'
      });
    }
    
    const customerId = session.customer_id;
    const credits = db.getCustomerCredits(customerId);
    const invoices = db.getCustomerInvoices(customerId);
    const monthlyUsage = db.getAllMonthlyUsage(customerId);
    
    // Get current month usage
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentUsage = db.getMonthlyUsage(customerId, currentMonth);
    
    res.json({
      success: true,
      credits: {
        balance: credits ? credits.credits_balance_minutes : 0,
        free: {
          allocated: credits ? credits.free_credits_allocated : 0,
          used: credits ? credits.free_credits_used : 0,
          remaining: credits ? (credits.free_credits_allocated - credits.free_credits_used) : 0
        },
        paid: {
          purchased: credits ? credits.paid_credits_purchased : 0,
          used: credits ? credits.paid_credits_used : 0,
          remaining: credits ? (credits.paid_credits_purchased - credits.paid_credits_used) : 0
        }
      },
      current_month_usage: currentUsage || null,
      invoices: invoices.slice(0, 10), // Last 10 invoices
      monthly_usage_history: monthlyUsage.slice(0, 12) // Last 12 months
    });
  } catch (error) {
    console.error('❌ Get credits and billing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get credits and billing',
      message: error.message
    });
  }
});

module.exports = router;

