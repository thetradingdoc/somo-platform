/**
 * RETELL WEBSOCKET HANDLER
 * 
 * This handles real-time communication between Retell AI and your middleware
 * Place this in: middleware-platform/webhooks/retell-websocket.js
 */

const WebSocket = require('ws');
const axios = require('axios');
const { fetchCallCosts } = require('../utils/cost-tracker');
const SMSService = require('../services/sms-service');

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
            nameProvidedAt: null, // Timestamp when name was first provided
            clinic_id: null // Clinic/tenant identifier (primary)
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
            if (connection && connection.clinic_id) {
                try {
                    const callDuration = Date.now() - connection.startTime;
                    const callDurationSeconds = Math.floor(callDuration / 1000);
                    const callDurationMinutes = Math.ceil(callDurationSeconds / 60); // Round up to nearest minute

                    // NOTE: For now, we use clinic_id as customer_id for credits (database schema uses customer_id)
                    // TODO: Create clinic_credits table or map clinic to customer properly
                    const customerIdForCredits = connection.clinic_id;
                    
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

                        console.log(`✅ Deducted ${callDurationMinutes} minutes from clinic ${connection.clinic_id}`);
                    } else {
                        // Insufficient credits - log warning
                        console.warn(`⚠️  Insufficient credits for clinic ${connection.clinic_id} (needed: ${callDurationMinutes}, available: ${credits ? credits.credits_balance_minutes : 0})`);

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
            // CRITICAL: Normalize phone number to +1 format for US customers
            connection.customerPhone = message.call.from_number 
                ? SMSService.formatPhoneNumber(message.call.from_number)
                : null;

            // Store Twilio CallSid from metadata if available
            if (message.call.metadata && message.call.metadata.twilio_call_sid) {
                connection.twilio_call_sid = message.call.metadata.twilio_call_sid;
            }

            // Extract clinic_id from various sources
            // Priority: dynamic_variables > metadata > agent_id lookup > phone number lookup
            // NOTE: We use clinic_id as the primary tenant identifier
            if (message.call.dynamic_variables && message.call.dynamic_variables.clinic_id) {
                connection.clinic_id = message.call.dynamic_variables.clinic_id;
                console.log(`✅ Extracted clinic_id from dynamic variables: ${connection.clinic_id}`);
            } else if (message.call.metadata && message.call.metadata.clinic_id) {
                connection.clinic_id = message.call.metadata.clinic_id;
                console.log(`✅ Extracted clinic_id from metadata: ${connection.clinic_id}`);
            } else if (message.call.dynamic_variables && message.call.dynamic_variables.customer_id) {
                // Legacy: customer_id support (may be clinic_id in disguise)
                connection.clinic_id = message.call.dynamic_variables.customer_id;
                console.log(`✅ Extracted clinic_id from customer_id (legacy): ${connection.clinic_id}`);
            } else if (message.call.metadata && message.call.metadata.customer_id) {
                // Legacy: customer_id support (may be clinic_id in disguise)
                connection.clinic_id = message.call.metadata.customer_id;
                console.log(`✅ Extracted clinic_id from customer_id (legacy): ${connection.clinic_id}`);
            } else if (message.call.agent_id) {
                // Look up clinic by Retell agent_id (check clinics table first, then customers for backward compatibility)
                const clinic = this.db.db.prepare('SELECT * FROM clinics WHERE retell_agent_id = ?').get(message.call.agent_id);
                if (clinic) {
                    connection.clinic_id = clinic.clinic_id;
                    console.log(`✅ Looked up clinic_id from agent_id: ${connection.clinic_id}`);
                } else {
                    // Fallback: check customers table (legacy support)
                const customer = this.db.db.prepare('SELECT * FROM customers WHERE retell_agent_id = ?').get(message.call.agent_id);
                if (customer) {
                        // For backward compatibility, use customer.id as clinic_id
                        // TODO: Map customer to clinic properly when relationship is clarified
                        connection.clinic_id = customer.id;
                        console.log(`⚠️  Looked up clinic_id from customer agent_id (legacy): ${connection.clinic_id}`);
                    }
                }
            }

            // Fallback: Try to lookup by phone number
            if (!connection.clinic_id) {
                const toNumber = message.call.to_number;
                if (toNumber) {
                    const clinicPhone = this.db.getClinicPhoneNumber(toNumber);
                    if (clinicPhone && clinicPhone.clinic_id) {
                        connection.clinic_id = clinicPhone.clinic_id;
                        console.log(`✅ Looked up clinic_id from phone number: ${connection.clinic_id}`);
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

                default:
                    result = {
                        success: false,
                        error: `Unknown function: ${functionName}`
                    };
            }

            const responseTime = Date.now() - startTime;
            const success = result.success !== false && !result.error;

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
                this.sendToRetell(connection.ws, {
                    type: 'response',
                    response: {
                        content: `I couldn't find any products matching "${query}". Would you like to browse our other products?`,
                        end_call: false
                    }
                });
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
                requires_email: true
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

            // Create checkout request payload
            const checkoutPayload = {
                merchant_id: merchantId,
                product_id: productId,
                customer_name: customerName,
                customer_phone: customerPhone,
                customer_email: customerEmail,
                quantity: quantity
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
                this.sendToRetell(connection.ws, {
                    type: 'response',
                    response: {
                        content: "I need your email address to complete your purchase. Could you please provide your email address?",
                        end_call: false
                    }
                });
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
                    this.sendToRetell(connection.ws, {
                        type: 'response',
                        response: {
                            content: `I've sent a verification code to ${customerEmail}. Please check your email and provide me with the 6-digit code to verify your account before completing your purchase.`,
                            end_call: false
                        }
                    });
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

                this.sendToRetell(connection.ws, {
                    type: 'response',
                    response: {
                        content: `Perfect! I've sent a payment link to your email at ${customerEmail}. The total is $${checkout.amount}. You can complete your purchase using that link. Is there anything else I can help you with?`,
                        end_call: false
                    }
                });

                console.log(`✅ Checkout created: ${checkout.checkout_id}`);
                console.log(`📧 Payment link sent to: ${customerEmail}`);
            } else if (response.data.requires_verification) {
                // Should not happen if we checked above, but handle it anyway
                this.sendToRetell(connection.ws, {
                    type: 'response',
                    response: {
                        content: `I need to verify your email before completing your purchase. I've sent a verification code to ${customerEmail}. Please check your email and provide me with the 6-digit code.`,
                        end_call: false
                    }
                });
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
            this.sendToRetell(connection.ws, {
                type: 'response',
                response: {
                    content: `I'm sorry, I'm having trouble processing that order: ${errorMessage}. Please try again or call us for assistance.`,
                    end_call: false
                }
            });
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

                    this.sendToRetell(connection.ws, {
                        type: 'response',
                        response: {
                            content: "Great! Your email is verified. Let me complete your purchase now.",
                            end_call: false
                        }
                    });

                    // Proceed with checkout
                    await this.handlePurchaseIntent(callId, productInfo);
                    delete connection.pendingVerification;
                } else {
                    this.sendToRetell(connection.ws, {
                        type: 'response',
                        response: {
                            content: "Perfect! Your email has been verified. How can I help you today?",
                            end_call: false
                        }
                    });
                }
            } else {
                this.sendToRetell(connection.ws, {
                    type: 'response',
                    response: {
                        content: `I'm sorry, that verification code is incorrect or has expired. ${verifyResponse.data.error || 'Please request a new code.'}`,
                        end_call: false
                    }
                });
            }
        } catch (error) {
            console.error('❌ Verification error:', error);
            this.sendToRetell(connection.ws, {
                type: 'response',
                response: {
                    content: "I'm sorry, I'm having trouble verifying your code. Please try again.",
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

        if (connection.clinic_id) {
            return connection.clinic_id;
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
                customer_phone: args.customer_phone ? SMSService.formatPhoneNumber(args.customer_phone) : this.getCustomerPhone(callId),
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