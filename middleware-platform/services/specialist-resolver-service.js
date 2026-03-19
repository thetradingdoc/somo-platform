/**
 * SpecialistResolverService
 *
 * Answers: "Who can handle this patient need?"
 * Returns: Map<provider_id, attributes> — NOT a list.
 *
 * Keeps BookingService focused on "when" while this handles "who."
 * Supports:
 *   - Hard filter (specialty + language + state + lane)
 *   - Soft filter decay (relax language if no hard match)
 *   - Urgency override (relax specialty/language, return first available)
 *   - Load balancing (least utilized + price-tier match)
 *   - Async lane (quota-based, no calendar blocks needed)
 */

const db = require('../database');
const crypto = require('crypto');

// Cache TTL for resolver results (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

class SpecialistResolverService {
  /**
   * Main entry point.
   *
   * @param {Object} params
   * @param {string}   params.clinicId        - Owning clinic
   * @param {string}   params.specialty       - e.g. "Cardiology" (from RAG output)
   * @param {string}   [params.language]      - e.g. "es" (ISO 639-1)
   * @param {string}   [params.state]         - e.g. "NY" (license state)
   * @param {string}   [params.lane]          - "sync" | "async" (default: "sync")
   * @param {string}   [params.urgency]       - "routine" | "urgent" | "emergent"
   * @param {number}   [params.patientTier]   - 1-4 for price-tier matching
   * @param {string}   [params.date]          - YYYY-MM-DD (for async quota check)
   *
   * @returns {Promise<{
   *   providers: Map<string, Object>,  // provider_id → full attributes
   *   matchMode: string,               // 'hard', 'soft', 'urgency_override'
   *   kellyScript: string|null         // script for filter-decay explanation
   * }>}
   */
  static async resolve(params) {
    const {
      clinicId,
      specialty,
      language = 'en',
      state = null,
      lane = 'sync',
      urgency = 'routine',
      patientTier = 2,
      date = new Date().toISOString().slice(0, 10)
    } = params;

    // Emergent: bypass all filters, return first available
    if (urgency === 'emergent') {
      return this._urgencyOverride(clinicId, lane, date);
    }

    // Check cache
    const cacheKey = this._cacheKey(params);
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    // Hard filter: specialty + language + state
    let result = await this._hardFilter({ clinicId, specialty, language, state, lane, urgency, patientTier, date });

    if (result.providers.size > 0) {
      this._setCache(cacheKey, result);
      return result;
    }

    // Soft filter: relax language
    result = await this._softFilter({ clinicId, specialty, state, lane, urgency, patientTier, date, originalLanguage: language });

    this._setCache(cacheKey, result);
    return result;
  }

  // ─────────────────────────────────────────────
  // Hard Filter
  // ─────────────────────────────────────────────
  static async _hardFilter({ clinicId, specialty, language, state, lane, urgency, patientTier, date }) {
    const candidates = this._queryProviders(clinicId);
    const filtered = candidates.filter(p => {
      const attrs = this._parseAttrs(p);
      return (
        this._matchesSpecialty(attrs.specialty, specialty) &&
        this._matchesLanguage(attrs.languages, language) &&
        this._matchesState(attrs.license_states, state) &&
        this._matchesLane(attrs.supported_lanes, lane) &&
        (urgency !== 'urgent' || attrs.accepts_urgent)
      );
    });

    return {
      providers: this._buildMap(filtered, { lane, date, patientTier }),
      matchMode: 'hard',
      kellyScript: null
    };
  }

  // ─────────────────────────────────────────────
  // Soft Filter (language relaxed)
  // ─────────────────────────────────────────────
  static async _softFilter({ clinicId, specialty, state, lane, urgency, patientTier, date, originalLanguage }) {
    const candidates = this._queryProviders(clinicId);
    const filtered = candidates.filter(p => {
      const attrs = this._parseAttrs(p);
      return (
        this._matchesSpecialty(attrs.specialty, specialty) &&
        this._matchesState(attrs.license_states, state) &&
        this._matchesLane(attrs.supported_lanes, lane) &&
        (urgency !== 'urgent' || attrs.accepts_urgent)
      );
    });

    const langName = this._langName(originalLanguage);
    const kellyScript = filtered.length > 0
      ? `I don't have a ${langName}-speaking ${specialty} specialist available right now. ` +
        `I can offer an English-speaking ${specialty} specialist with built-in AI translation. ` +
        `Would you like that, or would you prefer to wait for a native ${langName} speaker?`
      : `I'm unable to find a ${specialty} specialist available right now. Would you like me to search for the next available appointment?`;

    return {
      providers: this._buildMap(filtered, { lane, date, patientTier }),
      matchMode: 'soft',
      kellyScript
    };
  }

