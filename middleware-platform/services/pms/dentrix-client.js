'use strict';

const axios = require('axios');
const { PmsError, PMS_ERROR } = require('./pms-errors');
const { resolveDentrixConfig } = require('./dentrix-config');

const tokenCache = new Map();

function cacheKey(config) {
  return `${config.client_id}:${config.organization_id || ''}:${config.token_url}`;
}

function mapAxiosError(e, label) {
  const status = e.response?.status;
  const body = e.response?.data;
  const detail =
    (typeof body === 'string' ? body : body?.message || body?.error || body?.error_description) ||
    e.message;
  if (status === 401 || status === 403) {
    return new PmsError(PMS_ERROR.NOT_CONFIGURED, `${label}: auth failed (${status}) — ${detail}`);
  }
  if (status === 429) {
    return new PmsError(PMS_ERROR.LOOKUP_FAILED, `${label}: rate limited — ${detail}`);
  }
  if (e.code === 'ECONNABORTED') {
    return new PmsError(PMS_ERROR.TIMEOUT, `${label}: timed out`);
  }
  return new PmsError(PMS_ERROR.LOOKUP_FAILED, `${label}: ${detail}`, { status, body });
}

class DentrixClient {
  constructor(settings = {}, clinicId = null) {
    this.config = resolveDentrixConfig(settings, clinicId);
    this.clinicId = clinicId;
  }

  async getAccessToken() {
    const { client_id, client_secret, token_url } = this.config;
    if (!client_id || !client_secret) {
      throw new PmsError(PMS_ERROR.NOT_CONFIGURED, 'Dentrix client_id and client_secret required');
    }

    const key = cacheKey(this.config);
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 30_000) {
      return cached.token;
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'client_credentials');
    params.set('client_id', client_id);
    params.set('client_secret', client_secret);

    try {
      const res = await axios.post(token_url, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      });
      const token = res.data?.access_token;
      const expiresIn = Number(res.data?.expires_in || 3600);
      if (!token) {
        throw new PmsError(PMS_ERROR.NOT_CONFIGURED, 'Dentrix token response missing access_token');
      }
      const bearer = String(token).startsWith('Bearer ') ? token : `Bearer ${token}`;
      const expiresAt = Date.now() + expiresIn * 1000;
      tokenCache.set(key, { token: bearer, expiresAt });
      return bearer;
    } catch (e) {
      if (e instanceof PmsError) throw e;
      throw mapAxiosError(e, 'Dentrix OAuth token');
    }
  }

  apiPath(suffix = '') {
    const base = String(this.config.api_base).replace(/\/$/, '');
    const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `${base}${path}`;
  }

  orgmapperPath(suffix = '') {
    const base = String(this.config.orgmapper_base).replace(/\/$/, '');
    const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `${base}${path}`;
  }

  async request(method, url, { params, data, orgmapper = false } = {}) {
    const token = await this.getAccessToken();
    const orgId = this.config.organization_id;
    if (!orgId && !orgmapper) {
      throw new PmsError(PMS_ERROR.NOT_CONFIGURED, 'Dentrix organization_id required');
    }

    const fullUrl = url.startsWith('http') ? url : orgmapper ? this.orgmapperPath(url) : this.apiPath(url);
    try {
      const res = await axios({
        method,
        url: fullUrl,
        params,
        data,
        headers: {
          Authorization: token,
          ...(orgmapper ? {} : { 'Organization-ID': orgId }),
          'Content-Type': 'application/json'
        },
        timeout: 20000
      });
      return res.data;
    } catch (e) {
      throw mapAxiosError(e, `Dentrix ${method} ${url}`);
    }
  }

  unwrap(payload) {
    if (payload == null) return null;
    if (Object.prototype.hasOwnProperty.call(payload, 'data')) return payload.data;
    return payload;
  }

  async get(pathSuffix, params, options = {}) {
    return this.request('GET', pathSuffix, { params, ...options });
  }

  async post(pathSuffix, data, options = {}) {
    return this.request('POST', pathSuffix, { data, ...options });
  }

  async put(pathSuffix, data, options = {}) {
    return this.request('PUT', pathSuffix, { data, ...options });
  }

  clearTokenCache() {
    tokenCache.delete(cacheKey(this.config));
  }
}

function clearDentrixTokenCache() {
  tokenCache.clear();
}

module.exports = { DentrixClient, clearDentrixTokenCache };
