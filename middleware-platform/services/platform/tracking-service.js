/**
 * Tracking Service
 * 
 * Provides utilities for order tracking and location formatting
 * for voice agent communication
 */

/**
 * Format delivery status for voice communication
 */
function formatDeliveryStatusForVoice(order) {
  if (!order) return null;

  const status = order.delivery_status || 'pending';
  const statusMessages = {
    'pending': 'Your order is being prepared',
    'preparing': 'Your order is being prepared',
    'ready': 'Your order is ready for pickup',
    'in_transit': 'Your order is on the way',
    'out_for_delivery': 'Your order is out for delivery',
    'delivered': 'Your order has been delivered',
    'exception': 'There was an issue with your delivery',
    'cancelled': 'Your order has been cancelled'
  };

  let message = statusMessages[status] || 'Your order status is being updated';

  // Add location info if available
  if (order.current_address && (status === 'in_transit' || status === 'out_for_delivery')) {
    message += `. The driver is currently near ${order.current_address}`;
  }

  // Add estimated arrival if available
  if (order.estimated_arrival && (status === 'in_transit' || status === 'out_for_delivery')) {
    try {
      const eta = new Date(order.estimated_arrival);
      const now = new Date();
      const minutesAway = Math.round((eta - now) / (1000 * 60));
      
      if (minutesAway > 0 && minutesAway < 120) {
        message += `. Estimated arrival in about ${minutesAway} minute${minutesAway !== 1 ? 's' : ''}`;
      } else if (minutesAway <= 0) {
        message += `. The driver should arrive very soon`;
      }
    } catch (e) {
      // Ignore date parsing errors
    }
  }

  // Add driver info if available
  if (order.driver_name && (status === 'in_transit' || status === 'out_for_delivery')) {
    message += `. Your driver is ${order.driver_name}`;
    if (order.driver_phone) {
      message += `, and you can reach them at ${formatPhoneForVoice(order.driver_phone)}`;
    }
  }

  return message;
}

/**
 * Format phone number for voice communication
 */
function formatPhoneForVoice(phone) {
  if (!phone) return '';
  
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // Format as (XXX) XXX-XXXX
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  return phone; // Return as-is if can't format
}

/**
 * Get human-readable location from coordinates
 * (In production, you might want to use reverse geocoding API)
 */
function formatLocationForVoice(latitude, longitude, address) {
  if (address) {
    // Extract city/neighborhood from address if possible
    const parts = address.split(',');
    if (parts.length >= 2) {
      return parts[parts.length - 2].trim(); // Usually city
    }
    return address;
  }
  
  // Fallback: return coordinates in a friendly way
  if (latitude && longitude) {
    return `latitude ${latitude.toFixed(4)}, longitude ${longitude.toFixed(4)}`;
  }
  
  return 'an unknown location';
}

/**
 * Get tracking summary for voice agent
 */
function getTrackingSummary(order) {
  if (!order) {
    return {
      available: false,
      message: 'I couldn\'t find tracking information for that order.'
    };
  }

  const status = order.delivery_status || 'pending';
  
  // If order is delivered, provide simple confirmation
  if (status === 'delivered') {
    return {
      available: true,
      message: 'Great news! Your order has been delivered.',
      status: 'delivered'
    };
  }

  // If order is cancelled
  if (status === 'cancelled') {
    return {
      available: true,
      message: 'I\'m sorry, but your order has been cancelled.',
      status: 'cancelled'
    };
  }

  // For active orders, provide detailed status
  const statusMessage = formatDeliveryStatusForVoice(order);
  
  return {
    available: true,
    message: statusMessage,
    status: status,
    hasLocation: !!(order.current_latitude && order.current_longitude),
    hasDriver: !!(order.driver_name),
    estimatedArrival: order.estimated_arrival || null
  };
}

module.exports = {
  formatDeliveryStatusForVoice,
  formatPhoneForVoice,
  formatLocationForVoice,
  getTrackingSummary
};

