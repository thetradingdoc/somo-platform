/**
 * RETELL WEBSOCKET HANDLER
 * 
 * This handles real-time communication between Retell AI and your middleware
 * Place this in: middleware-platform/webhooks/retell-websocket.js
 */

const WebSocket = require('ws');
const axios = require('axios');
const { fetchCallCosts } = require('../utils/cost-tracker');
const { check: clinicRateLimitCheck } = require('../utils/clinic-rate-limiter');
const tokenBudget = require('../utils/token-budget');
const SMSService = require('../services/sms-service');
const { processTurn: processCodingStateTurn } = require('../services/coding-state-service');
const CodingGraph = require('../services/coding-graph');
const { detectRedFlags, checkBeforeScheduling } = require('../services/triage-service');
const CallSessionService = require('../services/call-session-service');
const PatientOrchestratorService = require('../services/patient-orchestrator-service');
const KellyAgentService = require('../services/kelly-agent-service');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const KellyOrchestratorPhase = require('../services/kelly-orchestrator-phase');

class RetellWebSocketHandler {
    constructor(db, config) {
        this.db = db;
        this.config = config;
        this.activeConnections = new Map();
    }

    // Handle incoming WebSocket connection from Retell
    handleConnection(ws, req) {
        const callId = this.extractCallId(req);
        console.log(`\n📞 NEW RETELL CALL: ${callId}`);
        console.log(`🔗 WS state on connect for ${callId}: readyState=${ws.readyState}`);

        // Load existing state if resuming (conversation resumption)
        let existingState = null;
        if (typeof this.db.getCallState === 'function') {
            try {
                existingState = this.db.getCallState(callId);
                if (existingState) {
                    console.log(`📂 Resuming call state: stage=${existingState.current_stage}`);
                }
            } catch (e) {
                console.warn('⚠️  Failed to load call state for resumption:', e.message);
            }
        }

        // Create call session for this Retell call
        const session = CallSessionService.startSession({
            callId,
            clinicId: existingState?.clinic_id || null,
            metadata: {
                channel: 'voice',
                transport: 'retell'
            }
        });

        // Store connection
        const connection = {
            ws,
            callId,
            startTime: Date.now(),
            conversationHistory: existingState ? [] : [], // History loaded from DB per-turn
            callMetadata: {},
            customerPhone: null,
            customerName: null, // Will be stored when first provided
            initialName: null, // Store the FIRST name provided by the caller (for fraud detection)
            nameProvidedAt: null, // Timestamp when name was first provided
            sentInitialGreeting: false, // Send one opening line so silent callers hear agent first
            clinic_id: existingState?.clinic_id || null, // Restore from persisted state
            appointment_id: null, // Task 52 (D2): set from room name (appt-{id}) when message.call arrives
            _transcriptSequence: 0, // u-6: barge-in idempotency — increment per transcript; skip stale replies
            _codingState: existingState?.current_stage || 'INTAKE',
            _codingStateData: existingState?.state_data || {},
            awaitingName: true, // Voice intake: first capture caller name, then proceed to intent.
            hasReceivedRetellMessage: false, // Track whether Retell sent at least one LLM frame
            session
        };
        this.activeConnections.set(callId, connection);
        this.sendInitialHandshake(callId, connection);

        // Handle messages from Retell
        ws.on('message', async (data) => {
            try {
                const rawPayload = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
                const message = JSON.parse(rawPayload);
                connection.hasReceivedRetellMessage = true;
                await this.handleRetellMessage(callId, message);
            } catch (error) {
                const preview = Buffer.isBuffer(data)
                    ? data.toString('utf8').slice(0, 220)
                    : String(data).slice(0, 220);
                console.error(`Error handling Retell message for ${callId}:`, error.message);
                console.error('Retell raw payload preview:', preview);
            }
        });

        ws.on('ping', () => {
            console.log(`🏓 WS ping received from Retell for ${callId}`);
        });

        ws.on('pong', () => {
            console.log(`🏓 WS pong received from Retell for ${callId}`);
        });

        ws.on('error', (err) => {
            console.error(`❌ WS error for ${callId}:`, err.message);
        });

        // Handle connection close
        ws.on('close', async (code, reasonBuffer) => {
            const closeReason = reasonBuffer ? reasonBuffer.toString('utf8') : '';
            console.log(`📴 Call ended: ${callId} (code=${code}${closeReason ? `, reason=${closeReason}` : ''})`);
            if (!connection.hasReceivedRetellMessage) {
                console.warn(`⚠️ No inbound Retell WS frames received before close for ${callId}`);
            }

            // Update lead call if this is a sales call
            try {
                const leadCall = this.db.db.prepare('SELECT * FROM lead_calls WHERE call_id = ?').get(callId);
                if (leadCall) {
                    const callDuration = Date.now() - connection.startTime;
                    const callDurationSeconds = Math.floor(callDuration / 1000);
                    const callCost = (callDurationSeconds / 60) * 0.05; // $0.05/min

                    this.db.db.prepare(`
                        UPDATE lead_calls 
                        SET call_status = 'completed',
                            call_duration_seconds = ?,
                            call_cost = ?,
                            updated_at = datetime('now')
                        WHERE call_id = ?
                    `).run(callDurationSeconds, callCost, callId);

                    console.log(`✅ Updated lead call ${leadCall.id} - Duration: ${Math.round(callDurationSeconds / 60)} min, Cost: $${callCost.toFixed(2)}`);
                }
            } catch (error) {
                console.error('⚠️  Error updating lead call:', error.message);
            }

            // Deduct credits when call ends
            const activeConnection = this.activeConnections.get(callId);
            if (activeConnection && activeConnection.clinic_id) {
                try {
                    const callDuration = Date.now() - activeConnection.startTime;
                    const callDurationSeconds = Math.floor(callDuration / 1000);
                    const callDurationMinutes = Math.ceil(callDurationSeconds / 60); // Round up to nearest minute

                    // R-1: Map clinic to customer for credits (clinic.merchant_id -> customer)
                    const customerIdForCredits = this.db.getCustomerIdForClinic?.(activeConnection.clinic_id) || activeConnection.clinic_id;
                    
                    // Get customer credits (using clinic_id as customer_id for now)
                    const credits = this.db.getCustomerCredits(customerIdForCredits);
                    if (credits && credits.credits_balance_minutes >= callDurationMinutes) {
                        // Deduct credits
                        this.db.deductCredits(customerIdForCredits, callDurationMinutes);

                        // Update voice call log with duration and credits deducted
                        // NOTE: voice_call_log table uses customer_id, so we use clinic_id here
                        const callLog = this.db.db.prepare('SELECT * FROM voice_call_log WHERE call_id = ?').get(callId);
                        if (callLog) {
                            this.db.db.prepare(`
                                UPDATE voice_call_log 
                                SET call_duration_seconds = ?,
                                    call_duration_minutes = ?,
                                    credits_deducted = ?,
                                    status = 'completed'
                                WHERE call_id = ?
                            `).run(callDurationSeconds, callDurationMinutes, callDurationMinutes, callId);
                        } else {
                            // Create call log if it doesn't exist
                            const { v4: uuidv4 } = require('uuid');
                            this.db.db.prepare(`
                                INSERT INTO voice_call_log (
                                    id, customer_id, call_id, call_duration_seconds, 
                                    call_duration_minutes, credits_deducted, status
                                ) VALUES (?, ?, ?, ?, ?, ?, 'completed')
                            `).run(
                                uuidv4(),
                                customerIdForCredits, // Using clinic_id as customer_id (database schema limitation)
                                callId,
                                callDurationSeconds,
                                callDurationMinutes,
                                callDurationMinutes
                            );
                        }

                        console.log(`✅ Deducted ${callDurationMinutes} minutes from clinic ${activeConnection.clinic_id}`);
                    } else {
                        // Insufficient credits - log warning
                        console.warn(`⚠️  Insufficient credits for clinic ${activeConnection.clinic_id} (needed: ${callDurationMinutes}, available: ${credits ? credits.credits_balance_minutes : 0})`);

                        // Still log the call
                        const callLog = this.db.db.prepare('SELECT * FROM voice_call_log WHERE call_id = ?').get(callId);
                        if (callLog) {
                            this.db.db.prepare(`
                                UPDATE voice_call_log 
                                SET call_duration_seconds = ?,
                                    call_duration_minutes = ?,
                                    credits_deducted = 0,
                                    status = 'completed_no_credits'
                                WHERE call_id = ?
                            `).run(callDurationSeconds, callDurationMinutes, callId);
                        }
                    }

                    // ========== COST TRACKING ==========
                    // Fetch and store costs from Twilio and Retell APIs
                    try {
                        const twilioCallSid = activeConnection.twilio_call_sid ||
                            activeConnection.callMetadata?.metadata?.twilio_call_sid ||
                            null;

                        console.log(`💰 Fetching costs for call ${callId}...`);
                        console.log(`   Twilio CallSid: ${twilioCallSid || 'not found'}`);

                        // Fetch costs from APIs (with fallback to calculated)
                        const costData = await fetchCallCosts(twilioCallSid, callId, callDurationMinutes);

                        // Update voice_call_log with costs
                        this.db.updateVoiceCallCosts(callId, costData);

                        console.log(`✅ Costs tracked for call ${callId}:`);
                        console.log(`   Twilio: $${costData.twilio_cost_usd?.toFixed(4) || 'N/A'} (${costData.cost_source === 'api' && costData.twilio_cost_usd ? 'API' : 'calculated'})`);
                        console.log(`   Retell: $${costData.retell_cost_usd?.toFixed(4) || 'N/A'} (${costData.cost_source === 'api' && costData.retell_cost_usd ? 'API' : 'calculated'})`);
                        console.log(`   Total: $${costData.total_cost_usd?.toFixed(4)} (source: ${costData.cost_source})`);
                    } catch (costError) {
                        console.error('❌ Failed to track costs:', costError);
                        // Still update with calculated costs as fallback
                        try {
                            const { calculateEstimatedCosts } = require('../utils/cost-tracker');
                            const calculatedCosts = calculateEstimatedCosts(callDurationMinutes);
                            this.db.updateVoiceCallCosts(callId, {
                                twilio_cost_calculated_usd: calculatedCosts.twilio_cost_calculated_usd,
                                retell_cost_calculated_usd: calculatedCosts.retell_cost_calculated_usd,
                                total_cost_usd: calculatedCosts.total_cost_calculated_usd,
                                cost_source: 'calculated'
                            });
                            console.log(`⚠️  Used calculated costs as fallback: $${calculatedCosts.total_cost_calculated_usd.toFixed(4)}`);
                        } catch (fallbackError) {
                            console.error('❌ Failed to store fallback costs:', fallbackError);
                        }
                    }
                    // ====================================
                } catch (creditsError) {
                    console.error('❌ Failed to deduct credits:', creditsError);
                }
            }

            // Save final state snapshot (medical coding agent)
            if (typeof this.db.saveAgentStateSnapshot === 'function') {
                try {
                    const callDuration = connection ? Date.now() - connection.startTime : 0;
                    this.db.saveAgentStateSnapshot(callId, 'call_ended', {
                        clinic_id: connection?.clinic_id || null,
                        duration_ms: callDuration,
                        ended_at: new Date().toISOString()
                    });
                } catch (e) {
                    console.warn('⚠️  Failed to save call-end snapshot:', e.message);
                }
            }

            // Task 48: Link FHIR encounter completion to claim/payment on call end
            try {
                const enc = this.db.getFHIREncounterByCallId && this.db.getFHIREncounterByCallId(callId);
                if (enc) {
                    const rd = enc.resource_data || (typeof enc.resource_data === 'string' ? JSON.parse(enc.resource_data) : {});
                    if (rd.status !== 'finished' && rd.status !== 'completed') {
                        rd.status = 'finished';
                        if (rd.period) rd.period.end = new Date().toISOString();
                        this.db.updateFHIREncounter && this.db.updateFHIREncounter(enc.resource_id, rd);
                        console.log(`✅ FHIR encounter ${enc.resource_id} completed on call end`);
                    }
                }
            } catch (e) {
                console.warn('⚠️  FHIR encounter completion on call end:', e.message);
            }

            // Token budget: reset per-call usage when call ends (Section 10)
            try {
                tokenBudget.reset(callId);
            } catch (_) { /* ignore */ }

            // End call session (for tracing / audit)
            try {
                CallSessionService.endSession(callId, {
                    ended_at: new Date().toISOString()
                });
            } catch (_) { /* ignore */ }

            this.activeConnections.delete(callId);
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error(`❌ WebSocket error for ${callId}:`, error);
        });
    }

