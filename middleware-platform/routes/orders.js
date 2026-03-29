/**
 * ORDERS ROUTES
 * Order management endpoints (merged from merchant-shop)
 * All routes require customer authentication and are scoped to customer's merchant
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { requireCustomerAuth, requireMerchant } = require('../middleware/customer-auth');
const { apiLimiter } = require('../middleware/rate-limiter');
const {
  resolvePrescriptionId,
  withProviderAliases,
  mapOrderRow,
  mapOrdersRows,
  logAliasUsage
} = require('../utils/naming-aliases');
const router = express.Router();

/**
 * Validate coordinates
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateCoordinates(latitude, longitude) {
  if (latitude === undefined || longitude === undefined) {
    return { valid: true }; // Optional fields, skip validation if not provided
  }

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { valid: false, error: 'Latitude and longitude must be numbers' };
  }

  if (isNaN(latitude) || isNaN(longitude)) {
    return { valid: false, error: 'Latitude and longitude must be valid numbers' };
  }

  if (latitude < -90 || latitude > 90) {
    return { valid: false, error: 'Latitude must be between -90 and 90' };
  }

  if (longitude < -180 || longitude > 180) {
    return { valid: false, error: 'Longitude must be between -180 and 180' };
  }

  return { valid: true };
}

/**
 * Get all orders
 * GET /api/orders
 * Returns orders scoped to authenticated customer's merchant
 */
router.get('/', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    logAliasUsage('orders-list', req);
    // Scope to customer's merchant_id (from auth middleware)
    const merchant_id = req.merchant_id;
    const orders = db.getOrdersByMerchant(merchant_id);
    const mapped = mapOrdersRows(orders);
    res.json(withProviderAliases({
      success: true,
      orders: mapped,
      prescription_orders: mapped,
      count: orders.length
    }, merchant_id));
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get single order
 * GET /api/orders/:id
 * Returns order only if it belongs to customer's merchant
 */
router.get('/:id', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    const order = db.getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    // Verify order belongs to customer's merchant
    if (order.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This order does not belong to your merchant account.'
      });
    }
    
    res.json(withProviderAliases({ success: true, order: mapOrderRow(order) }, req.merchant_id));
  } catch (error) {
    console.error('❌ Error fetching order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Create order
 * POST /api/orders
 * Creates order for customer's merchant (merchant_id from auth)
 */
router.post('/', requireCustomerAuth, requireMerchant, (req, res) => {
  try { db.incrementOpsCounter && db.incrementOpsCounter('merchant_order_create_attempt'); } catch (_) {}
  const idempotencyKey = req.header('Idempotency-Key') || req.body?.idempotency_key || null;
  const operationType = 'order_create';
  const reservation = db.reserveIdempotencyKey(idempotencyKey, operationType);
  if (reservation === 'completed') {
    const cached = db.getIdempotentResult(idempotencyKey, operationType);
    if (cached?.result) return res.status(200).json(cached.result);
  }
  if (reservation === 'in_progress') {
    return res.status(409).json({ success: false, error: 'Duplicate order request in progress' });
  }

  try {
    logAliasUsage('orders-create', req);
    const {
      quantity,
      customer_email,
      customer_name,
      customer_phone,
      shipping_address,
      pickup_address,
      pickup_latitude,
      pickup_longitude,
      drop_point,
      source
    } = req.body;
    const product_id = resolvePrescriptionId(req.body || {});

    if (!product_id || !quantity || !customer_email) {
      db.releaseIdempotencyKey(idempotencyKey, operationType);
      return res.status(400).json({
        success: false,
        error: 'prescription_id (or product_id), quantity, and customer_email are required'
      });
    }

    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) {
      db.releaseIdempotencyKey(idempotencyKey, operationType);
      return res.status(400).json({
        success: false,
        error: 'quantity must be a positive integer'
      });
    }

    // Validate coordinates if provided
    if (pickup_latitude !== undefined || pickup_longitude !== undefined) {
      const coordValidation = validateCoordinates(pickup_latitude, pickup_longitude);
      if (!coordValidation.valid) {
        db.releaseIdempotencyKey(idempotencyKey, operationType);
        return res.status(400).json({
          success: false,
          error: `Invalid pickup coordinates: ${coordValidation.error || 'Invalid coordinates'}`
        });
      }
    }

    // Use merchant_id from authenticated customer (not from request body)
    const merchant_id = req.merchant_id;

    // Validate product and inventory
    const product = db.getProduct(product_id);
    if (!product) {
      db.releaseIdempotencyKey(idempotencyKey, operationType);
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // Verify product belongs to customer's merchant
    if (product.merchant_id !== merchant_id) {
      db.releaseIdempotencyKey(idempotencyKey, operationType);
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This product does not belong to your merchant account.'
      });
    }

    if (product.inventory < quantity) {
      db.releaseIdempotencyKey(idempotencyKey, operationType);
      return res.status(400).json({ success: false, error: 'Insufficient inventory' });
    }

    // Calculate total
    const total_amount = product.price * quantity;

    // Create order with pickup and drop point locations
    const order = {
      id: uuidv4(),
      merchant_id: merchant_id, // Use from auth
      product_id,
      quantity,
      customer_email,
      customer_name,
      customer_phone,
      shipping_address,
      pickup_address: pickup_address || null, // Pickup/from location
      pickup_latitude: pickup_latitude || null,
      pickup_longitude: pickup_longitude || null,
      drop_point: drop_point || shipping_address, // Drop point (delivery address)
      total_amount,
      status: 'pending',
      payment_status: 'pending_payment',
      source: source || 'direct'
    };

    db.createOrder(order);
    
    // Update inventory atomically
    db.updateInventory(product_id, quantity);

    // Fetch full order with product details
    const fullOrder = db.getOrder(order.id);

    const payload = withProviderAliases({
      success: true,
      order: mapOrderRow(fullOrder)
    }, merchant_id);
    db.completeIdempotentResult(idempotencyKey, operationType, payload);
    try { db.incrementOpsCounter && db.incrementOpsCounter('merchant_order_create_success'); } catch (_) {}
    console.log('📊 [agentic-commerce] order_created', {
      order_id: fullOrder?.id,
      merchant_id,
      source: source || 'direct',
      payment_status: fullOrder?.payment_status
    });
    res.status(201).json(payload);
  } catch (error) {
    db.releaseIdempotencyKey(idempotencyKey, operationType);
    try { db.incrementOpsCounter && db.incrementOpsCounter('merchant_order_create_failed'); } catch (_) {}
    console.error('❌ Error creating order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update order status
 * PUT /api/orders/:id/status
 * Updates order only if it belongs to customer's merchant
 */
router.put('/:id/status', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required' });
    }

    const order = db.getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Verify order belongs to customer's merchant
    if (order.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This order does not belong to your merchant account.'
      });
    }

    db.updateOrderStatus(req.params.id, status);
    const updatedOrder = db.getOrder(req.params.id);
    try { db.incrementOpsCounter && db.incrementOpsCounter('merchant_order_status_updated'); } catch (_) {}
    console.log('📊 [agentic-commerce] order_status_updated', {
      order_id: req.params.id,
      merchant_id: req.merchant_id,
      status
    });
    
    res.json(withProviderAliases({ success: true, order: mapOrderRow(updatedOrder) }, req.merchant_id));
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update order
 * PUT /api/orders/:id
 * Updates order only if it belongs to customer's merchant
 */
router.put('/:id', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    const order = db.getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Verify order belongs to customer's merchant
    if (order.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This order does not belong to your merchant account.'
      });
    }

    // Remove merchant_id / provider_id from update body (cannot change tenant)
    const { merchant_id, provider_id, pickup_latitude, pickup_longitude, ...updateData } = req.body;

    // Validate coordinates if provided
    if (pickup_latitude !== undefined || pickup_longitude !== undefined) {
      const coordValidation = validateCoordinates(pickup_latitude, pickup_longitude);
      if (!coordValidation.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid pickup coordinates: ${coordValidation.error || 'Invalid coordinates'}`
        });
      }
      // Add validated coordinates to updateData
      if (pickup_latitude !== undefined) updateData.pickup_latitude = pickup_latitude;
      if (pickup_longitude !== undefined) updateData.pickup_longitude = pickup_longitude;
    }

    const result = db.updateOrder(req.params.id, updateData);
    if (result.changes === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    const updatedOrder = db.getOrder(req.params.id);
    res.json(withProviderAliases({ success: true, order: mapOrderRow(updatedOrder) }, req.merchant_id));
  } catch (error) {
    console.error('❌ Error updating order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get order tracking information
 * GET /api/orders/:id/tracking
 * Returns tracking only if order belongs to customer's merchant
 */
router.get('/:id/tracking', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    const order = db.getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Verify order belongs to customer's merchant
    if (order.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This order does not belong to your merchant account.'
      });
    }

    // Parse tracking events if stored as JSON string
    let trackingEvents = [];
    if (order.tracking_events) {
      try {
        trackingEvents = typeof order.tracking_events === 'string' 
          ? JSON.parse(order.tracking_events) 
          : order.tracking_events;
      } catch (e) {
        console.warn('⚠️  Failed to parse tracking_events:', e.message);
      }
    }

    res.json({
      success: true,
      tracking: {
        order_id: order.id,
        provider_id: order.merchant_id,
        merchant_id: order.merchant_id,
        prescription_id: order.product_id,
        product_id: order.product_id,
        delivery_status: order.delivery_status || 'pending',
        driver_name: order.driver_name || null,
        driver_phone: order.driver_phone || null,
        current_location: order.current_latitude && order.current_longitude
          ? {
              latitude: order.current_latitude,
              longitude: order.current_longitude,
              address: order.current_address || null
            }
          : null,
        estimated_arrival: order.estimated_arrival || null,
        last_location_update: order.last_location_update || null,
        events: trackingEvents,
        shipping_address: order.shipping_address ? 
          (typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : order.shipping_address)
          : null
      }
    });
  } catch (error) {
    console.error('❌ Error fetching tracking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update order tracking (webhook for dispensary delivery system)
 * POST /api/orders/:id/tracking
 * Updates tracking only if order belongs to customer's merchant
 * 
 * Expected payload:
 * {
 *   "delivery_status": "out_for_delivery" | "in_transit" | "delivered" | "exception",
 *   "driver_name": "John Doe",
 *   "driver_phone": "+1234567890",
 *   "latitude": 40.7128,
 *   "longitude": -74.0060,
 *   "address": "123 Main St, City, State",
 *   "estimated_arrival": "2024-12-01T15:30:00Z",
 *   "event": {
 *     "timestamp": "2024-12-01T14:00:00Z",
 *     "status": "out_for_delivery",
 *     "message": "Driver is on the way",
 *     "location": { "lat": 40.7128, "lng": -74.0060 }
 *   }
 * }
 */
router.post('/:id/tracking', apiLimiter, requireCustomerAuth, requireMerchant, async (req, res) => {
  try {
    const { id } = req.params;
    const order = db.getOrder(id);
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Verify order belongs to customer's merchant
    if (order.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This order does not belong to your merchant account.'
      });
    }

    const {
      delivery_status,
      driver_name,
      driver_phone,
      latitude,
      longitude,
      address,
      estimated_arrival,
      event
    } = req.body;

    // Validate coordinates if provided
    if (latitude !== undefined || longitude !== undefined) {
      const coordValidation = validateCoordinates(latitude, longitude);
      if (!coordValidation.valid) {
        return res.status(400).json({
          success: false,
          error: coordValidation.error || 'Invalid coordinates'
        });
      }
    }

    // Validate delivery_status if provided
    const validStatuses = ['pending', 'out_for_delivery', 'in_transit', 'delivered', 'exception', 'cancelled'];
    if (delivery_status && !validStatuses.includes(delivery_status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid delivery_status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Build update object
    const updates = {};
    if (delivery_status) updates.delivery_status = delivery_status;
    if (driver_name) updates.driver_name = driver_name;
    if (driver_phone) updates.driver_phone = driver_phone;
    if (latitude !== undefined) updates.current_latitude = latitude;
    if (longitude !== undefined) updates.current_longitude = longitude;
    if (address) updates.current_address = address;
    if (estimated_arrival) updates.estimated_arrival = estimated_arrival;
    updates.last_location_update = new Date().toISOString();

    // Add tracking event if provided
    if (event) {
      let trackingEvents = [];
      if (order.tracking_events) {
        try {
          trackingEvents = typeof order.tracking_events === 'string'
            ? JSON.parse(order.tracking_events)
            : order.tracking_events;
        } catch (e) {
          console.warn('⚠️  Failed to parse existing tracking_events');
        }
      }
      
      trackingEvents.push({
        ...event,
        timestamp: event.timestamp || new Date().toISOString()
      });
      
      // Keep only last 50 events
      if (trackingEvents.length > 50) {
        trackingEvents = trackingEvents.slice(-50);
      }
      
      updates.tracking_events = trackingEvents;
    }

    // Update order
    db.updateOrder(id, updates);
    const updatedOrder = db.getOrder(id);

    // Auto-confirm delivery if driver is within radius
    if (latitude !== undefined && longitude !== undefined && 
        (delivery_status === 'out_for_delivery' || delivery_status === 'in_transit')) {
      try {
        const DeliveryConfirmation = require('../services/delivery-confirmation-service');
        const confirmationResult = await DeliveryConfirmation.checkAndConfirmDelivery(id);
        
        if (confirmationResult.confirmed) {
          console.log(`✅ Auto-confirmed delivery for order ${id}`);
          // Re-fetch order to get updated status
          const finalOrder = db.getOrder(id);
          return res.json(withProviderAliases({
            success: true,
            message: 'Tracking updated and delivery auto-confirmed',
            order: mapOrderRow(finalOrder),
            autoConfirmed: true,
            distance: confirmationResult.distance
          }, req.merchant_id));
        }
      } catch (confirmationError) {
        console.warn('⚠️  Auto-confirmation check failed:', confirmationError.message);
        // Continue with normal response even if auto-confirmation fails
      }
    }

    console.log(`✅ Tracking updated for order ${id}: ${delivery_status || 'location update'}`);

    res.json(withProviderAliases({
      success: true,
      message: 'Tracking updated successfully',
      order: mapOrderRow(updatedOrder)
    }, req.merchant_id));
  } catch (error) {
    console.error('❌ Error updating tracking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get Google Maps API key for frontend (tenant only)
 * GET /api/orders/config/maps
 * Returns Google Maps API key for authenticated tenant
 */
router.get('/config/maps', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    const mapProvider = googleApiKey ? 'google' : 'leaflet'; // Default to free Leaflet
    
    res.json({
      success: true,
      provider: mapProvider,
      // Only return Google API key if configured
      apiKey: googleApiKey || null,
      // Configuration
      deliveryRadius: parseInt(process.env.DELIVERY_RADIUS_METERS || '100'),
      autoConfirmEnabled: process.env.AUTO_CONFIRM_DELIVERY !== 'false',
      // Note about free provider
      note: mapProvider === 'leaflet' 
        ? 'Using free Leaflet + OpenStreetMap (no API key required)'
        : 'Using Google Maps (API key configured)'
    });
  } catch (error) {
    console.error('❌ Error fetching maps config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Manually confirm delivery
 * POST /api/orders/:id/confirm-delivery
 * Allows tenant to manually confirm delivery
 */
router.post('/:id/confirm-delivery', requireCustomerAuth, requireMerchant, async (req, res) => {
  try {
    const { id } = req.params;
    const order = db.getOrder(id);
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Verify order belongs to customer's merchant
    if (order.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This order does not belong to your merchant account.'
      });
    }

    if (order.delivery_status === 'delivered') {
      return res.json(withProviderAliases({
        success: true,
        message: 'Order already delivered',
        order: mapOrderRow(order)
      }, req.merchant_id));
    }

    // Use delivery confirmation service
    const DeliveryConfirmation = require('../services/delivery-confirmation-service');
    const result = await DeliveryConfirmation.manualConfirmDelivery(id, {
      confirmedBy: 'tenant',
      notes: 'Manually confirmed via dashboard'
    });

    if (result.success) {
      const updatedOrder = db.getOrder(id);
      res.json(withProviderAliases({
        success: true,
        message: 'Delivery confirmed successfully',
        order: mapOrderRow(updatedOrder)
      }, req.merchant_id));
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to confirm delivery'
      });
    }
  } catch (error) {
    console.error('❌ Error confirming delivery:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

