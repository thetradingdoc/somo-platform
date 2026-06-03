/**
 * Geocoding Service
 * 
 * Converts addresses to coordinates and vice versa using Nominatim (OpenStreetMap)
 * FREE - No API key required, but has usage limits (1 request/second)
 * Includes caching to reduce API calls
 * 
 * Falls back to Google Maps if GOOGLE_MAPS_API_KEY is set (for better accuracy)
 */

const axios = require('axios');
const db = require('../database');

// Cache for geocoded addresses (in-memory, can be moved to Redis in production)
const geocodeCache = new Map();
const CACHE_TTL = parseInt(process.env.GEOCODING_CACHE_TTL || '86400') * 1000; // Default 24 hours in milliseconds

// Rate limiting for Nominatim (1 request per second)
let lastNominatimRequest = 0;
const NOMINATIM_MIN_INTERVAL = 1000; // 1 second

/**
 * Geocode an address to coordinates
 * Uses Nominatim (OpenStreetMap) - FREE, no API key needed
 * Falls back to Google Maps if API key is configured
 * 
 * @param {string} address - Address to geocode
 * @param {Object} options - Options { useCache: true, preferGoogle: false }
 * @returns {Promise<Object>} { latitude, longitude, formatted_address }
 */
async function geocodeAddress(address, options = {}) {
  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    return {
      success: false,
      error: 'Invalid address provided'
    };
  }

  const { useCache = true, preferGoogle = false } = options;
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;

  // Check cache first
  if (useCache) {
    const cacheKey = address.toLowerCase().trim();
    const cached = geocodeCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`✅ Geocoding cache hit for: ${address.substring(0, 50)}...`);
      return {
        success: true,
        ...cached.data,
        fromCache: true
      };
    }
  }

  // Try Google Maps first if API key is configured and preferred
  if (preferGoogle && googleApiKey) {
    const googleResult = await geocodeWithGoogle(address, googleApiKey, useCache);
    if (googleResult.success) {
      return googleResult;
    }
    // Fall through to Nominatim if Google fails
  }

  // Use Nominatim (OpenStreetMap) - FREE, no API key needed
  return await geocodeWithNominatim(address, useCache);
}

/**
 * Geocode using Nominatim (OpenStreetMap) - FREE
 */
async function geocodeWithNominatim(address, useCache = true) {
  try {
    // Rate limiting: Nominatim allows 1 request per second
    const now = Date.now();
    const timeSinceLastRequest = now - lastNominatimRequest;
    if (timeSinceLastRequest < NOMINATIM_MIN_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, NOMINATIM_MIN_INTERVAL - timeSinceLastRequest));
    }
    lastNominatimRequest = Date.now();

    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 1,
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'Somo-Delivery-Tracking/1.0' // Required by Nominatim
      },
      timeout: 5000
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];

      const geocodeResult = {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        formatted_address: result.display_name,
        place_id: result.place_id || null,
        address_components: result.address ? {
          street: result.address.road || null,
          city: result.address.city || result.address.town || result.address.village || null,
          state: result.address.state || null,
          zip: result.address.postcode || null,
          country: result.address.country || null
        } : null
      };

      // Cache the result
      if (useCache) {
        const cacheKey = address.toLowerCase().trim();
        geocodeCache.set(cacheKey, {
          data: geocodeResult,
          timestamp: Date.now()
        });
        console.log(`✅ Geocoded with Nominatim and cached: ${address.substring(0, 50)}...`);
      }

      return {
        success: true,
        ...geocodeResult,
        fromCache: false,
        provider: 'nominatim'
      };
    } else {
      return {
        success: false,
        error: 'No results found for this address',
        status: 'ZERO_RESULTS',
        provider: 'nominatim'
      };
    }
  } catch (error) {
    console.error('❌ Nominatim geocoding error:', error.message);
    return {
      success: false,
      error: error.message || 'Geocoding service unavailable',
      provider: 'nominatim'
    };
  }
}

/**
 * Geocode using Google Maps (if API key is available)
 */
