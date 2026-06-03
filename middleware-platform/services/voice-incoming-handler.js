'use strict';

const axios = require('axios');

function createVoiceIncomingHandler(deps) {
  const { db, normalizePhoneNumber, clinicRateLimitCheck } = deps;
  return async function handleVoiceIncoming(req, res) {
  try {
    console.log('\n📞 INCOMING CALL from Twilio');
    console.log('From:', req.body.From);
    console.log('To:', req.body.To);
    console.log('CallSid:', req.body.CallSid);

    const { isDemoTwilioNumber, resolveTemplate: resolveSomoDemoTemplate } = require('./somo-demo-template-registry');

    // Check if this is an outbound sales call (from query params) or inbound to demo line
    let isSomoDemoDemo = req.query.call_type === 'somo_demo';
    const normalizedToForDemo = normalizePhoneNumber(req.body.To);
    if (!isSomoDemoDemo && isDemoTwilioNumber(normalizedToForDemo)) {
      isSomoDemoDemo = true;
      console.log('📞 Inbound call to Somo demo demo Twilio number');
    }
    const demoRequestId = req.query.demo_request_id;
    const somoDemoUseCase = req.query.use_case ? String(req.query.use_case) : null;
    const somoDemoProspectName = req.query.prospect_name
      ? decodeURIComponent(String(req.query.prospect_name))
      : null;

    const isOutboundSales =
      !isSomoDemoDemo && (req.query.call_type === 'sales_outbound' || req.query.lead_id);
    const leadId = req.query.lead_id;
    const clinicName = req.query.clinic_name ? decodeURIComponent(req.query.clinic_name) : null;

    // Look up SaaS customer by dedicated Twilio phone number first
    const toNumberRaw = req.body.To;
    const normalizedToNumber = normalizePhoneNumber(toNumberRaw);
    let clinicId = null;
    let customerId = req.query.customer_id ? String(req.query.customer_id).trim() : null;
    let matchedCustomer = null;

    // For outbound sales / Somo demo demo, use dedicated agents; otherwise use default
    let retellAgentId = isOutboundSales
        ? (process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a')
        : (process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a');

    if (customerId && !isOutboundSales && !isSomoDemoDemo) {
      matchedCustomer = db.getCustomer(customerId);
      if (matchedCustomer) {
        console.log(`✅ Matched customer from query customer_id: ${customerId}`);
        if (matchedCustomer.retell_agent_id) {
          retellAgentId = matchedCustomer.retell_agent_id;
        }
      } else {
        console.warn(`⚠️  customer_id query param not found: ${customerId}`);
        customerId = null;
      }
    }

    if (isSomoDemoDemo) {
      try {
        const tpl = resolveSomoDemoTemplate({ use_case: somoDemoUseCase || 'receptionist' });
        retellAgentId = req.query.agent_id || tpl.agentId;
      } catch (e) {
        console.error('❌ Somo demo demo agent not configured:', e.message);
        const errTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Demo calls are temporarily unavailable. Please try again later.</Say>
  <Hangup/>
</Response>`;
        return res.type('text/xml').send(errTwiml);
      }
    }

    if (isSomoDemoDemo) {
      console.log('📞 SOMO DEMO CALL');
      console.log(`   Demo request: ${demoRequestId}`);
      console.log(`   Use case: ${somoDemoUseCase}`);
      console.log(`   Prospect: ${somoDemoProspectName}`);
      console.log(`   Agent: ${retellAgentId}`);
      if (demoRequestId) {
        const demoRow = db.getSomoDemoRequest(demoRequestId);
        if (demoRow) {
          db.updateSomoDemoRequest(demoRequestId, { status: 'ringing' });
        }
      }
    } else if (isOutboundSales) {
      console.log('📞 OUTBOUND SALES CALL DETECTED');
      console.log(`   Lead ID: ${leadId}`);
      console.log(`   Clinic: ${clinicName}`);
      console.log(`   Using Sales Agent: ${retellAgentId}`);

      // For outbound calls, the "To" number is the target (clinic), not our number
      // We don't need to look up customer by number - we have lead_id
      if (leadId) {
        const lead = db.getLead(leadId);
        if (lead) {
          console.log(`✅ Found lead: ${lead.clinic_name}`);
          // Use lead data for context
          clinicId = leadId; // Use lead ID as identifier
        }
      }
    } else if (!customerId) {
      const customerByNumber = db.getCustomerByTwilioNumber(normalizedToNumber);
      if (customerByNumber) {
        matchedCustomer = customerByNumber;
        customerId = customerByNumber.id;
        if (customerByNumber.retell_agent_id) {
          retellAgentId = customerByNumber.retell_agent_id;
        }
        console.log(`✅ Matched customer ${customerByNumber.name || customerByNumber.company_name || customerByNumber.id} via Twilio number ${normalizedToNumber}`);

        // CRITICAL: Get merchant_id from customer for voice functions
        if (customerByNumber.merchant_id) {
          console.log(`✅ Customer has merchant_id: ${customerByNumber.merchant_id}`);
        } else {
          console.warn(`⚠️  Customer ${customerId} has no merchant_id. Voice product/order functions may not work.`);
        }

      } else {
        // Look up legacy clinic mapping
        const clinicPhone = db.getClinicPhoneNumber(normalizedToNumber);
        if (clinicPhone && clinicPhone.clinic_id) {
          clinicId = clinicPhone.clinic_id;
          customerId = clinicId; // Legacy: clinic_id used as customer_id
          const clinic = await db.getClinicById(clinicId);
          if (clinic && clinic.retell_agent_id) {
            retellAgentId = clinic.retell_agent_id;
            console.log(`✅ Found clinic: ${clinic.name} (${clinicId})`);
            console.log(`   Using Retell agent: ${retellAgentId}`);
          }
        } else {
          // Try to find customer by agent_id if provided in query params or headers
          const agentIdFromRequest = req.query.agent_id || req.headers['x-retell-agent-id'];
          if (agentIdFromRequest) {
            const customer = db.db.prepare('SELECT * FROM customers WHERE retell_agent_id = ?').get(agentIdFromRequest);
            if (customer) {
              matchedCustomer = customer;
              customerId = customer.id;
              retellAgentId = agentIdFromRequest;
              console.log(`✅ Found customer by agent_id: ${customer.name} (${customerId})`);
              console.log(`   Using Retell agent: ${retellAgentId}`);

              // CRITICAL: Get merchant_id from customer for voice functions
              if (customer.merchant_id) {
                console.log(`✅ Customer has merchant_id: ${customer.merchant_id}`);
              } else {
                console.warn(`⚠️  Customer ${customerId} has no merchant_id. Voice product/order functions may not work.`);
              }

            } else {
              console.warn(`⚠️  No customer found for agent_id: ${agentIdFromRequest}`);
              console.warn(`   Using default Retell agent: ${retellAgentId}`);
            }
          } else {
            console.warn(`⚠️  No clinic or customer found for phone number: ${normalizedToNumber}`);
            console.warn(`   Using default Retell agent: ${retellAgentId}`);
          }
        }
      }
    }

    if (!matchedCustomer && customerId) {
      matchedCustomer = db.getCustomer(customerId);
    }

    const {
      resolveInboundRetellAgent,
      buildMissingRetellTwiml
    } = require('./voice-inbound-tenant');
    const retellResolution = resolveInboundRetellAgent({
      matchedCustomer,
      customerId,
      isSomoDemoDemo,
      isOutboundSales,
      currentRetellAgentId: retellAgentId,
      defaultAgentId: process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a'
    });
    if (retellResolution.failClosed) {
      console.warn(
        `⚠️  SaaS inbound fail-closed (${retellResolution.reason}) customer=${customerId || matchedCustomer?.id}`
      );
      return res.type('text/xml').send(buildMissingRetellTwiml());
    }
    retellAgentId = retellResolution.retellAgentId;

    if (customerId && !isOutboundSales && !isSomoDemoDemo) {
      const { canAcceptInboundCall, buildBlockedTwiml } = require('./billing-access');
      const access = canAcceptInboundCall(db, customerId);
      if (!access.allowed) {
        console.warn(`⚠️  Inbound blocked for customer ${customerId}: ${access.reason}`);
        return res.type('text/xml').send(buildBlockedTwiml(access.message));
      }
      if (access.trial) {
        try {
          db.touchTrialActivity(customerId);
        } catch (_) { /* non-fatal */ }
      }
    }

    if (matchedCustomer && !isOutboundSales && !isSomoDemoDemo) {
      try {
        const VoiceAgentRuntime = require('./voice-agent-runtime');
        const runtime = VoiceAgentRuntime.loadProviderVoiceRuntime(db, {
          merchantId: matchedCustomer.merchant_id,
          customerId: matchedCustomer.id
        });
        const admission = VoiceAgentRuntime.evaluateCallAdmission(runtime);
        if (!admission.allowed) {
          const msg = admission.message || VoiceAgentRuntime.buildUnavailableMessage();
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${String(msg).replace(/[<>&"']/g, '')}</Say>
  <Hangup/>
</Response>`;
          console.warn(`⚠️  Inbound voice gate (${admission.reason}) for customer ${matchedCustomer.id}`);
          return res.type('text/xml').send(twiml);
        }
      } catch (gateErr) {
        console.warn('⚠️  Voice runtime inbound gate skipped:', gateErr.message);
      }
    }

    // Per-clinic rate limit (Section 17) — tier-aware when customer known
    const tenantKey = isSomoDemoDemo
      ? `somo_demo:${demoRequestId || retellAgentId}`
      : clinicId || customerId || retellAgentId || (isOutboundSales && leadId) || 'unknown';
    let tierRateLimit;
    if (matchedCustomer) {
      const { getRateLimitForCustomer } = require('./billing-access');
      tierRateLimit = getRateLimitForCustomer(matchedCustomer);
    }
    const rateLimit = clinicRateLimitCheck(tenantKey, tierRateLimit);
    if (!rateLimit.allowed) {
      console.warn(`⚠️  Clinic rate limit exceeded for ${tenantKey} (${rateLimit.limit}/min)`);
      const rateLimitTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We're experiencing high call volume. Please try again in a moment.</Say>
  <Hangup/>
</Response>`;
      return res.type('text/xml').send(rateLimitTwiml);
    }

    // CRITICAL: Register call with Retell FIRST (before responding)
    // But use a shorter timeout and handle errors gracefully
    const metadata = {};
    if (req.body.CallSid) {
      metadata.twilio_call_sid = req.body.CallSid;
    }
    // Add lead metadata for outbound sales calls
    if (isSomoDemoDemo) {
      metadata.call_type = 'somo_demo';
      if (demoRequestId) metadata.demo_request_id = demoRequestId;
      if (somoDemoUseCase) metadata.use_case = somoDemoUseCase;
      if (somoDemoProspectName) metadata.prospect_name = somoDemoProspectName;
    }
    if (isOutboundSales && leadId) {
      metadata.lead_id = leadId;
      metadata.call_type = 'sales_outbound';
      metadata.clinic_name = clinicName;
    }
    if (clinicId) {
      metadata.clinic_id = clinicId;
    }
    if (customerId) {
      metadata.customer_id = customerId;
    }
    if (matchedCustomer?.customer_type) {
      metadata.customer_type = matchedCustomer.customer_type;
    }
    // CRITICAL: Add merchant_id to metadata for voice functions (product search, order creation, tracking)
    if (matchedCustomer && matchedCustomer.merchant_id) {
      metadata.merchant_id = matchedCustomer.merchant_id;
      console.log(`✅ Added merchant_id ${matchedCustomer.merchant_id} to voice call metadata`);
    } else if (customerId) {
      // Try to get merchant_id from customer record if not already in matchedCustomer
      const customer = db.getCustomer(customerId);
      if (customer && customer.merchant_id) {
        metadata.merchant_id = customer.merchant_id;
        console.log(`✅ Added merchant_id ${customer.merchant_id} to voice call metadata`);
      } else {
        console.warn(`⚠️  No merchant_id found for customer ${customerId}. Voice product/order functions will not work.`);
      }
    }

    // Use merchant_id from metadata if available, otherwise try to resolve from clinic
    let merchantResolutionReason = 'none';
    let merchantId = metadata.merchant_id;
    if (merchantId) merchantResolutionReason = 'metadata';
    if (!merchantId && customerId) {
      // Try to get merchant from customer's clinic
      const customer = db.getCustomer(customerId);
      if (customer && customer.merchant_id) {
        merchantId = customer.merchant_id;
        merchantResolutionReason = 'customer_record';
      }
    }
    if (!merchantId && clinicId) {
      // Try to get merchant from clinic
      const clinic = await db.getClinicById(clinicId);
      if (clinic && clinic.merchant_id) {
        merchantId = clinic.merchant_id;
        merchantResolutionReason = 'clinic_record';
      }
    }

    // If still no merchant_id, resolve from Retell agent_id (PRIMARY METHOD - agent should be associated with tenant)
    if (!merchantId && retellAgentId) {
      // CRITICAL: Explicit mapping for known agents to ensure correct tenant resolution
      // This ensures the agent ALWAYS connects to the correct tenant
      const agentToSubdomainMap = {
        'agent_9151f738c705a56f4a0d8df63a': 'akin-dunbar' // Explicit mapping for akin-dunbar agent
      };
      
      // Check explicit mapping first (highest priority)
      if (agentToSubdomainMap[retellAgentId]) {
        const mappedSubdomain = agentToSubdomainMap[retellAgentId];
        const mappedMerchant = db.getMerchantBySubdomain(mappedSubdomain);
        if (mappedMerchant) {
          merchantId = mappedMerchant.id;
          merchantResolutionReason = 'agent_subdomain_map';
          console.log(`✅ Resolved merchant_id from explicit agent mapping: ${merchantId} (${mappedMerchant.name || 'unknown'}) for subdomain ${mappedSubdomain}`);
        }
      }
      
      // Method 1: Find merchant directly by agent_id (if merchants table has retell_agent_id column)
      if (!merchantId) {
        try {
          const merchantByAgent = db.db.prepare('SELECT id FROM merchants WHERE retell_agent_id = ? LIMIT 1').get(retellAgentId);
          if (merchantByAgent && merchantByAgent.id) {
            merchantId = merchantByAgent.id;
            merchantResolutionReason = 'merchant_retell_agent_id';
            const merchant = db.getMerchant(merchantId);
            console.log(`✅ Resolved merchant_id directly from merchant agent_id: ${merchantId} (${merchant?.name || 'unknown'})`);
          }
        } catch (e) {
          // Column might not exist, continue to other methods
        }
      }
      
      // Method 2: Find customer by agent_id (SaaS customers have agent_id)
      if (!merchantId) {
        const customerByAgent = db.db.prepare('SELECT * FROM customers WHERE retell_agent_id = ?').get(retellAgentId);
        if (customerByAgent && customerByAgent.merchant_id) {
          merchantId = customerByAgent.merchant_id;
          merchantResolutionReason = 'customer_retell_agent_id';
          const merchant = db.getMerchant(merchantId);
          console.log(`✅ Resolved merchant_id from customer agent_id: ${merchantId} (${merchant?.name || 'unknown'})`);
        }
      }
      
      // Method 3: Find clinic by agent_id (legacy clinics have agent_id)
      if (!merchantId) {
        const clinicWithAgent = db.db.prepare('SELECT merchant_id FROM clinics WHERE retell_agent_id = ? AND merchant_id IS NOT NULL LIMIT 1').get(retellAgentId);
        if (clinicWithAgent && clinicWithAgent.merchant_id) {
          merchantId = clinicWithAgent.merchant_id;
          merchantResolutionReason = 'clinic_retell_agent_id';
          const merchant = db.getMerchant(merchantId);
          console.log(`✅ Resolved merchant_id from clinic agent_id: ${merchantId} (${merchant?.name || 'unknown'})`);
        }
      }
      
      // Last resort: default tenant only when inbound tenant is unknown (not explicit customer_id)
      if (!merchantId && !customerId) {
        const defaultSubdomain = constants.TENANTS.DEFAULT_SUBDOMAIN || 'akin-dunbar';
        const defaultMerchant = db.getMerchantBySubdomain(defaultSubdomain);
        if (defaultMerchant) {
          merchantId = defaultMerchant.id;
          merchantResolutionReason = 'default_tenant_subdomain';
          console.log(`✅ Resolved merchant_id from default tenant (${defaultSubdomain}): ${merchantId} (${defaultMerchant.name || 'unknown'})`);
        } else {
          console.error(`❌ CRITICAL: Default tenant (${defaultSubdomain}) not found in database!`);
          // Final fallback: use first available merchant to keep voice flow alive in dev/misconfigured envs.
          try {
            const anyMerchant = (db.getAllMerchants && db.getAllMerchants()[0]) || null;
            if (anyMerchant?.id) {
              merchantId = anyMerchant.id;
              merchantResolutionReason = 'first_available_merchant_fallback';
              console.warn(`⚠️  Falling back to first available merchant: ${merchantId} (${anyMerchant.name || 'unknown'})`);
            }
          } catch (_) {}
        }
      }
    }

    if (!merchantId) {
      console.warn(`⚠️  No merchant_id found for customer ${customerId || 'unknown'} / clinic ${clinicId || 'unknown'}. Voice product/order functions may not work.`);
      merchantResolutionReason = 'unresolved';
    }

    // Optional hard guard: enforce merchant resolution before calling Retell.
    if (!merchantId && (process.env.REQUIRE_MERCHANT_ON_INBOUND === '1' || process.env.REQUIRE_MERCHANT_ON_INBOUND === 'true')) {
      const missingMerchantTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We are unable to route your call right now due to account configuration. Please try again shortly.</Say>
  <Hangup/>
</Response>`;
      return res.type('text/xml').send(missingMerchantTwiml);
    }

    const dynamicVariables = {};

    if (merchantId != null && merchantId !== '') {
      dynamicVariables.merchant_id = String(merchantId);
    }

    // Somo demo public demo — per-use-case opener for Retell
    if (isSomoDemoDemo) {
      const { getUseCaseContext } = require('./somo-demo-service');
      const useCaseKey = somoDemoUseCase || 'receptionist';
      const ctx = getUseCaseContext(useCaseKey);
      dynamicVariables.company_name = 'Somo demo';
      dynamicVariables.prospect_name = String(somoDemoProspectName || 'there');
      dynamicVariables.use_case = String(useCaseKey);
      dynamicVariables.use_case_label = String(ctx.use_case_label);
      dynamicVariables.use_case_opener = String(ctx.use_case_opener);
      dynamicVariables.call_type = 'somo_demo';
      dynamicVariables.persona_name = 'Sam';
      if (demoRequestId) dynamicVariables.demo_request_id = String(demoRequestId);
      try {
        const tpl = resolveSomoDemoTemplate({ use_case: useCaseKey });
        dynamicVariables.template_id = tpl.template_id;
      } catch (_) {}
      console.log('📋 Added Somo demo demo context to dynamic variables');
    }

    // For outbound sales calls, add lead-specific variables
    if (isOutboundSales && leadId) {
      const lead = db.getLead(leadId);
      if (lead) {
        dynamicVariables.clinic_name = String(lead.clinic_name || clinicName || 'the clinic');
        dynamicVariables.clinic_location = String(lead.location || 'Unknown');
        dynamicVariables.job_title = String(lead.title || 'Medical Receptionist');
        dynamicVariables.lead_id = String(leadId);
        dynamicVariables.lead_source = String(lead.source || 'job_search');
        console.log(`📋 Added lead context to dynamic variables`);
      }
    }

    if (clinicId) {
      dynamicVariables.clinic_id = String(clinicId);
    }
    if (customerId) {
      dynamicVariables.customer_id = String(customerId);
    }
    if (matchedCustomer?.customer_type) {
      dynamicVariables.customer_type = String(matchedCustomer.customer_type);
    }

    // Pre-populate patient context for cost optimization (P1 - reduce data entry during call)
    if (!isOutboundSales && req.body.From) {
      try {
        const callerPhone = SMSService.formatPhoneNumber(req.body.From);
        let patient = db.getFHIRPatientByPhone(callerPhone);
        if (!patient) {
          const altPhone = normalizePhoneNumber(req.body.From);
          if (altPhone !== callerPhone) patient = db.getFHIRPatientByPhone(altPhone);
        }
        if (patient) {
          const data = patient.resource_data && typeof patient.resource_data === 'object' ? patient.resource_data : {};
          const name = data?.name?.[0];
          const patientName = name ? [name.given?.join(' '), name.family].filter(Boolean).join(' ').trim() : (patient.name || null);
          const hasInsurance = !!(data?.insurance?.length || patient.insurance_verified);
          dynamicVariables.patient_id = String(patient.resource_id);
          if (patientName) dynamicVariables.patient_name = String(patientName);
          dynamicVariables.has_insurance = hasInsurance ? 'yes' : 'no';
          console.log(`✅ Pre-populated patient context: ${patientName || patient.resource_id} (insurance: ${dynamicVariables.has_insurance})`);
        }
      } catch (e) {
        console.warn('⚠️  Patient pre-population failed:', e.message);
      }
    }

    const registerPayload = {
      agent_id: retellAgentId,
      audio_websocket_protocol: 'twilio',
      audio_encoding: 'mulaw',
      sample_rate: 8000,
      from_number: req.body.From,
      to_number: req.body.To,
      metadata,
      retell_llm_dynamic_variables: dynamicVariables
    };

    try {
      console.log('[VoiceInbound] merchant_resolution', JSON.stringify({
        merchant_id: merchantId || null,
        reason: merchantResolutionReason,
        clinic_id: clinicId || null,
        customer_id: customerId || null,
        retell_agent_id: retellAgentId || null
      }));
    } catch (_) {}

    console.log('📡 Registering call with Retell...');

    let callId = null;
    let sipUri = null;

    try {
      const retellRegisterResp = await axios.post(
        'https://api.retellai.com/v2/register-phone-call',
        registerPayload,
        {
          headers: {
            'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000 // allow up to 8 seconds for Retell to respond
        }
      );

      console.log('📊 Retell Register Response:', JSON.stringify(retellRegisterResp.data, null, 2));

      callId = retellRegisterResp.data.call_id;
      console.log('✅ Call registered! Call ID:', callId);

      // Log call to database (async, don't block response)
      // For outbound sales calls, also log to lead_calls
      if (isOutboundSales && leadId) {
        setImmediate(async () => {
          try {
            // Update lead call record with Retell call ID
            const leadCalls = db.db.prepare('SELECT * FROM lead_calls WHERE call_id = ? OR call_id LIKE ?').all(
              req.query.call_id || '',
              `%${req.body.CallSid}%`
            );
            if (leadCalls.length > 0) {
              const leadCall = leadCalls[0];
              db.db.prepare(`
                UPDATE lead_calls 
                SET call_id = ?,
                    call_status = 'ringing',
                    updated_at = datetime('now')
                WHERE id = ?
              `).run(callId, leadCall.id);
              console.log(`📝 Updated lead call record with Retell call ID: ${callId}`);
            }
          } catch (logError) {
            console.error('⚠️  Failed to update lead call:', logError.message);
          }
        });
      }

      if (customerId || clinicId) {
        setImmediate(async () => {
          try {
            // Resolve a valid customers.id for FK-safe voice_call_log inserts.
            // Legacy flows may only have clinic_id; map or create tenant customer as needed.
            let resolvedCustomerId = customerId || null;
            // Guard legacy values (e.g. clinic-default) that are not real customers.id rows.
            if (resolvedCustomerId) {
              const existingCustomer = db.getCustomer?.(resolvedCustomerId) ||
                db.db.prepare('SELECT id FROM customers WHERE id = ? LIMIT 1').get(resolvedCustomerId);
              if (!existingCustomer) {
                resolvedCustomerId = null;
              }
            }
            if (!resolvedCustomerId && clinicId) {
              resolvedCustomerId =
                db.getCustomerIdForClinic?.(clinicId) ||
                db.ensureCustomerIdForClinic?.(clinicId) ||
                null;
              if (!resolvedCustomerId) {
                console.warn(`⚠️  Could not resolve customer_id for clinic ${clinicId}; logging voice call without customer_id`);
              }
            }

            await db.logVoiceCall({
              id: `call-${callId}`,
              customer_id: resolvedCustomerId,
              clinic_id: clinicId || null,
              call_id: callId,
              twilio_call_sid: req.body.CallSid, // Store Twilio CallSid for cost tracking
              call_duration_seconds: null, // Will update when call ends
              function_calls_count: 0,
              status: 'active'
            });
            if (typeof db.upsertCallState === 'function') {
              db.upsertCallState(callId, {
                customer_id: resolvedCustomerId,
                clinic_id: clinicId || null,
                current_stage: 'INTAKE',
                state_data: { twilio_call_sid: req.body.CallSid }
              });
            }
            if (clinicId) {
              try {
                db.db.prepare(`UPDATE voice_call_log SET clinic_id = ? WHERE call_id = ?`).run(clinicId, callId);
              } catch (_) {}
            }
            if (clinicId) {
              try {
                const orchestrator = require('./rcm-journey-orchestrator');
                const started = orchestrator.startJourney({
                  clinicId,
                  callId,
                  patientId: req.body?.patient_id || null,
                  source: 'voice',
                  stage: 'pre_registration',
                  payload: {
                    twilio_call_sid: req.body.CallSid,
                    direction: req.body.Direction || req.body.direction || null,
                  },
                });
                console.log(`🧭 RCM journey ${started.created ? 'started' : 'reused'}: ${started.journey?.id || started.journey_id} (call ${callId})`);
              } catch (rcmJourneyErr) {
                console.warn('⚠️  RCM journey start on call:', rcmJourneyErr.message);
              }
            }
            console.log(`📝 Logged call to database for ${resolvedCustomerId ? 'customer' : 'clinic'}: ${resolvedCustomerId || clinicId}`);
            console.log(`   Twilio CallSid: ${req.body.CallSid}`);
          } catch (logError) {
            console.error('⚠️  Failed to log call:', logError.message);
          }
        });
      }

      // Get SIP URI from Retell response if available, otherwise use default format
      // Retell may return sip_uri, sip_endpoint, or we construct it from call_id
      sipUri = retellRegisterResp.data.sip_uri ||
        retellRegisterResp.data.sip_endpoint ||
        `sip:${callId}@5t4n6j0wnrl.sip.livekit.cloud`;

      console.log('📞 Dialing to Retell SIP endpoint:', sipUri);
      if (isOutboundSales) {
        console.log('   📋 Outbound sales call - using sales agent prompt');
      }
    } catch (retellError) {
      console.error('❌ Retell registration failed:', retellError.message);
      console.error('   RETELL_API_KEY present:', !!process.env.RETELL_API_KEY);
      if (retellError.response) {
        console.error('   Status:', retellError.response.status);
        try {
          console.error('   Data:', JSON.stringify(retellError.response.data));
        } catch (e) {
          console.error('   Data: <unserializable>');
        }
      } else if (retellError.request) {
        console.error('   No response received from Retell (request sent).');
      }
      // If Retell fails, return fallback TwiML (configurable strict/soft behavior).
      const strictRetellFailure =
        process.env.INBOUND_RETELL_STRICT_FAILURE === '1' ||
        process.env.INBOUND_RETELL_STRICT_FAILURE === 'true';
      const errorTwiml = strictRetellFailure ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, we're experiencing technical difficulties. Please try again in a moment.</Say>
  <Hangup/>
</Response>` : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We are temporarily unable to connect you to the live agent. Please try again in about one minute, or leave your number after the tone and we will call you back.</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">Please leave your callback number now.</Say>
  <Record maxLength="30" playBeep="true"/>
  <Hangup/>
</Response>`;
      return res.type('text/xml').send(errorTwiml);
    }

    // Return TwiML IMMEDIATELY after Retell registration
    // Twilio requires response within 10-15 seconds
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>${sipUri}</Sip>
  </Dial>
</Response>`;

    res.type('text/xml').send(twiml);

    // ========== FHIR INTEGRATION ==========
    // Process FHIR resources asynchronously AFTER responding to Twilio
    // This prevents timeout issues - FAILURES DO NOT BLOCK CALLS
    if (process.env.ENABLE_FHIR !== 'false') {
      setImmediate(async () => {
        try {
          // Only process FHIR if we have customer_id (for proper patient linking)
          if (!customerId) {
            console.log('[FHIR] Skipping FHIR processing - no customer_id found');
            return;
          }

          // Resolve merchant_id from phone number or clinic_id
          let merchantId = null;
          if (clinicId) {
            const clinic = await db.getClinicById(clinicId);
            if (clinic && clinic.merchant_id) {
              merchantId = clinic.merchant_id;
            }
          }
          if (!merchantId && req.body.To) {
            // Try to resolve from phone number
            const clinicPhone = db.getClinicPhoneNumber(req.body.To);
            if (clinicPhone) {
              const clinic = await db.getClinicById(clinicPhone.clinic_id);
              if (clinic && clinic.merchant_id) {
                merchantId = clinic.merchant_id;
              }
            }
          }
          if (!merchantId && customerId) {
            // Try to get from customer
            const customer = db.getCustomer(customerId);
            if (customer && customer.merchant_id) {
              merchantId = customer.merchant_id;
            }
          }

          const callData = FHIRAdapter.retellCallToFHIR({
            call_id: callId,
            from_number: req.body.From,
            to_number: req.body.To,
            metadata: {
              twilio_call_sid: req.body.CallSid,
              merchant_id: merchantId // Use resolved merchant_id, null if not found
            }
          });

          const fhirResources = await FHIRService.processVoiceCall(callData);
          console.log(`[FHIR] ✅ Created Patient: ${fhirResources.patient.id}, Encounter: ${fhirResources.encounter.id}`);

          // Store FHIR IDs for later use
          global.activeCalls = global.activeCalls || {};
          global.activeCalls[callId] = {
            patientId: fhirResources.patient.id,
            encounterId: fhirResources.encounter.id,
            callSid: req.body.CallSid
          };
        } catch (fhirError) {
          // FHIR failures are non-blocking - log but don't crash
          console.error('[FHIR] ⚠️  FHIR processing failed (non-blocking):', fhirError.message);
          if (fhirError.stack) {
            console.error('[FHIR] Stack:', fhirError.stack.split('\n').slice(0, 3).join('\n'));
          }
          // Continue with call - FHIR is optional for voice agent functionality
        }
      });
    }
    // ======================================
    // Main try block ends here - response already sent
  } catch (error) {
    console.error('❌ Error handling incoming call:');

    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('   Error:', error.message);
    }

    // Log error to database
    try {
      const toNumber = req.body.To;
      const clinicPhone = db.getClinicPhoneNumber(toNumber);
      const clinicId = clinicPhone ? clinicPhone.clinic_id : null;

      db.logError({
        id: `error-${require('crypto').randomBytes(16).toString('hex')}`,
        customer_id: clinicId,
        error_type: 'VoiceCallError',
        error_message: error.message,
        stack_trace: error.stack,
        request_id: req.body.CallSid,
        endpoint: '/voice/incoming',
        context: JSON.stringify({ from: req.body.From, to: req.body.To }),
        severity: 'high'
      });
    } catch (logError) {
      console.error('⚠️  Failed to log error:', logError.message);
    }

    // Return error TwiML
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, there was an error connecting your call. Please try again later.</Say>
  <Hangup/>
</Response>`;

    res.type('text/xml');
    res.send(errorTwiml);
  }
  };
}

module.exports = { createVoiceIncomingHandler };
