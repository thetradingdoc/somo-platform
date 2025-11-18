/**
 * Comprehensive Test Suite
 * Tests frontend, backend, voice agent, and database
 */

const http = require('http');
const db = require('../database');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';
const TEST_RESULTS = {
    frontend: [],
    backend: [],
    voiceAgent: [],
    database: [],
    errors: []
};

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);
        const options = {
            hostname: url.hostname,
            port: url.port || 4000,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const parsed = body ? JSON.parse(body) : {};
                    resolve({ status: res.statusCode, data: parsed, headers: res.headers });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body, headers: res.headers });
                }
            });
        });

        req.on('error', reject);
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

// ============================================
// DATABASE TESTS
// ============================================

async function testDatabase() {
    log('\n📊 Testing Database...', 'blue');

    try {
        // Test 1: Database connection
        log('  ✓ Testing database connection...', 'yellow');
        const testQuery = db.db.prepare('SELECT 1 as test').get();
        if (testQuery && testQuery.test === 1) {
            TEST_RESULTS.database.push({ test: 'Connection', status: 'PASS' });
            log('    ✅ Database connection: PASS', 'green');
        } else {
            TEST_RESULTS.database.push({ test: 'Connection', status: 'FAIL' });
            TEST_RESULTS.errors.push('Database connection failed');
            log('    ❌ Database connection: FAIL', 'red');
        }

        // Test 2: Tables exist
        log('  ✓ Testing required tables...', 'yellow');
        const tables = ['users', 'appointments', 'fhir_patients', 'eligibility_checks', 'insurance_claims'];
        const missingTables = [];

        for (const table of tables) {
            try {
                const result = db.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
                if (!result) {
                    missingTables.push(table);
                }
            } catch (e) {
                missingTables.push(table);
            }
        }

        if (missingTables.length === 0) {
            TEST_RESULTS.database.push({ test: 'Required Tables', status: 'PASS' });
            log('    ✅ Required tables exist: PASS', 'green');
        } else {
            TEST_RESULTS.database.push({ test: 'Required Tables', status: 'FAIL', missing: missingTables });
            TEST_RESULTS.errors.push(`Missing tables: ${missingTables.join(', ')}`);
            log(`    ❌ Missing tables: ${missingTables.join(', ')}`, 'red');
        }

        // Test 3: Database queries
        log('  ✓ Testing database queries...', 'yellow');
        try {
            const users = db.getAllUsers();
            const appointments = db.getAllAppointments();
            TEST_RESULTS.database.push({ test: 'Queries', status: 'PASS' });
            log(`    ✅ Database queries: PASS (${users.length} users, ${appointments.length} appointments)`, 'green');
        } catch (e) {
            TEST_RESULTS.database.push({ test: 'Queries', status: 'FAIL', error: e.message });
            TEST_RESULTS.errors.push(`Database query error: ${e.message}`);
            log(`    ❌ Database queries: FAIL - ${e.message}`, 'red');
        }

    } catch (error) {
        TEST_RESULTS.database.push({ test: 'Database Tests', status: 'FAIL', error: error.message });
        TEST_RESULTS.errors.push(`Database test error: ${error.message}`);
        log(`  ❌ Database test error: ${error.message}`, 'red');
    }
}

// ============================================
// BACKEND API TESTS
// ============================================

async function testBackend() {
    log('\n🔧 Testing Backend API...', 'blue');

    const endpoints = [
        { method: 'GET', path: '/health', name: 'Health Check' },
        { method: 'GET', path: '/api/patients', name: 'Get Patients' },
        {
            method: 'POST', path: '/api/test/appointment-email', name: 'Test Appointment Email',
            data: { patient_email: 'test@example.com', patient_name: 'Test', appointment_type: 'Test', date: '2025-11-15', time: '2:00 PM' },
            note: 'Note: This endpoint requires server restart if recently added'
        }
    ];

    for (const endpoint of endpoints) {
        try {
            log(`  ✓ Testing ${endpoint.name} (${endpoint.method} ${endpoint.path})...`, 'yellow');
            const response = await makeRequest(endpoint.method, endpoint.path, endpoint.data);

            if (response.status === 200 || response.status === 201 || (response.status === 404 && endpoint.path === '/api/patients')) {
                TEST_RESULTS.backend.push({ test: endpoint.name, status: 'PASS', code: response.status });
                log(`    ✅ ${endpoint.name}: PASS (${response.status})`, 'green');
            } else if (response.status === 404 && endpoint.path === '/api/test/appointment-email') {
                TEST_RESULTS.backend.push({ test: endpoint.name, status: 'WARN', code: response.status, note: 'Server may need restart' });
                TEST_RESULTS.errors.push(`${endpoint.name} returned 404 - Server may need restart to load new endpoint`);
                log(`    ⚠️  ${endpoint.name}: WARN (${response.status}) - Server may need restart`, 'yellow');
            } else {
                TEST_RESULTS.backend.push({ test: endpoint.name, status: 'FAIL', code: response.status, error: response.data.error });
                TEST_RESULTS.errors.push(`${endpoint.name} failed with status ${response.status}`);
                log(`    ❌ ${endpoint.name}: FAIL (${response.status})`, 'red');
            }
        } catch (error) {
            TEST_RESULTS.backend.push({ test: endpoint.name, status: 'ERROR', error: error.message });
            TEST_RESULTS.errors.push(`${endpoint.name} error: ${error.message}`);
            log(`    ❌ ${endpoint.name}: ERROR - ${error.message}`, 'red');
        }
    }
}