async function geocodeWithGoogle(address, apiKey, useCache = true) {
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: address,
        key: apiKey
      },
      timeout: 5000
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const location = result.geometry.location;

      const geocodeResult = {
        latitude: location.lat,
        longitude: location.lng,
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        address_components: result.address_components,
        location_type: result.geometry.location_type
      };

      // Cache the result
      if (useCache) {
        const cacheKey = address.toLowerCase().trim();
        geocodeCache.set(cacheKey, {
          data: geocodeResult,
          timestamp: Date.now()
        });
        console.log(`✅ Geocoded with Google Maps and cached: ${address.substring(0, 50)}...`);
      }

      return {
        success: true,
        ...geocodeResult,
        fromCache: false,
        provider: 'google'
      };
    } else {
      return {
        success: false,
        error: `Geocoding failed: ${response.data.status}`,
        status: response.data.status,
        provider: 'google'
      };
    }
  } catch (error) {
    console.error('❌ Google Maps geocoding error:', error.message);
    return {
      success: false,
      error: error.message || 'Google Maps geocoding unavailable',
      provider: 'google'
    };
  }
}

/**
 * Reverse geocode coordinates to address
 * Uses Nominatim (OpenStreetMap) - FREE, no API key needed
 * Falls back to Google Maps if API key is configured
 * 
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @param {Object} options - Options { useCache: true, preferGoogle: false }
 * @returns {Promise<Object>} { formatted_address, address_components }
 */
async function reverseGeocode(latitude, longitude, options = {}) {
  if (latitude === null || latitude === undefined || 
      longitude === null || longitude === undefined) {
    return {
      success: false,
      error: 'Invalid coordinates provided'
    };
  }

  // Validate coordinates
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      success: false,
      error: 'Coordinates out of valid range'
    };
  }

  const { useCache = true, preferGoogle = false } = options;
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;

  // Check cache
  if (useCache) {
    const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    const cached = geocodeCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`✅ Reverse geocoding cache hit for: ${cacheKey}`);
      return {
        success: true,
        ...cached.data,
        fromCache: true
      };
    }
  }

  // Try Google Maps first if API key is configured and preferred
  if (preferGoogle && googleApiKey) {
    const googleResult = await reverseGeocodeWithGoogle(latitude, longitude, googleApiKey, useCache);
    if (googleResult.success) {
      return googleResult;
    }
    // Fall through to Nominatim if Google fails
  }

  // Use Nominatim (OpenStreetMap) - FREE
  return await reverseGeocodeWithNominatim(latitude, longitude, useCache);
}

/**
 * Reverse geocode using Nominatim (OpenStreetMap) - FREE
 */
async function reverseGeocodeWithNominatim(latitude, longitude, useCache = true) {
  try {
    // Rate limiting: Nominatim allows 1 request per second
    const now = Date.now();
    const timeSinceLastRequest = now - lastNominatimRequest;
    if (timeSinceLastRequest < NOMINATIM_MIN_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, NOMINATIM_MIN_INTERVAL - timeSinceLastRequest));
    }
    lastNominatimRequest = Date.now();

    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat: latitude,
        lon: longitude,
        format: 'json',
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'Somo-Delivery-Tracking/1.0' // Required by Nominatim
      },
      timeout: 5000
    });

    if (response.data) {
      const result = response.data;
      
      const reverseGeocodeResult = {
        formatted_address: result.display_name,
        place_id: result.place_id || null,
        address_components: result.address ? {
          street: result.address.road || null,
          city: result.address.city || result.address.town || result.address.village || null,
          state: result.address.state || null,
          zip: result.address.postcode || null,
          country: result.address.country || null
        } : null
      };

      // Cache the result
      if (useCache) {
        const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        geocodeCache.set(cacheKey, {
          data: reverseGeocodeResult,
          timestamp: Date.now()
        });
      }

      return {
        success: true,
        ...reverseGeocodeResult,
        fromCache: false,
        provider: 'nominatim'
      };
    } else {
      return {
        success: false,
        error: 'No results found for these coordinates',
        status: 'ZERO_RESULTS',
        provider: 'nominatim'
      };
    }
  } catch (error) {
    console.error('❌ Nominatim reverse geocoding error:', error.message);
    return {
      success: false,
      error: error.message || 'Reverse geocoding service unavailable',
      provider: 'nominatim'
    };
  }
}

