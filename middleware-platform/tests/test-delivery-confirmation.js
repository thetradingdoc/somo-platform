/**
 * Test Delivery Confirmation Service
 * Tests auto-confirmation and manual confirmation logic
 */

const DeliveryConfirmation = require('../services/delivery-confirmation-service');
const db = require('../database');

console.log('🧪 Testing Delivery Confirmation Service\n');

// Mock order data
const mockOrderId = 'test-order-' + Date.now();
const deliveryAddress = '1600 Amphitheatre Parkway, Mountain View, CA';
const deliveryCoords = { latitude: 37.4220, longitude: -122.0841 };

async function runTests() {
    // Test 1: Auto-confirmation when within radius
    console.log('Test 1: Auto-Confirmation (Within Radius)');
    try {
        // Create a mock order
        db.createOrder({
            id: mockOrderId,
            merchant_id: 'test-merchant',
            product_id: 'test-product',
            quantity: 1,
            customer_email: 'test@example.com',
            customer_name: 'Test Customer',
            customer_phone: '+1234567890',
            shipping_address: JSON.stringify({
                address: deliveryAddress,
                latitude: deliveryCoords.latitude,
                longitude: deliveryCoords.longitude
            }),
            total_amount: 50.00,
            status: 'paid',
            payment_status: 'paid',
            source: 'test',
            delivery_status: 'out_for_delivery'
        });

        // Driver is very close (within 50m)
        const driverLocation = {
            latitude: deliveryCoords.latitude + 0.0005, // ~50m away
            longitude: deliveryCoords.longitude + 0.0005
        };

        const result = await DeliveryConfirmation.autoConfirmDelivery(
            mockOrderId,
            driverLocation,
            deliveryAddress,
            100 // 100m radius
        );

        if (result.confirmed) {
            console.log(`  ✅ Auto-confirmed delivery`);
            console.log(`     Distance: ${result.distance ? Math.round(result.distance) + 'm' : 'N/A'}`);
        } else {
            console.log(`  ⚠️  Not confirmed: ${result.error || result.reason}`);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
    console.log('');

    // Test 2: Manual confirmation
    console.log('Test 2: Manual Confirmation');
    try {
        const result = await DeliveryConfirmation.manualConfirmDelivery(
            mockOrderId,
            'test-admin'
        );

        if (result.success) {
            console.log(`  ✅ Manually confirmed delivery`);
        } else {
            console.log(`  ⚠️  Manual confirmation: ${result.error}`);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
    console.log('');

    // Test 3: Already delivered
    console.log('Test 3: Already Delivered');
    try {
        const result = await DeliveryConfirmation.manualConfirmDelivery(
            mockOrderId,
            'test-admin'
        );

        if (result.success && result.error === 'Order already delivered.') {
            console.log(`  ✅ Correctly handled already-delivered order`);
        } else {
            console.log(`  ⚠️  Result: ${JSON.stringify(result)}`);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
    console.log('');

    // Test 4: Order not found
    console.log('Test 4: Order Not Found');
    try {
        const result = await DeliveryConfirmation.manualConfirmDelivery(
            'non-existent-order',
            'test-admin'
        );

        if (!result.success && result.error.includes('not found')) {
            console.log(`  ✅ Correctly handled missing order`);
        } else {
            console.log(`  ⚠️  Result: ${JSON.stringify(result)}`);
        }
    } catch (error) {
        console.log(`  ✅ Error caught: ${error.message}`);
    }
    console.log('');

    // Test 5: Driver too far
    console.log('Test 5: Driver Too Far');
    try {
        const newOrderId = 'test-order-far-' + Date.now();
        db.createOrder({
            id: newOrderId,
            merchant_id: 'test-merchant',
            product_id: 'test-product',
            quantity: 1,
            customer_email: 'test@example.com',
            customer_name: 'Test Customer',
            customer_phone: '+1234567890',
            shipping_address: JSON.stringify({
                address: deliveryAddress,
                latitude: deliveryCoords.latitude,
                longitude: deliveryCoords.longitude
            }),
            total_amount: 50.00,
            status: 'paid',
            payment_status: 'paid',
            source: 'test',
            delivery_status: 'out_for_delivery'
        });

        // Driver is far away (500m)
        const driverLocation = {
            latitude: deliveryCoords.latitude + 0.005, // ~500m away
            longitude: deliveryCoords.longitude + 0.005
        };

        const result = await DeliveryConfirmation.autoConfirmDelivery(
            newOrderId,
            driverLocation,
            deliveryAddress,
            100 // 100m radius
        );

        if (!result.confirmed && result.distance) {
            console.log(`  ✅ Correctly rejected (driver ${Math.round(result.distance)}m away)`);
        } else {
            console.log(`  ⚠️  Result: ${JSON.stringify(result)}`);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
    }
    console.log('');

    // Cleanup
    try {
        // Note: In a real test, you'd want to clean up test orders
        console.log('  Cleanup: Test orders created (manual cleanup may be needed)');
    } catch (error) {
        console.log(`  ⚠️  Cleanup error: ${error.message}`);
    }

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Delivery Confirmation Service Tests Complete');
    console.log('');
    console.log('Note: These tests require geocoding service to be configured.');
    console.log('Auto-confirmation requires AUTO_CONFIRM_DELIVERY=true in .env');
}

// Run tests
runTests().catch(error => {
    console.error('❌ Test suite error:', error);
    process.exit(1);
});