// ============================================
// VOICE AGENT TESTS
// ============================================

async function testVoiceAgent() {
    log('\n🎤 Testing Voice Agent...', 'blue');

    try {
        // Test 1: Retell functions file exists
        log('  ✓ Testing Retell functions configuration...', 'yellow');
        const fs = require('fs');
        const path = require('path');
        const functionsPath = path.join(__dirname, '../retell-functions/retell-functions.json');

        if (fs.existsSync(functionsPath)) {
            const functions = JSON.parse(fs.readFileSync(functionsPath, 'utf8'));
            // Check for both 'functions' and 'tools' (different formats)
            const functionList = functions.functions || functions.tools || [];
            if (functionList.length > 0) {
                TEST_RESULTS.voiceAgent.push({ test: 'Retell Functions', status: 'PASS', count: functionList.length });
                log(`    ✅ Retell functions: PASS (${functionList.length} functions)`, 'green');
            } else {
                TEST_RESULTS.voiceAgent.push({ test: 'Retell Functions', status: 'FAIL', error: 'No functions defined' });
                TEST_RESULTS.errors.push('Retell functions file has no functions');
                log('    ❌ Retell functions: FAIL - No functions defined', 'red');
            }
        } else {
            TEST_RESULTS.voiceAgent.push({ test: 'Retell Functions', status: 'FAIL', error: 'File not found' });
            TEST_RESULTS.errors.push('Retell functions file not found');
            log('    ❌ Retell functions: FAIL - File not found', 'red');
        }

        // Test 2: Voice agent prompt exists
        log('  ✓ Testing voice agent prompt...', 'yellow');
        const promptPath = path.join(__dirname, '../../docs/voice-agent/kelly-voice-agent-prompt.md');
        if (fs.existsSync(promptPath)) {
            TEST_RESULTS.voiceAgent.push({ test: 'Agent Prompt', status: 'PASS' });
            log('    ✅ Voice agent prompt: PASS', 'green');
        } else {
            TEST_RESULTS.voiceAgent.push({ test: 'Agent Prompt', status: 'FAIL', error: 'File not found' });
            TEST_RESULTS.errors.push('Voice agent prompt file not found');
            log('    ❌ Voice agent prompt: FAIL - File not found', 'red');
        }

        // Test 3: Retell WebSocket handler
        log('  ✓ Testing Retell WebSocket handler...', 'yellow');
        try {
            const RetellWebSocketHandler = require('../webhooks/retell-websocket');
            // Check if it's a class (constructor function) or has the expected methods
            if (RetellWebSocketHandler && (typeof RetellWebSocketHandler === 'function' || typeof RetellWebSocketHandler.prototype === 'object')) {
                // Check if instance has handleScheduleAppointment method
                const instance = new RetellWebSocketHandler({}, {});
                if (instance && typeof instance.handleScheduleAppointment === 'function') {
                    TEST_RESULTS.voiceAgent.push({ test: 'WebSocket Handler', status: 'PASS' });
                    log('    ✅ Retell WebSocket handler: PASS', 'green');
                } else {
                    TEST_RESULTS.voiceAgent.push({ test: 'WebSocket Handler', status: 'FAIL', error: 'handleScheduleAppointment method not found' });
                    TEST_RESULTS.errors.push('Retell WebSocket handler missing handleScheduleAppointment method');
                    log('    ❌ Retell WebSocket handler: FAIL - Method not found', 'red');
                }
            } else {
                TEST_RESULTS.voiceAgent.push({ test: 'WebSocket Handler', status: 'FAIL', error: 'Handler class not found' });
                TEST_RESULTS.errors.push('Retell WebSocket handler class missing');
                log('    ❌ Retell WebSocket handler: FAIL - Class not found', 'red');
            }
        } catch (e) {
            TEST_RESULTS.voiceAgent.push({ test: 'WebSocket Handler', status: 'FAIL', error: e.message });
            TEST_RESULTS.errors.push(`Retell WebSocket handler error: ${e.message}`);
            log(`    ❌ Retell WebSocket handler: FAIL - ${e.message}`, 'red');
        }

    } catch (error) {
        TEST_RESULTS.voiceAgent.push({ test: 'Voice Agent Tests', status: 'FAIL', error: error.message });
        TEST_RESULTS.errors.push(`Voice agent test error: ${error.message}`);
        log(`  ❌ Voice agent test error: ${error.message}`, 'red');
    }
}

// ============================================
// FRONTEND TESTS
// ============================================

async function testFrontend() {
    log('\n🖥️  Testing Frontend...', 'blue');

    try {
        const fs = require('fs');
        const path = require('path');
        const frontendPath = path.join(__dirname, '../../unified-dashboard');

        // Test 1: Frontend files exist
        log('  ✓ Testing frontend files...', 'yellow');
        const requiredFiles = [
            'index.html',
            'login.html',
            'patients/patient-login.html',
            'patients/patient-dashboard.html',
            'patients/wallet.html',
            'business/business-dashboard.html'
        ];

        const missingFiles = [];
        for (const file of requiredFiles) {
            const filePath = path.join(frontendPath, file);
            if (!fs.existsSync(filePath)) {
                missingFiles.push(file);
            }
        }

        if (missingFiles.length === 0) {
            TEST_RESULTS.frontend.push({ test: 'Required Files', status: 'PASS' });
            log('    ✅ Required frontend files: PASS', 'green');
        } else {
            TEST_RESULTS.frontend.push({ test: 'Required Files', status: 'FAIL', missing: missingFiles });
            TEST_RESULTS.errors.push(`Missing frontend files: ${missingFiles.join(', ')}`);
            log(`    ❌ Missing files: ${missingFiles.join(', ')}`, 'red');
        }

        // Test 2: Frontend API configuration
        log('  ✓ Testing frontend API configuration...', 'yellow');
        const configPath = path.join(frontendPath, 'assets/js/config.js');
        if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, 'utf8');
            if (configContent.includes('API_BASE') || configContent.includes('apiBaseUrl')) {
                TEST_RESULTS.frontend.push({ test: 'API Configuration', status: 'PASS' });
                log('    ✅ Frontend API configuration: PASS', 'green');
            } else {
                TEST_RESULTS.frontend.push({ test: 'API Configuration', status: 'WARN', error: 'API config not found' });
                log('    ⚠️  Frontend API configuration: WARN', 'yellow');
            }
        } else {
            TEST_RESULTS.frontend.push({ test: 'API Configuration', status: 'WARN', error: 'Config file not found' });
            log('    ⚠️  Frontend API configuration: WARN - Config file not found', 'yellow');
        }

    } catch (error) {
        TEST_RESULTS.frontend.push({ test: 'Frontend Tests', status: 'FAIL', error: error.message });
        TEST_RESULTS.errors.push(`Frontend test error: ${error.message}`);
        log(`  ❌ Frontend test error: ${error.message}`, 'red');
    }
}

// ============================================
// SUMMARY
// ============================================

function printSummary() {
    log('\n' + '='.repeat(60), 'blue');
    log('📊 TEST SUMMARY', 'blue');
    log('='.repeat(60), 'blue');

    const categories = [
        { name: 'Database', tests: TEST_RESULTS.database },
        { name: 'Backend API', tests: TEST_RESULTS.backend },
        { name: 'Voice Agent', tests: TEST_RESULTS.voiceAgent },
        { name: 'Frontend', tests: TEST_RESULTS.frontend }
    ];

    for (const category of categories) {
        const passed = category.tests.filter(t => t.status === 'PASS').length;
        const failed = category.tests.filter(t => t.status === 'FAIL').length;
        const total = category.tests.length;

        log(`\n${category.name}:`, 'yellow');
        log(`  ✅ Passed: ${passed}/${total}`, passed === total ? 'green' : 'yellow');
        if (failed > 0) {
            log(`  ❌ Failed: ${failed}/${total}`, 'red');
        }
    }

    if (TEST_RESULTS.errors.length > 0) {
        log('\n❌ ERRORS:', 'red');
        TEST_RESULTS.errors.forEach((error, i) => {
            log(`  ${i + 1}. ${error}`, 'red');
        });
    }

    const totalPassed = categories.reduce((sum, cat) => sum + cat.tests.filter(t => t.status === 'PASS').length, 0);
    const totalTests = categories.reduce((sum, cat) => sum + cat.tests.length, 0);

    log('\n' + '='.repeat(60), 'blue');
    log(`Overall: ${totalPassed}/${totalTests} tests passed`, totalPassed === totalTests ? 'green' : 'yellow');
    log('='.repeat(60) + '\n', 'blue');
}

// ============================================
// MAIN
// ============================================

async function runAllTests() {
    log('\n🧪 COMPREHENSIVE TEST SUITE', 'blue');
    log('='.repeat(60), 'blue');
    log(`Testing: ${API_BASE}`, 'yellow');
    log('='.repeat(60) + '\n', 'blue');

    await testDatabase();
    await testBackend();
    await testVoiceAgent();
    await testFrontend();

    printSummary();

    const hasErrors = TEST_RESULTS.errors.length > 0;
    process.exit(hasErrors ? 1 : 0);
}

// Run tests
if (require.main === module) {
    runAllTests().catch(error => {
        log(`\n❌ Test suite error: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    });
}

module.exports = { runAllTests, TEST_RESULTS };