    // Handle different message types from Retell
    async handleRetellMessage(callId, message) {
        const connection = this.activeConnections.get(callId);
        if (!connection) return;
        const interactionType = message.interaction_type || message.type;
        // Temporary protocol diagnostics: capture actual inbound payload shape from Retell
        try {
            const keys = Object.keys(message || {});
            console.log(`🧭 Retell payload shape`, {
                interaction_type: message?.interaction_type,
                type: message?.type,
                keys
            });
        } catch (_) {}

        // Store call metadata from first message
        const callMeta = message.call || (interactionType === 'call_details' ? message : null);
        if (callMeta) {
            connection.callMetadata = callMeta;
            // CRITICAL: Normalize phone number to +1 format for US customers
            connection.customerPhone = callMeta.from_number
                ? SMSService.formatPhoneNumber(callMeta.from_number)
                : null;

            // Store Twilio CallSid from metadata if available
            if (callMeta.metadata && callMeta.metadata.twilio_call_sid) {
                connection.twilio_call_sid = callMeta.metadata.twilio_call_sid;
            }

            // Extract clinic_id from various sources
            // Priority: dynamic_variables > metadata > agent_id lookup > phone number lookup
            // NOTE: We use clinic_id as the primary tenant identifier
            if (callMeta.dynamic_variables && callMeta.dynamic_variables.clinic_id) {
                connection.clinic_id = callMeta.dynamic_variables.clinic_id;
                console.log(`✅ Extracted clinic_id from dynamic variables: ${connection.clinic_id}`);
            } else if (callMeta.metadata && callMeta.metadata.clinic_id) {
                connection.clinic_id = callMeta.metadata.clinic_id;
                console.log(`✅ Extracted clinic_id from metadata: ${connection.clinic_id}`);
            } else if (callMeta.dynamic_variables && callMeta.dynamic_variables.customer_id) {
                // Legacy: customer_id support (may be clinic_id in disguise)
                connection.clinic_id = callMeta.dynamic_variables.customer_id;
                console.log(`✅ Extracted clinic_id from customer_id (legacy): ${connection.clinic_id}`);
            } else if (callMeta.metadata && callMeta.metadata.customer_id) {
                // Legacy: customer_id support (may be clinic_id in disguise)
                connection.clinic_id = callMeta.metadata.customer_id;
                console.log(`✅ Extracted clinic_id from customer_id (legacy): ${connection.clinic_id}`);
            } else if (callMeta.agent_id) {
                // Look up clinic by Retell agent_id (check clinics table first, then customers for backward compatibility)
                const clinic = this.db.db.prepare('SELECT * FROM clinics WHERE retell_agent_id = ?').get(callMeta.agent_id);
                if (clinic) {
                    connection.clinic_id = clinic.clinic_id;
                    console.log(`✅ Looked up clinic_id from agent_id: ${connection.clinic_id}`);
                } else {
                    // Fallback: check customers table (legacy support)
                const customer = this.db.db.prepare('SELECT * FROM customers WHERE retell_agent_id = ?').get(callMeta.agent_id);
                if (customer) {
                        // R-1: Use customer's first clinic when agent maps to customer (legacy)
                        const clinicRow = this.db.db.prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1').get(customer.merchant_id);
                        connection.clinic_id = clinicRow?.clinic_id || customer.id;
                        console.log(`⚠️  Looked up clinic_id from customer agent_id (legacy): ${connection.clinic_id}`);
                    }
                }
            }

            // Fallback: Try to lookup by phone number
            if (!connection.clinic_id) {
                const toNumber = callMeta.to_number;
                if (toNumber) {
                    const clinicPhone = this.db.getClinicPhoneNumber(toNumber);
                    if (clinicPhone && clinicPhone.clinic_id) {
                        connection.clinic_id = clinicPhone.clinic_id;
                        console.log(`✅ Looked up clinic_id from phone number: ${connection.clinic_id}`);
                    }
                }
            }

            // Task 6: Fallback clinic_id from env only. S-1: No arbitrary DB clinic—multi-tenant leak risk.
            if (!connection.clinic_id) {
                const fallback = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID;
                if (fallback) {
                    connection.clinic_id = fallback;
                    console.log(`⚠️  Using fallback clinic_id from env: ${connection.clinic_id}`);
                }
            }

            // Inbound calls often register patient_name in Retell dynamic variables before the WS connects.
            // Apply it so we do not loop on "I didn't catch your name" when the caller already exists.
            const dv =
                callMeta.dynamic_variables ||
                callMeta.retell_llm_dynamic_variables ||
                (callMeta.metadata && callMeta.metadata.dynamic_variables);
            const knownFromCall = dv && (dv.patient_name || dv.patientName);
            if (knownFromCall && String(knownFromCall).trim()) {
                const pn = String(knownFromCall).trim();
                if (!connection.initialName) {
                    this.storeCustomerName(callId, pn);
                } else if (!connection.customerName) {
                    connection.customerName = pn;
                }
                connection.patientId = connection.patientId || dv.patient_id || dv.patientId || null;
                connection.awaitingName = false;
                console.log(`✅ Voice caller name pre-filled from call metadata: ${pn}`);
            }

            // Skincare / routine intake: Retell dynamic_variables.kelly_flow (or routine_intake_active)
            try {
                const kf = KellyOrchestratorPhase.extractKellyFlowFromRetellCall(callMeta);
                if (KellyOrchestratorPhase.kellyFlowActivatesRoutineIntake(kf)) {
                    KellyToolExecutor._setSessionMeta(callId, 'routine_intake_active', '1');
                    console.log(`✅ routine_intake_active=1 from kelly_flow / call metadata (${kf || 'flag'})`);
                }
            } catch (e) {
                console.warn('⚠️  routine_intake_active bind failed:', e.message);
            }

            // Task 52 (Decision D2): Derive appointment_id from room name (appt-{id}) for trigger_case_report
            const roomName = message.call.room_name || message.call.room || '';
            if (roomName.startsWith('appt-')) {
                connection.appointment_id = roomName.slice(5);
                console.log(`✅ Extracted appointment_id from room "${roomName}": ${connection.appointment_id}`);
            } else if (roomName) {
                console.log(`ℹ️  Room "${roomName}" does not follow appt-{id} convention — no appointment_id extracted.`);
            }

            // Keep session in sync with resolved clinic_id
            if (connection.session && connection.clinic_id && !connection.session.clinicId) {
                CallSessionService.updateSession(callId, { clinicId: connection.clinic_id });
                connection.session.clinicId = connection.clinic_id;
            }

            // Persist call state once clinic_id is available (medical coding agent)
            if (connection.clinic_id && typeof this.db.upsertCallState === 'function') {
                try {
                    this.db.upsertCallState(callId, { clinic_id: connection.clinic_id });
                } catch (e) {
                    console.warn('⚠️  Failed to upsert call state:', e.message);
                }
            }

            // If the call starts and the caller is silent, proactively greet once.
            // This avoids "connected but agent never speaks first" behavior.
            if (!connection.sentInitialGreeting) {
                this.sendInitialGreeting(callId, connection, callMeta, message.response_id);
            }
        }

        // Per-clinic rate limit (Section 17)
        const tenantKey = connection.clinic_id || callMeta?.agent_id || 'unknown';
        const rateLimit = clinicRateLimitCheck(tenantKey);
        if (!rateLimit.allowed) {
            console.warn(`⚠️  Clinic rate limit exceeded for ${tenantKey} (${rateLimit.limit}/min)`);
            if (interactionType === 'function_call') {
                const functionCall = message.function_call || message;
                this.sendToRetell(connection.ws, {
                    type: 'function_call_response',
                    function_call_id: functionCall.id || functionCall.function_call_id,
                    result: { success: false, error: 'Rate limit exceeded. Please try again shortly.' }
                });
            }
            return;
        }

        console.log(`\n📨 Message from ${callId}:`, interactionType);

        switch (interactionType) {
            case 'call_details':
                break;
            case 'update':
                // Retell sends updates about call state
                if (message.update?.transcript) {
                    await this.handleTranscript(callId, { transcript: message.update.transcript });
                }
                break;
            case 'update_only':
                break;

            case 'function_call':
                await this.handleFunctionCall(callId, message);
                break;

            case 'response':
                // Retell is responding to user
                break;

            case 'response_required':
            case 'reminder_required':
                // Some Retell versions require an explicit response trigger.
                // If no opening has been sent yet, send one now.
                if (!connection.sentInitialGreeting) {
                    this.sendInitialGreeting(callId, connection, connection.callMetadata || null, message.response_id);
                    break;
                }
                if (Array.isArray(message.transcript)) {
                    const lastUserTurn = [...message.transcript].reverse().find((t) => t?.role === 'user' && t?.content);
                    if (lastUserTurn?.content) {
                        await this.handleTranscript(callId, {
                            transcript: lastUserTurn.content,
                            response_id: message.response_id
                        });
                    } else if (interactionType === 'reminder_required') {
                        this.sendRetellResponse(connection.ws, "I'm still here - how can I help you?", message.response_id);
                    }
                }
                break;

            case 'ping_pong':
                this.sendToRetell(connection.ws, { response_type: 'ping_pong', timestamp: message.timestamp });
                break;
            case 'ping':
                // Respond to ping
                this.sendToRetell(connection.ws, { type: 'pong' });
                break;

            default:
                console.log('Unknown message type:', interactionType);
        }
    }

    // Handle user speech transcript
    async handleTranscript(callId, message) {
        const connection = this.activeConnections.get(callId);

        // VOICE_AGENT_ENABLED gate (u-4): when 0, reject voice; redirect to web chat
        const voiceAgentEnabled = process.env.VOICE_AGENT_ENABLED === '1' || process.env.VOICE_AGENT_ENABLED === 'true';
        if (!voiceAgentEnabled) {
            const baseUrl = this.config?.apiBaseUrl || process.env.BASE_URL || 'http://localhost:4000';
            const chatUrl = `${baseUrl}/unified-dashboard/patients/triage.html`;
            const rejectMsg = `Voice is currently unavailable. Please use our web chat at ${chatUrl} to book or get help.`;
            this.sendRetellResponse(connection.ws, rejectMsg, message.response_id);
            console.log(`🚫 Voice channel disabled (VOICE_AGENT_ENABLED=0): redirected caller to web chat`);
            return;
        }

        const userSaid = message.transcript;

        console.log(`🗣️  User said: "${userSaid}"`);

        // Deterministic name-first voice flow:
        // 1) Initial greeting asks for caller name
        // 2) First user turn is parsed as name, then we ask how we can help
        if (connection?.awaitingName) {
            const extractedName = this.extractLikelyName(userSaid);
            if (extractedName) {
                this.storeCustomerName(callId, extractedName);
                connection.awaitingName = false;
                const askIntent = `Thanks ${extractedName}. How can I help you today?`;
                this.sendRetellResponse(connection.ws, askIntent, message.response_id);
                connection.conversationHistory.push({
                    role: 'assistant',
                    content: askIntent,
                    timestamp: Date.now()
                });
                return;
            }
            const askNameAgain = "I didn't catch your name. Can I get your name first?";
            this.sendRetellResponse(connection.ws, askNameAgain, message.response_id);
            connection.conversationHistory.push({
                role: 'assistant',
                content: askNameAgain,
                timestamp: Date.now()
            });
            return;
        }

        // u-6: Barge-in idempotency — increment sequence; capture ours before async work
        connection._transcriptSequence = (connection._transcriptSequence || 0) + 1;
        const mySequence = connection._transcriptSequence;

        // Store in conversation history
        connection.conversationHistory.push({
            role: 'user',
            content: userSaid,
            timestamp: Date.now()
        });

        // Conversation history cap for token budget (simple turn-based limit)
        const MAX_TURNS = 20;
        if (connection.conversationHistory.length > MAX_TURNS) {
            connection.conversationHistory.splice(
                0,
                connection.conversationHistory.length - MAX_TURNS
            );
        }

        // Persist to voice_conversation_memory (medical coding agent)
        if (typeof this.db.appendConversationMemory === 'function') {
            try {
                this.db.appendConversationMemory(callId, connection?.clinic_id || null, 'user', userSaid, null);
            } catch (e) {
                console.warn('⚠️  Failed to append conversation memory:', e.message);
            }
        }

        // State machine: LangGraph when enabled, fallback to coding-state-service.
        // Production guardrail: LANGGRAPH_ROLLOUT_PCT must be 0 or 1 (enforced in services/coding-graph.js).
        const transcriptPayload = { transcript: userSaid };
        const clinicContext = { clinic_id: connection?.clinic_id || null };
        const useLangGraph = (CodingGraph.shouldUseLangGraph(callId, connection?.clinic_id) || CodingGraph.isShadowMode());

        try {
            if (useLangGraph) {
                const lgResult = await CodingGraph.processTurn(
                    this.db, callId, 'transcript', transcriptPayload, clinicContext
                );
                if (lgResult?.transition) {
                    console.log(`🔄 [${callId}] LangGraph: ${lgResult.fromStage} → ${lgResult.toStage}`);
                }
                if (!lgResult || lgResult === null) {
                    // LangGraph unavailable - fallback to old state service
                    processCodingStateTurn(this.db, callId, 'transcript', transcriptPayload, clinicContext);
                }
            } else {
                processCodingStateTurn(this.db, callId, 'transcript', transcriptPayload, clinicContext);
            }
        } catch (e) {
            console.warn('⚠️  State machine failed:', e.message);
            if (useLangGraph) {
                try {
                    processCodingStateTurn(this.db, callId, 'transcript', transcriptPayload, clinicContext);
                } catch (fb) {
                    console.warn('⚠️  Fallback state service also failed:', fb.message);
                }
            }
            if (typeof this.db.enqueueToolCallDLQ === 'function') {
                try {
                    this.db.enqueueToolCallDLQ({
                        call_id: callId,
                        clinic_id: connection?.clinic_id,
                        function_name: 'state_machine_transcript',
                        error_message: e.message
                    });
                } catch (_) {}
            }
        }

        // Kelly Agent (LLM) — K-1: Groq + tools; falls back to PatientOrchestrator when LLM unavailable
        let agentReply = null;
        let kellyResult = null;
        {
            try {
                const callerPhone = connection?.customerPhone || connection?.callMetadata?.from_number || null;
                const resolvedPatientId = connection?.patientId || null;
                const result = await KellyAgentService.processTurn({
                    message: userSaid,
                    sessionId: callId,
                    channel: 'voice',
                    clinicId: connection?.clinic_id || null,
                    patientId: resolvedPatientId,
                    callerPhone,
                    patientName: connection?.customerName || connection?.initialName || null
                });
                kellyResult = result;
                agentReply = result?.reply;
                if (result?.usedFallback) {
                    console.log(`📋 [${callId}] Kelly LLM unavailable, used orchestrator fallback`);
                }
                if (result?.endCall) {
                    if (agentReply) {
                        this.sendRetellResponse(connection.ws, agentReply, message.response_id);
                    }
                    return;
                }
            } catch (e) {
                kellyResult = { usedFallback: true };
                console.warn('⚠️  KellyAgent failed:', e.message);
                try {
                    const fb = await PatientOrchestratorService.orchestrate({
                        channel: 'voice',
                        transcript_or_message: userSaid,
                        session_id: callId,
                        caller_phone: connection?.customerPhone || connection?.callMetadata?.from_number || null,
                        patient_id: connection?.patientId || null,
                        clinic_id: connection?.clinic_id || null
                    });
                    agentReply = fb?.text || fb?.reply;
                } catch (e2) {
                    console.warn('⚠️  Orchestrator fallback also failed:', e2.message);
                }
            }
        }

        // u-8: Orchestrator-only (AgentBrain removed). Fallback when orchestrator returns nothing.
        if (!agentReply) {
            agentReply = "I didn't catch that. Could you say that again?";
        }

        if (agentReply) {
            // u-6: Skip if a newer transcript arrived while we were processing (barge-in)
            if (mySequence !== (connection._transcriptSequence || 0)) {
                console.log(`⏭️  Skipping stale reply (seq ${mySequence} < current ${connection._transcriptSequence})`);
                return;
            }

            connection.conversationHistory.push({
                role: 'assistant',
                content: agentReply,
                timestamp: Date.now()
            });

            // orch-1 + orch-4: Persist voice session (skip when fallback—orchestrator already persisted)
            try {
                // Persist voice session context even when Kelly returns a fallback/error reply.
                // Otherwise the next transcript turn may lose triage/OPQRST continuity and
                // increase the chance of additional LLM/tool retries (bad UX).
                if (this.db?.upsertOrchestrateSession) {
                    const row = this.db.getOrchestrateSessionBySessionId?.(callId);
                    let preferredLang = row?.preferred_language || 'en';
                    try {
                        const { detectLanguageFromText, detectLanguagePreferenceRequest } = require('../services/patient-orchestrator-service');
                        const langReq = detectLanguagePreferenceRequest(userSaid);
                        if (langReq?.isLanguageRequest && langReq?.code) preferredLang = langReq.code;
                        else if ((row?.turn_count ?? 0) < 2) preferredLang = detectLanguageFromText(userSaid).code || preferredLang;
                    } catch (_) {}
                    this.db.upsertOrchestrateSession({
                        session_id: callId,
                        channel: 'voice',
                        patient_id: connection?.patientId || row?.patient_id,
                        caller_phone: connection?.customerPhone || connection?.callMetadata?.from_number || row?.caller_phone,
                        clinic_id: connection?.clinic_id || row?.clinic_id,
                        preferred_language: preferredLang,
                        turn_count: (row?.turn_count ?? 0) + 1,
                        conversation_history: connection.conversationHistory,
                        flow_state: { ...(row?.flow_state || {}), initial_name: connection?.initialName }
                    });
                }
            } catch (e2) { console.warn('⚠️  orch-1/orch-4: Failed to persist voice session:', e2?.message); }

            const turnIndex = connection.conversationHistory.length;
            const session = connection.session || CallSessionService.getSession(callId) || null;

            if (this.db && typeof this.db.insertAgentTurn === 'function') {
                try {
                    this.db.insertAgentTurn({
                        call_id: callId,
                        clinic_id: connection?.clinic_id || null,
                        turn_index: turnIndex,
                        role: 'assistant',
                        text: agentReply,
                        actions_json: [],
                        prompt_profile_id: 'patient_orchestrate',
                        prompt_version: 'v1',
                        prompt_checksum: '',
                        model: 'orchestrate',
                        latency_ms: null,
                        trace_id: session?.traceId || null
                    });
                } catch (e) {
                    console.warn('⚠️  Failed to insert agent turn:', e.message);
                }
            }

            this.sendRetellResponse(connection.ws, agentReply, message.response_id);
        }
    }

