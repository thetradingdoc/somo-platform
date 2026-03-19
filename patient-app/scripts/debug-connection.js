#!/usr/bin/env node
/**
 * Debug patient app connection (Metro + API)
 * Run: node scripts/debug-connection.js
 */
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const NGROK = 'https://8654-38-105-226-114.ngrok-free.app';
const METRO_PORT = 8081;

function getMacIP() {
  try {
    const out = execSync('ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null', { encoding: 'utf8' });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(url, { headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ ok: res.statusCode < 400, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log('🔍 Patient app connection debug\n');

  // 1. API (ngrok)
  console.log('1. API (ngrok)...');
  try {
    const r = await fetch(`${NGROK}/health`, { 'ngrok-skip-browser-warning': 'true' });
    const reachable = r.data && (r.data.includes('"status"') || r.data.includes('middleware'));
    console.log(reachable ? '   ✅ API reachable' : '   ❌ API unreachable or wrong response');
    if (!reachable) console.log('   Raw:', (r.data || '').slice(0, 120));
  } catch (e) {
    console.log('   ❌ API unreachable:', e.message);
  }

  // 2. Metro port
  console.log('\n2. Metro bundler (port 8081)...');
  try {
    const r = await fetch(`http://127.0.0.1:${METRO_PORT}/status`);
    const ok = r.ok && r.data.includes('packager');
    console.log(ok ? '   ✅ Metro is running' : '   ❌ Metro not running or wrong response');
    if (!ok) console.log('   → Start Metro: npx expo start (in another terminal)');
  } catch {
    console.log('   ❌ Metro not reachable - is "npx expo start" running?');
  }

  // 3. Mac IP
  const ip = getMacIP();
  console.log('\n3. Your Mac IP (for phone):', ip || 'Could not detect');

  // 4. Test if port 8081 is open from outside (simple check)
  console.log('\n4. Phone connection tips:');
  console.log('   • Phone and Mac must be on same Wi‑Fi');
  console.log('   • Disable Mac firewall or allow Node: System Settings → Network → Firewall');
  console.log('   • Disable router "AP isolation" / "client isolation"');
  console.log('   • Try: REACT_NATIVE_PACKAGER_HOSTNAME=' + (ip || 'YOUR_IP') + ' npx expo start');
  console.log('\n5. No Xcode? Use web instead:');
  console.log('   npx expo start --web');
  console.log('   Then open http://localhost:8081 in a browser.\n');
}

main().catch(console.error);
