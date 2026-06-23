/**
 * FHIR Service - Somo Telehealth Platform
 *
 * Business logic layer for FHIR resource operations
 * Handles all FHIR resource creation, retrieval, updates, and searches
 */

const db = require('../../database');
const fhirIds = require('../../lib/fhir-brand-identifiers');
const FHIRResources = require('../../models/fhir-resources');
const { v4: uuidv4 } = require('uuid');

// Import Stripe Issuing Service (optional - won't fail if not configured)
let StripeIssuingService;
try {
  StripeIssuingService = require('../commerce/stripe-issuing-service');
} catch (e) {
  console.warn('⚠️  Stripe Issuing Service not available:', e.message);
  StripeIssuingService = null;
}

class FHIRService {
  /**
   * Normalize name for comparison (remove extra spaces, convert to lowercase, remove punctuation)
   */
  static normalizeName(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Check if two names match (allowing for minor variations)
   */
  static namesMatch(name1, name2) {
    if (!name1 || !name2) return false;

    const normalized1 = this.normalizeName(name1);
    const normalized2 = this.normalizeName(name2);

    // Exact match
    if (normalized1 === normalized2) return true;

    // Split into parts for comparison
    const parts1 = normalized1.split(' ').filter(p => p.length > 0);
    const parts2 = normalized2.split(' ').filter(p => p.length > 0);

    // If both have at least 2 parts, compare first and last names
    if (parts1.length >= 2 && parts2.length >= 2) {
      const first1 = parts1[0];
      const last1 = parts1[parts1.length - 1];
      const first2 = parts2[0];
      const last2 = parts2[parts2.length - 1];

      // First and last names must match
      return first1 === first2 && last1 === last2;
    }

    // If only one part, compare directly
    if (parts1.length === 1 && parts2.length === 1) {
      return parts1[0] === parts2[0];
    }

    return false;
  }

  /**
   * Find duplicate patients by name (similar names)
   * @param {string} name - Patient name to search for
   * @param {string} excludePatientId - Patient ID to exclude from results
   * @returns {Array} Array of duplicate patient records
   */
  static findDuplicatePatientsByName(name, excludePatientId = null) {
    try {
      if (!name) return [];

      // Get all patients
      const allPatients = db.db.prepare('SELECT * FROM fhir_patients WHERE is_deleted = 0').all();

      // Parse the provided name
      const nameParts = this.normalizeName(name).split(' ').filter(p => p.length > 0);
      if (nameParts.length === 0) return [];

      const duplicates = [];

      for (const patient of allPatients) {
        // Skip if this is the patient we're excluding
        if (excludePatientId && patient.resource_id === excludePatientId) continue;

        // Get patient name from resource_data
        let patientName = '';
        try {
          const patientData = typeof patient.resource_data === 'string'
            ? JSON.parse(patient.resource_data)
            : patient.resource_data;

          if (patientData.name && patientData.name[0]) {
            const nameObj = patientData.name[0];
            const given = (nameObj.given || []).join(' ');
            const family = nameObj.family || '';
            patientName = `${given} ${family}`.trim();
          } else if (patient.name) {
            patientName = patient.name;
          }
        } catch (e) {
          // Skip if we can't parse
          continue;
        }

        // Check if names match
        if (patientName && this.namesMatch(name, patientName)) {
          duplicates.push({
            resource_id: patient.resource_id,
            name: patientName,
            phone: patient.phone,
            email: patient.email,
            created_at: patient.created_at
          });
        }
      }

      return duplicates;
    } catch (error) {
      console.error('[FHIR] Error finding duplicate patients:', error);
      return [];
    }
  }

  /**
   * Create or get existing patient from phone number
   * RULE: Each person has a unique identity. If similar names exist, phone number must be confirmed.
   * @param {Object} patientData - Patient information
   * @param {boolean} requirePhoneConfirmation - If true, return duplicates instead of creating when similar names found
   * @returns {Object} FHIR Patient resource or duplicate detection result
   */
  static async getOrCreatePatient(patientData, requirePhoneConfirmation = true) {
    try {
      // Parse name
      let firstName = patientData.firstName;
      let lastName = patientData.lastName;
      let fullName = '';

      if (!firstName && patientData.name) {
        const nameParts = patientData.name.split(' ');
        firstName = nameParts[0] || 'Unknown';
        lastName = nameParts.slice(1).join(' ') || '';
      }

      if (!firstName) {
        firstName = 'Unknown';
      }

      fullName = `${firstName} ${lastName}`.trim();

      // STEP 1: Check if patient exists by phone (MOST RELIABLE - phone is unique identifier)
      if (patientData.phone) {
        const existingPatientByPhone = db.getFHIRPatientByPhone(patientData.phone);
        if (existingPatientByPhone) {
          console.log(`[FHIR] ✅ Found existing patient by phone: ${existingPatientByPhone.resource_id}`);

          // Verify name matches (if name provided)
          if (fullName && fullName !== 'Unknown') {
            const existingName = existingPatientByPhone.name || '';
            if (!this.namesMatch(fullName, existingName)) {
              console.warn(`[FHIR] ⚠️  Name mismatch: Provided "${fullName}" but patient record has "${existingName}"`);
              // Still return the patient found by phone (phone is more reliable than name)
            }
          }

          return {
            patient: existingPatientByPhone.resource_data,
            duplicate: false,
            foundBy: 'phone'
          };
        }
      }

      // STEP 2: Check if patient exists by email (SECONDARY - email can be unique)
      if (patientData.email) {
        const existingPatientByEmail = db.getFHIRPatientByEmail(patientData.email);
        if (existingPatientByEmail) {
          console.log(`[FHIR] ✅ Found existing patient by email: ${existingPatientByEmail.resource_id}`);

          // Verify name matches
          if (fullName && fullName !== 'Unknown') {
            const existingName = existingPatientByEmail.name || '';
            if (!this.namesMatch(fullName, existingName)) {
              console.warn(`[FHIR] ⚠️  Name mismatch: Provided "${fullName}" but patient record has "${existingName}"`);
            }
          }

          return {
            patient: existingPatientByEmail.resource_data,
            duplicate: false,
            foundBy: 'email'
          };
        }
      }

      // STEP 3: Check for duplicate patients by name (REQUIRES PHONE CONFIRMATION)
      if (requirePhoneConfirmation && fullName && fullName !== 'Unknown') {
        const duplicates = this.findDuplicatePatientsByName(fullName);

        if (duplicates.length > 0) {
          console.log(`[FHIR] ⚠️  Found ${duplicates.length} patient(s) with similar name: "${fullName}"`);

          // If phone was provided, check if it matches any duplicate
          if (patientData.phone) {
            const matchingDuplicate = duplicates.find(d => d.phone === patientData.phone);
            if (matchingDuplicate) {
              console.log(`[FHIR] ✅ Phone number matches existing patient: ${matchingDuplicate.resource_id}`);
              const existingPatient = db.getFHIRPatient(matchingDuplicate.resource_id);
              if (existingPatient) {
                return {
                  patient: existingPatient.resource_data,
                  duplicate: false,
                  foundBy: 'name_and_phone'
                };
              }
            }
          }

          // Task 8: If email was provided, check if it uniquely matches one duplicate
          const normEmail = (e) => (e || '').toLowerCase().trim();
          if (patientData.email) {
            const providedEmail = normEmail(patientData.email);
            const emailMatches = duplicates.filter(d => providedEmail && normEmail(d.email) === providedEmail);
            if (emailMatches.length === 1) {
              const m = emailMatches[0];
              console.log(`[FHIR] ✅ Email matches unique patient: ${m.resource_id}`);
              const existingPatient = db.getFHIRPatient(m.resource_id);
              if (existingPatient) {
                return {
                  patient: existingPatient.resource_data,
                  duplicate: false,
                  foundBy: 'name_and_email'
                };
              }
            }
          }

          // Phone/email don't resolve - require confirmation (Task 8: support email-only identity)
          const hasEmail = !!patientData.email;
          const hasPhone = !!patientData.phone;
          const confirmMsg = hasPhone
            ? 'Please confirm your phone number to verify your identity.'
            : hasEmail
              ? 'Please confirm your email address to verify your identity.'
              : 'Please confirm your phone number or email to verify your identity.';
          console.log(`[FHIR] 🚨 DUPLICATE DETECTED: Similar name found, ${hasPhone ? 'phone does not match' : hasEmail ? 'email does not match' : 'phone/email not provided'}`);
          return {
            duplicate: true,
            requiresPhoneConfirmation: true,
            requiresEmailConfirmation: !hasPhone && hasEmail,
            duplicates: duplicates.map(d => ({
              patient_id: d.resource_id,
              name: d.name,
              phone: d.phone ? this.maskPhone(d.phone) : null,
              email: d.email ? this.maskEmail(d.email) : null,
              has_phone: !!d.phone,
              has_email: !!d.email
            })),
            message: `Found ${duplicates.length} patient(s) with similar name "${fullName}". ${confirmMsg}`,
            provided_name: fullName,
            provided_phone: patientData.phone || null,
            provided_email: patientData.email || null,
            voice_agent_instruction: hasPhone
              ? 'Ask the caller to confirm their phone number. If it matches an existing patient, use that record.'
              : hasEmail
                ? 'Ask the caller to confirm their email address. If it matches an existing patient, use that record.'
                : 'Ask the caller to confirm their phone number or email. If it matches an existing patient, use that record.'
          };
        }
      }

      // STEP 4: No duplicates found - create new patient
      // RULE: Require phone number for new patients (phone is unique identifier)
      if (!patientData.phone && requirePhoneConfirmation) {
        throw new Error('Phone number is required to create a new patient record. Each patient must have a unique phone number. Please provide your phone number to continue.');
      }

      // Double-check: Verify phone number doesn't already exist (defensive check)
      if (patientData.phone) {
        const existingByPhone = db.getFHIRPatientByPhone(patientData.phone);
        if (existingByPhone) {
          console.log(`[FHIR] ⚠️  Phone number ${patientData.phone} already exists - returning existing patient`);
          return {
            patient: existingByPhone.resource_data,
            duplicate: false,
            foundBy: 'phone'
          };
        }
      }

      const patientResource = FHIRResources.createPatient({
        id: `patient-${uuidv4()}`,
        firstName: firstName,
        lastName: lastName || '',
        phone: patientData.phone,
        email: patientData.email,
        gender: patientData.gender,
        birthDate: patientData.birthDate,
        address: patientData.address,
        consentVoiceRecording: true,
        preferredLanguage: patientData.language || 'en-US',
        timezone: patientData.timezone
      });

      // Add merchant_id if provided (for tenant linking)
      if (patientData.merchant_id) {
        patientResource.merchant_id = patientData.merchant_id;
      }

      // Validate
      const validation = FHIRResources.validate(patientResource);
      if (!validation.valid) {
        throw new Error(`Patient validation failed: ${validation.errors.join(', ')}`);
      }

      // Save to database (will throw error if phone number already exists)
      try {
        db.createFHIRPatient(patientResource);
        console.log(`[FHIR] ✅ Created new patient: ${patientResource.id}${patientResource.merchant_id ? ` (merchant: ${patientResource.merchant_id})` : ''}`);

        // HSA wallet: create embedded wallet for patient (phone-based for Busia)
        try {
          const HSAWalletService = require('../platform/hsa-wallet-service');
          if (HSAWalletService.isConfigured() && (patientData.phone || patientData.email)) {
            const wallet = await HSAWalletService.createPatientWallet({
              phone: patientData.phone,
              email: patientData.email,
              patientId: patientResource.id
            });
            if (wallet?.walletAddress && db.updateFHIRPatientWallet) {
              db.updateFHIRPatientWallet(patientResource.id, wallet.walletAddress);
              console.log(`[FHIR] ✅ HSA wallet created for patient ${patientResource.id}`);
            }
          }
        } catch (walletErr) {
          console.warn('[FHIR] HSA wallet creation skipped:', walletErr.message);
        }
      } catch (createError) {
        // If error is due to duplicate phone, try to find existing patient
        if (createError.message && createError.message.includes('phone') && createError.message.includes('already exists')) {
          console.warn(`[FHIR] ⚠️  Duplicate phone detected during creation: ${createError.message}`);
          if (patientData.phone) {
            const existingByPhone = db.getFHIRPatientByPhone(patientData.phone);
            if (existingByPhone) {
              return {
                patient: existingByPhone.resource_data,
                duplicate: false,
                foundBy: 'phone'
              };
            }
          }
        }
        throw createError;
      }

      // NOTE: Cards are NOT auto-created at patient signup
      // Cards are created on-demand when:
      // 1. Patient has insurance AND a bill/copay is created
      // 2. Patient requests a payment card
      // See: createCardForBill() or createCardForCopay() methods

      return {
        patient: patientResource,
        duplicate: false,
        foundBy: 'created'
      };
    } catch (error) {
      console.error('[FHIR] Error in getOrCreatePatient:', error);
      throw error;
    }
  }

  /**
   * Merge two FHIR patients into a single longitudinal record.
   * NOTE: This is a conservative merge:
   * - Moves dependent rows where safe.
   * - Marks secondary as is_deleted = 1 and sets merged_into.
   * - Does NOT hard-delete data.
   *
   * @param {string} primaryId - Patient ID to keep.
   * @param {string} secondaryId - Patient ID to merge into primary and deactivate.
   */
  static mergePatients(primaryId, secondaryId, reason = 'profile_update') {
    if (!primaryId || !secondaryId || primaryId === secondaryId) {
      return;
    }
    try {
      const d = db;

      const primary = d.getFHIRPatient ? d.getFHIRPatient(primaryId) : null;
      const secondary = d.getFHIRPatient ? d.getFHIRPatient(secondaryId) : null;
      if (!primary || !secondary) {
        console.warn('[FHIR] mergePatients: one or both patients not found', { primaryId, secondaryId });
        return;
      }

      console.log('[FHIR] 🔀 mergePatients start', { primaryId, secondaryId });

      // 1. Move appointments
      try {
        d.db.prepare(
          `UPDATE appointments SET patient_id = ? WHERE patient_id = ?`
        ).run(primaryId, secondaryId);
      } catch (e) {
        console.warn('[FHIR] mergePatients: failed to move appointments:', e.message);
      }

      // 2. Move insurance + eligibility
      try {
        if (d.db) {
          d.db.prepare(`UPDATE patient_insurance SET patient_id = ? WHERE patient_id = ?`).run(primaryId, secondaryId);
        }
      } catch (e) {
        console.warn('[FHIR] mergePatients: failed to move patient_insurance:', e.message);
      }
      try {
        if (d.db) {
          d.db.prepare(`UPDATE eligibility_checks SET patient_id = ? WHERE patient_id = ?`).run(primaryId, secondaryId);
        }
      } catch (e) {
        console.warn('[FHIR] mergePatients: failed to move eligibility_checks:', e.message);
      }

      // 3. Move encounters / communications / documents
      try {
        if (d.db) {
          d.db.prepare(`UPDATE fhir_encounters SET patient_id = ? WHERE patient_id = ?`).run(primaryId, secondaryId);
        }
      } catch (e) {
        console.warn('[FHIR] mergePatients: failed to move fhir_encounters:', e.message);
      }
      try {
        if (d.db) {
          d.db.prepare(`UPDATE fhir_communications SET patient_id = ? WHERE patient_id = ?`).run(primaryId, secondaryId);
        }
      } catch (e) {
        console.warn('[FHIR] mergePatients: failed to move fhir_communications:', e.message);
      }
      try {
        if (d.db) {
          d.db.prepare(`UPDATE patient_documents SET patient_id = ? WHERE patient_id = ?`).run(primaryId, secondaryId);
        }
      } catch (e) {
        console.warn('[FHIR] mergePatients: failed to move patient_documents:', e.message);
      }

      // 4. Mark secondary as merged/deleted
      try {
        if (d.db) {
          d.db.prepare(
            `UPDATE fhir_patients
             SET is_deleted = 1,
                 merged_into = ?,
                 updated_at = datetime('now')
             WHERE resource_id = ?`
          ).run(primaryId, secondaryId);
        }
      } catch (e) {
        console.warn('[FHIR] mergePatients: failed to mark secondary as merged:', e.message);
      }

      try {
        if (d.createPatientMergeEvent) {
          d.createPatientMergeEvent({
            primary_id: primaryId,
            secondary_id: secondaryId,
            reason,
            created_by: 'system'
          });
        }
      } catch (e) {
        console.warn('[FHIR] mergePatients: failed to record merge event:', e.message);
      }

      console.log('[FHIR] 🔀 mergePatients complete', { primaryId, secondaryId });
    } catch (error) {
      console.error('[FHIR] Error in mergePatients:', error);
    }
  }

  /**
   * Mask phone number for privacy (show last 4 digits)
   */
  static maskPhone(phone) {
    if (!phone || phone.length < 4) return '***-****';
    return `***-***-${phone.slice(-4)}`;
  }

  /**
   * Mask email for privacy (show first letter and domain)
   */
  static maskEmail(email) {
    if (!email || !email.includes('@')) return '***@***';
    const [local, domain] = email.split('@');
    if (local.length === 0) return `***@${domain}`;
    return `${local[0]}***@${domain}`;
  }

  /**
   * Create a new encounter for a voice call
   * @param {Object} encounterData - Encounter information
   * @returns {Object} FHIR Encounter resource
   */
  static async createEncounter(encounterData) {
    try {
      const encounterResource = FHIRResources.createEncounter({
        id: `encounter-${uuidv4()}`,
        patientId: encounterData.patientId,
        patientName: encounterData.patientName,
        callId: encounterData.callId,
        status: encounterData.status || 'in-progress',
        type: encounterData.type || 'Mental health support call',
        startTime: encounterData.startTime || new Date().toISOString(),
        reasonCode: encounterData.reasonCode,
        reasonText: encounterData.reasonText,
        agentVersion: encounterData.agentVersion,
        merchantId: encounterData.merchantId
      });

      // Validate
      const validation = FHIRResources.validate(encounterResource);
      if (!validation.valid) {
        throw new Error(`Encounter validation failed: ${validation.errors.join(', ')}`);
      }

      // Save to database
      db.createFHIREncounter(encounterResource);

      console.log(`[FHIR] Created encounter: ${encounterResource.id} for call: ${encounterData.callId}`);
      return encounterResource;
    } catch (error) {
      console.error('[FHIR] Error in createEncounter:', error);
      throw error;
    }
  }

  /**
   * Update an existing encounter
   * @param {string} encounterId - Encounter resource ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated FHIR Encounter resource
   */
  static async updateEncounter(encounterId, updates) {
    try {
      const existing = db.getFHIREncounter(encounterId);
      if (!existing) {
        throw new Error(`Encounter not found: ${encounterId}`);
      }

      const encounterResource = existing.resource_data;

      // Update fields
      if (updates.status) encounterResource.status = updates.status;
      if (updates.endTime) encounterResource.period.end = updates.endTime;
      if (updates.duration) {
        encounterResource.length = {
          value: updates.duration,
          unit: 'minutes',
          system: 'http://unitsofmeasure.org',
          code: 'min'
        };
      }

      // Update metadata
      encounterResource.meta.lastUpdated = new Date().toISOString();
      encounterResource.meta.versionId = String(parseInt(encounterResource.meta.versionId) + 1);

      // Save to database
      db.updateFHIREncounter(encounterId, encounterResource);

      console.log(`[FHIR] Updated encounter: ${encounterId}`);
      return encounterResource;
    } catch (error) {
      console.error('[FHIR] Error in updateEncounter:', error);
      throw error;
    }
  }

  /**
   * Store voice call transcript as Communication resource
   * @param {Object} transcriptData - Transcript information
   * @returns {Object} FHIR Communication resource
   */
  static async storeTranscript(transcriptData) {
    try {
      const communicationResource = FHIRResources.createCommunication({
        id: `communication-${uuidv4()}`,
        patientId: transcriptData.patientId,
        patientName: transcriptData.patientName,
        encounterId: transcriptData.encounterId,
        messages: transcriptData.messages, // Array of { text, speaker, timestamp, sentiment }
        sentTime: transcriptData.sentTime || new Date().toISOString(),
        category: 'instruction',
        notes: transcriptData.notes
      });

      // Validate
      const validation = FHIRResources.validate(communicationResource);
      if (!validation.valid) {
        throw new Error(`Communication validation failed: ${validation.errors.join(', ')}`);
      }

      // Save to database
      db.createFHIRCommunication(communicationResource);

      console.log(`[FHIR] Stored transcript: ${communicationResource.id} for encounter: ${transcriptData.encounterId}`);
      return communicationResource;
    } catch (error) {
      console.error('[FHIR] Error in storeTranscript:', error);
      throw error;
    }
  }

  /**
   * Create a mental health observation/assessment
   * @param {Object} observationData - Observation information
   * @returns {Object} FHIR Observation resource
   */
  static async createObservation(observationData) {
    try {
      const observationResource = FHIRResources.createObservation({
        id: `observation-${uuidv4()}`,
        patientId: observationData.patientId,
        patientName: observationData.patientName,
        encounterId: observationData.encounterId,
        assessmentType: observationData.assessmentType, // PHQ-9, GAD-7, MOOD, STRESS
        valueInteger: observationData.score,
        valueString: observationData.valueString,
        interpretation: observationData.interpretation,
        effectiveDateTime: observationData.effectiveDateTime || new Date().toISOString(),
        notes: observationData.notes
      });

      // Validate
      const validation = FHIRResources.validate(observationResource);
      if (!validation.valid) {
        throw new Error(`Observation validation failed: ${validation.errors.join(', ')}`);
      }

      // Save to database
      db.createFHIRObservation(observationResource);

      console.log(`[FHIR] Created observation: ${observationResource.id}`);
      return observationResource;
    } catch (error) {
      console.error('[FHIR] Error in createObservation:', error);
      throw error;
    }
  }

  /**
   * Create a clinical observation (dermatology, imaging, AI findings)
   * vc-p0-1: Extends createObservation for video consult clinical findings
   * @param {Object} data - { patientId, patientName, encounterId, text, snomedCode, bodySite, valueString, interpretation, ... }
   * @returns {Object} FHIR Observation resource
   */
  static async createClinicalObservation(data) {
    try {
      const observationResource = FHIRResources.createClinicalObservation({
        id: `observation-${uuidv4()}`,
        patientId: data.patientId,
        patientName: data.patientName,
        encounterId: data.encounterId,
        text: data.text,
        snomedCode: data.snomedCode || data.code,
        bodySite: data.bodySite,
        valueString: data.valueString,
        valueInteger: data.valueInteger,
        interpretation: data.interpretation,
        effectiveDateTime: data.effectiveDateTime || new Date().toISOString()
      });

      const validation = FHIRResources.validate(observationResource);
      if (!validation.valid) {
        throw new Error(`Clinical observation validation failed: ${validation.errors.join(', ')}`);
      }

      db.createFHIRObservation(observationResource);
      console.log(`[FHIR] Created clinical observation: ${observationResource.id}`);
      return observationResource;
    } catch (error) {
      console.error('[FHIR] Error in createClinicalObservation:', error);
      throw error;
    }
  }

  /**
   * Create a DiagnosticReport (Phase 8 Task 57).
   * Builds FHIR DiagnosticReport: resourceType, status: final, code LOINC 11488-4 Consult note,
   * subject (Patient ref), encounter ref, issued, conclusion (summary), presentedForm (base64 markdown).
   * Accepts payload shape: { subject, encounter, issued, conclusion, presentedForm (markdown or base64) } or legacy data shape.
   * @param {Object} payload - { subject: { reference: 'Patient/...' }, encounter: { reference: 'Encounter/...' }, issued, conclusion, presentedForm?, results[]? } or legacy { patientId, patientName, encounterId, ... }
   * @param {Object} [options] - { persist: true } to insert into DB
   * @returns {Object} FHIR DiagnosticReport resource
   */
  static async createDiagnosticReport(payload, options = {}) {
    const data = payload?.subject?.reference
      ? {
          id: payload.id || `diagnosticreport-${uuidv4()}`,
          subject: payload.subject,
          encounter: payload.encounter,
          patientId: (payload.subject.reference || '').replace(/^Patient\//, ''),
          patientName: payload.subject.display || '',
          encounterId: (payload.encounter?.reference || '').replace(/^Encounter\//, ''),
          conclusion: payload.conclusion || '',
          issued: payload.issued || new Date().toISOString(),
          effectiveDateTime: payload.effectiveDateTime || payload.issued || new Date().toISOString(),
          loincCode: payload.loincCode || '11488-4',
          display: payload.display || 'Consult note',
          presentedFormMarkdown: payload.presentedFormMarkdown || (typeof payload.presentedForm === 'string' ? payload.presentedForm : null),
          results: payload.results || [],
          status: payload.status || 'final'
        }
      : {
          id: payload?.id || `diagnosticreport-${uuidv4()}`,
          patientId: payload.patientId,
          patientName: payload.patientName,
          encounterId: payload.encounterId,
          conclusion: payload.conclusion || '',
          results: payload.results || [],
          loincCode: payload.loincCode || '11488-4',
          display: payload.display || 'Consult note',
          effectiveDateTime: payload.effectiveDateTime || new Date().toISOString(),
          issued: payload.issued || new Date().toISOString(),
          presentedFormMarkdown: payload.presentedFormMarkdown || payload.presentedForm,
          status: payload.status || 'final'
        };
    if (payload?.presentedFormMarkdown) data.presentedFormMarkdown = payload.presentedFormMarkdown;
    try {
      const reportResource = FHIRResources.createDiagnosticReport(data);
      const validation = FHIRResources.validate(reportResource);
      if (!validation.valid) {
        throw new Error(`DiagnosticReport validation failed: ${validation.errors.join(', ')}`);
      }
      if (options.persist !== false && db.createFHIRDiagnosticReport) {
        db.createFHIRDiagnosticReport(reportResource);
      }
      console.log(`[FHIR] Created DiagnosticReport: ${reportResource.id}`);
      return reportResource;
    } catch (error) {
      console.error('[FHIR] Error in createDiagnosticReport:', error);
      throw error;
    }
  }

  /**
   * Convenience helper: Create a DiagnosticReport for a completed appointment.
   * Uses appointment + patient context to build subject/encounter references and a basic conclusion.
   * @param {string} appointmentId
   * @returns {Promise<Object>} FHIR DiagnosticReport resource
   */
  static async createDiagnosticReportForAppointment(appointmentId) {
    if (!appointmentId) {
      throw new Error('appointmentId is required');
    }

    const appt = db.getAppointment ? db.getAppointment(appointmentId) : null;
    if (!appt) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    const patientId = appt.patient_id || null;
    let patientName = appt.patient_name || '';

    if (patientId && db.getFHIRPatient) {
      try {
        const patientRow = db.getFHIRPatient(patientId);
        const res = patientRow?.resource_data || {};
        if (Array.isArray(res.name) && res.name.length > 0) {
          patientName =
            res.name[0].text ||
            [res.name[0].given?.[0], res.name[0].family].filter(Boolean).join(' ') ||
            patientName;
        }
      } catch (_) {
        // fall back to appointment patient_name
      }
    }

    const subject = patientId
      ? {
          reference: `Patient/${patientId}`,
          display: patientName
        }
      : {
          reference: 'Patient/unknown',
          display: patientName || 'Unknown patient'
        };

    const encounter = {
      reference: `Encounter/${appointmentId}`,
      display: appt.appointment_type || 'Telemedicine visit'
    };

    const when = appt.start_time || `${appt.date || ''} ${appt.time || ''}`.trim() || new Date().toISOString();
    const conclusion = `Telemedicine visit (${appt.appointment_type || 'consultation'}) completed on ${appt.date || ''} at ${appt.time || ''}.`;

    return this.createDiagnosticReport(
      {
        subject,
        encounter,
        effectiveDateTime: when,
        issued: new Date().toISOString(),
        conclusion
      },
      { persist: true }
    );
  }

  /**
   * Phase 7 Task 55: Build FHIR DiagnosticReport from case report callback (no DB insert).
   * Used to set resource_data on the pending row. LOINC 11488-4 Consult note.
   */
  static createDiagnosticReportFromCaseReport(data) {
    const patientId = data.patient_id;
    const encounterId = data.encounter_id;
    const conclusion = (data.case_report_text || '').slice(0, 4000);
    const reportId = `diagnosticreport-${data.job_id || uuidv4()}`;
    const reportResource = FHIRResources.createDiagnosticReport({
      id: reportId,
      patientId,
      patientName: '',
      encounterId,
      conclusion,
      loincCode: '11488-4',
      display: 'Consult note',
      effectiveDateTime: new Date().toISOString(),
      issued: new Date().toISOString()
    });
    if (data.case_report_text) {
      try {
        reportResource.presentedForm = [{
          contentType: 'text/markdown',
          data: Buffer.from(data.case_report_text, 'utf8').toString('base64')
        }];
      } catch (_) {}
    }
    return reportResource;
  }

  /**
   * Create a medication request (product order)
   * @param {Object} medicationData - Medication request information
   * @returns {Object} FHIR MedicationRequest resource
   */
  static async createMedicationRequest(medicationData) {
    try {
      const medicationResource = FHIRResources.createMedicationRequest({
        id: `medication-request-${uuidv4()}`,
        patientId: medicationData.patientId,
        patientName: medicationData.patientName,
        encounterId: medicationData.encounterId,
        productName: medicationData.productName,
        orderId: medicationData.orderId,
        productId: medicationData.productId,
        price: medicationData.price,
        currency: medicationData.currency || 'USD',
        dosageInstructions: medicationData.dosageInstructions,
        status: medicationData.status || 'active'
      });

      // Save to database (using Observation table for now, can extend later)
      db.createFHIRObservation({
        ...medicationResource,
        code: { coding: [{ code: 'MEDICATION_ORDER' }] },
        subject: { reference: `Patient/${medicationData.patientId}` },
        effectiveDateTime: new Date().toISOString()
      });

      console.log(`[FHIR] Created medication request: ${medicationResource.id}`);
      return medicationResource;
    } catch (error) {
      console.error('[FHIR] Error in createMedicationRequest:', error);
      throw error;
    }
  }

  /**
   * Get patient by ID
   * @param {string} patientId - Patient resource ID
   * @returns {Object} FHIR Patient resource
   */
  static async getPatient(patientId) {
    try {
      const patient = db.getFHIRPatient(patientId);
      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }
      return patient.resource_data;
    } catch (error) {
      console.error('[FHIR] Error in getPatient:', error);
      throw error;
    }
  }

  /**
   * Fetch test eligibility data from Stedi sandbox and create patients
   * This calls Stedi API with test member IDs to create eligibility checks
   */
  static async fetchTestPatientsFromStedi() {
    try {
      console.log('[FHIR] 🔄 Fetching test patients from Stedi sandbox...');

      const InsuranceService = require('../rcm/insurance-service');

      // Test patient data for Stedi sandbox
      // These are common test member IDs used in healthcare sandboxes
      const testPatients = [
        {
          patientName: 'John Smith',
          dateOfBirth: '1980-01-15',
          memberId: '123456789',
          payerId: 'BCBS',
          phone: '+15551234567',
          email: 'john.smith@example.com'
        },
        {
          patientName: 'Jane Doe',
          dateOfBirth: '1985-05-20',
          memberId: '987654321',
          payerId: 'AETNA',
          phone: '+15559876543',
          email: 'jane.doe@example.com'
        },
        {
          patientName: 'Robert Johnson',
          dateOfBirth: '1990-08-10',
          memberId: '456789123',
          payerId: 'UHC',
          phone: '+15555555555',
          email: 'robert.johnson@example.com'
        }
      ];

      let created = 0;
      let eligibilityChecksCreated = 0;

      for (const testPatient of testPatients) {
        try {
          // Check if patient already exists
          const existingPatient = db.getFHIRPatientByPhone(testPatient.phone) ||
            db.getFHIRPatientByEmail(testPatient.email);

          if (existingPatient) {
            console.log(`[FHIR] ⏭️  Patient ${testPatient.patientName} already exists, skipping`);
            continue;
          }

          // Call Stedi API to check eligibility (this will create an eligibility check)
          console.log(`[FHIR] 📞 Checking eligibility for ${testPatient.patientName} (${testPatient.memberId})...`);

          const eligibilityData = {
            patientName: testPatient.patientName,
            dateOfBirth: testPatient.dateOfBirth,
            memberId: testPatient.memberId,
            payerId: testPatient.payerId,
            serviceCode: '90834', // Common therapy CPT code
            dateOfService: new Date().toISOString().split('T')[0],
            patientId: null // Will be set after patient creation
          };

          // Create patient from test data first
          const nameParts = testPatient.patientName.split(' ');
          const family = nameParts.pop() || 'Unknown';
          const given = nameParts.length > 0 ? nameParts : [testPatient.patientName];

          const patientResult = await this.getOrCreatePatient({
            name: {
              family: family,
              given: given
            },
            phone: testPatient.phone,
            email: testPatient.email,
            birthDate: testPatient.dateOfBirth
          }, false);

          if (!patientResult.patient) {
            console.warn(`[FHIR] ⚠️  Failed to create patient ${testPatient.patientName}`);
            continue;
          }

          const patientId = patientResult.patient.id || patientResult.patient.resource_id;
          created++;
          console.log(`[FHIR] ✅ Created patient ${testPatient.patientName} (ID: ${patientId})`);

          // Now check eligibility with patient ID
          eligibilityData.patientId = patientId;
          const eligibilityResult = await InsuranceService.checkEligibility(eligibilityData);

          if (eligibilityResult) {
            eligibilityChecksCreated++;
            console.log(`[FHIR] ✅ Eligibility check created for ${testPatient.patientName}`);

            // Find the eligibility check we just created (by member_id and payer_id)
            const eligibilityCheck = db.prepare(`
              SELECT id FROM eligibility_checks
              WHERE member_id = ? AND payer_id = ? AND patient_id = ?
              ORDER BY created_at DESC
              LIMIT 1
            `).get(testPatient.memberId, testPatient.payerId, patientId);

            // Link the eligibility check to the patient (should already be linked, but ensure it)
            if (eligibilityCheck) {
              db.prepare(`
                UPDATE eligibility_checks
                SET patient_id = ?
                WHERE id = ?
              `).run(patientId, eligibilityCheck.id);

              // Create patient_insurance record
              const payer = db.prepare(`
                SELECT payer_name FROM insurance_payers WHERE payer_id = ?
              `).get(testPatient.payerId);

              db.prepare(`
                INSERT OR IGNORE INTO patient_insurance (
                  id, patient_id, payer_id, payer_name, member_id, is_primary, is_verified
                ) VALUES (?, ?, ?, ?, ?, 1, 1)
              `).run(
                uuidv4(),
                patientId,
                testPatient.payerId,
                payer?.payer_name || testPatient.payerId,
                testPatient.memberId
              );
            }
          }
        } catch (error) {
          console.warn(`[FHIR] ⚠️  Error processing test patient ${testPatient.patientName}:`, error.message);
        }
      }

      console.log(`[FHIR] ✅ Created ${created} test patients, ${eligibilityChecksCreated} eligibility checks`);
      return { created, eligibilityChecksCreated };
    } catch (error) {
      console.error('[FHIR] ❌ Error fetching test patients from Stedi:', error);
      return { created: 0, eligibilityChecksCreated: 0 };
    }
  }

  /**
   * Sync patients from Stedi eligibility checks
   * Creates FHIR patients from eligibility_checks that don't have linked patients
   */
  static async syncPatientsFromStedi() {
    try {
      console.log('[FHIR] 🔄 Syncing patients from Stedi eligibility checks...');

      // First, try to fetch test patients from Stedi if no eligibility checks exist
      const eligibilityCount = db.prepare(`
        SELECT COUNT(*) as count FROM eligibility_checks
      `).get();

      if (eligibilityCount.count === 0) {
        console.log('[FHIR] 📥 No eligibility checks found, fetching test data from Stedi sandbox...');
        const fetchResult = await this.fetchTestPatientsFromStedi();
        if (fetchResult.created > 0) {
          return fetchResult;
        }
      }

      // Find eligibility_checks without linked patients
      const orphanedChecks = db.prepare(`
        SELECT DISTINCT 
          ec.member_id,
          ec.payer_id,
          ec.payer_name,
          ec.response_data,
          ec.created_at
        FROM eligibility_checks ec
        WHERE ec.patient_id IS NULL 
           OR ec.patient_id NOT IN (SELECT resource_id FROM fhir_patients WHERE is_deleted = 0)
        ORDER BY ec.created_at DESC
        LIMIT 50
      `).all();

      if (orphanedChecks.length === 0) {
        console.log('[FHIR] ✅ No orphaned eligibility checks found');
        return { created: 0, linked: 0 };
      }

      let created = 0;
      let linked = 0;

      for (const check of orphanedChecks) {
        try {
          // Parse response_data to extract patient information
          let patientData = {
            phone: null,
            email: null,
            name: null
          };

          if (check.response_data) {
            try {
              const response = typeof check.response_data === 'string'
                ? JSON.parse(check.response_data)
                : check.response_data;

              // Extract patient info from Stedi response
              if (response.patient_name) {
                patientData.name = response.patient_name;
              }
              if (response.patient_phone) {
                patientData.phone = response.patient_phone;
              }
              if (response.patient_email) {
                patientData.email = response.patient_email;
              }
              if (response.subscriber && response.subscriber.name) {
                patientData.name = response.subscriber.name;
              }
              if (response.subscriber && response.subscriber.phone) {
                patientData.phone = response.subscriber.phone;
              }
            } catch (parseError) {
              // Continue without patient data
            }
          }

          // Try to find existing patient by member_id in patient_insurance
          const existingInsurance = db.prepare(`
            SELECT patient_id FROM patient_insurance
            WHERE member_id = ? AND payer_id = ?
            LIMIT 1
          `).get(check.member_id, check.payer_id);

          let patientId = existingInsurance?.patient_id;

          // Check if patient exists
          if (patientId) {
            const existingPatient = db.prepare(`
              SELECT resource_id FROM fhir_patients 
              WHERE resource_id = ? AND is_deleted = 0
            `).get(patientId);
            if (!existingPatient) {
              patientId = null;
            }
          }

          // Try to find by phone or email
          if (!patientId && patientData.phone) {
            const patientByPhone = db.prepare(`
              SELECT resource_id FROM fhir_patients
              WHERE phone = ? AND is_deleted = 0
              LIMIT 1
            `).get(patientData.phone);
            if (patientByPhone) {
              patientId = patientByPhone.resource_id;
            }
          }

          if (!patientId && patientData.email) {
            const patientByEmail = db.prepare(`
              SELECT resource_id FROM fhir_patients
              WHERE email = ? AND is_deleted = 0
              LIMIT 1
            `).get(patientData.email);
            if (patientByEmail) {
              patientId = patientByEmail.resource_id;
            }
          }

          // Create new patient if none found
          if (!patientId) {
            const patientName = patientData.name || `Member ${check.member_id}`;
            const nameParts = patientName.split(' ');
            const family = nameParts.pop() || 'Unknown';
            const given = nameParts.length > 0 ? nameParts : [patientName];

            const patientResult = await this.getOrCreatePatient({
              name: {
                family: family,
                given: given
              },
              phone: patientData.phone,
              email: patientData.email
            }, false); // Don't require phone confirmation for sync

            if (patientResult.patient) {
              patientId = patientResult.patient.id || patientResult.patient.resource_id;
              created++;
            }
          }

          // Link eligibility_checks to patient
          if (patientId) {
            const updateResult = db.prepare(`
              UPDATE eligibility_checks
              SET patient_id = ?
              WHERE member_id = ? AND payer_id = ? AND (patient_id IS NULL OR patient_id != ?)
            `).run(patientId, check.member_id, check.payer_id, patientId);

            if (updateResult.changes > 0) {
              linked += updateResult.changes;
            }

            // Ensure patient_insurance record exists
            const insuranceExists = db.prepare(`
              SELECT id FROM patient_insurance
              WHERE patient_id = ? AND member_id = ? AND payer_id = ?
            `).get(patientId, check.member_id, check.payer_id);

            if (!insuranceExists) {
              const payer = db.prepare(`
                SELECT payer_name FROM insurance_payers WHERE payer_id = ?
              `).get(check.payer_id);

              db.prepare(`
                INSERT INTO patient_insurance (
                  id, patient_id, payer_id, payer_name, member_id, is_primary, is_verified
                ) VALUES (?, ?, ?, ?, ?, 1, 1)
              `).run(
                uuidv4(),
                patientId,
                check.payer_id,
                check.payer_name || payer?.payer_name || 'Unknown',
                check.member_id
              );
            }
          }
        } catch (error) {
          console.warn(`[FHIR] ⚠️  Error processing member_id ${check.member_id}:`, error.message);
        }
      }

      console.log(`[FHIR] ✅ Synced ${created} new patients, linked ${linked} eligibility checks`);
      return { created, linked };
    } catch (error) {
      console.error('[FHIR] ❌ Error syncing patients from Stedi:', error);
      return { created: 0, linked: 0 };
    }
  }

  /**
   * Search patients
   * @param {Object} searchParams - Search parameters
   * @returns {Array} Array of FHIR Patient resources
   */
  static async searchPatients(searchParams) {
    try {
      const patients = db.searchFHIRPatients(searchParams);
      return patients.map(p => p.resource_data);
    } catch (error) {
      console.error('[FHIR] Error in searchPatients:', error);
      throw error;
    }
  }

  /**
   * Get encounter by ID
   * @param {string} encounterId - Encounter resource ID
   * @returns {Object} FHIR Encounter resource
   */
  static async getEncounter(encounterId) {
    try {
      const encounter = db.getFHIREncounter(encounterId);
      if (!encounter) {
        throw new Error(`Encounter not found: ${encounterId}`);
      }
      return encounter.resource_data;
    } catch (error) {
      console.error('[FHIR] Error in getEncounter:', error);
      throw error;
    }
  }

  /**
   * Get encounter by call ID
   * @param {string} callId - Voice call ID
   * @returns {Object} FHIR Encounter resource
   */
  static async getEncounterByCallId(callId) {
    try {
      const encounter = db.getFHIREncounterByCallId(callId);
      if (!encounter) {
        return null;
      }
      return encounter.resource_data;
    } catch (error) {
      console.error('[FHIR] Error in getEncounterByCallId:', error);
      throw error;
    }
  }

  /**
   * Get all encounters for a patient
   * @param {string} patientId - Patient resource ID
   * @param {number} limit - Maximum number of results
   * @returns {Array} Array of FHIR Encounter resources
   */
  static async getPatientEncounters(patientId, limit = 20) {
    try {
      const encounters = db.getPatientEncounters(patientId, limit);
      return encounters.map(e => e.resource_data);
    } catch (error) {
      console.error('[FHIR] Error in getPatientEncounters:', error);
      throw error;
    }
  }

  /**
   * Get encounter transcript (communications)
   * @param {string} encounterId - Encounter resource ID
   * @returns {Array} Array of FHIR Communication resources
   */
  static async getEncounterTranscript(encounterId) {
    try {
      const communications = db.getEncounterCommunications(encounterId);
      return communications.map(c => c.resource_data);
    } catch (error) {
      console.error('[FHIR] Error in getEncounterTranscript:', error);
      throw error;
    }
  }

  /**
   * Task 52: Get transcript as plain text with speaker labels for case report service.
   * Query fhir_communications for encounter; extract payload[].contentString; concatenate chronologically.
   * Speaker from extension https://doclittle.health/extension/speaker (agent -> Doctor, patient -> Patient).
   */
  static getTranscriptText(encounterId) {
    const communications = db.getEncounterCommunications(encounterId);
    const lines = [];
    for (const row of communications) {
      const res = row.resource_data || {};
      const payload = res.payload || [];
      for (const p of payload) {
        const text = p.contentString || '';
        if (!text.trim()) continue;
        const ext = p.extension || [];
        const speakerExt = ext.find(e => fhirIds.matchesExtensionUrl(e.url, 'speaker'));
        const speakerRaw = speakerExt?.valueString || 'unknown';
        const label = speakerRaw === 'agent' ? 'Doctor' : speakerRaw === 'patient' ? 'Patient' : speakerRaw;
        lines.push(`${label}: ${text.trim()}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * Get patient observations (assessments)
   * @param {string} patientId - Patient resource ID
   * @param {number} limit - Maximum number of results
   * @returns {Array} Array of FHIR Observation resources
   */
  static async getPatientObservations(patientId, limit = 50) {
    try {
      const observations = db.getPatientObservations(patientId, limit);
      return observations.map(o => o.resource_data);
    } catch (error) {
      console.error('[FHIR] Error in getPatientObservations:', error);
      throw error;
    }
  }

  /**
   * Get patient everything (all resources)
   * @param {string} patientId - Patient resource ID
   * @returns {Object} Bundle of all patient resources
   */
  static async getPatientEverything(patientId) {
    try {
      const patient = await this.getPatient(patientId);
      const encounters = await this.getPatientEncounters(patientId, 100);
      const observations = await this.getPatientObservations(patientId, 100);

      // Get all communications for patient encounters
      const communications = [];
      for (const encounter of encounters) {
        const encounterComms = await this.getEncounterTranscript(encounter.id);
        communications.push(...encounterComms);
      }

      return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1 + encounters.length + observations.length + communications.length,
        entry: [
          { resource: patient },
          ...encounters.map(e => ({ resource: e })),
          ...observations.map(o => ({ resource: o })),
          ...communications.map(c => ({ resource: c }))
        ]
      };
    } catch (error) {
      console.error('[FHIR] Error in getPatientEverything:', error);
      throw error;
    }
  }

  /**
   * Log FHIR audit event
   * @param {string} action - Action performed (CREATE, READ, UPDATE, DELETE)
   * @param {string} resourceType - FHIR resource type
   * @param {string} resourceId - Resource ID
   * @param {string} userId - User performing the action
   * @param {string} ipAddress - IP address
   * @param {string} userAgent - User agent string
   */
  static async auditLog(action, resourceType, resourceId, userId, ipAddress, userAgent) {
    try {
      db.createFHIRAuditLog(action, resourceType, resourceId, userId, ipAddress, userAgent);
      console.log(`[FHIR Audit] ${action} ${resourceType}/${resourceId} by ${userId || 'system'}`);
    } catch (error) {
      console.error('[FHIR] Error in auditLog:', error);
      // Don't throw - audit failures shouldn't break the main operation
    }
  }

  /**
   * Process voice call and create all FHIR resources
   * @param {Object} callData - Voice call information
   * @returns {Object} Created FHIR resources
   */
  static async processVoiceCall(callData) {
    try {
      console.log('[FHIR] Processing voice call:', callData.callId);

      // 1. Get or create patient
      const patientResult = await this.getOrCreatePatient({
        phone: callData.customerPhone,
        email: callData.customerEmail,
        name: callData.customerName
      });

      // getOrCreatePatient returns a wrapper ({ patient, ... }) in most paths.
      // Normalize to the underlying FHIR Patient resource and resolve a persisted resource_id.
      const patientResource = patientResult?.patient || patientResult;
      let patientId = patientResource?.id;

      if (!patientId && callData.customerPhone) {
        const { findFHIRPatientForVoice } = require('./fhir-voice-lookup');
        const byPhone = findFHIRPatientForVoice(db, {
          phone: callData.customerPhone,
          clinicId: callData.clinicId || callData.clinic_id,
          customerId: callData.customerId || callData.customer_id,
          merchantId: callData.merchantId,
          requireClinicScope: !!(callData.clinicId || callData.clinic_id)
        });
        if (byPhone?.resource_id) patientId = byPhone.resource_id;
      }
      if (!patientId && callData.customerEmail) {
        const byEmail = db.getFHIRPatientByEmail(callData.customerEmail);
        if (byEmail?.resource_id) patientId = byEmail.resource_id;
      }
      if (!patientId) {
        throw new Error('FHIR patient resolution failed before encounter creation');
      }

      // 2. Create encounter for this call
      const encounter = await this.createEncounter({
        patientId,
        patientName: callData.customerName,
        callId: callData.callId,
        status: 'in-progress',
        startTime: new Date().toISOString(),
        merchantId: callData.merchantId,
        agentVersion: callData.agentVersion
      });

      console.log(`[FHIR] Voice call processed: Patient ${patientId}, Encounter ${encounter.id}`);

      return {
        patient: patientResource,
        encounter
      };
    } catch (error) {
      console.error('[FHIR] Error in processVoiceCall:', error);
      throw error;
    }
  }

  /**
   * Complete voice call and finalize FHIR resources
   * @param {string} callId - Voice call ID
   * @param {Object} callSummary - Call completion data
   * @returns {Object} Updated FHIR resources
   */
  static async completeVoiceCall(callId, callSummary) {
    try {
      console.log('[FHIR] Completing voice call:', callId);

      // 1. Get encounter by call ID
      const encounter = await this.getEncounterByCallId(callId);
      if (!encounter) {
        throw new Error(`Encounter not found for call: ${callId}`);
      }

      // 2. Update encounter status
      const updatedEncounter = await this.updateEncounter(encounter.id, {
        status: 'finished',
        endTime: new Date().toISOString(),
        duration: callSummary.duration
      });

      // 3. Store transcript if provided
      let communication = null;
      if (callSummary.transcript && callSummary.transcript.length > 0) {
        communication = await this.storeTranscript({
          patientId: encounter.subject.reference.replace('Patient/', ''),
          encounterId: encounter.id,
          messages: callSummary.transcript
        });
      }

      // 4. Store assessment if provided
      let observation = null;
      if (callSummary.assessment) {
        observation = await this.createObservation({
          patientId: encounter.subject.reference.replace('Patient/', ''),
          encounterId: encounter.id,
          assessmentType: callSummary.assessment.type,
          score: callSummary.assessment.score,
          interpretation: callSummary.assessment.interpretation
        });
      }

      console.log(`[FHIR] Voice call completed: ${callId}`);

      return {
        encounter: updatedEncounter,
        communication,
        observation
      };
    } catch (error) {
      console.error('[FHIR] Error in completeVoiceCall:', error);
      throw error;
    }
  }

  /**
   * Check if patient has insurance
   * @param {string} patientId - Patient ID
   * @returns {boolean} True if patient has insurance
   */
  static patientHasInsurance(patientId) {
    try {
      const insurance = db.getPatientInsurance(patientId);
      return !!(insurance && insurance.member_id && insurance.payer_id);
    } catch (error) {
      console.warn(`[FHIR] Error checking insurance for patient ${patientId}:`, error.message);
      return false;
    }
  }

  /**
   * Create Stripe card for a patient (on-demand)
   * Only creates card if patient has insurance
   * @param {Object} patientResource - FHIR Patient resource
   * @param {Object} options - Card options (clinic_id, spending_limit, etc.)
   * @returns {Object} Card creation result
   */
  static async createPatientCard(patientResource, options = {}) {
    // Check if patient has insurance before creating card
    const patientId = patientResource.id || patientResource.resource_id;
    if (!this.patientHasInsurance(patientId)) {
      console.log(`[FHIR] Patient ${patientId} does not have insurance - skipping card creation`);
      return {
        success: false,
        error: 'Patient does not have insurance. Cards are only created for insured patients.',
        requiresInsurance: true
      };
    }
    if (!StripeIssuingService) {
      console.warn('[FHIR] ⚠️  Stripe Issuing Service not available');
      return {
        success: false,
        error: 'Stripe Issuing Service not available'
      };
    }

    try {
      const patientId = patientResource.id || patientResource.resource_id;

      // Check if cardholder already exists for this patient
      const existingCardholder = db.getCardholderByPatientId(patientId);
      if (existingCardholder) {
        console.log(`[FHIR] Cardholder already exists for patient ${patientId}`);
        // Check if card exists
        const existingCards = db.getCardsByPatientId(patientId);
        if (existingCards && existingCards.length > 0) {
          console.log(`[FHIR] Card already exists for patient ${patientId}`);
          return {
            success: true,
            cardholder_id: existingCardholder.stripe_cardholder_id,
            card_id: existingCards[0].stripe_card_id,
            existing: true
          };
        }
      }

      // Prepare patient data for Stripe
      const patientData = {
        id: patientId,
        resource_id: patientId,
        name: patientResource.name?.[0]
          ? `${(patientResource.name[0].given || []).join(' ')} ${patientResource.name[0].family || ''}`.trim()
          : 'Unknown Patient',
        firstName: patientResource.name?.[0]?.given?.[0] || '',
        lastName: patientResource.name?.[0]?.family || '',
        email: patientResource.telecom?.find(t => t.system === 'email')?.value || null,
        phone: patientResource.telecom?.find(t => t.system === 'phone')?.value || null,
        address: patientResource.address || [],
        resource_data: patientResource
      };

      // Create Stripe Issuing service instance
      const stripeIssuing = new StripeIssuingService();

      // Create cardholder and card
      const result = await stripeIssuing.createCardholderAndCard(patientData, {
        clinic_id: options.clinic_id || null,
        spending_limit: options.spending_limit || 100000, // $1,000 in cents
        spending_interval: options.spending_interval || 'all_time',
        currency: options.currency || 'usd'
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create card');
      }

      // Save cardholder to database
      const cardholderId = `cardholder-${uuidv4()}`;
      db.createStripeCardholder({
        id: cardholderId,
        patient_id: patientId,
        clinic_id: options.clinic_id || null,
        stripe_cardholder_id: result.cardholder_id,
        type: 'individual',
        name: patientData.name,
        email: patientData.email,
        phone: patientData.phone,
        billing_address: stripeIssuing._extractBillingAddress(patientData),
        status: 'active',
        metadata: {
          created_by: 'fhir-service',
          patient_id: patientId
        }
      });

      // Save card to database
      const cardId = `card-${uuidv4()}`;
      db.createStripeCard({
        id: cardId,
        patient_id: patientId,
        clinic_id: options.clinic_id || null,
        cardholder_id: cardholderId,
        stripe_card_id: result.card_id,
        type: 'virtual',
        currency: options.currency || 'usd',
        status: 'active',
        last4: result.last4,
        brand: result.brand,
        expiry_month: result.expiry_month,
        expiry_year: result.expiry_year,
        spending_controls: {
          spending_limits: [
            {
              amount: options.spending_limit || 100000,
              interval: options.spending_interval || 'all_time'
            }
          ]
        },
        metadata: {
          created_by: 'fhir-service',
          patient_id: patientId
        }
      });

      console.log(`[FHIR] ✅ Created Stripe card for patient ${patientId}: ${result.card_id} (****${result.last4})`);

      return {
        success: true,
        cardholder_id: result.cardholder_id,
        card_id: result.card_id,
        last4: result.last4,
        brand: result.brand
      };
    } catch (error) {
      console.error('[FHIR] Error creating patient card:', error);
      throw error;
    }
  }

  /**
   * Create card for a specific bill/claim (on-demand)
   * Only creates if patient has insurance and owes money
   * @param {string} patientId - Patient ID
   * @param {number} billAmount - Bill amount in dollars
   * @param {Object} options - Additional options (claim_id, appointment_id, etc.)
   * @returns {Object} Card creation result
   */
  static async createCardForBill(patientId, billAmount, options = {}) {
    try {
      // Check if patient has insurance
      if (!this.patientHasInsurance(patientId)) {
        console.log(`[FHIR] Patient ${patientId} does not have insurance - skipping card creation for bill`);
        return {
          success: false,
          error: 'Patient does not have insurance. Cards are only created for insured patients.',
          requiresInsurance: true
        };
      }

      // Get patient resource
      const patient = db.getFHIRPatient(patientId);
      if (!patient) {
        return {
          success: false,
          error: 'Patient not found'
        };
      }

      const patientResource = typeof patient.resource_data === 'string'
        ? JSON.parse(patient.resource_data)
        : patient.resource_data;

      // Calculate spending limit (bill amount + 10% buffer, in cents)
      const spendingLimit = Math.ceil(billAmount * 110); // Add 10% buffer

      // Create card with bill-specific limit
      const result = await this.createPatientCard(patientResource, {
        clinic_id: options.clinic_id || null,
        spending_limit: spendingLimit,
        spending_interval: 'all_time', // One-time use for this bill
        currency: 'usd',
        bill_id: options.claim_id || options.bill_id || null,
        appointment_id: options.appointment_id || null
      });

      if (result.success) {
        console.log(`[FHIR] ✅ Created card for bill: $${billAmount} (limit: $${(spendingLimit / 100).toFixed(2)})`);
      }

      return result;
    } catch (error) {
      console.error('[FHIR] Error creating card for bill:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create card for copay payment (on-demand)
   * Only creates if patient has insurance
   * @param {string} patientId - Patient ID
   * @param {number} copayAmount - Copay amount in dollars
   * @param {Object} options - Additional options (appointment_id, etc.)
   * @returns {Object} Card creation result
   */
  static async createCardForCopay(patientId, copayAmount, options = {}) {
    try {
      // Check if patient has insurance
      if (!this.patientHasInsurance(patientId)) {
        console.log(`[FHIR] Patient ${patientId} does not have insurance - skipping card creation for copay`);
        return {
          success: false,
          error: 'Patient does not have insurance. Cards are only created for insured patients.',
          requiresInsurance: true
        };
      }

      // Get patient resource
      const patient = db.getFHIRPatient(patientId);
      if (!patient) {
        return {
          success: false,
          error: 'Patient not found'
        };
      }

      const patientResource = typeof patient.resource_data === 'string'
        ? JSON.parse(patient.resource_data)
        : patient.resource_data;

      // Calculate spending limit (copay amount + small buffer, in cents)
      const spendingLimit = Math.ceil(copayAmount * 110); // Add 10% buffer

      // Create card with copay-specific limit
      const result = await this.createPatientCard(patientResource, {
        clinic_id: options.clinic_id || null,
        spending_limit: spendingLimit,
        spending_interval: 'all_time', // One-time use for this copay
        currency: 'usd',
        appointment_id: options.appointment_id || null,
        copay_amount: copayAmount
      });

      if (result.success) {
        console.log(`[FHIR] ✅ Created card for copay: $${copayAmount} (limit: $${(spendingLimit / 100).toFixed(2)})`);
      }

      return result;
    } catch (error) {
      console.error('[FHIR] Error creating card for copay:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = FHIRService;
