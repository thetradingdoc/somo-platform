# Geolocation Tracking - Quick Start Guide

## ✅ What's Been Implemented

### Backend Services
1. **Location Verification Service** - Distance calculation, proximity detection
2. **Geocoding Service** - Address ↔ Coordinates conversion with caching
3. **Delivery Confirmation Service** - Auto/manual delivery confirmation

### Frontend UI
1. **Tenant Dashboard** (`unified-dashboard/business/orders.html`)
   - Interactive Google Maps with real-time tracking
   - "Track Delivery" button on active orders
   - Shows customer address (red marker) and driver location (blue marker)
   - Delivery radius circle visualization
   - Manual delivery confirmation button
   - Auto-updates every 15 seconds

2. **Customer View** (`public/customer/order-tracking.html`)
   - Simple, text-based tracking interface
   - Enter order ID or email to track
   - Shows delivery status, driver info, ETA
   - No map required (simple and fast)

### API Endpoints
- `GET /api/orders/config/maps` - Get Google Maps API key (tenant only)
- `GET /api/orders/:id/tracking` - Get order tracking info
- `POST /api/orders/:id/tracking` - Update location (from driver app)
- `POST /api/orders/:id/confirm-delivery` - Manually confirm delivery

---

## 🔑 Environment Variables Setup

Add these to your `.env` file or Azure App Settings:

```bash
# Required
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# Optional (with defaults)
DELIVERY_RADIUS_METERS=100              # Auto-confirm radius (default: 100m)
AUTO_CONFIRM_DELIVERY=true              # Enable auto-confirmation (default: true)
LOCATION_UPDATE_INTERVAL=15             # Polling interval in seconds (default: 15)
GEOCODING_CACHE_TTL=86400               # Cache TTL in seconds (default: 24 hours)
```

### Getting Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/Select a project
3. Enable APIs:
   - Maps JavaScript API
   - Geocoding API
4. Create API Key (Credentials → Create Credentials → API Key)
5. Restrict the key:
   - Application restrictions: HTTP referrers
   - Add: `https://api.doclittle.site/*`, `https://*.doclittle.site/*`
   - API restrictions: Select only Maps JavaScript API and Geocoding API
6. Copy key to `.env` file

**Cost**: Free tier = $200/month credit (~28,000 map loads)

---

## 🚀 How It Works

### For Tenant (Dashboard)
1. View orders in dashboard
2. Click "📍 Track Delivery" on active orders
3. See map with:
   - Customer delivery address (red marker)
   - Driver current location (blue marker, updates every 15s)
   - Delivery radius circle (100m default)
   - Route line between driver and customer
4. Click "Confirm Delivery" to manually confirm
5. Auto-confirmation happens when driver is within radius

### For Customer
1. Visit `/customer/order-tracking.html`
2. Enter order ID or email
3. See delivery status, driver info, ETA
4. Simple text-based interface (no map needed)

### For Driver App (External System)
Send location updates via:
```bash
POST /api/orders/:order_id/tracking
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "delivery_status": "out_for_delivery",
  "driver_name": "John Doe",
  "driver_phone": "+1234567890",
  "address": "123 Main St, New York, NY"
}
```

System will:
- Store location in database
- Auto-confirm delivery if within radius
- Update map in real-time for tenant

---

## 📊 Monitoring

### Current Logging
- ✅ Location updates logged to console
- ✅ Auto-confirmation events logged
- ✅ Geocoding cache statistics
- ✅ Tracking events stored in database

### View Tracking Data
```sql
SELECT 
  id, 
  delivery_status, 
  current_latitude, 
  current_longitude,
  last_location_update,
  tracking_events
FROM merchant_orders 
WHERE delivery_status IN ('out_for_delivery', 'in_transit')
ORDER BY last_location_update DESC;
```

---

## 🧪 Testing

### Test Location Verification
```javascript
const LocationVerification = require('./services/location-verification-service');
const result = LocationVerification.checkProximity(
  40.7128, -74.0060, // Driver (NYC)
  40.7580, -73.9855, // Delivery (Times Square)
  100 // 100m radius
);
console.log(result); // { withinRadius: true/false, distance: 1234 }
```

### Test Geocoding
```javascript
const Geocoding = require('./services/geocoding-service');
const result = await Geocoding.geocodeAddress('123 Main St, New York, NY');
console.log(result); // { success: true, latitude: 40.7128, longitude: -74.0060 }
```

---

## 📋 Remaining Tasks

- [ ] Admin dashboard (monitor all deliveries)
- [ ] Analytics endpoint (delivery metrics)
- [ ] Test files (location verification, geocoding, confirmation)
- [ ] Location update history table (for analytics)

---

## 🎯 Next Steps

1. **Add Google Maps API key** to `.env`
2. **Test tenant dashboard** - Click "Track Delivery" on an order
3. **Test customer view** - Visit `/customer/order-tracking.html`
4. **Integrate driver app** - Send location updates to `/api/orders/:id/tracking`

---

## 📖 Full Documentation

- `docs/geolocation-tracking-todo.md` - Complete feature list
- `docs/geolocation-implementation-summary.md` - Implementation details
- `docs/env-setup-geolocation.md` - Environment setup guide

