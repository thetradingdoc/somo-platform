/**
 * Diagnosis Code to CPT Code Mapper
 * 
 * Maps ICD-10 diagnosis codes to typical CPT service codes with realistic pricing
 * This generates dummy data for claims when only diagnosis codes are available
 */

class DiagnosisCodeMapper {
  /**
   * Map of ICD-10 codes to typical CPT codes and descriptions
   * Based on common medical practices and treatment patterns
   */
  static DIAGNOSIS_TO_CPT_MAP = {
    // ACL Tear - S83.541
    'S83.541': [
      {
        cptCode: '99213',
        description: 'Office visit - Established patient (knee evaluation)',
        typicalCharge: 250.00,
        serviceType: 'Evaluation and Management'
      },
      {
        cptCode: '73721',
        description: 'MRI - Knee without contrast',
        typicalCharge: 1200.00,
        serviceType: 'Diagnostic Imaging'
      },
      {
        cptCode: '97110',
        description: 'Therapeutic exercise (physical therapy)',
        typicalCharge: 85.00,
        serviceType: 'Physical Therapy'
      },
      {
        cptCode: '97112',
        description: 'Neuromuscular reeducation',
        typicalCharge: 95.00,
        serviceType: 'Physical Therapy'
      }
    ],
    
    // Patellar Tendinitis - M76.51
    'M76.51': [
      {
        cptCode: '99213',
        description: 'Office visit - Established patient (knee evaluation)',
        typicalCharge: 250.00,
        serviceType: 'Evaluation and Management'
      },
      {
        cptCode: '20610',
        description: 'Injection - Knee joint (corticosteroid)',
        typicalCharge: 350.00,
        serviceType: 'Therapeutic Injection'
      },
      {
        cptCode: '97110',
        description: 'Therapeutic exercise (physical therapy)',
        typicalCharge: 85.00,
        serviceType: 'Physical Therapy'
      },
      {
        cptCode: '97140',
        description: 'Manual therapy techniques',
        typicalCharge: 90.00,
        serviceType: 'Physical Therapy'
      }
    ]
  };

  /**
   * Category-based ICD-10 → CPT mapping (first 3 chars).
   * Used when no exact code match exists.
   */
  static CATEGORY_TO_CPT_MAP = {
    E11: [
      { cptCode: '99213', description: 'Office visit - Type 2 diabetes management', typicalCharge: 150, serviceType: 'E&M' },
      { cptCode: '99214', description: 'Office visit - Moderate complexity', typicalCharge: 200, serviceType: 'E&M' },
      { cptCode: '83036', description: 'Hemoglobin A1c', typicalCharge: 45, serviceType: 'Lab' }
    ],
    I10: [
      { cptCode: '99213', description: 'Office visit - Hypertension management', typicalCharge: 150, serviceType: 'E&M' },
      { cptCode: '99214', description: 'Office visit - Moderate complexity', typicalCharge: 200, serviceType: 'E&M' },
      { cptCode: '93000', description: 'ECG', typicalCharge: 75, serviceType: 'Diagnostic' }
    ],
    J45: [
      { cptCode: '99213', description: 'Office visit - Asthma management', typicalCharge: 150, serviceType: 'E&M' },
      { cptCode: '94060', description: 'Spirometry', typicalCharge: 95, serviceType: 'Diagnostic' }
    ],
    M25: [
      { cptCode: '99213', description: 'Office visit - Joint pain evaluation', typicalCharge: 150, serviceType: 'E&M' },
      { cptCode: '73721', description: 'MRI knee', typicalCharge: 1200, serviceType: 'Imaging' }
    ],
    M54: [
      { cptCode: '99213', description: 'Office visit - Back pain evaluation', typicalCharge: 150, serviceType: 'E&M' },
      { cptCode: '97110', description: 'Therapeutic exercise', typicalCharge: 85, serviceType: 'PT' }
    ],
    Z00: [
      { cptCode: '99381', description: 'Preventive visit - New patient', typicalCharge: 250, serviceType: 'Preventive' },
      { cptCode: '99382', description: 'Preventive visit - Established', typicalCharge: 200, serviceType: 'Preventive' },
      { cptCode: '99385', description: 'Adult preventive visit', typicalCharge: 220, serviceType: 'Preventive' }
    ],
    F41: [
      { cptCode: '99213', description: 'Office visit - Anxiety management', typicalCharge: 150, serviceType: 'E&M' },
      { cptCode: '90834', description: 'Psychotherapy 45 min', typicalCharge: 150, serviceType: 'Therapy' }
    ],
    F32: [
      { cptCode: '99213', description: 'Office visit - Depression management', typicalCharge: 150, serviceType: 'E&M' },
      { cptCode: '90837', description: 'Psychotherapy 60 min', typicalCharge: 180, serviceType: 'Therapy' }
    ],
    R50: [
      { cptCode: '99213', description: 'Office visit - Fever evaluation', typicalCharge: 150, serviceType: 'E&M' },
      { cptCode: '36415', description: 'Venipuncture', typicalCharge: 25, serviceType: 'Lab' }
    ]
  };

