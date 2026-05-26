/**
 * CONFIGURE RETELL AGENT
 * 
 * Run: node configure-retell.js
 * This will properly configure your Retell agent with webhook endpoints
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const RETELL_API_KEY = process.env.RETELL_API_KEY;
const AGENT_ID = process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a';
// Retell TTS voice (openai-*, 11labs-*). Same env as RetellService.createAgent — set RETELL_VOICE_ID in .env to unify quality across agents.
const RETELL_VOICE_ID =
    (process.env.RETELL_VOICE_ID && String(process.env.RETELL_VOICE_ID).trim()) || 'retell-Cimo';

// Determine API base URL
// Priority: API_BASE_URL > BASE_URL > Railway URL > localhost
let API_BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL;
if (!API_BASE_URL) {
    // Check if running on Railway
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        API_BASE_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    } else if (process.env.NODE_ENV === 'production') {
        // Production: use Railway URL (backend is on Railway)
        API_BASE_URL = 'https://web-production-a783d.up.railway.app';
    } else {
        // Development: use localhost
        API_BASE_URL = 'http://localhost:4000';
    }
}

// Remove trailing slash if present
API_BASE_URL = API_BASE_URL.replace(/\/$/, '');

const IS_PRODUCTION = process.env.NODE_ENV === 'production' ||
    (API_BASE_URL && !API_BASE_URL.includes('localhost') && !API_BASE_URL.includes('127.0.0.1'));

// WebSocket URL: use wss:// for production (HTTPS), ws:// for development
const WEBSOCKET_URL = IS_PRODUCTION
    ? API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')
    : 'ws://localhost:4000';

// Load healthcare prompt and functions
function loadHealthcarePrompt() {
    try {
        const docsPath = path.join(__dirname, '..', 'docs', 'voice-agent');
        const kellyPaths = [
            path.join(docsPath, 'prompts', 'kelly-voice-agent-prompt.md'),
            path.join(docsPath, 'kelly-voice-agent-prompt.md'),
            path.join(__dirname, 'retell-functions', 'kelly-voice-agent-prompt.md')
        ];

        let prompt = null;
        for (const p of kellyPaths) {
            if (fs.existsSync(p)) {
                prompt = fs.readFileSync(p, 'utf8');
                console.log('✅ Loaded Kelly prompt from', path.relative(path.join(__dirname, '..'), p));
                break;
            }
        }

        if (!prompt) {
            console.error('⚠️  Could not find Kelly voice agent prompt');
            return null;
        }

        const medicalPromptPath = path.join(docsPath, 'medical-voice-agent-prompt.md');
        if (!fs.existsSync(medicalPromptPath)) {
            throw new Error(
                `Missing required medical workflow prompt: ${path.relative(path.join(__dirname, '..'), medicalPromptPath)}`
            );
        }
        const medical = fs.readFileSync(medicalPromptPath, 'utf8');
        prompt = prompt + '\n\n---\n\n' + medical;
        console.log('✅ Appended medical coding workflow prompt');

        return prompt;
    } catch (error) {
        console.error('❌ Could not load healthcare prompt:', error.message);
        throw error;
    }
}

function loadRetellFunctions() {
    try {
        const functionsPath = path.join(__dirname, 'retell-functions', 'retell-functions.json');
        const functionsData = fs.readFileSync(functionsPath, 'utf8');
        const parsed = JSON.parse(functionsData);
        return parsed.functions || [];
    } catch (error) {
        console.error('⚠️  Could not load function definitions:', error.message);
        console.error('   Using default functions instead');
        return [
            {
                type: 'end_call',
                name: 'end_call',
                description: 'End the call when customer is done'
            }
        ];
    }
}

async function configureRetellAgent() {
    if (!RETELL_API_KEY) {
        console.error('\n❌ RETELL_API_KEY is missing. Add it to middleware-platform/.env');
        throw new Error('RETELL_API_KEY required');
    }

    console.log('\n🔧 CONFIGURING RETELL AGENT');
    console.log('━'.repeat(60));
    console.log('Agent ID:', AGENT_ID);
    console.log('API Base URL:', API_BASE_URL);
    console.log('WebSocket URL:', WEBSOCKET_URL);
    console.log('Environment:', IS_PRODUCTION ? 'Production' : 'Development');
    console.log('━'.repeat(60) + '\n');

    try {
        // Get current agent config
        console.log('📥 Fetching current agent...');
        // Retell API uses /get-agent/{id} and /update-agent/{id} (not /v2/agent/...).
        const retellApiBase = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
        const getResponse = await axios.get(`${retellApiBase.replace(/\/$/, '')}/get-agent/${AGENT_ID}`, {
            headers: {
                Authorization: `Bearer ${RETELL_API_KEY}`
            }
        });

        console.log('✅ Current agent:', getResponse.data?.agent_name || getResponse.data?.agent_id || AGENT_ID);

        // Load healthcare prompt and functions
        console.log('\n📚 Loading healthcare prompt and functions...');
        const healthcarePrompt = loadHealthcarePrompt();
        const retellFunctions = loadRetellFunctions();

        if (healthcarePrompt) {
            console.log('✅ Healthcare prompt loaded');
        } else {
            console.log('⚠️  Using default prompt');
        }

        if (retellFunctions && retellFunctions.length > 0) {
            console.log(`✅ Loaded ${retellFunctions.length} function definitions`);
        } else {
            console.log('⚠️  Using default functions');
        }

        // Update agent with WebSocket URL
        console.log('\n📤 Updating agent with healthcare configuration...');

        // Build the prompt - use healthcare prompt if available, otherwise use default
        let generalPrompt;
        if (healthcarePrompt) {
            generalPrompt = healthcarePrompt;
        } else {
            generalPrompt = `You are Kelly, a helpful medical voice assistant for DocLittle. Your role is to:
1. Help patients check their insurance coverage
2. Book physician appointments
3. Handle appointment confirmations, cancellations, and rescheduling
4. Process payments through insurance coverage and patient copays
5. Look up patient claims and billing information

Keep it friendly, professional, and empathetic—you're helping people with their healthcare needs.
Always introduce yourself as: "Hi, I'm Kelly. I'll be your assistant today."
Start by asking for the patient's full name, then greet them personally.

Keep responses short and natural for voice conversation.`;
        }

        // Retell API: custom LLM is response_engine.type "custom-llm" + llm_websocket_url inside it (not top-level).
        const updateData = {
            agent_name: 'Kelly - DocLittle Medical Voice Assistant',
            voice_id: RETELL_VOICE_ID,
            language: 'en-US',
            response_engine: {
                type: 'custom-llm',
                llm_websocket_url: `${WEBSOCKET_URL}/webhook/retell/llm`
            },
            enable_backchannel: true,
            // Valid values include call-center, coffee-shop, etc.; "office" is not in the current API enum.
            ambient_sound: null,
            general_prompt: generalPrompt,
            // Reproducible tools: Retell tool schemas MUST be set programmatically so deleting/resetting an agent
            // does not silently remove coding + billing function-calling ability.
            general_tools: (retellFunctions && retellFunctions.length > 0)
                ? retellFunctions
                : [
                    {
                        type: 'end_call',
                        name: 'end_call',
                        description: 'End the call when the customer is done or when the conversation is complete.'
                    }
                ]
        };

        const updateResponse = await axios.patch(
            `${retellApiBase.replace(/\/$/, '')}/update-agent/${AGENT_ID}`,
            updateData,
            {
                headers: {
                    Authorization: `Bearer ${RETELL_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ Agent updated successfully!\n');
        console.log('📋 Configuration:');
        console.log('   Agent ID:', AGENT_ID);
        console.log('   Phone:', '+15856202445');
        console.log(
            '   LLM Webhook:',
            updateData.response_engine?.llm_websocket_url || '(missing — check response_engine)'
        );
        console.log('   Voice (RETELL_VOICE_ID):', updateData.voice_id);

        console.log('\n' + '━'.repeat(60));
        console.log('✅ CONFIGURATION COMPLETE!');
        console.log('━'.repeat(60) + '\n');

        console.log('🧪 TEST YOUR AGENT:');
        console.log('   1. Make sure your server is running (npm start)');
        if (IS_PRODUCTION) {
            console.log('   2. Server is deployed to:', API_BASE_URL);
            console.log('   3. WebSocket endpoint:', `${WEBSOCKET_URL}/webhook/retell/llm`);
        } else {
            console.log('   2. Server running on localhost:4000');
            console.log('   3. For production, set API_BASE_URL=https://doclittle.site');
        }
        console.log('   4. Call: +15856202445');
        console.log('   5. Say: "Hi, I\'d like to schedule an appointment"');
        console.log('   6. Or: "I\'d like to check my insurance coverage"');
        console.log('   7. Or: "I got a bill, can you tell me what it was for?"');
        console.log('   8. Check your terminal for logs\n');

        console.log('⚠️  MAKE SURE:');
        if (IS_PRODUCTION) {
            console.log('   ✓ Server deployed to production domain');
            console.log('   ✓ SSL certificate is active (HTTPS)');
            console.log('   ✓ WebSocket endpoint is accessible (WSS)');
        } else {
            console.log('   ✓ Server running on port 4000');
            console.log('   ✓ For production: Set API_BASE_URL in .env');
        }
        console.log('   ✓ Products/Orders now integrated in middleware (no separate merchant-shop needed)');
        console.log('   ✓ Your phone has SMS enabled\n');

        return updateResponse.data;

    } catch (error) {
        console.error('\n❌ Configuration failed:');

        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Error:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('   Error:', error.message);
        }

        if (error.response?.status === 401) {
            console.error('\n⚠️  Check your RETELL_API_KEY in .env');
        }

        if (error.response?.status === 404) {
            console.error('\n⚠️  Agent not found. Check agent ID:', AGENT_ID);
            console.error('   You can find your agent ID in the Retell dashboard');
        }

        throw error;
    }
}

// Test webhook endpoint
async function testWebhook() {
    console.log('\n🧪 TESTING WEBHOOK ENDPOINT...\n');

    try {
        const healthUrl = `${API_BASE_URL}/health/live`;
        console.log('   Testing:', healthUrl);
        const response = await axios.get(healthUrl, {
            timeout: 10000,
            validateStatus: (status) => status === 200
        });

        console.log('✅ Server is reachable!');
        console.log('   Status:', response.status);
        console.log('   Response:', response.data);

        // Test WebSocket endpoint (can't actually test WS connection with axios, but verify URL is correct)
        console.log('   WebSocket URL:', `${WEBSOCKET_URL}/webhook/retell/llm`);

        return true;
    } catch (error) {
        console.error('❌ Server test failed!');
        if (IS_PRODUCTION) {
            console.error('   Make sure your server is deployed and accessible at:', API_BASE_URL);
            console.error('   Make sure SSL certificate is active');
        } else {
            console.error('   Make sure your server is running on port 4000');
            console.error('   For production: Set API_BASE_URL=https://doclittle.site in .env');
        }
        console.error('   Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('   💡 Tip: Server is not running or not accessible');
        }

        return false;
    }
}

// Run configuration
if (require.main === module) {
    (async () => {
        try {
            // Test webhook first
            const webhookOk = await testWebhook();

            if (!webhookOk) {
                console.error('\n❌ Fix webhook issues before configuring agent');
                process.exit(1);
            }

            // Configure agent
            await configureRetellAgent();

            process.exit(0);
        } catch (error) {
            process.exit(1);
        }
    })();
}

module.exports = configureRetellAgent;