#!/usr/bin/env node
/**
 * Test TikTok Shop API credentials (App Key + App Secret)
 * Based on: https://partner.tiktokshop.com/doc/page/275254
 * 
 * Flow: Get Access Token (requires auth_code) → Get Authorized Shops
 * auth_code comes from OAuth - must be generated for YOUR app in Partner Center
 */

// Load .env manually
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../middleware-platform/.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const APP_KEY = process.env.TIKTOK_API_KEY_US_APP_KEY || '6j9nccbc5miut';
const APP_SECRET = process.env.TIKTOK_API_KEY_US_APP_SECRET || '3bb17cfd90b03b2bc28d3e050aa60ad9c28a3893';

// From Postman Test Environment - may be expired or tied to a different app
const AUTH_CODE = 'TTP_zUogrAAAAAAZ_8AY6LucJprWnT_zFd-tuB8yr5i82jQJhDAdrUjsDD8EKlMUJqiDskQ7LLUQB63nMQT5u_Jeh11MQFv0DRqXsQESHGi2_F_z4-DXAMgkl8RRA6T2Pzwwp6W-L2Uh2AlZ1yUIcNBRwevn2JWeTAuF';

async function getAccessToken() {
  const url = new URL('https://auth.tiktok-shops.com/api/v2/token/get');
  url.searchParams.set('app_key', APP_KEY);
  url.searchParams.set('app_secret', APP_SECRET);
  url.searchParams.set('auth_code', AUTH_CODE);
  url.searchParams.set('grant_type', 'authorized_code');

  const res = await fetch(url.toString());
  const data = await res.json();

  return { status: res.status, data };
}

async function main() {
  console.log('TikTok Shop API Credential Test');
  console.log('================================');
  console.log('App Key:', APP_KEY);
  console.log('App Secret:', APP_SECRET ? `${APP_SECRET.slice(0, 8)}...` : '(not set)');
  console.log('Auth Code:', AUTH_CODE ? `${AUTH_CODE.slice(0, 20)}...` : '(not set - required for token)');
  console.log('');

  // Step 1: Get Access Token
  console.log('1. Calling Get Access Token (auth.tiktok-shops.com/api/v2/token/get)...');
  try {
    const result = await getAccessToken();
    console.log('   HTTP Status:', result.status);
    console.log('   Response:', JSON.stringify(result.data, null, 2));

    if (result.data.code === 0 && result.data.data?.access_token) {
      console.log('\n✅ App Key + App Secret are VALID. Access token received.');
      console.log('   (auth_code was accepted - you can now call Get Authorized Shops)');
      return;
    }

    // Parse error codes (TikTok uses "client_key" for app_key)
    const code = result.data.code;
    const message = (result.data.message || result.data.data?.message || '').toLowerCase();
    if (code === 36004003 || message.includes('invalid client_key') || message.includes('client_key')) {
      console.log('\n❌ Invalid App Key (client_key). TikTok rejected your app_key.');
      console.log('   Check TIKTOK_API_KEY_US_APP_KEY in .env and verify in TikTok Shop Partner Center.');
      console.log('   Ensure app_key and app_secret are from the same app and correct region (US/UK).');
    } else if (code === 1051001 || message.includes('app_key')) {
      console.log('\n❌ Invalid App Key. Check TIKTOK_API_KEY_US_APP_KEY in .env');
    } else if (code === 1051002 || message.includes('app_secret')) {
      console.log('\n❌ Invalid App Secret. Check TIKTOK_API_KEY_US_APP_SECRET in .env');
    } else if (code === 1051003 || message.includes('auth_code') || message.includes('expired')) {
      console.log('\n⚠️  App Key + App Secret appear valid, but auth_code is invalid or expired.');
      console.log('   To complete the test:');
      console.log('   1. Go to https://partner.tiktokshop.com/doc/page/275254');
      console.log('   2. Use the API Testing Tool or OAuth flow to get a fresh auth_code for your app');
      console.log('   3. Or in Postman: set app_key + app_secret in environment, run Get Access Token with a fresh auth_code');
    } else {
      console.log('\n   Code:', code, '-', message);
    }
  } catch (err) {
    console.error('   Error:', err.message);
    if (err.cause) console.error('   Cause:', err.cause);
  }
}

main();