    // Handle function calls from Retell LLM
    async handleFunctionCall(callId, message) {
        const connection = this.activeConnections.get(callId);
        if (!connection) return;

        const functionCall = message.function_call || message;
        const functionName = functionCall.name;
        const functionArgs = functionCall.parameters || functionCall.arguments || {};
        const startTime = Date.now();

        console.log(`\n🔧 FUNCTION CALL: ${functionName}`);
        console.log('   Args:', JSON.stringify(functionArgs, null, 2));

        // Get clinic_id from connection metadata (primary tenant identifier)
        let clinicId = connection.clinic_id || null;

        // Try to extract from function args if available
        if (!clinicId && functionArgs.clinic_id) {
            clinicId = functionArgs.clinic_id;
        }

        // Try to extract from dynamic variables in message
        if (!clinicId && message.dynamic_variables && message.dynamic_variables.clinic_id) {
            clinicId = message.dynamic_variables.clinic_id;
        }
        
        // Legacy: Also check customer_id (may be clinic_id in disguise)
        if (!clinicId && functionArgs.customer_id) {
            clinicId = functionArgs.customer_id;
            console.log(`⚠️  Using customer_id as clinic_id (legacy): ${clinicId}`);
        }

        try {
            let result;

            switch (functionName) {
                case 'collect_insurance':
                    result = await this.handleCollectInsurance(callId, functionArgs);
                    break;

                case 'schedule_appointment':
                    result = await this.handleScheduleAppointment(callId, functionArgs);
                    break;

                case 'patient_intake':
                    result = await this.handlePatientIntake(callId, functionArgs);
                    break;

                case 'get_patient_intake_status':
                    result = await this.handleGetPatientIntakeStatus(callId, functionArgs);
                    break;

                case 'get_available_slots':
                    result = await this.handleGetAvailableSlots(callId, functionArgs);
                    break;

                case 'search_appointments':
                    result = await this.handleSearchAppointments(callId, functionArgs);
                    break;

                case 'confirm_appointment':
                    result = await this.handleConfirmAppointment(callId, functionArgs);
                    break;

                case 'cancel_appointment':
                    result = await this.handleCancelAppointment(callId, functionArgs);
                    break;

                case 'reschedule_appointment':
                    result = await this.handleRescheduleAppointment(callId, functionArgs);
                    break;

                case 'create_appointment_checkout':
                    result = await this.handleCreateAppointmentCheckout(callId, functionArgs);
                    break;

                case 'verify_checkout_code':
                    result = await this.handleVerifyCheckoutCode(callId, functionArgs);
                    break;

                case 'get_product_quote':
                case 'prepare_commerce_checkout': {
                    const KellyToolExecutor = require('../services/kelly-tool-executor');
                    const patientId = connection.patientId || null;
                    const callerPhone =
                        connection.customerPhone || connection.callMetadata?.from_number || null;
                    result = await KellyToolExecutor.execute(functionName, functionArgs, {
                        sessionId: callId,
                        clinicId,
                        patientId,
                        callerPhone,
                        channel: 'voice'
                    });
                    break;
                }

                case 'verify_email_code':
                case 'verify_email_verification_code':
                    result = await this.handleEmailVerificationCode(callId, functionArgs);
                    break;

                case 'schedule_demo':
                    result = await this.handleScheduleDemo(callId, functionArgs);
                    break;

                case 'collect_contact_info':
                    result = await this.handleCollectContactInfo(callId, functionArgs);
                    break;

                case 'end_call':
                    result = await this.handleEndCall(callId, functionArgs);
                    break;

                case 'get_patient_claims':
                    result = await this.handleGetPatientClaims(callId, functionArgs);
                    break;

                case 'get_order_tracking':
                    result = await this.handleGetOrderTracking(callId, functionArgs);
                    break;

                case 'send_followup_email':
                    result = await this.handleSendFollowupEmail(callId, functionArgs);
                    break;

                case 'send_followup_sms':
                    result = await this.handleSendFollowupSMS(callId, functionArgs);
                    break;

                case 'search_products':
                    result = await this.handleSearchProducts(callId, functionArgs);
                    break;

                case 'create_checkout':
                    result = await this.handleCreateCheckout(callId, functionArgs);
                    break;
                case 'get_available_payment_methods':
                    result = await this.handleGetAvailablePaymentMethods(callId, functionArgs);
                    break;

                case 'search_icd10_codes':
                    result = await this.handleSearchIcd10Codes(callId, functionArgs);
                    break;

                case 'search_cpt_codes':
                    result = await this.handleSearchCptCodes(callId, functionArgs);
                    break;

                case 'search_hcpcs_codes':
                    result = await this.handleSearchHcpcsCodes(callId, functionArgs);
                    break;

                case 'extract_medical_text':
                    result = await this.handleExtractMedicalText(callId, functionArgs);
                    break;

                case 'assess_urgency':
                    result = await this.handleAssessUrgency(callId, functionArgs);
                    break;

                case 'suggest_codes_from_symptoms':
                    result = await this.handleSuggestCodesFromSymptoms(callId, functionArgs);
                    break;

                case 'validate_code_pair':
                    result = await this.handleValidateCodePair(callId, functionArgs);
                    break;

                case 'check_payer_guidelines':
                    result = await this.handleCheckPayerGuidelines(callId, functionArgs);
                    break;

                case 'get_code_pricing':
                    result = await this.handleGetCodePricing(callId, functionArgs);
                    break;

                case 'send_document_upload_link':
                    result = await this.handleSendDocumentUploadLink(callId, functionArgs);
                    break;

                default:
                    result = {
                        success: false,
                        error: `Unknown function: ${functionName}`
                    };
            }

            // Link voice session to patient_id when caller is identified (orch-1)
            const pid = result?.patient_id || result?.patientId || (result?.appointment?.patient_id);
            if (pid) {
                const conn = this.activeConnections.get(callId);
                if (conn) {
                    conn.patientId = pid;
                }
                try {
                    if (this.db && typeof this.db.upsertOrchestrateSession === 'function') {
                        const row = this.db.getOrchestrateSessionBySessionId?.(callId);
                        if (row) {
                            this.db.upsertOrchestrateSession({
                                session_id: callId,
                                channel: 'voice',
                                patient_id: pid,
                                caller_phone: conn?.customerPhone || conn?.callMetadata?.from_number || row.caller_phone,
                                clinic_id: conn?.clinic_id || row.clinic_id,
                                preferred_language: row?.preferred_language,
                                turn_count: row?.turn_count,
                                conversation_history: row?.conversation_history,
                                flow_state: row?.flow_state,
                                status: row?.status || 'active'
                            });
                        }
                    }
                } catch (_) {}
            }

            const responseTime = Date.now() - startTime;
            const success = result.success !== false && !result.error;

            // Latency budget (Section 3): log if over budget
            try {
                const latencyBudget = require('../config/latency-budget');
                const budget = latencyBudget.getBudget(functionName);
                if (responseTime > budget && latencyBudget.recordViolation) {
                    latencyBudget.recordViolation();
                    console.warn(`⚠️  ${functionName} over budget: ${responseTime}ms > ${budget}ms`);
                }
            } catch (_) { /* ignore */ }

            // State machine: single path - LangGraph when enabled, fallback to coding-state-service
            const fnPayload = { function_name: functionName, result };
            const fnClinicContext = { clinic_id: clinicId };
            const useLangGraphFn = CodingGraph.shouldUseLangGraph(callId, clinicId) || CodingGraph.isShadowMode();
            try {
                if (useLangGraphFn) {
                    const lgResult = await CodingGraph.processTurn(
                        this.db, callId, 'function_call', fnPayload, fnClinicContext
                    );
                    if (lgResult?.transition) {
                        console.log(`🔄 [${callId}] LangGraph: ${lgResult.fromStage} → ${lgResult.toStage}`);
                    }
                    if (!lgResult || lgResult === null) {
                        processCodingStateTurn(this.db, callId, 'function_call', fnPayload, fnClinicContext);
                    }
                } else {
                    processCodingStateTurn(this.db, callId, 'function_call', fnPayload, fnClinicContext);
                }
            } catch (e) {
                console.warn('⚠️  State machine (function_call) failed:', e.message);
                if (useLangGraphFn) {
                    try {
                        processCodingStateTurn(this.db, callId, 'function_call', fnPayload, fnClinicContext);
                    } catch (_) {}
                }
            }

            // Snapshot function results for coding tools (debug/audit)
            if (['search_icd10_codes', 'search_cpt_codes', 'search_hcpcs_codes', 'suggest_codes_from_symptoms'].includes(functionName) && typeof this.db.saveAgentStateSnapshot === 'function') {
                try {
                    this.db.saveAgentStateSnapshot(callId, `function_${functionName}`, {
                        args: functionArgs,
                        result,
                        response_time_ms: responseTime
                    });
                } catch (e) {
                    console.warn('⚠️  Failed to save function snapshot:', e.message);
                }
            }

            // Log function call to database
            // NOTE: Using clinic_id as customer_id for database (schema limitation)
            await this.db.logFunctionCall({
                id: `func-${require('crypto').randomBytes(16).toString('hex')}`,
                customer_id: clinicId, // Using clinic_id as customer_id (database schema limitation)
                call_id: callId,
                function_name: functionName,
                parameters: functionArgs,
                response_time_ms: responseTime,
                success: success,
                error_message: result.error || null
            });

            console.log(`✅ Function result:`, JSON.stringify(result, null, 2));

            // Send function result back to Retell
            this.sendToRetell(connection.ws, {
                type: 'function_call_response',
                function_call_id: functionCall.id || functionCall.function_call_id,
                result: result
            });

        } catch (error) {
            const responseTime = Date.now() - startTime;

            // DLQ for failed tool calls (Section 2)
            if (typeof this.db.enqueueToolCallDLQ === 'function') {
                try {
                    this.db.enqueueToolCallDLQ({
                        call_id: callId,
                        clinic_id: clinicId,
                        function_name: functionName,
                        parameters: functionArgs,
                        error_message: error.message
                    });
                } catch (dlqErr) {
                    console.warn('⚠️  Failed to enqueue tool call to DLQ:', dlqErr.message);
                }
            }

            // Log error
            // NOTE: Using clinic_id as customer_id for database (schema limitation)
            this.db.logError({
                id: `error-${require('crypto').randomBytes(16).toString('hex')}`,
                customer_id: clinicId, // Using clinic_id as customer_id (database schema limitation)
                error_type: 'FunctionCallError',
                error_message: error.message,
                stack_trace: error.stack,
                request_id: callId,
                endpoint: `function:${functionName}`,
                context: JSON.stringify({ function_name: functionName, call_id: callId }),
                severity: 'high'
            });

            // Log failed function call
            await this.db.logFunctionCall({
                id: `func-${require('crypto').randomBytes(16).toString('hex')}`,
                customer_id: clinicId, // Using clinic_id as customer_id (database schema limitation)
                call_id: callId,
                function_name: functionName,
                parameters: functionArgs,
                response_time_ms: responseTime,
                success: false,
                error_message: error.message
            });

            console.error(`❌ Function call error (${functionName}):`, error);
            this.sendToRetell(connection.ws, {
                type: 'function_call_response',
                function_call_id: functionCall.id || functionCall.function_call_id,
                result: {
                    success: false,
                    error: error.message
                }
            });
        }
    }

