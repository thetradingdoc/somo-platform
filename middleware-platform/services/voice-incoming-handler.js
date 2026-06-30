'use strict';

const axios = require('axios');
const Metrics = require('./metrics');
const {
  isOutboundRequest,
  normalizeCallType,
  resolveVoiceAccount,
  resolveOutboundRetellAgent,
  resolveMerchantForVoice,
  buildAccountResolutionFailureTwiml,
  getOperatorCustomerId
} = require('./voice-account-resolution');

function createVoiceIncomingHandler(deps) {
  const { db, normalizePhoneNumber } = deps;
  return async function handleVoiceIncoming(req, res) {
  try {
    console.log('\n📞 INCOMING CALL from Twilio');
    console.log('From:', req.body.From);
    console.log('To:', req.body.To);
    console.log('CallSid:', req.body.CallSid);

    const { isPlatformNavigationDid } = require('./navigation/navigation-config');

    const normalizedToNumber = normalizePhoneNumber(req.body.To);

    const isOutboundSalesEarly = isOutboundRequest(req);
    const platformNavigationDid = !isOutboundSalesEarly && isPlatformNavigationDid(normalizedToNumber);
    if (platformNavigationDid) {
      console.log('📞 Inbound call to platform navigation DID');
    }

    const isOutboundSales = isOutboundSalesEarly;
    const leadId = req.query.lead_id;
    const clinicName = req.query.clinic_name ? decodeURIComponent(req.query.clinic_name) : null;
    const resolvedCallTypeInitial = normalizeCallType(req, {
      isOutbound: isOutboundSales,
      leadId
    });
    let resolvedCallType = resolvedCallTypeInitial;

    // Look up SaaS customer by dedicated Twilio phone number first
    const toNumberRaw = req.body.To;
    const defaultAgentId = process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a';

    const account = resolveVoiceAccount(db, req, {
      normalizedToNumber,
      isOutbound: isOutboundSales,
      leadId
    });
    let clinicId = account.clinicId || null;
    let customerId = account.customerId;
    let matchedCustomer = account.matchedCustomer;

    const { isNavigationCustomer } = require('./voice-account-resolution');
    const { CALL_TYPE_CONSUMER_NAVIGATION } = require('./voice-call-context');
    const { navigationCustomerId } = require('./navigation/navigation-config');

    if (platformNavigationDid && !isNavigationCustomer(matchedCustomer)) {
      const navRow = db.getCustomer(navigationCustomerId());
      if (navRow) {
        customerId = navRow.id;
        matchedCustomer = navRow;
        console.log(`✅ Platform navigation DID override: ${customerId}`);
      }
    }

    const isNavigationInbound =
      !isOutboundSales &&
      (platformNavigationDid || isNavigationCustomer(matchedCustomer));
    if (isNavigationInbound) {
      resolvedCallType = CALL_TYPE_CONSUMER_NAVIGATION;
    }

    let siteContextForMetadata = null;
    let voiceContextForCall = null;
    try {
      const { resolveCallSiteContext } = require('./call-site-context');
      const { buildVoiceCallContext, runtimeClinicId, canPrepopulatePatient, toRetellMetadata } = require('./voice-call-context');
      const siteCtx = resolveCallSiteContext({
        db,
        to_number: normalizedToNumber,
        customer_id: customerId,
        clinic_id: clinicId,
        call_type: resolvedCallType,
        direction: isOutboundSales ? 'outbound' : 'inbound'
      });
      siteContextForMetadata = siteCtx;
      voiceContextForCall = buildVoiceCallContext({ siteContext: siteCtx });
      customerId = siteCtx.customer_id || customerId;
      clinicId = runtimeClinicId(voiceContextForCall) || null;
    } catch (_) {}

    let retellAgentId = isOutboundSales
      ? resolveOutboundRetellAgent(req, matchedCustomer, defaultAgentId)
      : defaultAgentId;

    if (isNavigationInbound) {
      const { resolveNavigationRetellAgentId } = require('./navigation/navigation-config');
      retellAgentId = resolveNavigationRetellAgentId();
    } else if (customerId && !isOutboundSales && matchedCustomer?.retell_agent_id) {
      retellAgentId = matchedCustomer.retell_agent_id;
    }

    if (isOutboundSales) {
      console.log('📞 OUTBOUND SALES CALL DETECTED');
      console.log(`   Lead ID: ${leadId}`);
      console.log(`   Clinic: ${clinicName}`);
      console.log(`   Using Sales Agent: ${retellAgentId}`);

      if (leadId) {
        const lead = db.getLead(leadId);
        if (lead) {
          console.log(`✅ Found lead: ${lead.clinic_name} (lead_id in metadata only)`);
        }
      }
    }

    if (isOutboundSales && req.query.agent_id) {
      retellAgentId = String(req.query.agent_id).trim();
      console.log(`✅ Outbound honoring agent_id query: ${retellAgentId}`);
    }

    if (!customerId) {
      console.error('❌ Account resolution failed: customer_id required before register-phone-call');
      return res.type('text/xml').send(buildAccountResolutionFailureTwiml());
    }

    const {
      resolveInboundRetellAgent,
      buildMissingRetellTwiml
    } = require('./voice-inbound-tenant');
    const retellResolution = resolveInboundRetellAgent({
      matchedCustomer,
      customerId,
      isOutboundSales,
      callType: resolvedCallType,
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

    if (customerId && isOutboundSales) {
      const { canInitiateOutboundCall, buildBlockedTwiml } = require('./billing-access');
      const access = canInitiateOutboundCall(db, customerId);
      if (!access.allowed) {
        console.warn(`⚠️  Outbound blocked for customer ${customerId}: ${access.reason}`);
        return res.type('text/xml').send(buildBlockedTwiml(access.message));
      }
    }

    if (customerId && !isOutboundSales) {
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

    if (matchedCustomer && !isOutboundSales) {
      try {
        const VoiceAgentRuntime = require('./voice-agent-runtime');
        const runtime = VoiceAgentRuntime.loadProviderVoiceRuntime(db, {
          merchantId: matchedCustomer.merchant_id,
          customerId: matchedCustomer.id,
          clinicId: clinicId || undefined
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

    // Twilio retry idempotency — return cached TwiML without re-counting limits
    const twilioCallSid = req.body.CallSid || null;
    const voiceLimitService = require('./voice-limit-service');
    const voiceActiveCalls = require('./voice-active-calls-service');
    const dedupe = await voiceLimitService.checkCallSidDedupe(twilioCallSid);
    if (dedupe.duplicate && dedupe.payload?.sipUri) {
      console.log(JSON.stringify({
        component: 'voice_inbound',
        event: 'call_sid_dedupe',
        call_sid: twilioCallSid,
        call_id: dedupe.payload.callId || null
      }));
      const cachedTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>${dedupe.payload.sipUri}</Sip>
  </Dial>
</Response>`;
      return res.type('text/xml').send(cachedTwiml);
    }

    // Concurrent cap before call_admission — busy callers must not burn req/min budget
    const tenantKey = customerId || clinicId || retellAgentId || (isOutboundSales && leadId) || 'unknown';
    let tierRateLimit;
    let maxConcurrent;
    if (matchedCustomer) {
      const billingAccess = require('./billing-access');
      tierRateLimit = billingAccess.getRateLimitForCustomer(matchedCustomer);
      maxConcurrent = billingAccess.getConcurrentCallsForCustomer(matchedCustomer);
    }

    const slotCallKey = twilioCallSid ? `twilio:${twilioCallSid}` : `pending:${Date.now()}`;
    let reservedSlot = false;
    if (customerId && maxConcurrent) {
      const capacity = await voiceActiveCalls.checkConcurrentCapacity(customerId, maxConcurrent);
      if (!capacity.allowed) {
        Metrics.increment('voice.admissions.rejected.concurrent', 1);
        console.warn(JSON.stringify({
          component: 'voice_inbound',
          event: 'concurrent_rejected',
          customer_id: customerId,
          concurrent_active: capacity.active,
          max_concurrent_calls: capacity.max,
          limit_type: 'max_concurrent_calls'
        }));
        const busyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">All of our lines are currently busy. Please try again in a moment.</Say>
  <Hangup/>
</Response>`;
        return res.type('text/xml').send(busyTwiml);
      }
    }

    const rateLimit = await voiceLimitService.checkCallAdmission({
      customerId: customerId || tenantKey,
      tenantKey,
      tierLimit: tierRateLimit
    });
    if (!rateLimit.allowed) {
      Metrics.increment('voice.admissions.rejected.rate', 1);
      console.warn(JSON.stringify({
        component: 'voice_inbound',
        event: 'admission_rejected',
        customer_id: customerId || null,
        rate_limit_outcome: 'rejected',
        limit_type: 'call_admission',
        limit: rateLimit.limit
      }));
      const rateLimitTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We're experiencing high call volume. Please try again in a moment.</Say>
  <Hangup/>
</Response>`;
      return res.type('text/xml').send(rateLimitTwiml);
    }

    if (customerId && maxConcurrent) {
      await voiceActiveCalls.reserveSlot(customerId, slotCallKey, twilioCallSid);
      voiceActiveCalls.recordAdmissionAudit(db, {
        id: `audit-${slotCallKey}`,
        customer_id: customerId,
        call_id: slotCallKey,
        twilio_call_sid: twilioCallSid
      });
      reservedSlot = true;
    }

    // CRITICAL: Register call with Retell FIRST (before responding)
    // But use a shorter timeout and handle errors gracefully
    const metadata = {};
    if (req.body.CallSid) {
      metadata.twilio_call_sid = req.body.CallSid;
    }
    if (isOutboundSales) {
      metadata.call_type = resolvedCallType;
      metadata.direction = 'outbound';
      if (leadId) {
        metadata.lead_id = leadId;
        metadata.clinic_name = clinicName;
      }
    } else if (isNavigationInbound) {
      metadata.call_type = CALL_TYPE_CONSUMER_NAVIGATION;
      metadata.direction = 'inbound';
    } else {
      metadata.call_type = resolvedCallType === 'operator_outbound' ? 'operator_outbound' : 'inbound_tenant';
      metadata.direction = 'inbound';
    }
    if (clinicId) {
      metadata.clinic_id = clinicId;
    }
    if (siteContextForMetadata) {
      metadata.site_context_status = siteContextForMetadata.site_context_status;
      metadata.clinic_id_source = siteContextForMetadata.clinic_id_source;
      metadata.to_number = normalizedToNumber;
    }
    const appointmentIdFromQuery = req.query.appointment_id
      ? String(req.query.appointment_id).trim()
      : null;
    const outboundPurposeFromQuery = req.query.outbound_purpose
      ? String(req.query.outbound_purpose).trim()
      : null;
    if (appointmentIdFromQuery) {
      metadata.appointment_id = appointmentIdFromQuery;
    }
    if (outboundPurposeFromQuery) {
      metadata.outbound_purpose = outboundPurposeFromQuery;
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

    const merchantFromQuery = req.query.merchant_id ? String(req.query.merchant_id).trim() : null;
    const merchantResolution = resolveMerchantForVoice(db, {
      customerId,
      matchedCustomer,
      merchantIdFromQuery: merchantFromQuery || metadata.merchant_id || null,
      retellAgentId,
      clinicId
    });
    let merchantId = merchantResolution.merchantId;
    let merchantResolutionReason = merchantResolution.reason;

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

    // Outbound: mirror call_type/direction in dynamic variables (Retell sometimes omits metadata on WS)
    if (isOutboundSales) {
      dynamicVariables.call_type = String(resolvedCallType || 'operator_outbound');
      dynamicVariables.direction = 'outbound';
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
    if (siteContextForMetadata) {
      const { toRetellMetadata, buildVoiceCallContext, canPrepopulatePatient } = require('./voice-call-context');
      const vctx = voiceContextForCall || buildVoiceCallContext({ siteContext: siteContextForMetadata });
      const trustedMeta = toRetellMetadata(vctx);
      if (trustedMeta.site_context_status) {
        dynamicVariables.site_context_status = String(trustedMeta.site_context_status);
      }
      if (trustedMeta.clinic_id_source) {
        dynamicVariables.clinic_id_source = String(trustedMeta.clinic_id_source);
      }
      if (trustedMeta.clinic_id) {
        dynamicVariables.clinic_id = String(trustedMeta.clinic_id);
        metadata.clinic_id = trustedMeta.clinic_id;
      } else if (dynamicVariables.clinic_id && !canPrepopulatePatient(vctx)) {
        delete dynamicVariables.clinic_id;
        delete metadata.clinic_id;
      }
      metadata.site_context_status = siteContextForMetadata.site_context_status;
      metadata.clinic_id_source = siteContextForMetadata.clinic_id_source;
    }
    if (customerId) {
      dynamicVariables.customer_id = String(customerId);
    }
    if (matchedCustomer?.customer_type) {
      dynamicVariables.customer_type = String(matchedCustomer.customer_type);
    }
    if (isNavigationInbound) {
      dynamicVariables.call_type = CALL_TYPE_CONSUMER_NAVIGATION;
      dynamicVariables.direction = 'inbound';
      dynamicVariables.routing_world = 'navigation';
    }
    if (appointmentIdFromQuery) {
      dynamicVariables.appointment_id = appointmentIdFromQuery;
    }
    if (outboundPurposeFromQuery) {
      dynamicVariables.outbound_purpose = outboundPurposeFromQuery;
    }
    if (resolvedCallType === 'operator_outbound') {
      dynamicVariables.call_type = 'operator_outbound';
      dynamicVariables.direction = 'outbound';
    }

    // Pre-populate patient context only when site is verified (no global FHIR fallback)
    if (!isOutboundSales && req.body.From) {
      try {
        const { buildVoiceCallContext, canPrepopulatePatient } = require('./voice-call-context');
        const vctx =
          voiceContextForCall ||
          buildVoiceCallContext({ siteContext: siteContextForMetadata || {} });
        if (!canPrepopulatePatient(vctx)) {
          // skip pre-pop — safer than wrong patient
        } else {
        const callerPhone = SMSService.formatPhoneNumber(req.body.From);
        const { findFHIRPatientForVoice } = require('./fhir-voice-lookup');
        const lookupOpts = {
          phone: callerPhone,
          clinicId: vctx.clinic_id,
          customerId: vctx.customer_id || metadata.customer_id || null,
          merchantId: siteContextForMetadata?.merchant_id || metadata.merchant_id || null,
          requireClinicScope: true
        };
        let patient = findFHIRPatientForVoice(db, lookupOpts);
        if (!patient) {
          const altPhone = normalizePhoneNumber(req.body.From);
          if (altPhone !== callerPhone) {
            patient = findFHIRPatientForVoice(db, { ...lookupOpts, phone: altPhone });
          }
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

      if (callId && siteContextForMetadata) {
        setImmediate(() => {
          try {
            db.upsertCallSiteContext?.({
              session_id: callId,
              call_id: callId,
              to_number: normalizedToNumber,
              customer_id: customerId,
              clinic_id: clinicId,
              clinic_id_source: siteContextForMetadata.clinic_id_source,
              site_context_status: siteContextForMetadata.site_context_status
            });
            db.insertKellyCallEvent?.({
              session_id: callId,
              call_id: callId,
              clinic_id: clinicId,
              customer_id: customerId,
              event_type: 'call_site_context_resolved',
              payload_json: {
                site_context_status: siteContextForMetadata.site_context_status,
                clinic_id_source: siteContextForMetadata.clinic_id_source,
                to_number: normalizedToNumber
              }
            });
          } catch (siteErr) {
            console.warn('⚠️  call_site_context ingress:', siteErr.message);
          }
        });
      }

      if (callId && (customerId || clinicId)) {
        setImmediate(() => {
          try {
            const { seedModeAtCallStart } = require('./conversation-mode/conversation-mode-session');
            const firstUtterance = req.query.first_utterance
              ? decodeURIComponent(String(req.query.first_utterance))
              : req.query.opening_intent
                ? decodeURIComponent(String(req.query.opening_intent))
                : '';
            const callDirection = isOutboundSales ? 'outbound' : 'inbound';
            const { resolveRoutingWorld, ROUTING_WORLD_NAVIGATION } = require('./voice-routing-world');
            const callTypeForMode = isNavigationInbound
              ? CALL_TYPE_CONSUMER_NAVIGATION
              : isOutboundSales
                ? resolvedCallType
                : 'tenant';
            const routingWorld = isNavigationInbound
              ? ROUTING_WORLD_NAVIGATION
              : resolveRoutingWorld({
                  call_type: callTypeForMode,
                  direction: callDirection,
                  to_number: normalizedToNumber,
                  customer_id: customerId,
                  customer: matchedCustomer
                });
            seedModeAtCallStart({
              sessionId: callId,
              db,
              clinicId,
              customerId,
              call_type: callTypeForMode,
              direction: callDirection,
              tenantResolved: require('./voice-routing-world').isTenantResolvedForMode(customerId),
              routing_world: routingWorld,
              site_context_status: voiceContextForCall?.site_context_status || null,
              appointmentId: appointmentIdFromQuery,
              outbound_purpose: outboundPurposeFromQuery,
              firstUtterance
            });

            if (isOutboundSales && customerId) {
              const {
                resolveCallOpeners,
                resolvePracticeDisplayName,
                buildDefaultOutboundOpener
              } = require('./call-opener-resolver');
              const practiceName = resolvePracticeDisplayName(db, {
                customerId,
                clinicId,
                customer: matchedCustomer
              });
              const settingsRow = db.getVoiceAgentSettingsForProvider?.({
                merchantId: merchantId || matchedCustomer?.merchant_id,
                customerId,
                clinicId:
                  siteContextForMetadata?.site_context_status === 'verified'
                    ? siteContextForMetadata.clinic_id || clinicId
                    : clinicId || null
              });
              const openerBundle = resolveCallOpeners({
                settings: settingsRow || {},
                practiceName,
                callType: resolvedCallType,
                direction: 'outbound',
                fallbackOutbound: buildDefaultOutboundOpener(practiceName, 'warm')
              });
              const activeOpener = openerBundle?.activeOpener;
              if (activeOpener?.text) {
                db.insertKellyCallEvent?.({
                  session_id: callId,
                  call_id: callId,
                  clinic_id: clinicId,
                  event_type: 'call_opener_used',
                  payload_json: JSON.stringify({
                    opener_text: activeOpener.text,
                    opener_source: activeOpener.source || 'outbound',
                    direction: 'outbound',
                    customer_id: customerId
                  })
                });
              }
            }
          } catch (seedErr) {
            console.warn('⚠️  voice-incoming mode/opener seed failed:', seedErr.message);
          }
        });
      }

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

            const callDirection = isOutboundSales ? 'outbound' : 'inbound';

            await db.logVoiceCall({
              id: `call-${callId}`,
              customer_id: resolvedCustomerId,
              clinic_id: clinicId || null,
              call_id: callId,
              twilio_call_sid: req.body.CallSid, // Store Twilio CallSid for cost tracking
              call_duration_seconds: null, // Will update when call ends
              function_calls_count: 0,
              status: 'active',
              direction: metadata.direction || callDirection
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

      if (twilioCallSid && sipUri) {
        await voiceLimitService.cacheInboundCall(twilioCallSid, { callId, sipUri });
      }
      if (reservedSlot && customerId && callId && slotCallKey !== callId) {
        await voiceActiveCalls.releaseSlot(customerId, slotCallKey);
        await voiceActiveCalls.reserveSlot(customerId, callId, twilioCallSid);
        voiceActiveCalls.endAdmissionAudit(db, customerId, slotCallKey);
        voiceActiveCalls.recordAdmissionAudit(db, {
          id: `audit-${callId}`,
          customer_id: customerId,
          call_id: callId,
          twilio_call_sid: twilioCallSid
        });
      }
    } catch (retellError) {
      if (reservedSlot && customerId) {
        await voiceActiveCalls.releaseSlot(customerId, slotCallKey);
        voiceActiveCalls.endAdmissionAudit(db, customerId, slotCallKey);
      }
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

          const FHIRAdapter = require('../adapters/fhir-adapter');
          const FHIRService = require('./fhir-service');

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
      const _clinicIdForLog = clinicPhone ? clinicPhone.clinic_id : null;

      let _customerIdForErrorLog = req.query.customer_id
        ? String(req.query.customer_id).trim()
        : null;
      if (_customerIdForErrorLog && !db.getCustomer(_customerIdForErrorLog)) {
        _customerIdForErrorLog = null;
      }
      if (!_customerIdForErrorLog && _clinicIdForLog) {
        _customerIdForErrorLog =
          (typeof db.getCustomerIdForClinic === 'function'
            ? db.getCustomerIdForClinic(_clinicIdForLog)
            : null) || null;
      }
      if (!_customerIdForErrorLog) {
        const opId = getOperatorCustomerId();
        if (opId && db.getCustomer(opId)) _customerIdForErrorLog = opId;
      }

      db.logError({
        id: `error-${require('crypto').randomBytes(16).toString('hex')}`,
        customer_id: _customerIdForErrorLog,
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
