/**
 * Delivery Confirmation Service
 * 
 * Handles automatic and manual delivery confirmation based on location proximity
 */

const db = require('../database');
const LocationVerification = require('./location-verification-service');
const GeocodingService = require('./geocoding-service');
const EmailService = require('./email-service');

/**
 * Auto-confirm delivery if driver is within radius
 * @param {string} orderId - Order ID
 * @param {Object} driverLocation - { latitude, longitude }
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Confirmation result
 */
async function autoConfirmDelivery(orderId, driverLocation, options = {}) {
  const {
    radiusMeters = parseInt(process.env.DELIVERY_RADIUS_METERS || '100'),
    autoConfirmEnabled = process.env.AUTO_CONFIRM_DELIVERY !== 'false'
  } = options;

  if (!autoConfirmEnabled) {
    return {
      success: false,
      confirmed: false,
      reason: 'Auto-confirmation is disabled'
    };
  }

  try {
    // Get order
    const order = db.getOrder(orderId);
    if (!order) {
      return {
        success: false,
        confirmed: false,
        error: 'Order not found'
      };
    }

    // Check if already delivered
    if (order.delivery_status === 'delivered') {
      return {
        success: true,
        confirmed: false,
        reason: 'Order already delivered'
      };
    }

    // Get delivery address - prefer drop_point, fallback to shipping_address
    let deliveryLat, deliveryLng;
    let deliveryAddress = null;
    
    // Try drop_point first (explicit delivery address)
    if (order.drop_point) {
      try {
        deliveryAddress = typeof order.drop_point === 'string'
          ? JSON.parse(order.drop_point)
          : order.drop_point;
        
        if (deliveryAddress && deliveryAddress.latitude && deliveryAddress.longitude) {
          deliveryLat = deliveryAddress.latitude;
          deliveryLng = deliveryAddress.longitude;
        } else if (typeof deliveryAddress === 'string') {
          // Need to geocode drop_point address
          const geocodeResult = await GeocodingService.geocodeAddress(deliveryAddress);
          if (geocodeResult.success) {
            deliveryLat = geocodeResult.latitude;
            deliveryLng = geocodeResult.longitude;
            // Update drop_point with coordinates
            db.updateOrder(orderId, {
              drop_point: JSON.stringify({
                address: deliveryAddress,
                latitude: deliveryLat,
                longitude: deliveryLng,
                formatted_address: geocodeResult.formatted_address
              })
            });
          }
        }
      } catch (e) {
        console.warn('⚠️  Failed to parse drop_point, trying shipping_address');
      }
    }
    
    // Fallback to shipping_address if drop_point not available
    if (!deliveryLat || !deliveryLng) {
      const shippingAddress = typeof order.shipping_address === 'string'
        ? JSON.parse(order.shipping_address)
        : order.shipping_address;

      if (shippingAddress && shippingAddress.latitude && shippingAddress.longitude) {
        deliveryLat = shippingAddress.latitude;
        deliveryLng = shippingAddress.longitude;
        deliveryAddress = shippingAddress;
      } else if (shippingAddress) {
        // Need to geocode address
        const addressString = typeof shippingAddress === 'string' 
          ? shippingAddress 
          : (shippingAddress.address || JSON.stringify(shippingAddress));
        
        const geocodeResult = await GeocodingService.geocodeAddress(addressString);
        if (!geocodeResult.success) {
          return {
            success: false,
            confirmed: false,
            error: 'Could not geocode delivery address',
            details: geocodeResult.error
          };
        }
        deliveryLat = geocodeResult.latitude;
        deliveryLng = geocodeResult.longitude;
        
        // Update order with geocoded address
        const updatedAddress = {
          address: addressString,
          latitude: deliveryLat,
          longitude: deliveryLng,
          formatted_address: geocodeResult.formatted_address
        };
        
        db.updateOrder(orderId, {
          shipping_address: JSON.stringify(updatedAddress),
          drop_point: order.drop_point || JSON.stringify(updatedAddress) // Set drop_point if not set
        });
        deliveryAddress = updatedAddress;
      } else {
        return {
          success: false,
          confirmed: false,
          error: 'No delivery address found in order'
        };
      }
    }

    // Verify location
    const verification = LocationVerification.verifyDeliveryLocation(
      { ...order, shipping_address: { latitude: deliveryLat, longitude: deliveryLng } },
      driverLocation,
      { radiusMeters }
    );

    if (!verification.canAutoConfirm) {
      return {
        success: true,
        confirmed: false,
        reason: verification.reason,
        distance: verification.distance,
        withinRadius: verification.withinRadius
      };
    }

    // Auto-confirm delivery
    const confirmedAt = new Date().toISOString();
    db.updateOrder(orderId, {
      delivery_status: 'delivered',
      status: 'delivered',
      last_location_update: confirmedAt
    });

    // Add tracking event
    const updatedOrder = db.getOrder(orderId); // Get updated order
    let trackingEvents = [];
    if (updatedOrder.tracking_events) {
      try {
        trackingEvents = typeof order.tracking_events === 'string'
          ? JSON.parse(order.tracking_events)
          : order.tracking_events;
      } catch (e) {
        trackingEvents = [];
      }
    }

    trackingEvents.push({
      timestamp: confirmedAt,
      status: 'delivered',
      message: 'Delivery confirmed automatically - driver arrived at destination',
      location: {
        lat: driverLocation.latitude,
        lng: driverLocation.longitude
      },
      distance: verification.distance,
      autoConfirmed: true
    });

    db.updateOrder(orderId, {
      tracking_events: JSON.stringify(trackingEvents)
    });

    // Send notification to tenant
    try {
      const merchant = db.getMerchant(order.merchant_id);
      if (merchant && merchant.email) {
        await EmailService.sendDeliveryConfirmationEmail(
          merchant.email,
          order,
          { autoConfirmed: true, distance: verification.distance }
        );
      }
    } catch (emailError) {
      console.warn('⚠️  Failed to send delivery confirmation email:', emailError.message);
    }

    console.log(`✅ Auto-confirmed delivery for order ${orderId} (distance: ${verification.distance}m)`);

    return {
      success: true,
      confirmed: true,
      orderId: orderId,
      distance: verification.distance,
      confirmedAt: confirmedAt,
      autoConfirmed: true
    };
  } catch (error) {
    console.error('❌ Error auto-confirming delivery:', error);
    return {
      success: false,
      confirmed: false,
      error: error.message
    };
  }
}

