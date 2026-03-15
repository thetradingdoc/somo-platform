/**
 * EOB (Explanation of Benefits) Calculation Service
 *
 * This service calculates EOB amounts based on:
 * 1. Fee schedule (when available) - payer-specific allowed amounts
 * 2. Stedi eligibility data (deductible, copay, coinsurance)
 * 3. CPT code charges from the claim
 *
 * Amount Allowed: Fee schedule lookup first, else 85%/70% of billed (fallback)
 */

const FeeScheduleService = require('./fee-schedule-service');

class EOBCalculationService {
  /**
   * Calculate Amount Allowed for a CPT code
   * 
   * In production, this should:
   * 1. Look up fee schedule by CPT code and payer
   * 2. Check provider contract rates
   * 3. Or use allowed amount from 835 ERA if available
   * 
   * For now, we use a simplified calculation:
   * - In-network: 85% of billed amount (typical)
   * - Out-of-network: 70% of billed amount (typical)
   * 
   * @param {number} billedAmount - Amount billed for the service
   * @param {boolean} inNetwork - Whether provider is in-network (default: true)
   * @returns {number} Allowed amount
   */
  static calculateAllowedAmount(billedAmount, inNetwork = true) {
    if (!billedAmount || billedAmount <= 0) {
      return 0;
    }

    // Typical allowed amounts based on network status
    // In production, this would come from fee schedule or contract
    const allowedPercentage = inNetwork ? 0.85 : 0.70;
    return Math.round(billedAmount * allowedPercentage * 100) / 100;
  }

