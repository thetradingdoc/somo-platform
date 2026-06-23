const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const knowledgeService = require('../services/shared/knowledge-service');

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down.' },
  validate: { trustProxy: false, ip: false }
});

router.get('/search', searchLimiter, async (req, res) => {
  const raw = (req.query.q || '').toString().trim();
  const q = raw.slice(0, 200);

  if (!q || q.length < 2) {
    return res.json({ query: q, icd10: [], cpt: [], hcpcs: [] });
  }

  try {
    const results = await knowledgeService.getCodeCandidatesDualSource(q, {
      maxIcd10: 12,
      maxCpt: 6,
      maxHcpcs: 4,
      useSemantic: true
    });

    const icd10 = results?.icd10 || results?.merged_codes?.icd10 || [];
    const cpt = results?.cpt || results?.merged_codes?.cpt || [];
    const hcpcs = results?.hcpcs || results?.merged_codes?.hcpcs || [];

    return res.json({
      query: q,
      icd10,
      cpt,
      hcpcs
    });
  } catch (err) {
    console.error('[rag-search] error:', err.message);
    return res.status(500).json({
      error: 'Search unavailable',
      query: q,
      icd10: [],
      cpt: [],
      hcpcs: []
    });
  }
});

module.exports = router;