    // Handle search_products function call
    async handleSearchProducts(callId, functionArgs) {
        const query = functionArgs.query || functionArgs.search_query;
        if (!query) {
            return {
                success: false,
                error: 'Query parameter is required for product search'
            };
        }

        const connection = this.activeConnections.get(callId);
        if (!connection) {
            return {
                success: false,
                error: 'Connection not found'
            };
        }

        try {
            console.log(`🔍 Searching products: ${query}`);

            // Resolve merchant_id from dynamic variables first (from Retell call setup), then function args, then clinic
            let merchantId = null;
            
            // Priority 1: Check dynamic variables (set during call registration)
            // Retell sends dynamic variables as "dynamic_variables" in the call message
            if (connection.callMetadata) {
                // Check all possible locations (Retell may use different keys)
                const dynamicVars = connection.callMetadata.dynamic_variables || 
                                   connection.callMetadata.retell_llm_dynamic_variables ||
                                   (connection.callMetadata.metadata && connection.callMetadata.metadata.dynamic_variables);
                
                // Debug logging
                console.log(`🔍 Checking dynamic variables for merchant_id...`);
                console.log(`   callMetadata exists: ${!!connection.callMetadata}`);
                console.log(`   dynamic_variables: ${!!connection.callMetadata.dynamic_variables}`);
                console.log(`   retell_llm_dynamic_variables: ${!!connection.callMetadata.retell_llm_dynamic_variables}`);
                console.log(`   metadata.dynamic_variables: ${!!(connection.callMetadata.metadata && connection.callMetadata.metadata.dynamic_variables)}`);
                if (dynamicVars) {
                    console.log(`   Found dynamicVars: ${JSON.stringify(dynamicVars)}`);
                }
                
                if (dynamicVars && dynamicVars.merchant_id) {
                    // CRITICAL: Validate that the merchant_id exists before using it
                    const merchant = this.db.getMerchant(dynamicVars.merchant_id);
                    if (merchant) {
                    merchantId = dynamicVars.merchant_id;
                    console.log(`✅ Using merchant_id from dynamic variables: ${merchantId}`);
                    } else {
                        console.warn(`⚠️  REJECTED invalid merchant_id from dynamic variables: ${dynamicVars.merchant_id} (not found in database)`);
                        console.warn(`   This is likely a hardcoded wrong merchant_id. Ignoring it.`);
                        // Don't use it - continue to next priority
                    }
                } else {
                    console.warn(`⚠️  Dynamic variables found but no merchant_id: ${JSON.stringify(dynamicVars)}`);
                }
            } else {
                console.warn(`⚠️  No callMetadata found in connection`);
            }
            
            // Priority 2: Use function args (but ONLY if they're valid - reject wrong merchant_id)
            if (!merchantId && functionArgs.merchant_id) {
                // CRITICAL: Validate that the merchant_id exists before using it
                const merchant = this.db.getMerchant(functionArgs.merchant_id);
                if (merchant) {
                    merchantId = functionArgs.merchant_id;
                    console.log(`✅ Using merchant_id from function args: ${merchantId}`);
                } else {
                    console.warn(`⚠️  REJECTED invalid merchant_id from function args: ${functionArgs.merchant_id} (not found in database)`);
                    console.warn(`   This is likely the hardcoded wrong merchant_id. Ignoring it.`);
                    // Don't use it - continue to next priority
                }
            }
            
            // Priority 3: Fallback to clinic_id resolution
            if (!merchantId && connection.clinic_id) {
                const clinic = await this.db.getClinicById(connection.clinic_id);
                if (clinic && clinic.merchant_id) {
                    merchantId = clinic.merchant_id;
                    console.log(`✅ Using merchant_id from clinic: ${merchantId}`);
                }
            }
            
            // Priority 4: ALWAYS use default tenant (akin-dunbar) as final fallback
            // This ensures the agent ALWAYS connects to akin-dunbar
            if (!merchantId) {
                const constants = require('../utils/constants');
                const defaultSubdomain = constants.TENANTS.DEFAULT_SUBDOMAIN || 'akin-dunbar';
                const defaultMerchant = this.db.getMerchantBySubdomain(defaultSubdomain);
                if (defaultMerchant) {
                    merchantId = defaultMerchant.id;
                    console.log(`✅ Using default tenant merchant (${defaultSubdomain}): ${merchantId}`);
                    console.log(`   This ensures the agent always connects to ${defaultSubdomain}`);
                } else {
                    console.error(`❌ CRITICAL: Default tenant (${defaultSubdomain}) not found in database!`);
                    console.error(`   Product search will fail. Please check database configuration.`);
                }
            }
            
            // Final validation - merchant_id should NEVER be null at this point
            if (!merchantId) {
                console.error(`❌ CRITICAL: No merchant_id resolved after all fallbacks!`);
                console.error(`   This should never happen. Product search will fail.`);
            } else {
                console.log(`✅ Final merchant_id resolved: ${merchantId}`);
            }

            // Call your middleware API
            const apiBaseUrl = this.config.apiBaseUrl || 'http://localhost:4000';
            const response = await axios.post(`${apiBaseUrl}/voice/products/search`, {
                merchant_id: merchantId, // Use resolved merchant_id, should never be null now
                query: query
            });

            const products = response.data.products || [];

            // Store search results
            connection.lastSearchResults = products;

            return {
                success: true,
                products: products,
                total: products.length,
                query: query
            };

        } catch (error) {
            console.error('❌ Product search error:', error);
            return {
                success: false,
                error: error.response?.data?.error || error.message || 'Failed to search products'
            };
        }
    }

    // Handle product search (legacy - kept for backward compatibility)
    async handleProductSearch(callId, query) {
        const connection = this.activeConnections.get(callId);

        try {
            console.log(`🔍 Searching products: ${query}`);

            // Resolve merchant_id from clinic_id
            let merchantId = null;
            if (connection.clinic_id) {
                const clinic = await this.db.getClinicById(connection.clinic_id);
                if (clinic && clinic.merchant_id) {
                    merchantId = clinic.merchant_id;
                }
            }
            if (!merchantId) {
                console.warn(`⚠️  No merchant_id found for clinic ${connection.clinic_id || 'unknown'}. Product search may fail.`);
            }

            // Call your middleware API
            const apiBaseUrl = this.config.apiBaseUrl || 'http://localhost:4000';
            const response = await axios.post(`${apiBaseUrl}/voice/products/search`, {
                merchant_id: merchantId, // Use resolved merchant_id, null if not found
                query: query
            });

            const products = response.data.products;

            if (products.length === 0) {
                this.sendRetellResponse(connection.ws, `I couldn't find any products matching "${query}". Would you like to browse our other products?`);
                return;
            }

            // Format product list for voice with stock levels
            const productList = products.slice(0, 3).map((p, i) => {
                const productName = p.title || p.name || 'Product';
                const price = p.price || '0.00';
                const inventory = p.inventory || 0;
                const stockStatus = inventory > 0 ? `In stock (${inventory} available)` : 'Out of stock';
                return `${i + 1}. ${productName} - $${price}. ${stockStatus}`;
            }).join('. ');

            const response_text = products.length === 1 && products[0]
                ? (() => {
                    const product = products[0];
                    const productName = product.title || product.name || 'a product';
                    const price = product.price || '0.00';
                    const description = product.description || '';
                    const inventory = product.inventory || 0;
                    const stockStatus = inventory > 0 ? `In stock (${inventory} available)` : 'Out of stock';
                    return `I found ${productName} - $${price}. ${description}. ${stockStatus}. Would you like to purchase this?`;
                })()
                : `I found ${products.length} products: ${productList}. Which one interests you?`;

            this.sendRetellResponse(connection.ws, response_text);

            // Store search results
            connection.lastSearchResults = products;

        } catch (error) {
            console.error('❌ Product search error:', error);
            this.sendRetellResponse(connection.ws, "Sorry, I'm having trouble searching products right now. Please try again.");
        }
    }

    // Handle search_icd10_codes - real-time ICD-10 lookup during voice calls
    async handleSearchIcd10Codes(callId, functionArgs) {
        const query = functionArgs.query || '';
        const limit = Math.min(20, Math.max(1, parseInt(functionArgs.limit, 10) || 10));
        if (!query || !query.trim()) {
            return { success: false, error: 'Query is required for ICD-10 search', codes: [] };
        }
        try {
            const knowledgeService = require('../services/knowledge-service');
            const codes = knowledgeService.searchIcd10Codes(query.trim(), limit);
            return {
                success: true,
                codes: codes.map(c => ({ code: c.code, description: c.description, category: c.category })),
                count: codes.length
            };
        } catch (error) {
            console.error('search_icd10_codes error:', error);
            return { success: false, error: error.message, codes: [] };
        }
    }

    // Handle search_cpt_codes - real-time CPT lookup during voice calls
    async handleSearchCptCodes(callId, functionArgs) {
        const query = functionArgs.query || '';
        const limit = Math.min(20, Math.max(1, parseInt(functionArgs.limit, 10) || 10));
        if (!query || !query.trim()) {
            return { success: false, error: 'Query is required for CPT search', codes: [] };
        }
        try {
            const db = require('../database');
            const codes = db.searchCptCodes(query.trim(), limit);
            return {
                success: true,
                codes: codes.map(c => ({ code: c.code, description: c.description, category: c.category })),
                count: codes.length
            };
        } catch (error) {
            console.error('search_cpt_codes error:', error);
            return { success: false, error: error.message, codes: [] };
        }
    }

    // Handle search_hcpcs_codes - real-time HCPCS lookup (DME, supplies, modifiers)
    async handleSearchHcpcsCodes(callId, functionArgs) {
        const query = functionArgs.query || '';
        const limit = Math.min(20, Math.max(1, parseInt(functionArgs.limit, 10) || 10));
        if (!query || !query.trim()) {
            return { success: false, error: 'Query is required for HCPCS search', codes: [] };
        }
        try {
            const knowledgeService = require('../services/knowledge-service');
            const codes = knowledgeService.searchHcpcsCodes(query.trim(), limit);
            return {
                success: true,
                codes: codes.map(c => ({
                    code: c.code,
                    description: c.description,
                    short_desc: c.short_desc,
                    type: c.type
                })),
                count: codes.length
            };
        } catch (error) {
            console.error('search_hcpcs_codes error:', error);
            return { success: false, error: error.message, codes: [] };
        }
    }

    // Handle extract_medical_text - structured extraction from patient utterance
    async handleExtractMedicalText(callId, functionArgs) {
        const text = functionArgs.patient_utterance || functionArgs.utterance || functionArgs.text || '';
        if (!text || !text.trim()) {
            return { success: false, error: 'patient_utterance is required', symptoms: [], vitals: {}, severity: null };
        }
        try {
            const extractionService = require('../services/medical-text-extraction-service');
            const data = extractionService.extractStructuredData(text.trim());
            const temporal = { ...(data.temporal || {}) };
            if (data.severity?.temporal) temporal.acuteness = data.severity.temporal;
            return {
                success: true,
                symptoms: data.symptoms || [],
                vitals: data.vitals || {},
                severity: data.severity?.severity || null,
                temporal
            };
        } catch (error) {
            console.error('extract_medical_text error:', error);
            return { success: false, error: error.message, symptoms: [], vitals: {}, severity: null };
        }
    }

    // Handle assess_urgency - red-flag detection for emergency triage
    async handleAssessUrgency(callId, functionArgs) {
        const text = functionArgs.symptoms_text || functionArgs.symptoms || '';
        if (!text || !text.trim()) {
            return { success: false, error: 'symptoms_text is required', urgency: 'ROUTINE' };
        }
        try {
            const assessment = detectRedFlags(text.trim());
            return {
                success: true,
                urgency: assessment.urgency,
                isEmergency: assessment.isEmergency,
                redFlags: assessment.redFlags,
                suggestedResponse: assessment.suggestedResponse
            };
        } catch (error) {
            console.error('assess_urgency error:', error);
            return { success: false, error: error.message, urgency: 'ROUTINE' };
        }
    }

