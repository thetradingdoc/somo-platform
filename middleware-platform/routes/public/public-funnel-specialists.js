'use strict';

const nppesSearch = require('../../services/platform/nppes-directory-search-service');

function registerPublicFunnelSpecialistRoutes(app, { apiLimiter }) {
  app.get('/api/public/funnel/specialists', apiLimiter, (req, res) => {
    try {
      const zip = String(req.query.zip || '').trim();
      const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
      const out = nppesSearch.searchSpecialistsByZip({ zip, limit });
      return res.json({
        success: true,
        disclaimer:
          'Directory information only. US providers only (NPPES). Booking is not guaranteed on Skin & Care. Confirm availability with the practice.',
        ...out,
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerPublicFunnelSpecialistRoutes };
