#!/usr/bin/env node
/**
 * Test script to verify admin portal routes are working correctly
 * 
 * Usage: node scripts/test-admin-routes.js [baseUrl]
 * Example: node scripts/test-admin-routes.js http://localhost:4000
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.argv[2] || 'http://localhost:4000';

// Routes to test
const routes = [
  // Main dashboard
  { path: '/admin', name: 'Main Dashboard', expect: 200 },
  { path: '/admin/index.html', name: 'Dashboard (index.html)', expect: 200 },
  { path: '/admin?tab=leads', name: 'Dashboard (leads tab)', expect: 200 },
  { path: '/admin?tab=clients', name: 'Dashboard (clients tab)', expect: 200 },
  { path: '/admin?tab=tenants', name: 'Dashboard (tenants tab)', expect: 200 },
  
  // Standalone pages (only accessible under /admin/)
  { path: '/admin/workflows.html', name: 'Workflows', expect: 200 },
  { path: '/admin/pipeline.html', name: 'Pipeline', expect: 200 },
  { path: '/admin/leads.html', name: 'Leads', expect: 200 },
  { path: '/admin/clients.html', name: 'Clients', expect: 200 },
  
  // Verify root-level access is blocked (should return 404)
  { path: '/workflows.html', name: 'Workflows (root - blocked)', expect: 404 },
  { path: '/pipeline.html', name: 'Pipeline (root - blocked)', expect: 404 },
  { path: '/leads.html', name: 'Leads (root - blocked)', expect: 404 },
  { path: '/clients.html', name: 'Clients (root - blocked)', expect: 404 },
];

// Helper to make HTTP request
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Admin-Route-Tester/1.0'
      }
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data.substring(0, 200) // First 200 chars
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// Test all routes
async function testRoutes() {
  console.log(`\n🧪 Testing Admin Portal Routes\n`);
  console.log(`Base URL: ${BASE_URL}\n`);
  console.log('─'.repeat(70));

  const results = [];
  
  for (const route of routes) {
    const url = `${BASE_URL}${route.path}`;
    process.stdout.write(`Testing: ${route.name.padEnd(35)} ... `);
    
    try {
      const response = await makeRequest(url);
      const passed = response.statusCode === route.expect;
      const status = passed ? '✅ PASS' : `❌ FAIL (got ${response.statusCode}, expected ${route.expect})`;
      
      console.log(status);
      
      results.push({
        route: route.name,
        path: route.path,
        expected: route.expect,
        actual: response.statusCode,
        passed,
        url
      });
    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
      results.push({
        route: route.name,
        path: route.path,
        expected: route.expect,
        actual: 'ERROR',
        passed: false,
        error: error.message,
        url
      });
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(70));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  
  console.log(`\n📊 Summary: ${passed}/${total} passed, ${failed} failed\n`);
  
  if (failed > 0) {
    console.log('❌ Failed Routes:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.route}: ${r.path}`);
      if (r.error) console.log(`     Error: ${r.error}`);
      else console.log(`     Expected: ${r.expected}, Got: ${r.actual}`);
    });
    console.log('');
  }
  
  // Exit with error code if any failed
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
testRoutes().catch(error => {
  console.error('\n❌ Test runner error:', error);
  process.exit(1);
});

