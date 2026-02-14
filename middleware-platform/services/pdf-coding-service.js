/**
 * PDF Medical Coding Service
 * 
 * Extracts text from PDF, runs medical coding, and returns codes with pricing
 */

const pdfParse = require('pdf-parse');
const { runCodingPipeline } = require('./coding-orchestrator');
const { buildPerceptualState } = require('./perception-layer');
const db = require('../database');

// CPT Code Pricing fallback when no payer fee schedule (use FeeScheduleService when payerId available)
const CPT_PRICING_FALLBACK = {
  '90837': { description: 'Psychotherapy, 60 minutes', price: 150.00 },
  '90834': { description: 'Psychotherapy, 45 minutes', price: 120.00 },
  '90833': { description: 'Psychotherapy, 30 minutes', price: 90.00 },
  '90832': { description: 'Psychotherapy, 30 minutes', price: 90.00 },
  '99213': { description: 'Office visit, established patient, low complexity', price: 100.00 },
  '99214': { description: 'Office visit, established patient, moderate complexity', price: 150.00 },
  '99215': { description: 'Office visit, established patient, high complexity', price: 200.00 },
  '99203': { description: 'Office visit, new patient, low complexity', price: 150.00 },
  '99204': { description: 'Office visit, new patient, moderate complexity', price: 250.00 },
  '99205': { description: 'Office visit, new patient, high complexity', price: 350.00 },
  '76705': { description: 'Ultrasound, abdomen, real time with image documentation; limited', price: 175.00 },
  '76700': { description: 'Ultrasound, abdomen, complete', price: 225.00 }
};

