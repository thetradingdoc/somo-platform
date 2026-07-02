'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { PmsError, PMS_ERROR } = require('./pms-errors');
const { resolveAthenaConfig } = require('./athena-config');

const tokenCache = new Map();
const FILE_CACHE_PATH = path.join(__dirname, '../../var/athena-oauth-cache.json');

/** OAuth tokens are per client_id, not per practice — never key cache by practice_id. */
function cacheKey(config) {
  return `${config.client_id}:${config.token_url}`;
}

function readFileTokenCache(key) {
  if (process.env.NODE_ENV === 'test' || process.env.ATHENA_TOKEN_FILE_CACHE === '0') return null;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE_CACHE_PATH, 'utf8'));
    if (raw.key === key && raw.expiresAt > Date.now() + 30_000) return raw.token;
  } catch {
    /* no cache file */
  }
  return null;
}

function writeFileTokenCache(key, token, expiresAt) {
  if (process.env.NODE_ENV === 'test' || process.env.ATHENA_TOKEN_FILE_CACHE === '0') return;
  try {
    fs.mkdirSync(path.dirname(FILE_CACHE_PATH), { recursive: true });
    fs.writeFileSync(FILE_CACHE_PATH, JSON.stringify({ key, token, expiresAt }));
  } catch {
    /* best-effort dev cache */
  }
}

function isQuotaExceededError(detail) {
  const msg = String(detail || '').toLowerCase();
  return msg.includes('quota exceeded') || msg.includes('rate limit');
}

function mapAxiosError(e, label) {
  const status = e.response?.status;
  const body = e.response?.data;
  const detail =
    (typeof body === 'string' ? body : body?.error || body?.detailedmessage || body?.message) ||
    e.message;
  if (status === 401 || status === 403) {
    return new PmsError(PMS_ERROR.NOT_CONFIGURED, `${label}: auth failed (${status}) — ${detail}`);
  }
  if (e.code === 'ECONNABORTED') {
    return new PmsError(PMS_ERROR.TIMEOUT, `${label}: timed out`);
  }
  return new PmsError(PMS_ERROR.LOOKUP_FAILED, `${label}: ${detail}`, { status, body });
}

class AthenaClient {
  constructor(settings = {}, clinicId = null) {
    this.config = resolveAthenaConfig(settings, clinicId);
    this.clinicId = clinicId;
  }

  async getAccessToken() {
    const { client_id, client_secret, token_url, scope } = this.config;
    if (!client_id || !client_secret) {
      throw new PmsError(PMS_ERROR.NOT_CONFIGURED, 'Athena client_id and client_secret required');
    }

    const key = cacheKey(this.config);
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 30_000) {
      return cached.token;
    }
    const fileCached = readFileTokenCache(key);
    if (fileCached) {
      tokenCache.set(key, { token: fileCached, expiresAt: Date.now() + 3600_000 });
      return fileCached;
    }

    const basic = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
    const params = new URLSearchParams();
    params.set('grant_type', 'client_credentials');
    if (scope) params.set('scope', scope);

    try {
      const res = await axios.post(token_url, params.toString(), {
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      });
      const token = res.data?.access_token;
      const expiresIn = Number(res.data?.expires_in || 3600);
      if (!token) {
        throw new PmsError(PMS_ERROR.NOT_CONFIGURED, 'Athena token response missing access_token');
      }
      const expiresAt = Date.now() + expiresIn * 1000;
      tokenCache.set(key, { token, expiresAt });
      writeFileTokenCache(key, token, expiresAt);
      return token;
    } catch (e) {
      if (e instanceof PmsError) throw e;
      const detail =
        (typeof e.response?.data === 'string'
          ? e.response.data
          : e.response?.data?.error || e.response?.data?.detailedmessage) || e.message;
      if (isQuotaExceededError(detail)) {
        throw new PmsError(
          PMS_ERROR.LOOKUP_FAILED,
          'Athena OAuth token quota exceeded — wait a few minutes before retrying; avoid running discover + verify back-to-back'
        );
      }
      throw mapAxiosError(e, 'Athena OAuth token');
    }
  }

  practicePath(suffix = '') {
    const pid = this.config.practice_id;
    if (!pid) {
      throw new PmsError(PMS_ERROR.NOT_CONFIGURED, 'Athena practice_id required');
    }
    const base = String(this.config.api_base).replace(/\/$/, '');
    const path = `/v1/${pid}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
    return `${base}${path}`;
  }

  async request(method, pathSuffix, { params, data, form } = {}) {
    const token = await this.getAccessToken();
    const url = pathSuffix.startsWith('http') ? pathSuffix : this.practicePath(pathSuffix);
    try {
      const res = await axios({
        method,
        url,
        params,
        data: form || data,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
        },
        timeout: 20000
      });
      return res.data;
    } catch (e) {
      throw mapAxiosError(e, `Athena ${method} ${pathSuffix}`);
    }
  }

  async get(pathSuffix, params) {
    return this.request('GET', pathSuffix, { params });
  }

  async post(pathSuffix, formOrData, asForm = true) {
    if (asForm && formOrData && typeof formOrData === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(formOrData)) {
        if (v != null) params.set(k, String(v));
      }
      return this.request('POST', pathSuffix, { form: params.toString() });
    }
    return this.request('POST', pathSuffix, { data: formOrData });
  }

  async put(pathSuffix, formOrData) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(formOrData || {})) {
      if (v != null) params.set(k, String(v));
    }
    return this.request('PUT', pathSuffix, { form: params.toString() });
  }

  clearTokenCache() {
    const key = cacheKey(this.config);
    tokenCache.delete(key);
    if (process.env.NODE_ENV !== 'test' && process.env.ATHENA_TOKEN_FILE_CACHE !== '0') {
      try {
        if (fs.existsSync(FILE_CACHE_PATH)) {
          const raw = JSON.parse(fs.readFileSync(FILE_CACHE_PATH, 'utf8'));
          if (raw.key === key) fs.unlinkSync(FILE_CACHE_PATH);
        }
      } catch {
        /* ignore */
      }
    }
  }
}

function clearAthenaTokenCache() {
  tokenCache.clear();
  if (process.env.NODE_ENV !== 'test' && process.env.ATHENA_TOKEN_FILE_CACHE !== '0') {
    try {
      if (fs.existsSync(FILE_CACHE_PATH)) fs.unlinkSync(FILE_CACHE_PATH);
    } catch {
      /* ignore */
    }
  }
}

module.exports = { AthenaClient, clearAthenaTokenCache };
