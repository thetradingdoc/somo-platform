/**
 * RETELL WEBSOCKET HANDLER
 * 
 * This handles real-time communication between Retell AI and your middleware
 * Place this in: middleware-platform/webhooks/retell-websocket.js
 */

const WebSocket = require('ws');
const axios = require('axios');
const { fetchCallCosts } = require('../utils/cost-tracker');

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

        // Store connection
        const connection = {
            ws,
            callId,
            startTime: Date.now(),
            conversationHistory: [],
            callMetadata: {},
            customerPhone: null,
            customerName: null, // Will be stored when first provided
            initialName: null, // Store the FIRST name provided by the caller (for fraud detection)
            nameProvidedAt: null // Timestamp when name was first provided
        };
        this.activeConnections.set(callId, connection);

        // Handle messages from Retell
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data);
                await this.handleRetellMessage(callId, message);
            } catch (error) {
                console.error('Error handling Retell message:', error);
            }
        });

        // Handle connection close
        ws.on('close', async () => {
            console.log(`📴 Call ended: ${callId}`);

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
            const connection = this.activeConnections.get(callId);
            if (connection && connection.customer_id) {
                try {
                    const callDuration = Date.now() - connection.startTime;
                    const callDurationSeconds = Math.floor(callDuration / 1000);
                    const callDurationMinutes = Math.ceil(callDurationSeconds / 60); // Round up to nearest minute

                    // Get customer credits
                    const credits = this.db.getCustomerCredits(connection.customer_id);
                    if (credits && credits.credits_balance_minutes >= callDurationMinutes) {
                        // Deduct credits
                        this.db.deductCredits(connection.customer_id, callDurationMinutes);

                        // Update voice call log with duration and credits deducted
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
                                connection.customer_id,
                                callId,
                                callDurationSeconds,
                                callDurationMinutes,
                                callDurationMinutes
                            );
                        }

                        console.log(`✅ Deducted ${callDurationMinutes} minutes from customer ${connection.customer_id}`);
                    } else {
                        // Insufficient credits - log warning
                        console.warn(`⚠️  Insufficient credits for customer ${connection.customer_id} (needed: ${callDurationMinutes}, available: ${credits ? credits.credits_balance_minutes : 0})`);

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
                        const twilioCallSid = connection.twilio_call_sid ||
                            connection.callMetadata?.metadata?.twilio_call_sid ||
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

        // Store call metadata from first message
        if (message.call) {
            connection.callMetadata = message.call;
            connection.customerPhone = message.call.from_number || null;

            // Store Twilio CallSid from metadata if available
            if (message.call.metadata && message.call.metadata.twilio_call_sid) {
                connection.twilio_call_sid = message.call.metadata.twilio_call_sid;
            }

            // Extract customer_id from various sources
            // Priority: dynamic_variables > metadata > agent_id lookup > phone number lookup
            if (message.call.dynamic_variables && message.call.dynamic_variables.customer_id) {
                connection.customer_id = message.call.dynamic_variables.customer_id;
                console.log(`✅ Extracted customer_id from dynamic variables: ${connection.customer_id}`);
            } else if (message.call.metadata && message.call.metadata.customer_id) {
                connection.customer_id = message.call.metadata.customer_id;
                console.log(`✅ Extracted customer_id from metadata: ${connection.customer_id}`);
            } else if (message.call.dynamic_variables && message.call.dynamic_variables.clinic_id) {
                // Legacy: clinic_id support
                connection.customer_id = message.call.dynamic_variables.clinic_id;
                console.log(`✅ Extracted clinic_id from dynamic variables: ${connection.customer_id}`);
            } else if (message.call.metadata && message.call.metadata.clinic_id) {
                // Legacy: clinic_id support
                connection.customer_id = message.call.metadata.clinic_id;
                console.log(`✅ Extracted clinic_id from metadata: ${connection.customer_id}`);
            } else if (message.call.agent_id) {
                // Look up customer by Retell agent_id
                const customer = this.db.db.prepare('SELECT * FROM customers WHERE retell_agent_id = ?').get(message.call.agent_id);
                if (customer) {
                    connection.customer_id = customer.id;
                    console.log(`✅ Looked up customer_id from agent_id: ${connection.customer_id}`);
                }
            }

            // Fallback: Try to lookup by phone number (legacy clinic support)
            if (!connection.customer_id) {
                const toNumber = message.call.to_number;
                if (toNumber) {
                    const clinicPhone = this.db.getClinicPhoneNumber(toNumber);
                    if (clinicPhone && clinicPhone.clinic_id) {
                        connection.customer_id = clinicPhone.clinic_id;
                        console.log(`✅ Looked up clinic_id from phone number: ${connection.customer_id}`);
                    }
                }
            }
        }

        console.log(`\n📨 Message from ${callId}:`, message.type);

        switch (message.type) {
            case 'update':
                // Retell sends updates about call state
                if (message.update?.transcript) {
                    await this.handleTranscript(callId, { transcript: message.update.transcript });
                }
                break;

            case 'function_call':
                await this.handleFunctionCall(callId, message);
                break;

            case 'response':
                // Retell is responding to user
                break;

            case 'ping':
                // Respond to ping
                this.sendToRetell(connection.ws, { type: 'pong' });
                break;

            default:
                console.log('Unknown message type:', message.type);
        }
    }

    // Handle user speech transcript
    async handleTranscript(callId, message) {
        const connection = this.activeConnections.get(callId);
        const userSaid = message.transcript;

        console.log(`🗣️  User said: "${userSaid}"`);

        // Store in conversation history
        connection.conversationHistory.push({
            role: 'user',
            content: userSaid,
            timestamp: Date.now()
        });

        // For healthcare, we let Retell LLM handle the conversation
        // and call functions as needed. No intent detection here.
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

        // Get clinic_id from connection metadata (if available)
        // Also check function args for clinic_id (passed via dynamic variables)
        let customerId = connection.customer_id || null;

        // Try to extract from function args if available
        if (!customerId && functionArgs.clinic_id) {
            customerId = functionArgs.clinic_id;
        }

        // Try to extract from dynamic variables in message
        if (!customerId && message.dynamic_variables && message.dynamic_variables.clinic_id) {
            customerId = message.dynamic_variables.clinic_id;
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

                case 'send_followup_email':
                    result = await this.handleSendFollowupEmail(callId, functionArgs);
                    break;

                case 'send_followup_sms':
                    result = await this.handleSendFollowupSMS(callId, functionArgs);
                    break;

                default:
                    result = {
                        success: false,
                        error: `Unknown function: ${functionName}`
                    };
            }

            const responseTime = Date.now() - startTime;
            const success = result.success !== false && !result.error;

            // Log function call to database
            await this.db.logFunctionCall({
                id: `func-${require('crypto').randomBytes(16).toString('hex')}`,
                customer_id: customerId,
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

            // Log error
            this.db.logError({
                id: `error-${require('crypto').randomBytes(16).toString('hex')}`,
                customer_id: customerId,
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
                customer_id: customerId,
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

    // Handle product search
    async handleProductSearch(callId, query) {
        const connection = this.activeConnections.get(callId);

        try {
            console.log(`🔍 Searching products: ${query}`);

            // Call your middleware API
            const response = await axios.post('http://localhost:4000/voice/products/search', {
                merchant_id: 'd10794ff-ca11-4e6f-93e9-560162b4f884',
                query: query
            });

            const products = response.data.products;

            if (products.length === 0) {
                this.sendToRetell(connection.ws, {
                    type: 'response',
                    response: {
                        content: `I couldn't find any products matching "${query}". Would you like to browse our other products?`,
                        end_call: false
                    }
                });
                return;
            }

            // Format product list for voice
            const productList = products.slice(0, 3).map((p, i) =>
                `${i + 1}. ${p.title} for $${p.price}`
            ).join('. ');

            const response_text = products.length === 1
                ? `I found ${products[0].title} for $${products[0].price}. ${products[0].description}. Would you like to purchase this?`
                : `I found ${products.length} products: ${productList}. Which one interests you?`;

            this.sendToRetell(connection.ws, {
                type: 'response',
                response: {
                    content: response_text,
                    end_call: false,
                    metadata: {
                        products: products
                    }
                }
            });

            // Store search results
            connection.lastSearchResults = products;

        } catch (error) {
            console.error('❌ Product search error:', error);
            this.sendToRetell(connection.ws, {
                type: 'response',
                response: {
                    content: "Sorry, I'm having trouble searching products right now. Please try again.",
                    end_call: false
                }
            });
        }
    }

    // Handle purchase intent
    async handlePurchaseIntent(callId, productInfo) {
        const connection = this.activeConnections.get(callId);

        // Extract customer info from call
        const customerPhone = this.getCustomerPhone(callId);
        const customerName = this.getCustomerName(callId) || 'Customer';

        try {
            console.log(`💳 Creating checkout for: ${productInfo.product_id}`);

            // Create checkout via middleware
            const response = await axios.post('http://localhost:4000/voice/checkout/create', {
                merchant_id: 'd10794ff-ca11-4e6f-93e9-560162b4f884',
                product_id: productInfo.product_id,
                customer_name: customerName,
                customer_phone: customerPhone,
                quantity: 1
            });

            if (response.data.success) {
                const checkout = response.data;

                this.sendToRetell(connection.ws, {
                    type: 'response',
                    response: {
                        content: `Perfect! I've sent a payment link to ${customerPhone}. The total is $${checkout.amount}. You can complete your purchase using that link. Is there anything else I can help you with?`,
                        end_call: false
                    }
                });

                console.log(`✅ Checkout created: ${checkout.checkout_id}`);
                console.log(`📱 SMS sent to: ${customerPhone}`);
            } else {
                throw new Error('Checkout creation failed');
            }

        } catch (error) {
            console.error('❌ Purchase error:', error);
            this.sendToRetell(connection.ws, {
                type: 'response',
                response: {
                    content: "I'm sorry, I'm having trouble processing that order. Please try again or call us for assistance.",
                    end_call: false
                }
            });
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

    // Helper: Extract call ID from request
    extractCallId(req) {
        return req.headers['x-retell-call-id'] ||
            req.url.split('/').pop() ||
            `call_${Date.now()}`;
    }

    // Helper: Get customer phone from Retell call
    getCustomerPhone(callId) {
        const connection = this.activeConnections.get(callId);
        return connection?.customerPhone || connection?.callMetadata?.from_number || null;
    }

    // Helper: Get customer name
    getCustomerName(callId) {
        const connection = this.activeConnections.get(callId);
        return connection?.customerName || connection?.initialName || null;
    }

    // Helper: Store customer name (called when name is first provided)
    storeCustomerName(callId, name) {
        const connection = this.activeConnections.get(callId);
        if (connection && name && !connection.initialName) {
            connection.initialName = name.trim();
            connection.customerName = name.trim();
            connection.nameProvidedAt = Date.now();
            console.log(`✅ Stored initial customer name: ${connection.initialName} (callId: ${callId})`);
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
            return null;
        }

        if (connection.customer_id) {
            return connection.customer_id;
        }

        const metadataClinic =
            connection.callMetadata?.metadata?.clinic_id ||
            connection.callMetadata?.metadata?.customer_id ||
            connection.callMetadata?.dynamic_variables?.clinic_id ||
            connection.callMetadata?.dynamic_variables?.customer_id ||
            null;

        return metadataClinic || null;
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
                patient_phone: args.patient_phone || this.getCustomerPhone(callId),
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
            // Store the initial name when first provided (for fraud detection)
            const connection = this.activeConnections.get(callId);
            if (connection && args.patient_name && !connection.initialName) {
                connection.initialName = args.patient_name.trim();
                connection.nameProvidedAt = Date.now();
                connection.customerName = args.patient_name.trim();
                console.log(`✅ Stored initial customer name: ${connection.initialName} (callId: ${callId})`);
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
            const patientPhone = args.patient_phone || this.getCustomerPhone(callId);
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
                clinic_id: clinicId
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
                return {
                    success: false,
                    error: error.response.data.error || error.response.data.message || error.message
                };
            }

            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle get_available_slots function
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
                timezone: args.timezone || 'America/New_York',
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

    // Handle create_appointment_checkout function
    async handleCreateAppointmentCheckout(callId, args) {
        try {
            const clinicId = this.getClinicId(callId);
            if (!clinicId) {
                return {
                    success: false,
                    error: 'Missing clinic context for creating checkout.'
                };
            }

            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/appointments/checkout`, {
                appointment_id: args.appointment_id,
                customer_name: args.customer_name,
                customer_email: args.customer_email,
                customer_phone: args.customer_phone || this.getCustomerPhone(callId),
                appointment_type: args.appointment_type,
                amount: args.amount,
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

    // Handle verify_checkout_code function
    async handleVerifyCheckoutCode(callId, args) {
        try {
            const clinicId = this.getClinicId(callId);
            const response = await axios.post(`${this.config.apiBaseUrl || 'http://localhost:4000'}/voice/checkout/verify`, {
                payment_token: args.payment_token,
                verification_code: args.verification_code,
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

    // Handle get_patient_claims function
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

    // Handle end_call function (for sales agent)
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