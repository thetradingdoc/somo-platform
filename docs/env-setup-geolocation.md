# Environment Variables for Geolocation Tracking

## Required Environment Variables

Add these to your `.env` file or Azure App Settings:

```bash
# Google Maps API Configuration
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# Delivery Configuration
DELIVERY_RADIUS_METERS=100              # Auto-confirm radius in meters (default: 100)
AUTO_CONFIRM_DELIVERY=true              # Enable/disable auto-confirmation (default: true)
LOCATION_UPDATE_INTERVAL=15             # Polling interval in seconds (default: 15)

# Geocoding Cache
GEOCODING_CACHE_TTL=86400               # Cache TTL in seconds (default: 86400 = 24 hours)
```

## Google Maps API Key Setup

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Create/Select Project**
3. **Enable APIs**:
   - Maps JavaScript API
   - Geocoding API
   - Distance Matrix API (optional)
4. **Create API Key**:
   - Go to "Credentials" → "Create Credentials" → "API Key"
5. **Restrict API Key** (Recommended):
   - Application restrictions: HTTP referrers
   - Add: `https://api.doclittle.site/*`, `https://*.doclittle.site/*`
   - API restrictions: Select only Maps JavaScript API and Geocoding API
6. **Copy API Key** to `.env` file

## Alternative: Mapbox

If using Mapbox instead:

```bash
MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here
```

## Verification

After adding the API key, restart the server and check logs:
- ✅ "Geocoding service initialized"
- ✅ "Location verification service ready"

If you see warnings:
- ⚠️ "GOOGLE_MAPS_API_KEY not configured" - Check your .env file
- ⚠️ "Geocoding API key not configured" - Verify the key is correct

