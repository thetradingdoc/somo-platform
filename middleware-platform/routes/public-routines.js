'use strict';

const concernRoutineService = require('../services/concern-routine-service');

/**
 * Public concern program catalog (funnel + mobile routine pick).
 */
function registerPublicRoutineRoutes(app, { apiLimiter }) {
  app.get('/api/public/routines/concerns', apiLimiter, (req, res) => {
    try {
      return res.json({ success: true, concerns: concernRoutineService.listConcerns() });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/public/routines/:concernId/preview', apiLimiter, (req, res) => {
    try {
      const concernId = String(req.params?.concernId || '').trim();
      const preview = concernRoutineService.buildPreview(concernId);
      if (!preview) {
        return res.status(404).json({ success: false, error: 'Unknown concern program.' });
      }
      return res.json({ success: true, preview });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerPublicRoutineRoutes };
