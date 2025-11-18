/**
 * Test Stripe Production Configuration
 * Verifies that Stripe production keys are correctly configured and working
 */

require('dotenv').config();

const stripeConfig = require('./utils/stripe-config');

console.log('🧪 Testing Stripe Production Configuration\n');
console.log('═'.repeat(60));

// Check environment
const env = process.env.NODE_ENV || 'development';
console.log(`\n📋 Environment: ${env}`);

// Check if we're in production
const isProduction = env === 'production' || env === 'prod';
if (!isProduction) {
  console.log('⚠️  WARNING: Not in production mode. Testing will use current environment.');
  console.log('   To test production mode, set: NODE_ENV=production\n');
}

// Test 1: Check if keys exist
console.log('\n1️⃣ Checking Stripe Keys...');
console.log('─'.repeat(60));

const hasSecretKey = !!process.env.STRIPE_SECRET_KEY;
const hasPublishableKey = !!process.env.STRIPE_PUBLISHABLE_KEY;

console.log(`   Secret Key: ${hasSecretKey ? '✅ Set' : '❌ Missing'}`);
console.log(`   Publishable Key: ${hasPublishableKey ? '✅ Set' : '❌ Missing'}`);

if (!hasSecretKey || !hasPublishableKey) {
  console.error('\n❌ ERROR: Stripe keys not found in environment variables!');
  console.error('   Please set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY');
  process.exit(1);
}

// Test 2: Validate key formats
console.log('\n2️⃣ Validating Key Formats...');
console.log('─'.repeat(60));

try {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  
  const secretIsLive = secretKey.startsWith('sk_live_');
  const secretIsTest = secretKey.startsWith('sk_test_');
  const publishableIsLive = publishableKey.startsWith('pk_live_');
  const publishableIsTest = publishableKey.startsWith('pk_test_');
  
  console.log(`   Secret Key Type: ${secretIsLive ? '🔴 LIVE (Production)' : secretIsTest ? '🟡 TEST' : '❌ Invalid format'}`);
  console.log(`   Publishable Key Type: ${publishableIsLive ? '🔴 LIVE (Production)' : publishableIsTest ? '🟡 TEST' : '❌ Invalid format'}`);
  
  // Check for mismatches
  if (secretIsLive !== publishableIsLive) {
    console.error('\n❌ ERROR: Key type mismatch!');
    console.error('   Secret key and publishable key must both be live or both be test.');
    process.exit(1);
  }
  
  // Check environment vs key type
  if (isProduction && secretIsTest) {
    console.error('\n❌ SECURITY ERROR: Test keys detected in production environment!');
    console.error('   Production environment requires live keys (sk_live_ / pk_live_)');
    process.exit(1);
  }
  
  if (!isProduction && secretIsLive) {
    console.error('\n❌ SECURITY ERROR: Production keys detected in development environment!');
    console.error('   Development environment requires test keys (sk_test_ / pk_test_)');
    console.error('   This is a security risk - please use test keys in development.');
    process.exit(1);
  }
  
  const mode = secretIsLive ? 'PRODUCTION' : 'TEST';
  console.log(`\n✅ Key validation passed: ${mode} mode detected`);
  
} catch (error) {
  console.error('\n❌ Key validation failed:', error.message);
  process.exit(1);
}

// Test 3: Initialize Stripe with config utility
console.log('\n3️⃣ Testing Stripe Configuration Utility...');
console.log('─'.repeat(60));

try {
  const stripe = stripeConfig.initializeStripe();
  if (!stripe) {
    console.error('❌ Failed to initialize Stripe');
    process.exit(1);
  }
  console.log('✅ Stripe initialized successfully');
  
  const mode = stripeConfig.getStripeMode();
  console.log(`   Mode: ${mode}`);
  
} catch (error) {
  console.error('❌ Stripe initialization failed:', error.message);
  if (error.message.includes('SECURITY ERROR')) {
    console.error('\n   This is a critical security issue. Please fix key configuration.');
  }
  process.exit(1);
}

// Test 4: Test Stripe API connection
console.log('\n4️⃣ Testing Stripe API Connection...');
console.log('─'.repeat(60));

async function testStripeConnection() {
  try {
    const stripe = stripeConfig.initializeStripe();
    
    // Test: Get account balance (this is a simple API call that doesn't require parameters)
    const balance = await stripe.balance.retrieve();
    
    console.log('✅ Stripe API connection successful!');
    console.log(`   Account available: $${(balance.available[0].amount / 100).toFixed(2)} ${balance.available[0].currency.toUpperCase()}`);
    console.log(`   Account pending: $${(balance.pending[0].amount / 100).toFixed(2)} ${balance.pending[0].currency.toUpperCase()}`);
    
    return true;
  } catch (error) {
    console.error('❌ Stripe API connection failed:', error.message);
    
    if (error.type === 'StripeAuthenticationError') {
      console.error('\n   Authentication failed. Please check:');
      console.error('   - Secret key is correct');
      console.error('   - Key has not been revoked');
      console.error('   - Key matches the Stripe account you want to use');
    } else if (error.type === 'StripeAPIError') {
      console.error('\n   API error. Please check:');
      console.error('   - Stripe service status');
      console.error('   - Network connectivity');
      console.error('   - API rate limits');
    }
    
    return false;
  }
}

// Test 5: Test publishable key
console.log('\n5️⃣ Testing Publishable Key...');
console.log('─'.repeat(60));

try {
  const publishableKey = stripeConfig.getStripePublishableKey();
  const mode = stripeConfig.getStripeMode();
  
  console.log('✅ Publishable key retrieved successfully');
  console.log(`   Key: ${publishableKey.substring(0, 20)}...`);
  console.log(`   Mode: ${mode}`);
  console.log(`\n   Use this key in frontend: ${publishableKey}`);
  
} catch (error) {
  console.error('❌ Failed to get publishable key:', error.message);
  process.exit(1);
}

// Run async test
(async () => {
  const connectionSuccess = await testStripeConnection();
  
  console.log('\n' + '═'.repeat(60));
  if (connectionSuccess) {
    console.log('\n✅ ALL TESTS PASSED!');
    console.log('\n📝 Summary:');
    console.log('   ✅ Stripe keys are configured');
    console.log('   ✅ Key formats are valid');
    console.log('   ✅ Environment matches key type');
    console.log('   ✅ Stripe API connection working');
    console.log('   ✅ Publishable key accessible');
    
    const mode = stripeConfig.getStripeMode();
    console.log(`\n🎯 Ready for: ${mode === 'production' ? '🔴 PRODUCTION' : '🟡 TEST'} use`);
    console.log(`\n📡 API Endpoint: https://api.doclittle.site`);
    console.log(`   Stripe mode: ${mode}`);
    
  } else {
    console.log('\n❌ SOME TESTS FAILED');
    console.log('\n   Please check the errors above and fix configuration issues.');
    process.exit(1);
  }
})();

