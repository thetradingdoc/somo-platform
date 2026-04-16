# Unified Dashboard - Frontend

**Version**: 3.0.0  
**Status**: Production Ready  
**Last Updated:** April 9, 2026

## Overview

The unified dashboard is the frontend interface for DocLittle, providing web-based dashboards for healthcare providers, patients, and administrators.

## Structure

### Skin & Care landing (CRA)

- **`littlelab-landing/`** — React (Create React App) app: Skin & Care marketing + Try Now assistant (Kelly, LiveKit, results flow). Build with `npm run build` inside that folder; static output is served with the rest of the unified dashboard.

### Main static pages

- **landing.html** — Public landing page (legacy/static)
- **login.html** — User authentication

### Business Dashboard (`business/`)
Provider-facing dashboard pages:
- **business-dashboard.html** - Main provider dashboard
- **billing.html** - Explanation of Benefits (EOB) display
- **patients.html** - Patient management
- **appointments.html** - Appointment calendar
- **claims.html** - Insurance claims
- **invoices.html** - Invoice management
- **wallets.html** - Circle wallet management
- **pdf-coding.html** - Medical coding interface
- **settings.html** - Provider settings

### Patient Portal (`patients/`)
Patient-facing self-service pages:
- **patient-dashboard.html** - Patient home
- **appointments.html** - Appointment management
- **profile.html** - Patient profile
- **wallet.html** - Patient wallet

### Insurer Dashboard (`insurer/`)
- **insurer-dashboard.html** - Insurance company dashboard

### Assets
- **assets/css/global.css** - Global styles
- **assets/js/config.js** - Frontend configuration
- **assets/img/** - Images and icons

## Features

### Billing/EOB Display
- Real-time insurance eligibility data
- Deductible, copay, and coinsurance display
- Claim breakdown with service details
- Plan information card with fintech blue styling

### Patient Management
- Patient search and filtering
- Patient record viewing
- Insurance information display
- Appointment history

### Appointment Management
- Calendar view
- Appointment scheduling
- Rescheduling and cancellation
- Provider availability

### Medical Coding
- PDF upload interface
- ICD-10 and CPT code extraction
- Code validation
- Claim creation

## Configuration

### API Configuration
Update `assets/js/config.js` with your API base URL:

```javascript
const API_BASE_URL = 'http://localhost:4000'; // Development
// const API_BASE_URL = 'https://your-api-domain.com'; // Production
```

### Styling
- Uses fintech blue gradient (`#1e40af` to `#3b82f6`) matching landing page
- Responsive design for mobile and desktop
- Modern UI with clean layouts

## Deployment

### Netlify Deployment

1. Connect GitHub repository
2. Set build directory to `unified-dashboard`
3. Configure redirects in `netlify.toml`
4. Deploy automatically on push

### Local Development

```bash
cd unified-dashboard
python3 -m http.server 8000
# Access at http://localhost:8000
```

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Related Documentation

- [Main README](../README.md) - Project overview
- [API Documentation](../docs/api/API_DOCUMENTATION.md) - Backend API reference
- [Setup Guide](../docs/setup/getting-started/SETUP.md) - Setup instructions