  // ─────────────────────────────────────────────
  // Urgency Override: return ANY available specialist ASAP
  // ─────────────────────────────────────────────
  static async _urgencyOverride(clinicId, lane, date) {
    const candidates = this._queryProviders(clinicId).filter(p => {
      const attrs = this._parseAttrs(p);
      return attrs.is_active && this._matchesLane(attrs.supported_lanes, lane);
    });

    return {
      providers: this._buildMap(candidates, { lane, date, patientTier: null }),
      matchMode: 'urgency_override',
      kellyScript: null
    };
  }

  // ─────────────────────────────────────────────
  // Build the canonical Map<provider_id, attributes>
  // Applies load balancing + async quota check
  // ─────────────────────────────────────────────
  static _buildMap(providers, { lane, date, patientTier }) {
    const map = new Map();

    const withLoad = providers.map(p => {
      const attrs = this._parseAttrs(p);
      const upcoming = this._getUpcomingCount(p.id);
      const quotaRemaining = lane === 'async'
        ? this._getAsyncQuotaRemaining(p.id, date)
        : null;

      return { ...attrs, id: p.id, upcoming_count: upcoming, quota_remaining: quotaRemaining };
    });

    // Sort: price-tier match first, then least utilized
    const sorted = this._sortByLoadAndTier(withLoad, patientTier, lane);

    for (const p of sorted) {
      // Skip async providers with no quota left
      if (lane === 'async' && p.quota_remaining !== null && p.quota_remaining <= 0) continue;

      map.set(p.id, {
        id: p.id,
        display_name: p.display_name,
        email: p.email || null,
        specialty: p.specialty,
        languages: p.languages,
        license_states: p.license_states,
        supported_lanes: p.supported_lanes,
        review_capacity: p.review_capacity,
        min_rate: p.min_rate,
        price_tier: p.price_tier,
        accepts_urgent: p.accepts_urgent,
        upcoming_count: p.upcoming_count,
        quota_remaining: p.quota_remaining,
        match_reason: this._buildMatchReason(p)
      });
    }

    return map;
  }

  // ─────────────────────────────────────────────
  // Load Balancing: sort by tier match then least busy
  // ─────────────────────────────────────────────
  static _sortByLoadAndTier(providers, patientTier, lane) {
    return [...providers].sort((a, b) => {
      // 1. Tier proximity (closer to patient tier = higher priority)
      if (patientTier !== null) {
        const aDiff = Math.abs(a.price_tier - patientTier);
        const bDiff = Math.abs(b.price_tier - patientTier);
        if (aDiff !== bDiff) return aDiff - bDiff;
      }

      // 2. Async: more quota remaining = higher priority
      if (lane === 'async') {
        const aQ = a.quota_remaining ?? 0;
        const bQ = b.quota_remaining ?? 0;
        if (aQ !== bQ) return bQ - aQ; // descending
      }

      // 3. Sync: fewer upcoming appointments = higher priority (least utilized)
      return a.upcoming_count - b.upcoming_count;
    });
  }

  // ─────────────────────────────────────────────
  // DB queries
  // ─────────────────────────────────────────────
  static _queryProviders(clinicId) {
    try {
      return db.db.prepare(`
        SELECT * FROM provider_profiles
        WHERE clinic_id = ? AND is_active = 1
      `).all(clinicId);
    } catch (e) {
      console.warn('[SpecialistResolver] provider_profiles table not found or empty:', e.message);
      return [];
    }
  }

  static _getUpcomingCount(providerId) {
    try {
      const row = db.db.prepare(`
        SELECT COUNT(*) as cnt FROM appointments
        WHERE practitioner_id = ?
          AND status NOT IN ('cancelled', 'completed')
          AND date >= date('now')
      `).get(providerId);
      return row?.cnt ?? 0;
    } catch (_) { return 0; }
  }

  static _getAsyncQuotaRemaining(providerId, date) {
    try {
      const row = db.db.prepare(`
        SELECT quota_total, quota_used FROM specialist_daily_quota
        WHERE provider_id = ? AND date = ?
      `).get(providerId, date);

      if (!row) {
        // No quota row today: use provider's default review_capacity
        const profile = db.db.prepare(`SELECT review_capacity FROM provider_profiles WHERE id = ?`).get(providerId);
        return profile?.review_capacity ?? 0;
      }
      return Math.max(0, row.quota_total - row.quota_used);
    } catch (_) { return 0; }
  }

  // ─────────────────────────────────────────────
  // Filter helpers
  // ─────────────────────────────────────────────
  static _parseAttrs(row) {
    const parse = (field, fallback = []) => {
      try { return JSON.parse(row[field] || JSON.stringify(fallback)); }
      catch (_) { return fallback; }
    };
    return {
      ...row,
      specialty: parse('specialty'),
      languages: parse('languages', ['en']),
      license_states: parse('license_states'),
      supported_lanes: parse('supported_lanes', ['sync'])
    };
  }

