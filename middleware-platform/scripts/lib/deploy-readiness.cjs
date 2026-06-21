'use strict';

const REQUIRED_ENV = {
  KELLY_RAILS_FAST_RAG: '0',
  USE_TRIAGE_RAG_V2: '1',
  CODING_SPINE_ONLY: '1',
  REMOTE_RAG_TIMEOUT_MS: '8000',
  REQUIRE_TRIAGE_FOR_VOICE: '1',
  CODING_PROD_CI: '1',
  PINECONE_MIN_SCORE: '0.45'
};

const FORBIDDEN_ENV = ['KELLY_E2E_SKIP_TRIAGE'];

async function fetchHealth(url) {
  const healthUrl = `${String(url).replace(/\/$/, '')}/health`;
  const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
  return { ok: res.ok, status: res.status, url: healthUrl };
}

function envChecklistCheck() {
  return {
    name: 'required_env_documented',
    pass: true,
    required_env: REQUIRED_ENV,
    forbidden_env: FORBIDDEN_ENV
  };
}

module.exports = {
  REQUIRED_ENV,
  FORBIDDEN_ENV,
  fetchHealth,
  envChecklistCheck
};
