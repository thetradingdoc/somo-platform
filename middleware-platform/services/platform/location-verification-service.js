/**
 * Location Verification Service
 * 
 * Handles distance calculation, proximity detection, and auto-delivery confirmation
 * based on driver location vs customer delivery address.
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) {
    return null;
  }

  // Validate coordinates
  if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
    throw new Error('Invalid latitude (must be between -90 and 90)');
  }
  if (lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) {
    throw new Error('Invalid longitude (must be between -180 and 180)');
  }

  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Check if driver is within delivery radius of customer address
 * @param {number} driverLat - Driver's current latitude
 * @param {number} driverLng - Driver's current longitude
 * @param {number} deliveryLat - Delivery address latitude
 * @param {number} deliveryLng - Delivery address longitude
 * @param {number} radiusMeters - Delivery radius in meters (default: 100)
 * @returns {Object} { withinRadius: boolean, distance: number }
 */
function checkProximity(driverLat, driverLng, deliveryLat, deliveryLng, radiusMeters = 100) {
  try {
    const distance = calculateDistance(driverLat, driverLng, deliveryLat, deliveryLng);
    
    if (distance === null) {
      return {
        withinRadius: false,
        distance: null,
        error: 'Invalid coordinates provided'
      };
    }

    return {
      withinRadius: distance <= radiusMeters,
      distance: distance,
      radius: radiusMeters,
      error: null
    };
  } catch (error) {
    return {
      withinRadius: false,
      distance: null,
      error: error.message
    };
  }
}

/**
 * Verify if delivery should be auto-confirmed based on location
 * @param {Object} order - Order object with location data
 * @param {Object} driverLocation - Current driver location { latitude, longitude }
 * @param {Object} options - Configuration options
 * @returns {Object} Verification result
 */
function verifyDeliveryLocation(order, driverLocation, options = {}) {
  const {
    radiusMeters = parseInt(process.env.DELIVERY_RADIUS_METERS || '100'),
    requireStableLocation = true,
    stableLocationDuration = 30 // seconds
  } = options;

  // Check if order has delivery address coordinates
  if (!order.shipping_address) {
    return {
      canAutoConfirm: false,
      reason: 'No delivery address found',
      distance: null
    };
  }

  // Parse shipping address to get coordinates
  let deliveryLat, deliveryLng;
  try {
    const shippingAddress = typeof order.shipping_address === 'string'
      ? JSON.parse(order.shipping_address)
      : order.shipping_address;

    // If address has coordinates, use them
    if (shippingAddress.latitude && shippingAddress.longitude) {
      deliveryLat = shippingAddress.latitude;
      deliveryLng = shippingAddress.longitude;
    } else {
      // Need to geocode address first
      return {
        canAutoConfirm: false,
        reason: 'Delivery address needs geocoding',
        distance: null,
        requiresGeocoding: true
      };
    }
  } catch (e) {
    return {
      canAutoConfirm: false,
      reason: 'Invalid shipping address format',
      distance: null
    };
  }

  // Check if driver location is provided
  if (!driverLocation || !driverLocation.latitude || !driverLocation.longitude) {
    return {
      canAutoConfirm: false,
      reason: 'Driver location not available',
      distance: null
    };
  }

  // Check proximity
  const proximity = checkProximity(
    driverLocation.latitude,
    driverLocation.longitude,
    deliveryLat,
    deliveryLng,
    radiusMeters
  );

  if (proximity.error) {
    return {
      canAutoConfirm: false,
      reason: proximity.error,
      distance: null
    };
  }

  // Check if location has been stable (if required)
  if (requireStableLocation && order.last_location_update) {
    const lastUpdate = new Date(order.last_location_update);
    const now = new Date();
    const secondsSinceUpdate = (now - lastUpdate) / 1000;

    if (secondsSinceUpdate < stableLocationDuration) {
      return {
        canAutoConfirm: false,
        reason: 'Location not stable long enough',
        distance: proximity.distance,
        withinRadius: proximity.withinRadius,
        secondsSinceUpdate: secondsSinceUpdate
      };
    }
  }

  return {
    canAutoConfirm: proximity.withinRadius,
    reason: proximity.withinRadius
      ? 'Driver is within delivery radius'
      : `Driver is ${Math.round(proximity.distance)}m away (radius: ${radiusMeters}m)`,
    distance: proximity.distance,
    withinRadius: proximity.withinRadius,
    deliveryLat,
    deliveryLng,
    driverLat: driverLocation.latitude,
    driverLng: driverLocation.longitude
  };
}

/**
 * Format distance for display
 * @param {number} distanceMeters - Distance in meters
 * @returns {string} Formatted distance
 */
function formatDistance(distanceMeters) {
  if (distanceMeters === null || distanceMeters === undefined) {
    return 'Unknown';
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)}m`;
  } else {
    const km = (distanceMeters / 1000).toFixed(2);
    return `${km}km`;
  }
}

module.exports = {
  calculateDistance,
  checkProximity,
  verifyDeliveryLocation,
  formatDistance
};