  /**
   * Get CPT codes for a diagnosis code (exact or category match)
   * @param {string} diagnosisCode - ICD-10 diagnosis code (e.g., 'S83.541', 'E11.9')
   * @returns {Array} Array of CPT code objects
   */
  static getCPTCodesForDiagnosis(diagnosisCode) {
    const code = diagnosisCode.trim().toUpperCase().replace(/\./g, '');
    const exact = this.DIAGNOSIS_TO_CPT_MAP[diagnosisCode.trim()] || this.DIAGNOSIS_TO_CPT_MAP[code];
    if (exact && exact.length > 0) return exact;
    return this.getCPTCodesForDiagnosisCategory(code) || [];
  }

  /**
   * Get CPT codes by ICD-10 category (first 3 chars)
   * @param {string} icd10Code - ICD-10 code (e.g., 'E11.9' → E11)
   * @returns {Array} Array of CPT code objects
   */
  static getCPTCodesForDiagnosisCategory(icd10Code) {
    const code = (icd10Code || '').trim().toUpperCase().replace(/\./g, '').slice(0, 3);
    return this.CATEGORY_TO_CPT_MAP[code] || [];
  }

  /**
   * Generate service line items from diagnosis codes
   * @param {Array} diagnosisCodes - Array of diagnosis code objects or strings
   * @param {Object} options - Options for generation
   * @param {number} options.maxServicesPerDiagnosis - Max services per diagnosis (default: 2)
   * @param {string} options.dateOfService - Date of service (default: today)
   * @returns {Array} Array of service line items
   */
  static generateServiceLineItemsFromDiagnoses(diagnosisCodes, options = {}) {
    const {
      maxServicesPerDiagnosis = 2,
      dateOfService = new Date().toISOString().split('T')[0]
    } = options;

    const lineItems = [];
    const processedCPTs = new Set(); // Avoid duplicates

    // Process each diagnosis code
    diagnosisCodes.forEach((diagCodeObj) => {
      const diagnosisCode = typeof diagCodeObj === 'string' 
        ? diagCodeObj 
        : diagCodeObj.code || diagCodeObj;

      if (!diagnosisCode) return;

      const cptCodes = this.getCPTCodesForDiagnosis(diagnosisCode);
      
      // Select up to maxServicesPerDiagnosis services
      const selectedCPTs = cptCodes.slice(0, maxServicesPerDiagnosis);
      
      selectedCPTs.forEach((cpt) => {
        // Skip if we've already added this CPT code
        if (processedCPTs.has(cpt.cptCode)) return;
        processedCPTs.add(cpt.cptCode);

        lineItems.push({
          code: cpt.cptCode,
          cpt_code: cpt.cptCode,
          description: cpt.description,
          name: cpt.description,
          charge: cpt.typicalCharge,
          amount: cpt.typicalCharge,
          billed_amount: cpt.typicalCharge,
          service_type: cpt.serviceType,
          diagnosis_code: diagnosisCode,
          date_of_service: dateOfService
        });
      });
    });

    // Fallback: try category-based mapping for each diagnosis
    if (lineItems.length === 0 && diagnosisCodes.length > 0) {
      diagnosisCodes.forEach((diagCodeObj) => {
        const diagnosisCode = typeof diagCodeObj === 'string' ? diagCodeObj : diagCodeObj.code || diagCodeObj;
        if (!diagnosisCode) return;
        const catCpts = this.getCPTCodesForDiagnosisCategory(diagnosisCode);
        catCpts.slice(0, 2).forEach((cpt) => {
          if (processedCPTs.has(cpt.cptCode)) return;
          processedCPTs.add(cpt.cptCode);
          lineItems.push({
            code: cpt.cptCode,
            cpt_code: cpt.cptCode,
            description: cpt.description,
            name: cpt.description,
            charge: cpt.typicalCharge,
            amount: cpt.typicalCharge,
            billed_amount: cpt.typicalCharge,
            service_type: cpt.serviceType,
            diagnosis_code: diagnosisCode,
            date_of_service: dateOfService
          });
        });
      });
    }

    // If still no line items, create default office visit
    if (lineItems.length === 0 && diagnosisCodes.length > 0) {
      const firstDiagnosis = typeof diagnosisCodes[0] === 'string' 
        ? diagnosisCodes[0] 
        : diagnosisCodes[0].code || diagnosisCodes[0];

      lineItems.push({
        code: '99213',
        cpt_code: '99213',
        description: 'Office visit - Established patient',
        name: 'Office visit - Established patient',
        charge: 250.00,
        amount: 250.00,
        billed_amount: 250.00,
        service_type: 'Evaluation and Management',
        diagnosis_code: firstDiagnosis,
        date_of_service: dateOfService
      });
    }

    return lineItems;
  }

  /**
   * Get diagnosis code description
   * @param {string} diagnosisCode - ICD-10 diagnosis code
   * @returns {string} Description of the diagnosis
   */
  static getDiagnosisDescription(diagnosisCode) {
    const descriptions = {
      'S83.541': 'Partial tear of anterior cruciate ligament of left knee',
      'M76.51': 'Patellar tendinitis, left knee'
    };

    return descriptions[diagnosisCode] || diagnosisCode;
  }
}

module.exports = DiagnosisCodeMapper;

