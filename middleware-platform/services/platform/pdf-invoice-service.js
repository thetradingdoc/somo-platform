/**
 * PDF INVOICE SERVICE
 * Generates PDF invoices for email attachments
 * Uses PDFKit for PDF generation
 */

const fs = require('fs');
const path = require('path');

class PDFInvoiceService {
  /**
   * Generate PDF invoice
   * @param {Object} invoice - Invoice data
   * @param {Array} items - Invoice line items
   * @param {Object} patient - Patient data
   * @param {Object} totals - Payment totals
   * @returns {Buffer} PDF buffer
   */
  static async generatePDF(invoice, items, patient, totals) {
    try {
      // Check if PDFKit is available
      let PDFDocument;
      try {
        PDFDocument = require('pdfkit');
      } catch (error) {
        console.warn('⚠️  PDFKit not installed. Install with: npm install pdfkit');
        // Return null - email will be sent without PDF attachment
        return null;
      }

      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {});

      // Header
      doc.fontSize(24)
         .text('INVOICE', { align: 'center' })
         .moveDown(0.5);

      doc.fontSize(12)
         .text(`Invoice Number: ${invoice.invoice_number}`, { align: 'center' })
         .text(`Date: ${new Date(invoice.created_at).toLocaleDateString()}`, { align: 'center' })
         .moveDown(1);

      // Patient Information
      let patientName = 'Unknown Patient';
      let patientAddress = '';
      if (patient) {
        const name = patient.name?.[0];
        if (name) {
          patientName = `${(name.given || []).join(' ')} ${name.family || ''}`.trim();
        }
        const address = patient.address?.[0];
        if (address) {
          const addrParts = [
            address.line?.[0],
            address.city,
            address.state,
            address.postalCode
          ].filter(Boolean);
          patientAddress = addrParts.join(', ');
        }
      }

      doc.fontSize(14)
         .text('Bill To:', { underline: true })
         .fontSize(12)
         .text(patientName);
      
      if (patientAddress) {
        doc.text(patientAddress);
      }

      doc.moveDown(1);

      // Invoice Details
      doc.fontSize(12)
         .text(`Due Date: ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'N/A'}`)
         .text(`Status: ${invoice.status.toUpperCase()}`)
         .moveDown(1);

      // Line Items Table
      if (items && items.length > 0) {
        doc.fontSize(14)
           .text('Services', { underline: true })
           .moveDown(0.5);

        // Table header
        const tableTop = doc.y;
        doc.fontSize(10)
           .text('Date', 50, tableTop)
           .text('Description', 120, tableTop)
           .text('CPT', 300, tableTop)
           .text('ICD', 350, tableTop)
           .text('Amount', 450, tableTop, { align: 'right' });

        let y = tableTop + 20;
        items.forEach(item => {
          const serviceDate = item.service_date 
            ? new Date(item.service_date).toLocaleDateString() 
            : '—';
          
          doc.fontSize(9)
             .text(serviceDate, 50, y)
             .text(item.description || 'Service', 120, y, { width: 170 })
             .text(item.cpt_code || '—', 300, y)
             .text(item.icd_code || '—', 350, y)
             .text(`$${item.total_price.toFixed(2)}`, 450, y, { align: 'right' });
          
          y += 20;
        });

        // Total line
        doc.moveTo(50, y)
           .lineTo(550, y)
           .stroke();
        
        y += 10;
        doc.fontSize(12)
           .font('Helvetica-Bold')
           .text('Total:', 350, y)
           .text(`$${invoice.amount.toFixed(2)}`, 450, y, { align: 'right' });
      }

      doc.moveDown(2);

      // Payment Summary
      doc.fontSize(14)
         .text('Payment Summary', { underline: true })
         .moveDown(0.5);

      doc.fontSize(12)
         .text(`Total Amount: $${invoice.amount.toFixed(2)}`)
         .text(`Total Paid: $${totals.paid.toFixed(2)}`)
         .text(`Balance Due: $${totals.balance.toFixed(2)}`, { 
           color: totals.balance > 0 ? 'red' : 'green' 
         });

      // Footer
      doc.fontSize(10)
         .text('Thank you for your business!', { align: 'center' })
         .text('Please remit payment by the due date to avoid late fees.', { align: 'center' });

      doc.end();

      // Wait for PDF to be generated
      return new Promise((resolve, reject) => {
        doc.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
        doc.on('error', reject);
      });
    } catch (error) {
      console.error('❌ Error generating PDF invoice:', error);
      // Return null if PDF generation fails - email will still be sent
      return null;
    }
  }

  /**
   * Generate PDF and save to file (for download)
   * @param {Object} invoice - Invoice data
   * @param {Array} items - Invoice line items
   * @param {Object} patient - Patient data
   * @param {Object} totals - Payment totals
   * @param {String} filePath - Path to save PDF
   * @returns {Promise<String>} File path
   */
  static async generateAndSavePDF(invoice, items, patient, totals, filePath) {
    try {
      const pdfBuffer = await this.generatePDF(invoice, items, patient, totals);
      
      if (!pdfBuffer) {
        throw new Error('PDF generation failed - PDFKit may not be installed');
      }

      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write PDF to file
      fs.writeFileSync(filePath, pdfBuffer);
      
      return filePath;
    } catch (error) {
      console.error('❌ Error saving PDF invoice:', error);
      throw error;
    }
  }
}

module.exports = PDFInvoiceService;