    // Handle suggest_codes_from_symptoms - proactive code suggestion from patient description
    async handleSuggestCodesFromSymptoms(callId, functionArgs) {
        const clinicalText = functionArgs.clinical_text || functionArgs.symptoms || '';
        const maxIcd10 = Math.min(10, Math.max(1, parseInt(functionArgs.max_icd10, 10) || 5));
        const maxCpt = Math.min(10, Math.max(1, parseInt(functionArgs.max_cpt, 10) || 5));
        if (!clinicalText || !clinicalText.trim()) {
            return { success: false, error: 'clinical_text is required', icd10: [], cpt: [] };
        }
        try {
            const knowledgeService = require('../services/knowledge-service');
            const conn = this.activeConnections?.get(callId);
            const clinicId = conn?.clinic_id || null;

            // Token budget check (Section 10) - voice defaults keyword-only; semantic adds embed latency
            let useSemantic = false;
            const tokenBudget = require('../utils/token-budget');
            const estimatedTokens = Math.ceil(clinicalText.length / 4) + 2000;
            if (tokenBudget.canProceed(callId, estimatedTokens)) {
                const featureFlags = require('../utils/feature-flags');
                if (featureFlags.isEnabled('semantic_search_enabled', clinicId, callId)) {
                    useSemantic = true;
                }
            } else {
                console.warn(`⚠️  Token budget exceeded for call ${callId}, suggest_codes using keyword-only`);
            }

            // Use perceptual_state from graph when available (Layer 2 - findings-based RAG)
            let perceptualState = null;
            const callState = typeof this.db.getCallState === 'function' ? this.db.getCallState(callId) : null;
            if (callState?.state_data?.perceptual_state) {
                perceptualState = callState.state_data.perceptual_state;
            }

            const remoteTimeoutMs = parseInt(process.env.REMOTE_RAG_TIMEOUT_MS || '2000', 10);
            const result = await knowledgeService.getCodeCandidatesDualSource(clinicalText.trim(), {
                maxIcd10,
                maxCpt,
                maxHcpcs: 3,
                clinicId,
                callId,
                perceptualState,
                useSemantic,
                remoteTimeoutMs
            });
            if (result.remote_knowledge?.metadata) {
                console.log('[suggest_codes] remote', result.remote_knowledge.metadata);
            }

            // Track tokens used (embedding + retrieval estimate)
            tokenBudget.addTokens(callId, Math.ceil(clinicalText.length / 4) + 500);

            const simplifyForPatient = (desc) => {
                if (!desc) return '';
                return desc
                    .replace(/\s*,\s*[^,]+$/, '')
                    .replace(/\s*\([^)]*\)/g, '')
                    .trim()
                    .slice(0, 80);
            };
            let icd10List = (result.icd10 || []).slice(0, maxIcd10);
            let cptList = (result.cpt || []).slice(0, maxCpt);

            // Mandatory validation: filter out codes not in KB (Section 6)
            const validation = knowledgeService.validateCodesExist({
                icd10: icd10List.map(c => c.code).filter(Boolean),
                cpt: cptList.map(c => c.code).filter(Boolean)
            });
            if (!validation.valid) {
                icd10List = icd10List.filter(c => !validation.invalid.icd10.includes(c.code));
                cptList = cptList.filter(c => !validation.invalid.cpt.includes(c.code));
            }

            // Check if any suggested code has low confidence (Section 5)
            const minConfidence = 0.6;
            const hasLowConfidence = [...icd10List, ...cptList].some(
                c => (c.confidence ?? 0.8) < minConfidence
            );

            // Validate primary ICD-10 + CPT pairs (top 3×3) for agent to present confidently
            const validatedPairs = [];
            const maxPairs = 9;
            for (const icd of icd10List.slice(0, 3)) {
                for (const cpt of cptList.slice(0, 3)) {
                    if (validatedPairs.length >= maxPairs) break;
                    const pairCheck = knowledgeService.validateCodePair(icd.code, cpt.code);
                    validatedPairs.push({
                        icd10_code: icd.code,
                        cpt_code: cpt.code,
                        valid: pairCheck.valid,
                        reason: pairCheck.reason || null
                    });
                }
            }
            return {
                success: true,
                icd10: icd10List.map(c => ({
                    code: c.code,
                    description: c.description,
                    patient_friendly: simplifyForPatient(c.description)
                })),
                cpt: cptList.map(c => ({
                    code: c.code,
                    description: c.description,
                    patient_friendly: simplifyForPatient(c.description)
                })),
                validated_pairs: validatedPairs,
                needs_review: hasLowConfidence
            };
        } catch (error) {
            console.error('suggest_codes_from_symptoms error:', error);
            return { success: false, error: error.message, icd10: [], cpt: [] };
        }
    }

    // Handle validate_code_pair - ICD-10 + CPT compatibility check
    async handleValidateCodePair(callId, functionArgs) {
        const icd10 = functionArgs.icd10_code || functionArgs.icd10 || '';
        const cpt = functionArgs.cpt_code || functionArgs.cpt || '';
        if (!icd10 || !cpt) {
            return { success: false, error: 'icd10_code and cpt_code are required', valid: false };
        }
        try {
            const knowledgeService = require('../services/knowledge-service');
            const db = this.db || require('../database');

            // 1. Code existence check
            const icdExists = db.codeExists?.(icd10, 'icd10');
            const cptExists = db.codeExists?.(cpt, 'cpt');
            if (!icdExists || !cptExists) {
                const result = {
                    success: true,
                    valid: false,
                    reason: !icdExists ? `ICD-10 code ${icd10} not found in knowledge base` : `CPT code ${cpt} not found in knowledge base`,
                    codesExist: { icd10: icdExists, cpt: cptExists }
                };
                if (typeof db.insertCodingDecision === 'function') {
                    const conn = this.activeConnections?.get(callId);
                    const hist = db.getConversationHistory?.(callId, 1);
                    db.insertCodingDecision({
                        call_id: callId,
                        clinic_id: conn?.clinic_id || null,
                        clinical_note: hist?.[0]?.role === 'user' ? hist[0].content : null,
                        proposed_icd10: icd10,
                        proposed_cpt: cpt,
                        validation_status: 'invalid',
                        validation_reason: result.reason,
                        rule_version: knowledgeService.getRuleVersionForDate?.(new Date()),
                        rule_hash: knowledgeService.getRuleHash?.()
                    });
                }
                return result;
            }

            // 2. Pair compatibility check
            const pairCheck = knowledgeService.validateCodePair(icd10, cpt);
            const result = {
                success: true,
                valid: pairCheck.valid,
                reason: pairCheck.reason,
                icd10_code: icd10,
                cpt_code: cpt
            };

            // 3. Log coding decision for audit (Phase 5.2)
            if (typeof db.insertCodingDecision === 'function') {
                const conn = this.activeConnections?.get(callId);
                const hist = db.getConversationHistory?.(callId, 1);
                db.insertCodingDecision({
                    call_id: callId,
                    clinic_id: conn?.clinic_id || null,
                    clinical_note: hist?.[0]?.role === 'user' ? hist[0].content : null,
                    proposed_icd10: icd10,
                    proposed_cpt: cpt,
                    validation_status: pairCheck.valid ? 'valid' : 'invalid',
                    validation_reason: pairCheck.reason || null,
                    rule_version: knowledgeService.getRuleVersionForDate?.(new Date()),
                    rule_hash: knowledgeService.getRuleHash?.()
                });
            }

            return result;
        } catch (error) {
            console.error('validate_code_pair error:', error);
            return { success: false, error: error.message, valid: false };
        }
    }

    // Handle check_payer_guidelines - check if payer has fee schedule
    async handleCheckPayerGuidelines(callId, functionArgs) {
        const payerId = functionArgs.payer_id || functionArgs.payerId || functionArgs.payer_name || '';
        if (!payerId) {
            return { success: false, error: 'payer_id is required', has_guidelines: false };
        }
        try {
            const FeeScheduleService = require('../services/fee-schedule-service');
            const hasGuidelines = FeeScheduleService.hasFeeScheduleForPayer(String(payerId).trim());
            return {
                success: true,
                payer_id: String(payerId).trim().toUpperCase(),
                has_guidelines: hasGuidelines,
                message: hasGuidelines ? 'Fee schedule available for this payer' : 'No fee schedule on file; pricing may be estimated'
            };
        } catch (error) {
            console.error('check_payer_guidelines error:', error);
            return { success: false, error: error.message, has_guidelines: false };
        }
    }

    // Handle get_code_pricing - get allowed amounts for CPT codes
    async handleGetCodePricing(callId, functionArgs) {
        const payerId = functionArgs.payer_id || functionArgs.payerId || '';
        let cptCodes = functionArgs.cpt_codes || functionArgs.cptCodes || [];
        const dateOfService = functionArgs.date_of_service || functionArgs.dateOfService || null;
        if (!payerId) {
            return { success: false, error: 'payer_id is required', pricing: {} };
        }
        if (!Array.isArray(cptCodes)) {
            cptCodes = [String(cptCodes)];
        }
        if (cptCodes.length === 0) {
            return { success: false, error: 'cpt_codes is required', pricing: {} };
        }
        try {
            const FeeScheduleService = require('../services/fee-schedule-service');
            const pricing = FeeScheduleService.getAllowedAmountsForCodes(
                String(payerId).trim().toUpperCase(),
                cptCodes.map(c => String(c).trim()),
                dateOfService
            );
            return {
                success: true,
                payer_id: String(payerId).trim().toUpperCase(),
                pricing,
                message: Object.keys(pricing).length > 0 ? 'Pricing from fee schedule' : 'No fee schedule rates found for these codes'
            };
        } catch (error) {
            console.error('get_code_pricing error:', error);
            return { success: false, error: error.message, pricing: {} };
        }
    }

    // Telemedicine Phase 3 — Task 23: send_document_upload_link (voice tool)
    async handleSendDocumentUploadLink(callId, functionArgs) {
        const baseUrl = this.config.apiBaseUrl || 'http://localhost:4000';
        const payload = {};
        if (functionArgs.patient_id) payload.patient_id = functionArgs.patient_id;
        if (functionArgs.patient_email) payload.patient_email = functionArgs.patient_email;
        if (functionArgs.patient_phone) payload.patient_phone = functionArgs.patient_phone;
        if (functionArgs.appointment_id) payload.appointment_id = functionArgs.appointment_id;
        if (!payload.patient_id && !payload.patient_email && !payload.patient_phone) {
            return {
                success: false,
                error: 'Provide patient_email or patient_phone (or patient_id) to send the upload link.',
                voice_agent_instruction: "Ask the caller for their email address so we can send them a secure link to upload their documents."
            };
        }
        try {
            const res = await axios.post(`${baseUrl}/api/patient/send-upload-link`, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            });
            const data = res.data || {};
            if (data.sent && data.success) {
                return {
                    success: true,
                    sent: true,
                    channel: data.channel || 'email',
                    expires_at: data.expires_at,
                    voice_agent_instruction: "I've sent a secure link to the email we have on file. You can use it to upload your lab results or any photos before your visit."
                };
            }
            return {
                success: false,
                error: data.error || 'Failed to send link',
                voice_agent_instruction: "I wasn't able to send the link right now — please ask the clinic to send it directly."
            };
        } catch (err) {
            const msg = err.response?.data?.error || err.message;
            return {
                success: false,
                error: msg,
                voice_agent_instruction: "I wasn't able to send the link right now — please ask the clinic to send it directly."
            };
        }
    }

    // Handle create_checkout function call
    async handleCreateCheckout(callId, functionArgs) {
        console.log('\n🔍 DEBUG: handleCreateCheckout START');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📞 Call ID: ${callId}`);
        console.log(`📋 Function Args (RAW):`, JSON.stringify(functionArgs, null, 2));
        console.log(`📋 Function Args Keys:`, Object.keys(functionArgs || {}));
        
        const connection = this.activeConnections.get(callId);
        if (!connection) {
            console.error('❌ Connection not found for callId:', callId);
            return {
                success: false,
                error: 'Connection not found'
            };
        }
        console.log(`✅ Connection found for callId: ${callId}`);

        // CRITICAL: Extract and store email from function arguments OR connection state
        console.log('\n🔍 STEP 1: Extract email from function args');
        let customerEmail = functionArgs.customer_email || functionArgs.email;
        console.log(`   functionArgs.customer_email: ${functionArgs.customer_email || 'NOT FOUND'}`);
        console.log(`   functionArgs.email: ${functionArgs.email || 'NOT FOUND'}`);
        console.log(`   Extracted email: ${customerEmail || 'NOT FOUND'}`);
        
        // FALLBACK: If not in function args, try to get from connection state (where it might have been stored earlier)
        if (!customerEmail) {
            console.log('\n🔍 STEP 2: Email not in function args, checking connection state');
            const connectionEmail = this.getCustomerEmail(callId);
            console.log(`   connection.customerEmail: ${connectionEmail || 'NOT FOUND'}`);
            customerEmail = connectionEmail;
            console.log(`   Final email from connection: ${customerEmail || 'NOT FOUND'}`);
        }
        
        // Store email in connection for future use
        if (customerEmail) {
            connection.customerEmail = customerEmail;
            console.log(`✅ Stored customer email in connection: ${customerEmail}`);
        } else {
            console.error('❌ NO EMAIL FOUND IN FUNCTION ARGS OR CONNECTION STATE');
        }

        // Extract other required parameters
        const productId = functionArgs.product_id;
        const quantity = functionArgs.quantity || 1;
        const customerName = functionArgs.customer_name || this.getCustomerName(callId) || 'Customer';
        const customerPhone = functionArgs.customer_phone || this.getCustomerPhone(callId);

        if (!productId) {
            return {
                success: false,
                error: 'product_id is required'
            };
        }

        if (!customerEmail) {
            console.error('\n❌ DEBUG: NO EMAIL - Returning error to agent');
            console.error('   This means agent must ask for email again');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return {
                success: false,
                error: 'customer_email is required. Please provide your email address.',
                requires_email: true,
                voice_agent_instruction: 'Ask the caller for their email address, then retry create_checkout with customer_email included.'
            };
        }

        try {
            console.log('\n🔍 STEP 3: Email found, proceeding with checkout');
            console.log(`💳 Creating checkout via function call: ${productId}`);
            console.log(`📧 Email being sent: ${customerEmail}`);
            console.log(`📋 Full function args:`, JSON.stringify(functionArgs, null, 2));

            // Resolve merchant ID from clinic_id, function args, or dynamic variables
            let merchantId = functionArgs.merchant_id;
            
            // Try dynamic variables first (from Retell call setup)
            // Retell sends dynamic variables as "dynamic_variables" in the call message
            if (!merchantId && connection.callMetadata) {
                const dynamicVars = connection.callMetadata.dynamic_variables || 
                                   connection.callMetadata.retell_llm_dynamic_variables ||
                                   (connection.callMetadata.metadata && connection.callMetadata.metadata.dynamic_variables);
                if (dynamicVars && dynamicVars.merchant_id) {
                    // CRITICAL: Validate that the merchant_id exists before using it
                    const merchant = this.db.getMerchant(dynamicVars.merchant_id);
                    if (merchant) {
                    merchantId = dynamicVars.merchant_id;
                        console.log(`✅ Using merchant_id from dynamic variables: ${merchantId}`);
                    } else {
                        console.warn(`⚠️  REJECTED invalid merchant_id from dynamic variables: ${dynamicVars.merchant_id} (not found in database)`);
                        // Don't use it - continue to next priority
                    }
                }
            }
            
            // Fallback to clinic_id resolution
            if (!merchantId && connection.clinic_id) {
                const clinic = await this.db.getClinicById(connection.clinic_id);
                if (clinic && clinic.merchant_id) {
                    merchantId = clinic.merchant_id;
                }
            }
            
            if (!merchantId) {
                console.warn(`⚠️  No merchant_id found for clinic ${connection.clinic_id || 'unknown'}. Checkout may fail.`);
            }
            
            const apiBaseUrl = this.config.apiBaseUrl || 'http://localhost:4000';

            // Create checkout request payload (payment_method for Mastercard Agent Pay / Stripe / link)
            const checkoutPayload = {
                merchant_id: merchantId,
                product_id: productId,
                customer_name: customerName,
                customer_phone: customerPhone,
                customer_email: customerEmail,
                quantity: quantity,
                payment_method: functionArgs.payment_method || 'link',
                mandate_id: functionArgs.mandate_id || null
            };
            
            console.log(`📤 Sending checkout request:`, JSON.stringify({
                ...checkoutPayload,
                customer_email: customerEmail ? `${customerEmail.substring(0, 3)}***` : 'MISSING'
            }, null, 2));

            // Create checkout
            const response = await axios.post(`${apiBaseUrl}/voice/checkout/create`, checkoutPayload);

            if (response.data.success) {
                const checkout = response.data;
                console.log(`✅ Checkout created: ${checkout.checkout_id}`);
                
                return {
                    success: true,
                    checkout_id: checkout.checkout_id,
                    payment_token: checkout.payment_token,
                    amount: checkout.amount,
                    product_name: checkout.product_name || checkout.product?.name,
                    message: `Checkout created successfully. Payment link will be sent to ${customerEmail} after verification.`
                };
            } else if (response.data.requires_verification) {
                return {
                    success: false,
                    requires_verification: true,
                    error: 'Email verification required',
                    message: `A verification code has been sent to ${customerEmail}. Please verify your email to complete checkout.`
                };
            } else {
                return {
                    success: false,
                    error: response.data.error || 'Checkout creation failed'
                };
            }

        } catch (error) {
            console.error('\n❌ Create checkout error:', error);
            console.error('   Error type:', error.constructor.name);
            console.error('   Error message:', error.message);
            
            // Handle axios errors specifically
            if (error.response) {
                console.error('   Response status:', error.response.status);
                console.error('   Response data type:', typeof error.response.data);
                console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
                
                // Extract error message from response
                let errorMessage = 'Failed to create checkout';
                
                // Handle different response formats
                if (Array.isArray(error.response.data)) {
                    // If response is an array, extract the first error object or message
                    console.error('   ⚠️  Response is an array - extracting error message');
                    const firstItem = error.response.data[0];
                    if (typeof firstItem === 'object' && firstItem.error) {
                        errorMessage = firstItem.error;
                    } else if (typeof firstItem === 'string') {
                        errorMessage = firstItem;
                    } else {
                        errorMessage = error.response.data.find(item => typeof item === 'string') || errorMessage;
                    }
                } else if (typeof error.response.data === 'object' && error.response.data.error) {
                    errorMessage = error.response.data.error;
                } else if (typeof error.response.data === 'string') {
                    errorMessage = error.response.data;
                }
                
                return {
                    success: false,
                    error: errorMessage,
                    requires_email: error.response.data?.requires_email || false
                };
            }
            
            return {
                success: false,
                error: error.message || 'Failed to create checkout'
            };
        }
    }

    // Handle get_available_payment_methods (4.2)
    async handleGetAvailablePaymentMethods(callId, functionArgs) {
        try {
            const PaymentMethodConfig = require('../services/payment-method-config');
            const conn = this.activeConnections?.get(callId);
            const merchantId = functionArgs?.merchant_id || conn?.merchant_id || null;
            const { methods, details } = PaymentMethodConfig.getAvailablePaymentMethods(merchantId);

            const labels = { link: 'payment link (email)', stripe: 'card (Stripe)', mastercard: 'Mastercard voice pay', visa: 'Visa voice pay' };
            const available = methods.map(m => labels[m] || m);

            return {
                success: true,
                payment_methods: methods,
                available_options: available,
                message: available.length > 0
                    ? `You can pay via: ${available.join(', ')}.`
                    : 'Payment link will be sent to your email.',
                details: details
            };
        } catch (error) {
            console.error('get_available_payment_methods error:', error);
            return { success: false, error: error.message, payment_methods: ['link'] };
        }
    }

    // Handle purchase intent
    async handlePurchaseIntent(callId, productInfo) {
        const connection = this.activeConnections.get(callId);

        // Extract customer info from call
        const customerPhone = this.getCustomerPhone(callId);
        const customerName = this.getCustomerName(callId) || 'Customer';
        const customerEmail = this.getCustomerEmail(callId);

        try {
            console.log(`💳 Creating checkout for: ${productInfo.product_id}`);

            // Resolve merchant ID from clinic_id or dynamic variables
            let merchantId = null;
            
            // Try dynamic variables first (from Retell call setup)
            // Retell sends dynamic variables as "dynamic_variables" in the call message
            if (connection.callMetadata) {
                const dynamicVars = connection.callMetadata.dynamic_variables || 
                                   connection.callMetadata.retell_llm_dynamic_variables ||
                                   (connection.callMetadata.metadata && connection.callMetadata.metadata.dynamic_variables);
                if (dynamicVars && dynamicVars.merchant_id) {
                    // CRITICAL: Validate that the merchant_id exists before using it
                    const merchant = this.db.getMerchant(dynamicVars.merchant_id);
                    if (merchant) {
                    merchantId = dynamicVars.merchant_id;
                        console.log(`✅ Using merchant_id from dynamic variables: ${merchantId}`);
                    } else {
                        console.warn(`⚠️  REJECTED invalid merchant_id from dynamic variables: ${dynamicVars.merchant_id} (not found in database)`);
                        // Don't use it - continue to next priority
                    }
                }
            }
            
            // Fallback to clinic_id resolution
            if (!merchantId && connection.clinic_id) {
                const clinic = await this.db.getClinicById(connection.clinic_id);
                if (clinic && clinic.merchant_id) {
                    merchantId = clinic.merchant_id;
                }
            }
            
            if (!merchantId) {
                console.warn(`⚠️  No merchant_id found for clinic ${connection.clinic_id || 'unknown'}. Checkout may fail.`);
            }
            
            const apiBaseUrl = this.config.apiBaseUrl || 'http://localhost:4000';

            // Check if email verification is required
            if (!customerEmail) {
                this.sendRetellResponse(connection.ws, "I need your email address to complete your purchase. Could you please provide your email address?");
                return;
            }

            // Check verification status
            const verificationStatus = await axios.get(`${apiBaseUrl}/voice/verify/status/${encodeURIComponent(customerEmail)}`);
            
            if (!verificationStatus.data.verified) {
                // Send verification code
                console.log(`📧 Sending verification code to: ${customerEmail}`);
                const sendCodeResponse = await axios.post(`${apiBaseUrl}/voice/verify/send-code`, {
                    email: customerEmail,
                    customer_id: connection.clinic_id, // Using clinic_id as customer_id (legacy support)
                    customer_name: customerName
                });

                if (sendCodeResponse.data.success) {
                    this.sendRetellResponse(connection.ws, `I've sent a verification code to ${customerEmail}. Please check your email and provide me with the 6-digit code to verify your account before completing your purchase.`);
                    // Store that we're waiting for verification
                    connection.pendingVerification = {
                        email: customerEmail,
                        productInfo: productInfo,
                        merchantId: merchantId
                    };
                    return;
                } else {
                    throw new Error('Failed to send verification code');
                }
            }

            // Email is verified, proceed with checkout
            const response = await axios.post(`${apiBaseUrl}/voice/checkout/create`, {
                merchant_id: merchantId,
                product_id: productInfo.product_id,
                customer_name: customerName,
                customer_phone: customerPhone,
                customer_email: customerEmail,
                quantity: 1
            });

            if (response.data.success) {
                const checkout = response.data;

                this.sendRetellResponse(connection.ws, `Perfect! I've sent a payment link to your email at ${customerEmail}. The total is $${checkout.amount}. You can complete your purchase using that link. Is there anything else I can help you with?`);

                console.log(`✅ Checkout created: ${checkout.checkout_id}`);
                console.log(`📧 Payment link sent to: ${customerEmail}`);
            } else if (response.data.requires_verification) {
                // Should not happen if we checked above, but handle it anyway
                this.sendRetellResponse(connection.ws, `I need to verify your email before completing your purchase. I've sent a verification code to ${customerEmail}. Please check your email and provide me with the 6-digit code.`);
                connection.pendingVerification = {
                    email: customerEmail,
                    productInfo: productInfo,
                    merchantId: merchantId
                };
            } else {
                throw new Error(response.data.error || 'Checkout creation failed');
            }

        } catch (error) {
            console.error('❌ Purchase error:', error);
            const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
            this.sendRetellResponse(connection.ws, `I'm sorry, I'm having trouble processing that order: ${errorMessage}. Please try again or call us for assistance.`);
        }
    }

    // Handle email verification code (from function call)
    async handleEmailVerificationCode(callId, functionArgs) {
        const email = functionArgs.email || functionArgs.customer_email;
        const code = functionArgs.code || functionArgs.verification_code;

        if (!email || !code) {
            return {
                success: false,
                error: 'Email and verification code are required'
            };
        }

        // Store email in connection for future use
        const connection = this.activeConnections.get(callId);
        if (connection) {
            connection.customerEmail = email;
        }

        await this.handleEmailVerification(callId, email, code);

        return {
            success: true,
            message: 'Email verification processed'
        };
    }

    // Handle email verification code (internal)
    async handleEmailVerification(callId, email, code) {
        const connection = this.activeConnections.get(callId);
        if (!connection) return;

        try {
            const apiBaseUrl = this.config.apiBaseUrl || 'http://localhost:4000';
            const verifyResponse = await axios.post(`${apiBaseUrl}/voice/verify/verify-code`, {
                email: email,
                code: code
            });

            if (verifyResponse.data.success) {
                // If there's a pending checkout, complete it
                if (connection.pendingVerification) {
                    const { productInfo, merchantId } = connection.pendingVerification;
                    const customerPhone = this.getCustomerPhone(callId);
                    const customerName = this.getCustomerName(callId) || 'Customer';

                    this.sendRetellResponse(connection.ws, "Great! Your email is verified. Let me complete your purchase now.");

                    // Proceed with checkout
                    await this.handlePurchaseIntent(callId, productInfo);
                    delete connection.pendingVerification;
                } else {
                    this.sendRetellResponse(connection.ws, "Perfect! Your email has been verified. How can I help you today?");
                }
            } else {
                this.sendRetellResponse(connection.ws, `I'm sorry, that verification code is incorrect or has expired. ${verifyResponse.data.error || 'Please request a new code.'}`);
            }
        } catch (error) {
            console.error('❌ Verification error:', error);
            this.sendRetellResponse(connection.ws, "I'm sorry, I'm having trouble verifying your code. Please try again.");
        }
    }

    // Handle end of call
    async handleEndOfCall(callId, message) {
        const connection = this.activeConnections.get(callId);
        if (!connection) return;

        const duration = Math.floor((Date.now() - connection.startTime) / 1000);
        console.log(`\n📊 CALL SUMMARY`);
        console.log(`   Duration: ${duration}s`);
        console.log(`   Messages: ${connection.conversationHistory.length}`);

        // Store call record in database
        try {
            this.db.prepare(`
                INSERT INTO call_logs (
                    call_id,
                    customer_phone,
                    duration_seconds,
                    conversation_data,
                    created_at
                ) VALUES (?, ?, ?, ?, ?)
            `).run(
                callId,
                this.getCustomerPhone(callId),
                duration,
                JSON.stringify(connection.conversationHistory),
                new Date().toISOString()
            );
        } catch (error) {
            console.error('Error storing call log:', error);
        }

        this.activeConnections.delete(callId);
    }

    // Simple intent detection
    detectIntent(text) {
        const lowerText = text.toLowerCase();

        // Purchase intent
        if (lowerText.match(/\b(buy|purchase|order|get)\b/)) {
            return { type: 'purchase', query: text };
        }

        // Search intent
        if (lowerText.match(/\b(find|search|looking for|need|want)\b/)) {
            return { type: 'search_product', query: text };
        }

        return { type: 'general', query: text };
    }

    // Helper: Send message to Retell
    sendToRetell(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    // Helper: send initial websocket readiness/config to Retell (Custom LLM protocol)
    sendInitialHandshake(callId, connection) {
        if (!connection?.ws || connection.ws.readyState !== WebSocket.OPEN) return;
        const opening = "Hi, my name is Kelly. I'm LittleLabs' voice assistant. Can I start by getting your name?";
        // Enable optional protocol features up front so Retell can stream richer events.
        this.sendToRetell(connection.ws, {
            response_type: 'config',
            config: {
                auto_reconnect: true,
                call_details: true,
                transcript_with_tool_calls: true
            }
        });
        // Per Retell docs, send an initial response event to establish readiness.
        // Non-empty content makes agent initiate conversation immediately.
        this.sendToRetell(connection.ws, {
            response_type: 'response',
            response_id: 0,
            content: opening,
            content_complete: true
        });
        connection.sentInitialGreeting = true;
        connection.conversationHistory.push({
            role: 'assistant',
            content: opening,
            timestamp: Date.now()
        });
        console.log(`🤝 Sent Retell WS handshake/config for ${callId}`);
        console.log(`👋 Sent initial greeting (handshake) for call ${callId}`);
    }

    extractLikelyName(transcript) {
        let t = String(transcript || '').trim();
        if (!t) return null;
        t = t.replace(/[\s.?!,;:]+$/u, '').trim();
        if (!t) return null;

        const fillerWord = /^(the|a|an|uh|um|er|like|so)$/iu;
        const nameWord = (w) => /^[\p{L}'-]{2,}$/u.test(w);

        const explicitPatterns = [
            /\bmy\s+name\s+is\s+(.+)$/iu,
            /\bthis\s+is\s+(.+)$/iu,
            /\b(i['']m|i\s+am)\s+(.+)$/iu,
            /\bcall\s+me\s+(.+)$/iu
        ];
        for (const re of explicitPatterns) {
            const m = t.match(re);
            if (!m) continue;
            const raw = (m[2] !== undefined ? m[2] : m[1] || '').trim();
            const namePart = raw.replace(/[\s.?!,;:]+$/u, '').trim();
            const words = namePart.split(/\s+/).filter(Boolean).slice(0, 4);
            const good = words.filter((w) => !fillerWord.test(w));
            if (good.length === 0) continue;
            if (good.every(nameWord)) return good.join(' ');
        }

        const compact = t.replace(/[^\p{L}' -]/gu, ' ').trim();
        if (!compact) return null;
        const stripped = compact.replace(/^(my\s+name\s+is|this\s+is|i\s+am|i'?m|call\s+me)\s+/iu, '');
        let words = stripped.split(/\s+/).filter(Boolean);
        const greetingLead = /^(hi|hello|hey|yes|no|ok|okay|thanks|thank|please|sir|ma'?am)$/iu;
        if (words.length === 1 && greetingLead.test(words[0])) return null;
        if (words.length > 1 && greetingLead.test(words[0])) {
            words = words.slice(1);
        }
        words = words.filter((x) => !fillerWord.test(x));
        if (words.length >= 1 && words.length <= 3 && words.every(nameWord)) {
            return words.join(' ');
        }
        return null;
    }

    // Helper: send assistant speech in Retell Custom LLM format
    sendRetellResponse(ws, content, responseId) {
        if (!content) return;
        const safeResponseId = (responseId === undefined || responseId === null) ? 0 : responseId;
        this.sendToRetell(ws, {
            response_type: 'response',
            response_id: safeResponseId,
            content,
            content_complete: true
        });
    }

    // Helper: build and send one-time initial greeting
    sendInitialGreeting(callId, connection, callMeta, responseId = null) {
        if (!connection || connection.sentInitialGreeting) return;
        const isOutboundSales = callMeta?.metadata?.call_type === 'sales_outbound';
        const patientName = callMeta?.dynamic_variables?.patient_name || connection.customerName || null;
        const opening = isOutboundSales
            ? "Hi, this is Alex from DocLittle. Is now still a good time to talk?"
            : (patientName
                ? `Hi ${patientName}, this is Kelly from DocLittle. How can I help you today?`
                : 'Hi, this is Kelly from DocLittle. How can I help you today?');

        this.sendRetellResponse(connection.ws, opening, responseId);
        connection.sentInitialGreeting = true;
        connection.conversationHistory.push({
            role: 'assistant',
            content: opening,
            timestamp: Date.now()
        });
        console.log(`👋 Sent initial greeting for call ${callId}`);
    }

    // Helper: Extract call ID from request
    extractCallId(req) {
        return req.headers['x-retell-call-id'] ||
            req.url.split('/').pop() ||
            `call_${Date.now()}`;
    }

    // Helper: Get customer phone from Retell call
    // CRITICAL: Always returns normalized phone number with +1 for US customers
    getCustomerPhone(callId) {
        const connection = this.activeConnections.get(callId);
        const phone = connection?.customerPhone || connection?.callMetadata?.from_number || null;
        
        // Normalize phone number if it exists (ensures +1 prefix for US numbers)
        if (phone) {
            const SMSService = require('../services/sms-service');
            return SMSService.formatPhoneNumber(phone);
        }
        
        return null;
    }

    // Helper: Get customer name
    getCustomerName(callId) {
        const connection = this.activeConnections.get(callId);
        return connection?.customerName || connection?.initialName || null;
    }

    // Helper: Get customer email
    getCustomerEmail(callId) {
        const connection = this.activeConnections.get(callId);
        return connection?.customerEmail || null;
    }

    // Helper: Store customer name (called when name is first provided). V-3: Also persist to DB.
    storeCustomerName(callId, name) {
        const connection = this.activeConnections.get(callId);
        if (connection && name && !connection.initialName) {
            connection.initialName = name.trim();
            connection.customerName = name.trim();
            connection.nameProvidedAt = Date.now();
            console.log(`✅ Stored initial customer name: ${connection.initialName} (callId: ${callId})`);
            try {
                const row = this.db?.getOrchestrateSessionBySessionId?.(callId);
                const existingState = row?.flow_state || {};
                if (this.db?.upsertOrchestrateSession) {
                    this.db.upsertOrchestrateSession({
                        session_id: callId,
                        channel: 'voice',
                        patient_id: row?.patient_id || connection?.patientId || null,
                        caller_phone: row?.caller_phone || connection?.customerPhone || null,
                        clinic_id: row?.clinic_id || connection?.clinic_id || null,
                        conversation_history: row?.conversation_history || connection?.conversationHistory || [],
                        flow_state: { ...existingState, initial_name: name.trim() }
                    });
                }
            } catch (e) { console.warn('⚠️  Could not persist initial_name:', e?.message); }
        }
    }

    // Helper: Get initial name for fraud validation
    getInitialName(callId) {
        const connection = this.activeConnections.get(callId);
        return connection?.initialName || null;
    }

    getClinicId(callId) {
        const connection = this.activeConnections.get(callId);
        if (!connection) {
            return this._resolveFallbackClinicId();
        }

        if (connection.clinic_id) {
            return connection.clinic_id;
        }

        const metadataClinic =
            connection.callMetadata?.metadata?.clinic_id ||
            connection.callMetadata?.metadata?.customer_id ||
            connection.callMetadata?.dynamic_variables?.clinic_id ||
            connection.callMetadata?.dynamic_variables?.customer_id ||
            null;

        if (metadataClinic) return metadataClinic;

        // Task 6: Fallback when Retell doesn't provide clinic_id
        return this._resolveFallbackClinicId();
    }

    _resolveFallbackClinicId() {
        const envId = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID;
        if (envId) {
            console.warn(`⚠️  Using fallback clinic_id from env: ${envId}`);
            return envId;
        }
        // S-1: Do NOT use arbitrary clinic - cross-tenant leak. Return null.
        return null;
    }

    // ==========================================
    // HEALTHCARE FUNCTION HANDLERS
    // ==========================================

    // Handle collect_insurance function
    async handleCollectInsurance(callId, args) {
        try {
            // Get the initial name stored when caller first identified themselves
            const connection = this.activeConnections.get(callId);
            const initialName = connection?.initialName || null;

            // Pass callId and initialName for fraud validation
            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/insurance/collect`, {
                patient_name: args.patient_name,
                member_id: args.member_id,
                payer_name: args.payer_name,
                payer_id: args.payer_id,
                patient_phone: args.patient_phone 
                    ? SMSService.formatPhoneNumber(args.patient_phone) 
                    : this.getCustomerPhone(callId),
                patient_email: args.patient_email,
                service_code: args.service_code,
                call_id: callId, // Pass callId for fraud validation
                initial_name: initialName // Pass initial name for validation
            });

            return response.data;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle schedule_appointment function
    async handleScheduleAppointment(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);

            // SAFETY: Red-flag check before scheduling (orch-9, V-2: ensure voice history available).
            // Defense-in-depth: runs in addition to DB triage guardrails on /voice/appointments/schedule
            // when session_id is passed (conversation-based emergency vs triage_sessions state).
            const providerOverrideEmergency = args.provider_override_emergency === true || args.provider_override_emergency === 'true';
            if (!providerOverrideEmergency) {
                let recentTurns = [];
                const orchRow = this.db?.getOrchestrateSessionBySessionId?.(callId);
                if (orchRow?.conversation_history) {
                    const hist = typeof orchRow.conversation_history === 'string'
                        ? JSON.parse(orchRow.conversation_history) : orchRow.conversation_history;
                    recentTurns = (Array.isArray(hist) ? hist : []).slice(-10);
                }
                if (recentTurns.length === 0 && typeof this.db?.getConversationHistory === 'function') {
                    recentTurns = this.db.getConversationHistory(callId, 10);
                }
                // V-2: Merge in-memory transcript so we don't miss unpersisted turns
                const connHist = connection?.conversationHistory || [];
                for (const t of connHist.slice(-5)) {
                    if (t?.content && t?.role === 'user') recentTurns.push({ role: 'user', content: t.content });
                }
                const { blockScheduling, assessment } = checkBeforeScheduling(recentTurns.map(t => ({
                    role: t.role,
                    content: t.content || t.content_english
                })));
                if (blockScheduling && assessment?.isEmergency) {
                    console.warn(`🚨 EMERGENCY: Blocked scheduling - red flags detected: ${assessment.redFlags?.join(', ')}`);

                    // Phase 1 safety: persist cross-channel emergency flag (24h)
                    try {
                        const phone = this.getCustomerPhone(callId);
                        const email = this.getCustomerEmail(callId);
                        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                        if (this.db && typeof this.db.upsertPatientEmergencyFlag === 'function') {
                            this.db.upsertPatientEmergencyFlag({
                                phone: phone || null,
                                email: email || null,
                                source: 'voice',
                                call_id: callId,
                                expires_at: expiresAt,
                                metadata: { red_flags: assessment.redFlags || [], urgency: assessment.urgency || 'EMERGENT' }
                            });
                        }
                    } catch (e) {
                        console.warn('⚠️  upsertPatientEmergencyFlag failed:', e?.message || e);
                    }

                    return {
                        success: false,
                        blockScheduling: true,
                        isEmergency: true,
                        urgency: 'EMERGENT',
                        message: assessment.suggestedResponse,
                        voice_agent_instruction: `CRITICAL: Do NOT schedule an appointment. The caller has described emergency symptoms. You MUST say: "${assessment.suggestedResponse}" and advise them to call 911 or go to the ER immediately. If a provider confirms this is a false positive, retry with provider_override_emergency=true.`
                    };
                }
            } else if (providerOverrideEmergency) {
                console.warn(`⚠️  Provider override: EMERGENT booking block bypassed for schedule_appointment`);
            }

            // Store the initial name when first provided (for fraud detection). V-3: use storeCustomerName to persist to DB.
            if (connection && args.patient_name) {
                this.storeCustomerName(callId, args.patient_name);
            }

            // CRITICAL: Validate email is provided (REQUIRED for confirmations)
            if (!args.patient_email || !args.patient_email.trim()) {
                console.warn(`⚠️  schedule_appointment called without email (callId: ${callId})`);
                return {
                    success: false,
                    requiresEmail: true,
                    error: 'Email address is required to schedule an appointment. Email is needed to send confirmation and payment information.',
                    message: 'To complete your appointment booking, I need your email address to send you a confirmation. What is your email address?',
                    voice_agent_instruction: 'Ask the caller for their email address. Do NOT proceed with booking until email is collected. After collecting email, retry schedule_appointment with the email included.'
                };
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(args.patient_email.trim())) {
                return {
                    success: false,
                    requiresEmail: true,
                    error: 'Invalid email format. Please provide a valid email address.',
                    message: 'That email address doesn\'t look quite right. Could you please provide your email address again?',
                    voice_agent_instruction: 'Ask the caller to provide their email address again. Make sure it includes @ and a domain (e.g., name@example.com).'
                };
            }

            // Ensure phone number is provided (required for duplicate detection)
            // CRITICAL: Normalize phone number to +1 format for US customers
            let patientPhone = args.patient_phone || this.getCustomerPhone(callId);
            
            // Normalize phone number if provided (auto-adds +1 for US numbers)
            if (patientPhone) {
                patientPhone = SMSService.formatPhoneNumber(patientPhone);
            }
            
            if (!patientPhone) {
                return {
                    success: false,
                    requiresPhone: true,
                    error: 'Phone number is required to schedule an appointment. Each patient must have a unique phone number.',
                    message: 'To schedule your appointment, I need your phone number to verify your identity. Can you please provide your phone number?'
                };
            }

            const clinicId = this.getClinicId(callId);
            if (!clinicId) {
                console.warn(`⚠️  Missing clinic_id for schedule_appointment (callId: ${callId})`);
                return {
                    success: false,
                    error: 'Missing clinic context. Unable to schedule appointment without clinic_id.'
                };
            }

            console.log(`📋 Scheduling appointment for ${args.patient_name} (${args.patient_email}) on ${args.date} at ${args.time} [clinic: ${clinicId}]`);

            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/appointments/schedule`, {
                patient_name: args.patient_name,
                patient_phone: patientPhone,
                patient_email: args.patient_email.trim(),
                appointment_type: args.appointment_type,
                date: args.date,
                time: args.time,
                timezone: args.timezone || 'America/New_York',
                notes: args.notes,
                clinic_id: clinicId,
                visit_mode: args.visit_mode || 'sync_video',
                session_id: callId,
                metadata: { session_id: callId }
            });

            // If duplicate was detected, return the duplicate response
            if (response.data.duplicate && response.data.requiresPhoneConfirmation) {
                console.log(`🚨 Duplicate patient detected for "${args.patient_name}" - phone confirmation required`);
                return {
                    success: false,
                    duplicate: true,
                    requiresPhoneConfirmation: true,
                    error: response.data.message || 'Duplicate patient found. Please confirm your phone number.',
                    duplicates: response.data.duplicates || [],
                    provided_name: response.data.provided_name,
                    provided_phone: response.data.provided_phone,
                    message: response.data.message || `I found a patient with a similar name in our system. To verify your identity, please confirm your phone number.`,
                    voice_agent_instruction: response.data.voice_agent_instruction || 'Ask the caller to confirm their phone number. If it matches, proceed with scheduling. If not, ask them to verify their information.'
                };
            }

            // Log successful appointment creation
            if (response.data.success && response.data.appointment) {
                console.log(`✅ Appointment successfully created: ${response.data.appointment.id} (Confirmation: ${response.data.appointment.confirmation_number})`);
                if (connection && !connection._onboardingStartAt) {
                    connection._onboardingStartAt = Date.now();
                }
            } else if (!response.data.success) {
                console.warn(`⚠️  Appointment scheduling failed: ${response.data.error || 'Unknown error'}`);
            }

            return response.data;
        } catch (error) {
            // Handle axios errors
            if (error.response && error.response.data) {
                // If backend returned duplicate error, return it
                if (error.response.data.duplicate && error.response.data.requiresPhoneConfirmation) {
                    return error.response.data;
                }
                const st = error.response.status;
                const d = error.response.data;
                if (st === 403 && d && (d.error_code || d.error)) {
                    return {
                        success: false,
                        error: d.error || d.message,
                        error_code: d.error_code || d.error,
                        message: d.message || d.error
                    };
                }
                return {
                    success: false,
                    error: d.error || d.message || error.message
                };
            }

            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle patient_intake function (DOB + country/city onboarding)
    async handlePatientIntake(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);
            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/patient/intake`, {
                patient_id: args.patient_id,
                patient_email: args.patient_email,
                patient_phone: args.patient_phone,
                first_name: args.first_name,
                last_name: args.last_name,
                dob: args.dob,
                country: args.country,
                city: args.city,
                city_place_id: args.city_place_id
            });
            const data = response.data || {};
            if (connection && connection._onboardingStartAt && data && data.success) {
                data.onboarding_ms = Date.now() - connection._onboardingStartAt;
            }
            return data;
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || error.message,
                message: error.response?.data?.message || "I couldn’t save that; let’s try again."
            };
        }
    }

    // Check which onboarding fields are missing (DOB/country/city)
    async handleGetPatientIntakeStatus(callId, args) {
        try {
            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/patient/intake/status`, {
                patient_id: args.patient_id,
                patient_email: args.patient_email,
                patient_phone: args.patient_phone
            });
            return response.data;
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || error.message
            };
        }
    }

    // Handle get_available_slots function
    // W3-S5.4: Pass call_id for session context (detected_language, patient state)
    async handleGetAvailableSlots(callId, args) {
        try {
            const clinicId = this.getClinicId(callId);
            if (!clinicId) {
                return {
                    success: false,
                    error: 'Missing clinic context for availability check.'
                };
            }

            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/appointments/available-slots`, {
                date: args.date,
                appointment_type: args.appointment_type,
                provider: args.provider || null,
                practitioner_id: args.practitioner_id || null,
                timezone: args.timezone || 'America/New_York',
                clinic_id: clinicId,
                call_id: callId,
                session_id: callId,
                metadata: { session_id: callId }
            });

            return response.data;
        } catch (error) {
            if (error.response && error.response.data) {
                const d = error.response.data;
                const st = error.response.status;
                if (st === 403 && d && (d.error_code || d.error)) {
                    return {
                        success: false,
                        error: d.error || d.message,
                        error_code: d.error_code || d.error,
                        message: d.message || d.error
                    };
                }
                return {
                    success: false,
                    error: d.error || d.message || error.message
                };
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle search_appointments function
    async handleSearchAppointments(callId, args) {
        try {
            const clinicId = this.getClinicId(callId);
            if (!clinicId) {
                return {
                    success: false,
                    error: 'Missing clinic context for appointment search.'
                };
            }

            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/appointments/search`, {
                search_term: args.search_term,
                clinic_id: clinicId
            });

            return response.data;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle confirm_appointment function
    async handleConfirmAppointment(callId, args) {
        try {
            const clinicId = this.getClinicId(callId);
            if (!clinicId) {
                return {
                    success: false,
                    error: 'Missing clinic context for confirmation.'
                };
            }

            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/appointments/confirm`, {
                appointment_id: args.appointment_id,
                clinic_id: clinicId
            });

            return response.data;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle cancel_appointment function
    async handleCancelAppointment(callId, args) {
        try {
            const clinicId = this.getClinicId(callId);
            if (!clinicId) {
                return {
                    success: false,
                    error: 'Missing clinic context for cancellation.'
                };
            }

            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/appointments/cancel`, {
                appointment_id: args.appointment_id,
                reason: args.reason,
                clinic_id: clinicId
            });

            return response.data;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle reschedule_appointment function
    async handleRescheduleAppointment(callId, args) {
        try {
            const clinicId = this.getClinicId(callId);
            if (!clinicId) {
                return {
                    success: false,
                    error: 'Missing clinic context for rescheduling.'
                };
            }

            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/appointments/reschedule`, {
                appointment_id: args.appointment_id,
                new_date: args.new_date,
                new_time: args.new_time,
                reason: args.reason,
                timezone: args.timezone || 'America/New_York',
                clinic_id: clinicId,
                session_id: callId,
                metadata: { session_id: callId }
            });

            return response.data;
        } catch (error) {
            if (error.response && error.response.data) {
                const d = error.response.data;
                if (error.response.status === 400 && d.error_code === 'SESSION_ID_REQUIRED') {
                    return {
                        success: false,
                        error: d.error || d.message,
                        error_code: d.error_code
                    };
                }
                return {
                    success: false,
                    error: d.error || d.message || error.message
                };
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle create_appointment_checkout function
    async handleCreateAppointmentCheckout(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);
            const clinicId = this.getClinicId(callId);
            if (!clinicId) {
                return {
                    success: false,
                    error: 'Missing clinic context for creating checkout.'
                };
            }

            const customerPhoneRaw = args.customer_phone || this.getCustomerPhone(callId);
            const customerPhone = customerPhoneRaw ? SMSService.formatPhoneNumber(customerPhoneRaw) : null;
            const patientPhoneRaw = args.patient_phone || args.customer_phone || this.getCustomerPhone(callId);
            const patientPhone = patientPhoneRaw ? SMSService.formatPhoneNumber(patientPhoneRaw) : null;

            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/appointments/checkout`, {
                appointment_id: args.appointment_id,
                customer_name: args.customer_name,
                customer_email: args.customer_email,
                customer_phone: customerPhone,
                // A4/A10: mirror patient_* fields for a single payload contract.
                patient_name: args.patient_name || args.customer_name,
                patient_email: args.patient_email || args.customer_email,
                patient_phone: patientPhone,
                appointment_type: args.appointment_type,
                amount: args.amount,
                clinic_id: clinicId,
                payment_method: args.payment_method || 'link',
                mandate_id: args.mandate_id || null,
                session_id: callId,
                call_id: callId,
                metadata: { session_id: callId }
            });

            if (response?.data?.payment_token && connection) {
                connection.lastPaymentToken = response.data.payment_token;
                connection.lastCheckoutId = response.data.checkout_id || null;
            }

            return response.data;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle verify_checkout_code function
    async handleVerifyCheckoutCode(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);
            const clinicId = this.getClinicId(callId);
            let paymentToken = args.payment_token;
            if (!paymentToken && connection?.lastPaymentToken) {
                paymentToken = connection.lastPaymentToken;
            }
            if (!paymentToken && connection?.lastCheckoutId && this.db?.getVoiceCheckout) {
                const row = this.db.getVoiceCheckout(connection.lastCheckoutId);
                paymentToken = row?.payment_token || null;
            }
            if (!paymentToken) {
                return {
                    success: false,
                    error: 'Missing payment token. Please resend checkout code first.',
                    error_code: 'MISSING_TOKEN',
                    voice_agent_instruction: 'If payment_token is missing, re-run create_appointment_checkout to resend verification, then retry verify_checkout_code.'
                };
            }
            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/checkout/verify`, {
                payment_token: paymentToken,
                verification_code: args.verification_code,
                clinic_id: clinicId,
                session_id: callId,
                call_id: callId,
                metadata: { session_id: callId }
            });

            return response.data;
        } catch (error) {
            return {
                success: false,
                error: error.message || error.response?.data?.error || 'Verification failed',
                voice_agent_instruction: 'Ask the caller to re-read the 6-digit code from their email and retry verify_checkout_code. If they do not have the code, offer to resend it.'
            };
        }
    }

    // Handle get_patient_claims function
    async handleGetOrderTracking(callId, args) {
        try {
            console.log(`📦 Getting order tracking for call ${callId}`);
            
            const apiBaseUrl = this.config.apiBaseUrl || 'http://localhost:4000';
            
            // Call the voice tracking endpoint
            // CRITICAL: Normalize phone number to +1 format for US customers
            const response = await axios.post(`${apiBaseUrl}/voice/orders/tracking`, {
                order_id: args.order_id,
                customer_email: args.customer_email,
                customer_phone: args.customer_phone ? SMSService.formatPhoneNumber(args.customer_phone) : null
            });

            if (!response.data.success) {
                return {
                    success: false,
                    error: response.data.error || 'Failed to get tracking information'
                };
            }

            // Return formatted result for voice agent
            return {
                success: true,
                found: response.data.found,
                message: response.data.message,
                delivery_status: response.data.delivery_status,
                driver_name: response.data.driver_name,
                driver_phone: response.data.driver_phone,
                estimated_arrival: response.data.estimated_arrival,
                current_location: response.data.current_location
            };
        } catch (error) {
            console.error('❌ Error getting order tracking:', error.message);
            return {
                success: false,
                error: error.response?.data?.error || error.message || 'Failed to get tracking information'
            };
        }
    }

    async handleGetPatientClaims(callId, args) {
        try {
            // Get the initial name stored when caller first identified themselves
            const connection = this.activeConnections.get(callId);
            const initialName = connection?.initialName || null;

            // First collect insurance to get patient_id (with fraud validation)
            const insuranceResponse = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/insurance/collect`, {
                patient_name: args.patient_name,
                member_id: args.member_id,
                payer_name: args.payer_name,
                call_id: callId, // Pass callId for fraud validation
                initial_name: initialName // Pass initial name for validation
            });

            if (!insuranceResponse.data.success || !insuranceResponse.data.patient_id) {
                return {
                    success: false,
                    error: 'Could not find patient with provided insurance information'
                };
            }

            // Get patient benefits/claims
            const claimsResponse = await axios.get(`${this.config.apiBaseUrl || 'http://localhost:4000'}/api/patient/benefits`, {
                params: {
                    patient_id: insuranceResponse.data.patient_id
                }
            });

            return claimsResponse.data;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle schedule_demo function (for sales agent)
    async handleScheduleDemo(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);
            const leadId = connection?.callMetadata?.lead_id || args.lead_id;

            console.log(`📅 Scheduling demo for ${args.clinic_name} (${args.contact_email}) on ${args.preferred_date} at ${args.preferred_time}`);

            // Create demo record in database (you may want to create a demos table)
            // For now, we'll update the lead with demo information
            if (leadId) {
                try {
                    const currentLead = this.db.db.prepare('SELECT notes FROM leads WHERE id = ?').get(leadId);
                    const newNotes = (currentLead?.notes || '') + '\nDemo scheduled: ' + args.preferred_date + ' at ' + args.preferred_time + ' (' + args.contact_name + ')';

                    this.db.db.prepare(`
                        UPDATE leads 
                        SET pipeline_stage = 'demo_scheduled',
                            status = 'demo_scheduled',
                            notes = ?,
                            follow_up_date = ?,
                            next_action = 'Demo scheduled',
                            updated_at = datetime('now')
                        WHERE id = ?
                    `).run(
                        newNotes,
                        args.preferred_date,
                        leadId
                    );
                    console.log(`✅ Updated lead ${leadId} with demo information`);
                } catch (dbError) {
                    console.warn('⚠️  Could not update lead:', dbError.message);
                }
            }

            // In a real implementation, you might want to:
            // 1. Send calendar invite via email
            // 2. Create a calendar event
            // 3. Send confirmation SMS

            return {
                success: true,
                message: `Demo scheduled successfully for ${args.preferred_date} at ${args.preferred_time}`,
                demo_date: args.preferred_date,
                demo_time: args.preferred_time,
                contact_email: args.contact_email,
                confirmation: `Great! I've scheduled your demo for ${args.preferred_date} at ${args.preferred_time}. You'll receive a confirmation email at ${args.contact_email} shortly. Looking forward to showing you how DocLittle can help ${args.clinic_name}!`
            };
        } catch (error) {
            console.error('❌ Error scheduling demo:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle collect_contact_info function (for sales agent)
    async handleCollectContactInfo(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);
            const leadId = connection?.callMetadata?.lead_id || args.lead_id;

            console.log(`📝 Collecting contact info for ${args.clinic_name}: ${args.contact_name} (${args.contact_email})`);

            // Update lead with contact information
            if (leadId) {
                try {
                    const updates = {};
                    if (args.contact_email) {
                        updates.clinic_email = args.contact_email;
                    }
                    if (args.contact_phone) {
                        updates.clinic_phone = args.contact_phone;
                    }
                    if (args.interest_level) {
                        updates.lead_score = args.interest_level === 'high' ? 90 :
                            args.interest_level === 'medium' ? 60 :
                                args.interest_level === 'low' ? 30 : 10;
                        updates.priority = args.interest_level === 'high' ? 1 :
                            args.interest_level === 'medium' ? 5 : 10;
                    }
                    if (Object.keys(updates).length > 0) {
                        // Get current notes first if we need to append
                        if (args.notes) {
                            const currentLead = this.db.db.prepare('SELECT notes FROM leads WHERE id = ?').get(leadId);
                            updates.notes = (currentLead?.notes || '') + '\n' + args.notes;
                        }
                        this.db.updateLead(leadId, updates);
                        console.log(`✅ Updated lead ${leadId} with contact information`);
                    }
                } catch (dbError) {
                    console.warn('⚠️  Could not update lead:', dbError.message);
                }
            }

            return {
                success: true,
                message: 'Contact information collected successfully',
                contact_name: args.contact_name,
                contact_email: args.contact_email,
                contact_phone: args.contact_phone,
                interest_level: args.interest_level
            };
        } catch (error) {
            console.error('❌ Error collecting contact info:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Handle end_call function (K-2: clarify usage).
     * PATIENT AGENT: Used by Kelly to gracefully end a patient call (e.g. after scheduling).
     * SALES AGENT: Used to update lead pipeline stage and close the call.
     * Both agents register this; the connection's callMetadata.agent_type distinguishes them.
     */
    async handleEndCall(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);
            const leadId = connection?.callMetadata?.lead_id;

            console.log(`📴 Ending call: ${args.reason || 'completed'}`);

            // Update lead based on call outcome
            if (leadId) {
                try {
                    const updates = {};
                    if (args.reason === 'demo_scheduled') {
                        updates.pipeline_stage = 'demo_scheduled';
                        updates.status = 'demo_scheduled';
                    } else if (args.reason === 'not_interested') {
                        updates.pipeline_stage = 'closed_lost';
                        updates.status = 'not_interested';
                    } else if (args.reason === 'callback_requested') {
                        updates.pipeline_stage = 'contacted';
                        updates.status = 'callback_requested';
                    }

                    if (args.outcome) {
                        const currentLead = this.db.db.prepare('SELECT notes FROM leads WHERE id = ?').get(leadId);
                        updates.notes = (currentLead?.notes || '') + '\nCall outcome: ' + args.outcome;
                    }

                    if (Object.keys(updates).length > 0) {
                        this.db.updateLead(leadId, updates);
                    }
                } catch (dbError) {
                    console.warn('⚠️  Could not update lead:', dbError.message);
                }
            }

            // Close the WebSocket connection
            if (connection && connection.ws) {
                connection.ws.close();
            }

            return {
                success: true,
                message: 'Call ended successfully',
                reason: args.reason
            };
        } catch (error) {
            console.error('❌ Error ending call:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle send_followup_email function
    async handleSendFollowupEmail(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);
            const leadId = connection?.callMetadata?.lead_id || args.lead_id;

            const toEmail = args.to_email || args.email;
            const subject = args.subject || 'Follow-up from DocLittle';
            const body = args.body || args.message || '';

            if (!toEmail) {
                return {
                    success: false,
                    error: 'Missing required parameter: to_email'
                };
            }

            // Call the HTTP endpoint (which handles email sending and logging)
            const apiBaseUrl = this.config.apiBaseUrl || 'http://localhost:4000';
            const response = await axios.post(`${apiBaseUrl}/api/retell/send-followup-email`, {
                call: { call_id: callId },
                parameters: {
                    to_email: toEmail,
                    subject: subject,
                    body: body,
                    lead_id: leadId
                }
            }, {
                headers: {
                    'X-Retell-Secret': process.env.RETELL_WEBHOOK_SECRET || ''
                }
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error sending follow-up email:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle send_followup_sms function
    async handleSendFollowupSMS(callId, args) {
        try {
            const connection = this.activeConnections.get(callId);
            const leadId = connection?.callMetadata?.lead_id || args.lead_id;

            const toPhone = args.to_phone || args.phone;
            const message = args.message || args.body || '';

            if (!toPhone) {
                return {
                    success: false,
                    error: 'Missing required parameter: to_phone'
                };
            }

            if (!message) {
                return {
                    success: false,
                    error: 'Missing required parameter: message'
                };
            }

            // Call the HTTP endpoint (which handles SMS sending and logging)
            const apiBaseUrl = this.config.apiBaseUrl || 'http://localhost:4000';
            const response = await axios.post(`${apiBaseUrl}/api/retell/send-followup-sms`, {
                call: { call_id: callId },
                parameters: {
                    to_phone: toPhone,
                    message: message,
                    lead_id: leadId
                }
            }, {
                headers: {
                    'X-Retell-Secret': process.env.RETELL_WEBHOOK_SECRET || ''
                }
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error sending follow-up SMS:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = RetellWebSocketHandler;