  /**
   * Calculate EOB breakdown for a claim
   *
   * @param {Object} params - Calculation parameters
   * @param {Array} params.lineItems - Array of service line items with CPT codes and charges
   * @param {Object} params.eligibility - Stedi eligibility data
   * @param {string} params.payerId - Payer ID (for fee schedule lookup)
   * @param {string} params.dateOfService - YYYY-MM-DD (for fee schedule)
   * @returns {Object} EOB breakdown
   */
  static calculateEOB({ lineItems = [], eligibility = {}, payerId = null, dateOfService = null }) {
    // Extract eligibility data
    const deductibleTotal = parseFloat(eligibility.deductible_total || 0);
    const deductibleRemaining = parseFloat(eligibility.deductible_remaining || eligibility.deductible_total || 0);
    const copayAmount = parseFloat(eligibility.copay_amount || 0);
    const coinsurancePercent = parseFloat(eligibility.coinsurance_percent || 0);
    const oopMax = eligibility.oop_max != null ? parseFloat(eligibility.oop_max) : null;
    const oopMet = eligibility.oop_met != null ? parseFloat(eligibility.oop_met) : 0;

    // Initialize totals
    let totalBilled = 0;
    let totalAllowed = 0;
    let totalPlanPaid = 0;
    let totalCopay = 0;
    let totalDeductible = 0;
    let totalCoinsurance = 0;
    let totalNotCovered = 0;
    let totalBalanceBilling = 0;
    let runningDeductibleRemaining = deductibleRemaining;
    let copayApplied = false; // Track if copay has been applied to this claim
    let runningOopMet = oopMet; // Tiba spec: b_oop_met, cumulative patient OOP YTD

    // Process each line item
    const processedLineItems = lineItems.map((item, index) => {
      const billedAmount = parseFloat(item.charge || item.billed_amount || item.amount || item.price) || 0;
      const cptCode = item.code || item.cpt_code || '';
      let allowed;
      let inNetwork = true;
      if (item.allowed_amount != null) {
        allowed = parseFloat(item.allowed_amount);
        inNetwork = item.in_network !== false && item.inNetwork !== false;
      } else if (payerId && cptCode && cptCode !== 'N/A') {
        const resolved = FeeScheduleService.resolveAllowedAmountAndNetwork({
          payerId,
          cptCode,
          billedAmount,
          dateOfService: item.date_of_service || item.date || dateOfService,
          inNetwork: true
        });
        allowed = resolved.allowedAmount;
        inNetwork = resolved.inNetwork;
      } else {
        allowed = this.calculateAllowedAmount(billedAmount, true);
      }

      totalBilled += billedAmount;
      totalAllowed += allowed;

      // Calculate patient responsibility
      let copay = 0;
      let deductible = 0;
      let coinsurance = 0;
      let planPaid = 0;
      const excessBilled = Math.max(0, billedAmount - allowed);
      // Tiba spec: balance billing (1-n_i)*max(0, f_i - a_i) for out-of-network only
      // In-network: excess often written off; OON: patient pays excess as balance billing
      const balanceBilling = inNetwork ? 0 : excessBilled;
      totalBalanceBilling += balanceBilling;
      totalNotCovered += excessBilled; // Display: total gap between billed and allowed

      // Step 1: Apply deductible if applicable (from allowed amount)
      if (runningDeductibleRemaining > 0 && allowed > 0) {
        const deductibleApplied = Math.min(runningDeductibleRemaining, allowed);
        deductible += deductibleApplied;
        runningDeductibleRemaining -= deductibleApplied;
      }

      // Step 2: Apply copay (typically per visit/claim, not per service)
      if (copayAmount > 0 && !copayApplied && (allowed - deductible) > 0) {
        copay = Math.min(copayAmount, allowed - deductible);
        copayApplied = true;
      }

      // Step 3: Calculate coinsurance (patient pays percentage after deductible and copay)
      const amountAfterDeductibleAndCopay = Math.max(0, allowed - deductible - copay);
      if (amountAfterDeductibleAndCopay > 0 && coinsurancePercent > 0) {
        coinsurance = Math.round(amountAfterDeductibleAndCopay * (coinsurancePercent / 100) * 100) / 100;
      }

      // Step 4: Plan pays the remainder of allowed amount
      planPaid = Math.max(0, allowed - deductible - copay - coinsurance);
      if (allowed > 0 && allowed < billedAmount * 0.3) {
        planPaid = allowed;
      }

      // Patient responsibility for this line (before OOP cap)
      let linePatientOwe = deductible + copay + coinsurance + balanceBilling;

      // Step 6 (Tiba spec): OOP max cap - when b_oop_met + r^patient exceeds b_oop_max, cap patient
      if (oopMax != null && oopMax > 0) {
        const spaceRemaining = Math.max(0, oopMax - runningOopMet);
        if (linePatientOwe > spaceRemaining) {
          const excess = linePatientOwe - spaceRemaining;
          linePatientOwe = spaceRemaining;
          planPaid += excess; // Plan absorbs excess when patient hits OOP max
        }
        runningOopMet += linePatientOwe;
      }

      // Accumulate totals
      totalCopay += copay;
      totalDeductible += deductible;
      totalCoinsurance += coinsurance;
      totalPlanPaid += planPaid;

      return {
        dateOfService: item.date_of_service || item.date || '',
        typeOfService: item.description || item.code || '',
        cptCode: item.code || '',
        modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
        amountBilled: billedAmount,
        allowedAmount: allowed,
        inNetwork,
        planPaid: Math.max(0, planPaid),
        otherInsurancePaid: 0,
        copay: copay,
        coinsurance: coinsurance,
        deductible: deductible,
        amountNotCovered: excessBilled,
        balanceBilling,
        whatYouOwe: linePatientOwe
      };
    });

    // Calculate total patient responsibility (sum of line whatYouOwe, which respects OOP cap)
    const totalPatientOwe = processedLineItems.reduce((sum, li) => sum + (li.whatYouOwe || 0), 0);

    return {
      lineItems: processedLineItems,
      totals: {
        amountBilled: totalBilled,
        allowedAmount: totalAllowed,
        planPaid: totalPlanPaid,
        otherInsurancePaid: 0,
        copay: totalCopay,
        coinsurance: totalCoinsurance,
        deductible: totalDeductible,
        amountNotCovered: totalNotCovered,
        balanceBilling: totalBalanceBilling,
        whatYouOwe: totalPatientOwe
      },
      eligibility: {
        deductibleTotal,
        deductibleRemaining: runningDeductibleRemaining,
        copayAmount,
        coinsurancePercent,
        oopMax,
        oopMet: runningOopMet
      }
    };
  }