  static _matchesSpecialty(providerSpecialties, required) {
    if (!required) return true;
    const norm = s => s.toLowerCase().replace(/\s+/g, '_');
    return providerSpecialties.some(s => norm(s) === norm(required));
  }

  static _matchesLanguage(providerLangs, required) {
    if (!required || required === 'en') return true; // English is always a soft default
    return providerLangs.includes(required);
  }

  static _matchesState(providerStates, required) {
    if (!required || providerStates.length === 0) return true; // No geo restriction
    return providerStates.includes(required.toUpperCase());
  }

  static _matchesLane(providerLanes, required) {
    return providerLanes.includes(required);
  }

  // ─────────────────────────────────────────────
  // Kelly narration helper
  // ─────────────────────────────────────────────
  static _buildMatchReason(provider) {
    const parts = [];
    if (provider.specialty?.length) parts.push(provider.specialty[0]);
    if (provider.languages?.length > 1) {
      const langs = provider.languages.filter(l => l !== 'en').map(l => this._langName(l));
      if (langs.length) parts.push(`${langs.join('/')}-speaking`);
    }
    if (provider.price_tier === 1) parts.push('Premium');
    if (provider.accepts_urgent) parts.push('Urgent-capable');
    return parts.join(', ') || 'General';
  }

  static _langName(code) {
    const map = { es: 'Spanish', sw: 'Swahili', fr: 'French', de: 'German', zh: 'Mandarin', ru: 'Russian', ar: 'Arabic', pt: 'Portuguese', hi: 'Hindi' };
    return map[code] || code.toUpperCase();
  }

  // ─────────────────────────────────────────────
  // Up-pay flag: when patient tier < specialist tier
  // ─────────────────────────────────────────────
  static flagUpPay(providerMap, patientTier) {
    const flags = [];
    for (const [id, attrs] of providerMap) {
      if (attrs.price_tier < patientTier) {
        flags.push({
          provider_id: id,
          specialist_tier: attrs.price_tier,
          patient_tier: patientTier,
          up_pay_required: true,
          note: `Patient (tier ${patientTier}) matched to tier-${attrs.price_tier} specialist — internal rate adjustment needed`
        });
      }
    }
    return flags;
  }

  // ─────────────────────────────────────────────
  // Quota management (called by BookingService on schedule)
  // ─────────────────────────────────────────────
  static async incrementAsyncQuota(providerId, date) {
    const { v4: uuidv4 } = require('uuid');
    try {
      // Ensure row exists
      const profile = db.db.prepare(`SELECT review_capacity FROM provider_profiles WHERE id = ?`).get(providerId);
      const capacity = profile?.review_capacity ?? 5;

      db.db.prepare(`
        INSERT INTO specialist_daily_quota (id, provider_id, date, quota_total, quota_used)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(provider_id, date) DO UPDATE SET
          quota_used = quota_used + 1,
          updated_at = datetime('now')
      `).run(uuidv4(), providerId, date, capacity);
      return { success: true };
    } catch (e) {
      console.error('[SpecialistResolver] incrementAsyncQuota failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  // ─────────────────────────────────────────────
  // Cache
  // ─────────────────────────────────────────────
  static _cacheKey(params) {
    const str = JSON.stringify({
      c: params.clinicId,
      s: params.specialty,
      l: params.language,
      st: params.state,
      ln: params.lane,
      u: params.urgency,
      t: params.patientTier
    });
    return crypto.createHash('sha1').update(str).digest('hex');
  }

  static _getCache(key) {
    try {
      const row = db.db.prepare(`
        SELECT result_json FROM resolver_cache WHERE cache_key = ? AND expires_at > datetime('now')
      `).get(key);
      if (!row) return null;
      const parsed = JSON.parse(row.result_json);
      // Re-hydrate Map
      parsed.providers = new Map(Object.entries(parsed.providers || {}));
      return parsed;
    } catch (_) { return null; }
  }

  static _setCache(key, result) {
    try {
      const expires = new Date(Date.now() + CACHE_TTL_MS).toISOString();
      const toStore = {
        ...result,
        providers: Object.fromEntries(result.providers) // Map → plain object for JSON
      };
      db.db.prepare(`
        INSERT INTO resolver_cache (cache_key, result_json, created_at, expires_at)
        VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(cache_key) DO UPDATE SET result_json = excluded.result_json, expires_at = excluded.expires_at
      `).run(key, JSON.stringify(toStore), expires);
    } catch (_) { /* cache miss is not fatal */ }
  }

  // ─────────────────────────────────────────────
  // Cleanup (call periodically or on startup)
  // ─────────────────────────────────────────────
  static cleanupCache() {
    try {
      db.db.prepare(`DELETE FROM resolver_cache WHERE expires_at <= datetime('now')`).run();
    } catch (_) {}
  }
}

module.exports = SpecialistResolverService;
