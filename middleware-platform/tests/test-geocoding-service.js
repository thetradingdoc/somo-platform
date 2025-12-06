/**
 * Test Geocoding Service
 * Tests address to coordinates conversion and caching
 */

const GeocodingService = require('../services/geocoding-service');

console.log('🧪 Testing Geocoding Service\n');

// Test addresses
const testAddresses = [
    '1600 Amphitheatre Parkway, Mountain View, CA',
    'Times Square, New York, NY',
    '123 Main St, New York, NY 10001'
];

async function runTests() {
    // Test 1: Geocode address
    console.log('Test 1: Geocode Address');
    try {
        const result1 = await GeocodingService.geocodeAddress(testAddresses[0]);
        if (result1.success) {
            console.log(`  ✅ Geocoded: ${testAddresses[0]}`);
            console.log(`     → ${result1.latitude}, ${result1.longitude}`);
            console.log(`     → ${result1.formatted_address}`);
            console.log(`     Provider: ${result1.provider || 'unknown'}`);
        } else {
            console.log(`  ❌ Failed: ${result1.error}`);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
    console.log('');

    // Test 2: Cache test
    console.log('Test 2: Caching');
    try {
        const start1 = Date.now();
        const result1 = await GeocodingService.geocodeAddress(testAddresses[1]);
        const time1 = Date.now() - start1;

        const start2 = Date.now();
        const result2 = await GeocodingService.geocodeAddress(testAddresses[1]); // Same address
        const time2 = Date.now() - start2;

        if (result1.success && result2.success) {
            console.log(`  First request: ${time1}ms`);
            console.log(`  Cached request: ${time2}ms`);
            console.log(`  From cache: ${result2.fromCache ? 'Yes' : 'No'}`);
            console.log(`  ✅ Caching: ${result2.fromCache && time2 < time1 ? 'PASS' : 'FAIL'}`);
        } else {
            console.log(`  ❌ Failed: ${result1.error || result2.error}`);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
    console.log('');

    // Test 3: Reverse geocode
    console.log('Test 3: Reverse Geocode');
    try {
        const result = await GeocodingService.reverseGeocode(40.7128, -74.0060); // NYC coordinates
        if (result.success) {
            console.log(`  ✅ Reverse geocoded: 40.7128, -74.0060`);
            console.log(`     → ${result.formatted_address}`);
            console.log(`     Provider: ${result.provider || 'unknown'}`);
        } else {
            console.log(`  ❌ Failed: ${result.error}`);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
    console.log('');

    // Test 4: Invalid address
    console.log('Test 4: Invalid Address');
    try {
        const result = await GeocodingService.geocodeAddress('');
        if (!result.success) {
            console.log(`  ✅ Invalid address rejected: ${result.error}`);
        } else {
            console.log(`  ❌ Should have failed for empty address`);
        }
    } catch (error) {
        console.log(`  ✅ Error caught: ${error.message}`);
    }
    console.log('');

    // Test 5: Invalid coordinates
    console.log('Test 5: Invalid Coordinates');
    try {
        const result1 = await GeocodingService.reverseGeocode(200, 200); // Invalid
        const result2 = await GeocodingService.reverseGeocode(null, null); // Invalid
        
        if (!result1.success && !result2.success) {
            console.log(`  ✅ Invalid coordinates rejected`);
        } else {
            console.log(`  ❌ Should have failed for invalid coordinates`);
        }
    } catch (error) {
        console.log(`  ✅ Error caught: ${error.message}`);
    }
    console.log('');

    // Test 6: Cache stats
    console.log('Test 6: Cache Statistics');
    try {
        const stats = GeocodingService.getCacheStats();
        console.log(`  Cache size: ${stats.size}`);
        console.log(`  Cache TTL: ${stats.ttl}s`);
        console.log(`  ✅ Cache stats: Available`);
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
    console.log('');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Geocoding Service Tests Complete');
    console.log('');
    console.log('Note: These tests use Nominatim (free) or Google Maps if API key is set.');
    console.log('Rate limiting: Nominatim allows 1 request/second.');
}

// Run tests
runTests().catch(error => {
    console.error('❌ Test suite error:', error);
    process.exit(1);
});