  /**
   * Calculate EOB from claim data
   * 
   * @param {Object} claim - Claim object from database
   * @param {Object} eligibility - Stedi eligibility data
   * @param {Object} claimDetails - Parsed claim response_data
   * @returns {Object} Complete EOB data
   */
  static calculateEOBFromClaim(claim, eligibility, claimDetails = {}) {
    // Extract line items from claim details
    const pricing = claimDetails.pricing || {};
    const coding = claimDetails.coding || {};
    
    // Build line items from pricing breakdown or claim data
    let lineItems = [];
    
    if (pricing.breakdown && Array.isArray(pricing.breakdown) && pricing.breakdown.length > 0) {
      // Use pricing breakdown if available (new format from PDF coding or generated from diagnosis codes)
      // PDF breakdown uses 'price'; claims may use charge/amount/billed_amount
      lineItems = pricing.breakdown.map((item) => ({
        code: item.code || item.cpt_code || '',
        description: item.description || item.name || '',
        charge: parseFloat(item.charge || item.amount || item.billed_amount || item.price) || 0,
        allowed_amount: item.allowed_amount || null,
        date_of_service: item.date_of_service || claim.submitted_at || new Date().toISOString().split('T')[0],
        modifiers: Array.isArray(item.modifiers) ? item.modifiers : []
      }));
    } else if (claim.service_code && claim.total_amount && claim.service_code !== 'N/A') {
      // Fallback: create line items from claim service codes (legacy format)
      const serviceCodes = claim.service_code.split(',').map(s => s.trim()).filter(s => s && s !== 'N/A');
      
      if (serviceCodes.length > 0) {
        // If multiple service codes, split the amount
        const amountPerService = serviceCodes.length > 0 
          ? claim.total_amount / serviceCodes.length 
          : claim.total_amount;
        
        lineItems = serviceCodes.map((code, index) => {
          // Try to get allowed amount from response_data if available
          let allowedAmount = null;
          if (claimDetails.allowed_amount) {
            allowedAmount = parseFloat(claimDetails.allowed_amount) / serviceCodes.length;
          }
          
          return {
            code: code,
            description: `CPT Code ${code}`,
            charge: amountPerService,
            allowed_amount: allowedAmount,
            date_of_service: claim.submitted_at ? new Date(claim.submitted_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            modifiers: []
          };
        });
      } else {
        // Single service - use total amount
        lineItems = [{
          code: claim.service_code || 'N/A',
          description: 'Medical Service',
          charge: claim.total_amount || 0,
          allowed_amount: claimDetails.allowed_amount ? parseFloat(claimDetails.allowed_amount) : null,
          date_of_service: claim.submitted_at ? new Date(claim.submitted_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          modifiers: []
        }];
      }
    }
    
    // If still no line items, try to generate from diagnosis codes
    if (lineItems.length === 0 && claim.diagnosis_code && claim.diagnosis_code !== 'N/A') {
      const DiagnosisCodeMapper = require('./diagnosis-code-mapper');
      const diagnosisCodes = claim.diagnosis_code.split(',').map(d => d.trim()).filter(d => d && d !== 'N/A');
      
      if (diagnosisCodes.length > 0) {
        console.log('📋 EOB: Generating service line items from diagnosis codes:', diagnosisCodes);
        const generatedLineItems = DiagnosisCodeMapper.generateServiceLineItemsFromDiagnoses(diagnosisCodes, {
          maxServicesPerDiagnosis: 2,
          dateOfService: claim.submitted_at ? new Date(claim.submitted_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
        });
        
        lineItems = generatedLineItems.map(item => ({
          code: item.code || item.cpt_code || '',
          description: item.description || item.name || '',
          charge: item.charge || item.amount || item.billed_amount || 0,
          allowed_amount: item.allowed_amount || null,
          date_of_service: item.date_of_service || (claim.submitted_at ? new Date(claim.submitted_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]),
          modifiers: Array.isArray(item.modifiers) ? item.modifiers : []
        }));
        
        console.log(`✅ EOB: Generated ${lineItems.length} service line items from diagnosis codes`);
      }
    }
    
    // Last resort: create single line item from total amount
    if (lineItems.length === 0 && claim.total_amount && claim.total_amount > 0) {
      lineItems = [{
        code: 'N/A',
        description: 'Medical Service',
        charge: claim.total_amount || 0,
        allowed_amount: claimDetails.allowed_amount ? parseFloat(claimDetails.allowed_amount) : null,
        date_of_service: claim.submitted_at ? new Date(claim.submitted_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        modifiers: []
      }];
    }

    // Calculate EOB (with fee schedule when payer available)
    const dateOfService = claim.submitted_at ? new Date(claim.submitted_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const eobCalculation = this.calculateEOB({
      lineItems,
      eligibility,
      payerId: claim.payer_id || null,
      dateOfService
    });

    return eobCalculation;
  }
}

module.exports = EOBCalculationService;

