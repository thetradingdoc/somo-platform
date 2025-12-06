/**
 * Test Location Verification Service
 * Tests distance calculation and proximity detection
 */

const LocationVerification = require('../services/location-verification-service');

console.log('🧪 Testing Location Verification Service\n');

// Test 1: Distance calculation
console.log('Test 1: Distance Calculation');
const point1 = { latitude: 40.7128, longitude: -74.0060 }; // NYC
const point2 = { latitude: 40.7580, longitude: -73.9855 }; // Times Square (close)
const point3 = { latitude: 34.0522, longitude: -118.2437 }; // LA (far)

const distance1 = LocationVerification.calculateDistance(point1, point2);
const distance2 = LocationVerification.calculateDistance(point1, point3);

console.log(`  NYC to Times Square: ${Math.round(distance1)}m (expected: ~1-2km)`);
console.log(`  NYC to LA: ${Math.round(distance2)}m (expected: ~3,944km)`);
console.log(`  ✅ Distance calculation: ${distance1 > 0 && distance2 > 0 ? 'PASS' : 'FAIL'}\n`);

// Test 2: Proximity detection
console.log('Test 2: Proximity Detection');
const isClose1 = LocationVerification.isWithinRadius(point1, point2, 2000); // 2km radius
const isClose2 = LocationVerification.isWithinRadius(point1, point3, 2000); // 2km radius

console.log(`  NYC to Times Square within 2km: ${isClose1} (expected: true)`);
console.log(`  NYC to LA within 2km: ${isClose2} (expected: false)`);
console.log(`  ✅ Proximity detection: ${isClose1 && !isClose2 ? 'PASS' : 'FAIL'}\n`);

// Test 3: Delivery radius (100m)
console.log('Test 3: Delivery Radius (100m)');
const deliveryAddress = { latitude: 40.7128, longitude: -74.0060 };
const driverNear = { latitude: 40.7129, longitude: -74.0061 }; // ~100m away
const driverFar = { latitude: 40.7135, longitude: -74.0065 }; // ~500m away

const withinRadius1 = LocationVerification.isWithinRadius(deliveryAddress, driverNear, 100);
const withinRadius2 = LocationVerification.isWithinRadius(deliveryAddress, driverFar, 100);

console.log(`  Driver near (100m): ${withinRadius1} (expected: true)`);
console.log(`  Driver far (500m): ${withinRadius2} (expected: false)`);
console.log(`  ✅ Delivery radius: ${withinRadius1 && !withinRadius2 ? 'PASS' : 'FAIL'}\n`);

// Test 4: Edge cases
console.log('Test 4: Edge Cases');
const invalidPoint = { latitude: null, longitude: -74.0060 };
const distanceInvalid = LocationVerification.calculateDistance(point1, invalidPoint);
const withinInvalid = LocationVerification.isWithinRadius(point1, invalidPoint, 100);

console.log(`  Invalid coordinates distance: ${distanceInvalid} (expected: null)`);
console.log(`  Invalid coordinates proximity: ${withinInvalid} (expected: false)`);
console.log(`  ✅ Edge cases: ${distanceInvalid === null && !withinInvalid ? 'PASS' : 'FAIL'}\n`);

// Test 5: Same point
console.log('Test 5: Same Point');
const samePoint = LocationVerification.calculateDistance(point1, point1);
const samePointProximity = LocationVerification.isWithinRadius(point1, point1, 100);

console.log(`  Same point distance: ${Math.round(samePoint)}m (expected: 0)`);
console.log(`  Same point proximity: ${samePointProximity} (expected: true)`);
console.log(`  ✅ Same point: ${samePoint === 0 && samePointProximity ? 'PASS' : 'FAIL'}\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Location Verification Service Tests Complete');

