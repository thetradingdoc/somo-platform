const express = require('express');
const router = express.Router();

/**
 * Proxy to local Colab RAG API.
 * Allows external clients to access RAG via the main ngrok tunnel (middleware :4000).
 *
 * Env:
 * - COLAB_RAG_PORT (default: 5000)
 */

// Support both local Colab (localhost:5000) and Render deployment
const COLAB_RAG_URL = process.env.COLAB_RAG_URL || `http://localhost:${process.env.COLAB_RAG_PORT || '5000'}`;

// Log on startup to verify configuration
if (process.env.NODE_ENV !== 'production') {
  console.log(`[rag-proxy] Configured RAG URL: ${COLAB_RAG_URL}`);
}

const RAG_PROXY_TIMEOUT_MS = parseInt(process.env.RAG_PROXY_TIMEOUT_MS || '15000', 10); // 15s for Render cold start

router.post('/retrieve', async (req, res) => {
  try {
    // Try /api/retrieve first, fallback to /retrieve if 404
    let response = await fetch(`${COLAB_RAG_URL}/api/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(RAG_PROXY_TIMEOUT_MS)
    });

    // If /api/retrieve returns 404, try /retrieve (for different API versions)
    if (response.status === 404) {
      response = await fetch(`${COLAB_RAG_URL}/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(RAG_PROXY_TIMEOUT_MS)
      });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`RAG API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('RAG proxy error:', error.message);
    res.status(503).json({
      error: 'RAG API unavailable',
      details: error.message,
      fallback: {
        icd10: [],
        cpt: [],
        hcpcs: [],
        metadata: { source: 'error_fallback' }
      }
    });
  }
});

router.get('/health', async (req, res) => {
  try {
    const response = await fetch(`${COLAB_RAG_URL}/health`, {
      signal: AbortSignal.timeout(RAG_PROXY_TIMEOUT_MS) // allow Render cold start
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const data = await response.json();
    res.json({
      status: 'healthy',
      colab_rag: data,
      proxy_url: COLAB_RAG_URL
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      colab_rag_url: COLAB_RAG_URL
    });
  }
});

module.exports = router;