/**
 * Reverse geocode using Google Maps (if API key is available)
 */
async function reverseGeocodeWithGoogle(latitude, longitude, apiKey, useCache = true) {
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        latlng: `${latitude},${longitude}`,
        key: apiKey
      },
      timeout: 5000
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      
      const reverseGeocodeResult = {
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        address_components: result.address_components,
        location_type: result.geometry.location_type
      };

      // Cache the result
      if (useCache) {
        const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        geocodeCache.set(cacheKey, {
          data: reverseGeocodeResult,
          timestamp: Date.now()
        });
      }

      return {
        success: true,
        ...reverseGeocodeResult,
        fromCache: false,
        provider: 'google'
      };
    } else {
      return {
        success: false,
        error: `Reverse geocoding failed: ${response.data.status}`,
        status: response.data.status,
        provider: 'google'
      };
    }
  } catch (error) {
    console.error('❌ Google Maps reverse geocoding error:', error.message);
    return {
      success: false,
      error: error.message || 'Google Maps reverse geocoding unavailable',
      provider: 'google'
    };
  }
}

/**
 * Geocode order shipping address and update order with coordinates
 * @param {Object} order - Order object
 * @returns {Promise<Object>} Updated order with coordinates
 */
async function geocodeOrderAddress(order) {
  if (!order.shipping_address) {
    return {
      success: false,
      error: 'Order has no shipping address'
    };
  }

  // Parse shipping address
  let addressString;
  try {
    const shippingAddress = typeof order.shipping_address === 'string'
      ? JSON.parse(order.shipping_address)
      : order.shipping_address;

    // If already has coordinates, return early
    if (shippingAddress.latitude && shippingAddress.longitude) {
      return {
        success: true,
        order: order,
        alreadyGeocoded: true
      };
    }

    // Build address string
    if (typeof shippingAddress === 'string') {
      addressString = shippingAddress;
    } else {
      addressString = [
        shippingAddress.street,
        shippingAddress.city,
        shippingAddress.state,
        shippingAddress.zip
      ].filter(Boolean).join(', ');
    }
  } catch (e) {
    addressString = order.shipping_address;
  }

  // Geocode the address
  const geocodeResult = await geocodeAddress(addressString);

  if (!geocodeResult.success) {
    return {
      success: false,
      error: geocodeResult.error,
      order: order
    };
  }

  // Update shipping address with coordinates
  let updatedShippingAddress;
  try {
    const currentAddress = typeof order.shipping_address === 'string'
      ? JSON.parse(order.shipping_address)
      : order.shipping_address;

    updatedShippingAddress = {
      ...(typeof currentAddress === 'object' ? currentAddress : { address: currentAddress }),
      latitude: geocodeResult.latitude,
      longitude: geocodeResult.longitude,
      formatted_address: geocodeResult.formatted_address,
      place_id: geocodeResult.place_id
    };
  } catch (e) {
    updatedShippingAddress = {
      address: order.shipping_address,
      latitude: geocodeResult.latitude,
      longitude: geocodeResult.longitude,
      formatted_address: geocodeResult.formatted_address,
      place_id: geocodeResult.place_id
    };
  }

  return {
    success: true,
    order: {
      ...order,
      shipping_address: updatedShippingAddress
    },
    coordinates: {
      latitude: geocodeResult.latitude,
      longitude: geocodeResult.longitude
    },
    alreadyGeocoded: false
  };
}

/**
 * Clear geocoding cache
 */
function clearCache() {
  geocodeCache.clear();
  console.log('✅ Geocoding cache cleared');
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    size: geocodeCache.size,
    ttl: CACHE_TTL / 1000 // in seconds
  };
}

module.exports = {
  geocodeAddress,
  reverseGeocode,
  geocodeOrderAddress,
  clearCache,
  getCacheStats
};

