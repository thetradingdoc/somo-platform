#!/usr/bin/env node

/**
 * Simple script to confirm the checkout error format
 * Tests what happens when email is missing
 */

const http = require('http');

const API_BASE = 'http://localhost:4000';

console.log('🔍 Confirming Checkout Error Format');
console.log('='.repeat(70));
console.log(`Testing: POST ${API_BASE}/voice/checkout/create\n`);

const payload = JSON.stringify({
    merchant_id: '6d1daad9-13c7-490c-916d-0ccc02506db5',
    product_id: '011eaf99-d0a6-4c74-b36c-e21441765787',
    quantity: 1,
    customer_name: 'Test Customer',
    customer_phone: '+1234567890'
    // NO EMAIL - this should trigger the error
});

const options = {
    hostname: 'localhost',
    port: 4000,
    path: '/voice/checkout/create',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

const req = http.request(options, (res) => {
    console.log(`📥 Response Status: ${res.statusCode}`);
    console.log(`📥 Response Headers:`, res.headers);
    
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('\n📥 Raw Response Data:');
        console.log(data);
        
        console.log('\n🔍 Response Analysis:');
        
        // Try to parse as JSON
        try {
            const parsed = JSON.parse(data);
            console.log('✅ Response is valid JSON');
            console.log('   Type:', Array.isArray(parsed) ? 'ARRAY' : typeof parsed);
            
            if (Array.isArray(parsed)) {
                console.log('   ⚠️  BUG CONFIRMED: Response is an ARRAY!');
                console.log('   Array length:', parsed.length);
                console.log('   Array contents:');
                parsed.forEach((item, index) => {
                    console.log(`      [${index}]:`, typeof item === 'object' ? JSON.stringify(item) : item);
                });
            } else if (typeof parsed === 'object') {
                console.log('   ✅ Response is an object (correct format)');
                console.log('   Keys:', Object.keys(parsed));
                if (parsed.error) {
                    console.log('   Error:', parsed.error);
                }
                if (parsed.requires_email) {
                    console.log('   Requires Email:', parsed.requires_email);
                }
                if (parsed.message) {
                    console.log('   Message:', parsed.message);
                }
            }
        } catch (e) {
            console.log('❌ Response is NOT valid JSON');
            console.log('   Error:', e.message);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Request Error:', error.message);
    console.error('   Make sure the server is running on port 4000');
});

req.write(payload);
req.end();