/**
 * Manually confirm delivery
 * @param {string} orderId - Order ID
 * @param {Object} options - { confirmedBy: string, notes: string }
 * @returns {Promise<Object>} Confirmation result
 */
async function manualConfirmDelivery(orderId, options = {}) {
  const { confirmedBy = 'tenant', notes = null } = options;

  try {
    const order = db.getOrder(orderId);
    if (!order) {
      return {
        success: false,
        error: 'Order not found'
      };
    }

    if (order.delivery_status === 'delivered') {
      return {
        success: true,
        confirmed: false,
        reason: 'Order already delivered'
      };
    }

    const confirmedAt = new Date().toISOString();
    db.updateOrder(orderId, {
      delivery_status: 'delivered',
      status: 'delivered',
      last_location_update: confirmedAt
    });

    // Add tracking event
    let trackingEvents = [];
    if (order.tracking_events) {
      try {
        trackingEvents = typeof order.tracking_events === 'string'
          ? JSON.parse(order.tracking_events)
          : order.tracking_events;
      } catch (e) {
        trackingEvents = [];
      }
    }

    trackingEvents.push({
      timestamp: confirmedAt,
      status: 'delivered',
      message: `Delivery confirmed manually by ${confirmedBy}`,
      confirmedBy: confirmedBy,
      notes: notes,
      autoConfirmed: false
    });

    db.updateOrder(orderId, {
      tracking_events: JSON.stringify(trackingEvents)
    });

    console.log(`✅ Manually confirmed delivery for order ${orderId} by ${confirmedBy}`);

    return {
      success: true,
      confirmed: true,
      orderId: orderId,
      confirmedAt: confirmedAt,
      confirmedBy: confirmedBy,
      autoConfirmed: false
    };
  } catch (error) {
    console.error('❌ Error manually confirming delivery:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check delivery status and auto-confirm if conditions are met
 * Called periodically for active deliveries
 * @param {string} orderId - Order ID
 * @returns {Promise<Object>} Status check result
 */
async function checkAndConfirmDelivery(orderId) {
  try {
    const order = db.getOrder(orderId);
    if (!order) {
      return {
        success: false,
        error: 'Order not found'
      };
    }

    // Only check orders that are out for delivery
    if (order.delivery_status !== 'out_for_delivery' && order.delivery_status !== 'in_transit') {
      return {
        success: true,
        checked: false,
        reason: `Order status is ${order.delivery_status}, not checking`
      };
    }

    // Check if we have driver location
    if (!order.current_latitude || !order.current_longitude) {
      return {
        success: true,
        checked: false,
        reason: 'Driver location not available'
      };
    }

    // Attempt auto-confirmation
    const result = await autoConfirmDelivery(orderId, {
      latitude: order.current_latitude,
      longitude: order.current_longitude
    });

    return result;
  } catch (error) {
    console.error('❌ Error checking delivery:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  autoConfirmDelivery,
  manualConfirmDelivery,
  checkAndConfirmDelivery
};