class PDFCodingService {
  /**
   * Extract text from PDF buffer
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<string>} Extracted text
   */
  async extractTextFromPDF(pdfBuffer) {
    try {
      const data = await pdfParse(pdfBuffer);
      return data.text;
    } catch (error) {
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  /**
   * Get pricing for CPT codes. Uses FeeScheduleService when payerId provided; else fallback.
   * @param {Array} cptCodes - Array of CPT code objects (may include confidence)
   * @param {Object} options - { payerId, dateOfService }
   * @returns {Array} CPT codes with pricing and confidence
   */
  getCPTPricing(cptCodes, options = {}) {
    const codes = (cptCodes || []).map(c => (c.code || c).toString().trim()).filter(Boolean);
    let feeSchedulePricing = {};
    if (options.payerId) {
      try {
        const FeeScheduleService = require('./fee-schedule-service');
        feeSchedulePricing = FeeScheduleService.getAllowedAmountsForCodes(
          String(options.payerId).trim().toUpperCase(),
          codes,
          options.dateOfService || null
        );
      } catch (e) {
        console.warn('⚠️  PDF coding: FeeScheduleService lookup failed:', e.message);
      }
    }

    return cptCodes.map(cpt => {
      const code = cpt.code || cpt;
      const codeStr = String(code).trim();
      const fromSchedule = feeSchedulePricing[codeStr];
      const fallback = CPT_PRICING_FALLBACK[codeStr] || { description: cpt.description || 'Unknown', price: 0 };
      const price = fromSchedule != null ? fromSchedule : fallback.price;
      const description = fallback.description || cpt.description || 'Unknown';

      const out = {
        code: codeStr,
        description,
        price,
        modifier: cpt.modifier || null,
        confidence: typeof cpt.confidence === 'number' ? cpt.confidence : 0.8,
        quantity: typeof cpt.quantity === 'number' && cpt.quantity >= 1 ? cpt.quantity : 1,
        source: fromSchedule != null ? 'fee_schedule' : 'fallback'
      };
      if (cpt.allowed_amount != null) out.allowed_amount = cpt.allowed_amount;
      if (cpt.in_network !== undefined) out.in_network = cpt.in_network;
      if (Array.isArray(cpt.modifiers)) out.modifiers = cpt.modifiers;
      return out;
    });
  }

  /**
   * Calculate total charge
   * @param {Array} cptCodesWithPricing - CPT codes with pricing
   * @returns {number} Total charge
   */
  calculateTotalCharge(cptCodesWithPricing) {
    return cptCodesWithPricing.reduce((total, cpt) => total + (cpt.price || 0), 0);
  }

  /**
   * Process PDF and extract medical codes
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Coding results with pricing
   */
  async processPDF(pdfBuffer, options = {}) {
    try {
      // Step 1: Extract text from PDF
      console.log('📄 Extracting text from PDF...');
      const extractedText = await this.extractTextFromPDF(pdfBuffer);
      
      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('No text found in PDF');
      }

      // Step 1.5: Layer 1 perception - build perceptual state from text
      const callId = options.callId || `pdf_${Date.now()}`;
      let perceptualState = null;
      try {
        perceptualState = await buildPerceptualState({
          callId,
          clinicalText: extractedText,
          modality: 'text',
          clinicId: options.clinicId || null
        });
        console.log(`📋 Perceptual state: ${perceptualState.textual_findings?.length || 0} textual findings`);
      } catch (e) {
        console.warn('⚠️  Perception layer failed (continuing with raw text):', e.message);
      }

      // Step 2: Run medical coding pipeline (pass payerId for Tiba f^P_i, n_i)
      console.log('🔍 Running medical coding pipeline...');
      const codingResult = await runCodingPipeline(
        {
          clinicalNote: extractedText,
          appointmentType: options.appointmentType || 'Unknown',
          durationMinutes: options.durationMinutes || 60,
          patientContext: options.patientContext || {},
          perceptualState
        },
        { payerId: options.payerId, dateOfService: options.dateOfService }
      );

      // Step 3: Get CPT pricing (FeeScheduleService when payerId in options)
      const cptCodesWithPricing = this.getCPTPricing(codingResult.cpt || [], {
        payerId: options.payerId,
        dateOfService: options.dateOfService
      });
      
      // Step 4: Calculate total charge
      const totalCharge = this.calculateTotalCharge(cptCodesWithPricing);

      // Step 5: Extract text positions for overlay (simplified - returns line numbers)
      const textLines = extractedText.split('\n').map((line, index) => ({
        line: index + 1,
        text: line.trim(),
        matches: this.findCodeMatches(line, codingResult)
      })).filter(item => item.text.length > 0);

      return {
        success: true,
        extractedText: extractedText,
        perceptualState: perceptualState || undefined,
        textLines: textLines,
        coding: {
          band: codingResult.band, // SIMPLE, MODERATE, COMPLEX
          icd10: codingResult.icd10 || [],
          cpt: cptCodesWithPricing,
          rationale: codingResult.rationale || '',
          evidenceTrace: codingResult.evidenceTrace,
          codingConfidence: codingResult.codingConfidence ?? 0.8
        },
        pricing: {
          totalCharge: totalCharge,
          breakdown: cptCodesWithPricing.map(cpt => ({
            code: cpt.code,
            description: cpt.description,
            price: cpt.price,
            modifier: cpt.modifier,
            confidence: cpt.confidence,
            quantity: cpt.quantity ?? 1,
            allowed_amount: cpt.allowed_amount,
            in_network: cpt.in_network,
            modifiers: cpt.modifiers ?? []
          })),
          codingConfidence: codingResult.codingConfidence ?? 0.8
        }
      };
    } catch (error) {
      console.error('Error processing PDF:', error);
      throw error;
    }
  }

  /**
   * Find code matches in text line (for highlighting)
   * @param {string} line - Text line
   * @param {Object} codingResult - Coding result
   * @returns {Array} Matches found in line
   */
  findCodeMatches(line, codingResult) {
    const matches = [];
    const lineLower = line.toLowerCase();

    // Check for ICD-10 codes
    if (codingResult.icd10) {
      codingResult.icd10.forEach(icd => {
        const code = icd.code || icd;
        if (lineLower.includes(code.toLowerCase()) || 
            (icd.description && lineLower.includes(icd.description.toLowerCase()))) {
          matches.push({ type: 'icd10', code: code, description: icd.description });
        }
      });
    }

    // Check for CPT codes
    if (codingResult.cpt) {
      codingResult.cpt.forEach(cpt => {
        const code = cpt.code || cpt;
        if (line.includes(code) || 
            (cpt.description && lineLower.includes(cpt.description.toLowerCase()))) {
          matches.push({ type: 'cpt', code: code, description: cpt.description });
        }
      });
    }

    return matches;
  }
}

module.exports = new PDFCodingService();

