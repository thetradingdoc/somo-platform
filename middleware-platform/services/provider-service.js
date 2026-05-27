/**
 * Provider Service - Operational dashboard support
 * 
 * Provides real-time data for provider daily operations:
 * - Today's schedule
 * - Next patient up
 * - Live metrics
 */

const db = require('../database');

class ProviderService {
  _toBool(value) {
    if (value === true || value === 1) return true;
    const v = String(value || '').toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }

  isProviderCalendarConnected(providerRef) {
    const email = typeof providerRef === 'string' ? providerRef : providerRef?.email;
    const providerId = typeof providerRef === 'object' ? providerRef?.provider_id : null;
    if (!email && !providerId) return false;
    try {
      let row = null;
      if (providerId) {
        row = db.db.prepare(`
          SELECT u.google_calendar_connected, u.google_refresh_token
          FROM provider_profiles pp
          LEFT JOIN users u ON u.id = pp.user_id
          WHERE pp.id = ?
          LIMIT 1
        `).get(providerId);
      }
      if (!row && email) {
        row = db.db.prepare(`
          SELECT google_calendar_connected, google_refresh_token
          FROM users
          WHERE lower(email) = lower(?)
          LIMIT 1
        `).get(email.trim().toLowerCase());
      }
      if (!row) return false;
      return this._toBool(row.google_calendar_connected) && !!row.google_refresh_token;
    } catch (_) {
      return false;
    }
  }

  hasProviderAvailabilityBlocks(providerRef, date = null) {
    const email = typeof providerRef === 'string' ? providerRef : providerRef?.email;
    if (!email) return false;
    try {
      const blocks = this.getAvailabilityBlocks(email, date || null, date || null);
      return Array.isArray(blocks) && blocks.some((b) => b.block_type === 'available');
    } catch (_) {
      return false;
    }
  }

  getProviderBookingTier(providerRef, lane = 'sync') {
    const calendarConnected = this.isProviderCalendarConnected(providerRef);
    const hasBlocks = this.hasProviderAvailabilityBlocks(providerRef);
    if (lane !== 'sync') {
      return { tier: 'async', calendar_connected: calendarConnected, has_availability_blocks: hasBlocks };
    }
    if (calendarConnected && hasBlocks) return { tier: 'A', calendar_connected: true, has_availability_blocks: true };
    if (!calendarConnected && hasBlocks) return { tier: 'B', calendar_connected: false, has_availability_blocks: true };
    return { tier: 'C', calendar_connected: calendarConnected, has_availability_blocks: hasBlocks };
  }
  /**
   * Resolve a canonical provider profile by email.
   * Returns null when no profile exists yet.
   */
  getProviderProfileByEmail(email) {
    if (!email || typeof email !== 'string') return null;
    return db.db.prepare(`
      SELECT id, clinic_id, display_name, email, specialty, languages, supported_lanes, is_active, price_tier, accepts_urgent
      FROM provider_profiles
      WHERE lower(email) = lower(?)
      LIMIT 1
    `).get(email.trim().toLowerCase()) || null;
  }

  /**
   * Ensure a canonical provider_profiles row exists for a provider email.
   * Backfills from customers.provider_profile when available.
   */
  ensureProviderProfileForEmail(email, clinicId = null) {
    if (!email || typeof email !== 'string') return null;
    const normalizedEmail = email.trim().toLowerCase();
    const existing = this.getProviderProfileByEmail(normalizedEmail);
    if (existing) return existing;

    const customer = db.db.prepare(`
      SELECT id, name, email, merchant_id, provider_profile
      FROM customers
      WHERE lower(email) = lower(?)
      LIMIT 1
    `).get(normalizedEmail);
    if (!customer) return null;

    let specialty = ['PrimaryCare'];
    try {
      const profile = customer.provider_profile ? JSON.parse(customer.provider_profile) : null;
      if (profile?.specialty && typeof profile.specialty === 'string') {
        specialty = [String(profile.specialty).replace(/\s+/g, '')];
      } else if (Array.isArray(profile?.specialty) && profile.specialty.length > 0) {
        specialty = profile.specialty.map((s) => String(s).replace(/\s+/g, ''));
      }
    } catch (_) {}

    // Resolve clinic from merchant when possible
    let resolvedClinicId = clinicId || null;
    if (!resolvedClinicId && customer.merchant_id) {
      const clinic = db.db.prepare(`
        SELECT clinic_id
        FROM clinics
        WHERE merchant_id = ?
        ORDER BY created_at ASC
        LIMIT 1
      `).get(customer.merchant_id);
      resolvedClinicId = clinic?.clinic_id || null;
    }
    if (!resolvedClinicId) {
      resolvedClinicId = process.env.DEFAULT_CLINIC_ID || 'clinic-default';
    }

    const providerId = `prov_${require('crypto').randomBytes(10).toString('hex')}`;
    const displayName = customer.name || normalizedEmail.split('@')[0];

    db.db.prepare(`
      INSERT INTO provider_profiles (
        id, clinic_id, user_id, display_name, email, specialty, languages,
        license_states, credentials, supported_lanes, review_capacity,
        min_rate, price_tier, accepts_urgent, accepts_emergency_triage, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '["en"]', '[]', '[]', '["sync","async"]', 5, 0, 2, 1, 0, 1, datetime('now'), datetime('now'))
    `).run(
      providerId,
      resolvedClinicId,
      customer.id,
      displayName,
      normalizedEmail,
      JSON.stringify(specialty)
    );

    return this.getProviderProfileByEmail(normalizedEmail);
  }
  /**
   * Get today's schedule for a provider s
   * @param {string} providerName - Provider name (defaults to all if not specified)
   * @returns {Array} Today's appointments sorted by time
   */
  getTodaySchedule(providerName = null) {
    const today = new Date().toISOString().split('T')[0];
    
    let query = `
      SELECT 
        id,
        patient_name,
        patient_phone,
        patient_email,
        appointment_type,
        date,
        time,
        start_time,
        end_time,
        duration_minutes,
        provider,
        status,
        notes,
        created_at
      FROM appointments
      WHERE date = ?
        AND status IN ('scheduled', 'confirmed')
    `;
    
    const params = [today];
    
    if (providerName) {
      query += ` AND provider = ?`;
      params.push(providerName);
    }
    
    query += ` ORDER BY time ASC`;
    
    const appointments = db.db.prepare(query).all(...params);
    
    // Enrich with time calculations
    const now = new Date();
    return appointments.map(apt => {
      const startTime = new Date(apt.start_time);
      const endTime = new Date(apt.end_time);
      const minutesUntil = Math.floor((startTime - now) / (1000 * 60));
      
      return {
        ...apt,
        minutes_until: minutesUntil,
        is_past: minutesUntil < 0,
        is_current: minutesUntil >= -apt.duration_minutes && minutesUntil <= apt.duration_minutes,
        is_upcoming: minutesUntil > 0 && minutesUntil <= 30,
        time_until: this._formatTimeUntil(minutesUntil),
        status_display: this._getStatusDisplay(apt.status, minutesUntil, apt.duration_minutes)
      };
    });
  }
  
  /**
   * Get the next patient up
   * @param {string} providerName - Provider name (optional)
   * @returns {Object|null} Next appointment or null
   */
  getNextPatient(providerName = null) {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    
    let query = `
      SELECT 
        id,
        patient_name,
        patient_phone,
        patient_email,
        appointment_type,
        date,
        time,
        start_time,
        end_time,
        duration_minutes,
        provider,
        status,
        notes
      FROM appointments
      WHERE date = ?
        AND status IN ('scheduled', 'confirmed')
        AND datetime(start_time) >= datetime(?)
    `;
    
    const params = [today, now.toISOString()];
    
    if (providerName) {
      query += ` AND provider = ?`;
      params.push(providerName);
    }
    
    query += ` ORDER BY time ASC LIMIT 1`;
    
    const appointment = db.db.prepare(query).get(...params);
    
    if (!appointment) return null;
    
    const startTime = new Date(appointment.start_time);
    const minutesUntil = Math.floor((startTime - now) / (1000 * 60));
    
    return {
      ...appointment,
      minutes_until: minutesUntil,
      time_until: this._formatTimeUntil(minutesUntil),
      is_soon: minutesUntil <= 15,
      is_running_late: minutesUntil < -5
    };
  }
  
  /**
   * Get live metrics for today
   * @param {string} providerName - Provider name (optional)
   * @returns {Object} Real-time statistics
   */
  getLiveStats(providerName = null) {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    
    let baseQuery = `
      FROM appointments
      WHERE date = ?
    `;
    
    const params = [today];
    
    if (providerName) {
      baseQuery += ` AND provider = ?`;
      params.push(providerName);
    }
    
    // Total scheduled today
    const totalScheduled = db.db.prepare(`
      SELECT COUNT(*) as count ${baseQuery} AND status IN ('scheduled', 'confirmed')
    `).get(...params).count;
    
    // Completed today
    const completed = db.db.prepare(`
      SELECT COUNT(*) as count ${baseQuery} AND status = 'completed'
    `).get(...params).count;
    
    // Cancelled today
    const cancelled = db.db.prepare(`
      SELECT COUNT(*) as count ${baseQuery} AND status = 'cancelled'
    `).get(...params).count;
    
    // No-shows (past appointments that weren't completed or cancelled)
    const noShows = db.db.prepare(`
      SELECT COUNT(*) as count 
      ${baseQuery} 
      AND (
        status = 'no_show'
        OR (
          status IN ('scheduled', 'confirmed')
          AND datetime(end_time) < datetime(?)
        )
      )
    `).get(...params, now.toISOString()).count;
    
    // Upcoming (next 2 hours)
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const upcoming = db.db.prepare(`
      SELECT COUNT(*) as count 
      ${baseQuery} 
      AND status IN ('scheduled', 'confirmed')
      AND datetime(start_time) BETWEEN datetime(?) AND datetime(?)
    `).get(...params, now.toISOString(), twoHoursFromNow.toISOString()).count;
    
    // Currently in session (started but not ended)
    const inSession = db.db.prepare(`
      SELECT COUNT(*) as count 
      ${baseQuery} 
      AND status IN ('scheduled', 'confirmed', 'arrived', 'in_room')
      AND datetime(start_time) <= datetime(?)
      AND datetime(end_time) >= datetime(?)
    `).get(...params, now.toISOString(), now.toISOString()).count;
    
    // Average wait time (for appointments that started late)
    const lateAppointments = db.db.prepare(`
      SELECT start_time, time
      ${baseQuery} 
      AND status IN ('scheduled', 'confirmed', 'completed')
      AND datetime(start_time) > datetime(date || ' ' || time)
    `).all(...params);
    
    let avgWaitMinutes = 0;
    if (lateAppointments.length > 0) {
      const totalWait = lateAppointments.reduce((sum, apt) => {
        const scheduled = new Date(`${apt.date}T${apt.time}`);
        const actual = new Date(apt.start_time);
        return sum + Math.floor((actual - scheduled) / (1000 * 60));
      }, 0);
      avgWaitMinutes = Math.round(totalWait / lateAppointments.length);
    }
    
    return {
      total_scheduled: totalScheduled,
      completed: completed,
      cancelled: cancelled,
      no_shows: noShows,
      upcoming: upcoming,
      in_session: inSession,
      avg_wait_minutes: avgWaitMinutes,
      completion_rate: totalScheduled > 0 ? ((completed / (totalScheduled + completed)) * 100).toFixed(1) : '0.0',
      no_show_rate: totalScheduled > 0 ? ((noShows / totalScheduled) * 100).toFixed(1) : '0.0'
    };
  }
  
  /**
   * Get provider status (online/offline + availability) by email
   * @param {string} email - Provider email
   * @returns {Object|null} { is_online, availability_rules } or null
   */
  getProviderStatus(email) {
    if (!email || typeof email !== 'string') return null;
    const normalizedEmail = email.trim().toLowerCase();
    const profile = this.getProviderProfileByEmail(normalizedEmail) || this.ensureProviderProfileForEmail(normalizedEmail);
    const providerId = profile?.id || null;
    const row = providerId
      ? db.db.prepare(`
        SELECT provider_id, email, is_online, availability_rules, last_seen_at, heartbeat_expires_at, updated_at
        FROM provider_status
        WHERE provider_id = ? OR email = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(providerId, normalizedEmail)
      : db.db.prepare(`
        SELECT provider_id, email, is_online, availability_rules, last_seen_at, heartbeat_expires_at, updated_at
        FROM provider_status
        WHERE email = ?
      `).get(normalizedEmail);
    if (!row) {
      return {
        provider_id: providerId,
        email: normalizedEmail,
        is_online: false,
        availability_rules: null,
        last_seen_at: null,
        heartbeat_expires_at: null,
        updated_at: null
      };
    }
    let rules = null;
    try {
      rules = row.availability_rules ? JSON.parse(row.availability_rules) : null;
    } catch (_) {}
    return {
      provider_id: row.provider_id || providerId || null,
      email: row.email || normalizedEmail,
      is_online: !!row.is_online,
      availability_rules: rules,
      last_seen_at: row.last_seen_at || null,
      heartbeat_expires_at: row.heartbeat_expires_at || null,
      updated_at: row.updated_at
    };
  }

  /**
   * Set provider online/offline status
   * @param {string} email - Provider email
   * @param {boolean} isOnline - Online status
   */
  setProviderOnline(email, isOnline) {
    if (!email || typeof email !== 'string') return;
    const e = email.trim().toLowerCase();
    const profile = this.getProviderProfileByEmail(e) || this.ensureProviderProfileForEmail(e);
    const providerId = profile?.id || null;
    db.db.prepare(`
      INSERT INTO provider_status (provider_id, email, is_online, last_seen_at, heartbeat_expires_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now', '+90 seconds'), datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        provider_id = COALESCE(excluded.provider_id, provider_status.provider_id),
        is_online = excluded.is_online,
        last_seen_at = excluded.last_seen_at,
        heartbeat_expires_at = excluded.heartbeat_expires_at,
        updated_at = datetime('now')
    `).run(providerId, e, isOnline ? 1 : 0);
  }

  /**
   * Heartbeat keeps provider online; extends expiry window.
   */
  heartbeatProvider(email) {
    if (!email || typeof email !== 'string') return null;
    const e = email.trim().toLowerCase();
    const profile = this.getProviderProfileByEmail(e) || this.ensureProviderProfileForEmail(e);
    const providerId = profile?.id || null;
    db.db.prepare(`
      INSERT INTO provider_status (provider_id, email, is_online, last_seen_at, heartbeat_expires_at, updated_at)
      VALUES (?, ?, 1, datetime('now'), datetime('now', '+90 seconds'), datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        provider_id = COALESCE(excluded.provider_id, provider_status.provider_id),
        is_online = 1,
        last_seen_at = datetime('now'),
        heartbeat_expires_at = datetime('now', '+90 seconds'),
        updated_at = datetime('now')
    `).run(providerId, e);
    return this.getProviderStatus(e);
  }

  /**
   * Expire stale heartbeats and mark providers offline.
   */
  expireStaleHeartbeats() {
    try {
      db.db.prepare(`
        UPDATE provider_status
        SET is_online = 0, updated_at = datetime('now')
        WHERE is_online = 1
          AND heartbeat_expires_at IS NOT NULL
          AND datetime(heartbeat_expires_at) <= datetime('now')
      `).run();
    } catch (_) {}
  }

  /**
   * Set provider availability rules (weekly hours)
   * @param {string} email - Provider email
   * @param {Object} availabilityRules - { mon: { start, end }, ... } or null
   */
  setProviderAvailability(email, availabilityRules) {
    if (!email || typeof email !== 'string') return;
    const e = email.trim().toLowerCase();
    const rulesJson = availabilityRules ? JSON.stringify(availabilityRules) : null;
    db.db.prepare(`
      INSERT INTO provider_status (email, availability_rules, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        availability_rules = excluded.availability_rules,
        updated_at = datetime('now')
    `).run(e, rulesJson);
  }

  /**
   * Get availability blocks for a provider
   * @param {string} email - Provider email
   * @param {string} [startDate] - Optional filter start date (YYYY-MM-DD)
   * @param {string} [endDate] - Optional filter end date (YYYY-MM-DD)
   * @returns {Array}
   */
  getAvailabilityBlocks(email, startDate = null, endDate = null) {
    if (!email || typeof email !== 'string') return [];
    const e = email.trim().toLowerCase();
    const profile = this.getProviderProfileByEmail(e) || this.ensureProviderProfileForEmail(e);
    const providerId = profile?.id || null;
    let query = `SELECT id, provider_id, provider_email, block_type, start_datetime, end_datetime, title, created_at
      FROM provider_availability_blocks WHERE (provider_email = ?`;
    const params = [e];
    if (providerId) {
      query += ` OR provider_id = ?`;
      params.push(providerId);
    }
    query += `)`;
    if (startDate) {
      query += ` AND date(end_datetime) >= date(?)`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND date(start_datetime) <= date(?)`;
      params.push(endDate);
    }
    query += ` ORDER BY start_datetime ASC`;
    return db.db.prepare(query).all(...params);
  }

  /**
   * Create availability block
   * @param {Object} block - { id, provider_email, block_type, start_datetime, end_datetime, title }
   * @returns {Object} created block
   */
  createAvailabilityBlock(block) {
    if (!block || !block.provider_email || !block.block_type || !block.start_datetime || !block.end_datetime) {
      throw new Error('Missing required fields for availability block');
    }
    const id = block.id || `avb_${require('crypto').randomBytes(12).toString('hex')}`;
    const e = block.provider_email.trim().toLowerCase();
    const profile = this.getProviderProfileByEmail(e) || this.ensureProviderProfileForEmail(e);
    const providerId = profile?.id || null;
    db.db.prepare(`
      INSERT INTO provider_availability_blocks (id, provider_id, provider_email, block_type, start_datetime, end_datetime, title)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, providerId, e, block.block_type, block.start_datetime, block.end_datetime, block.title || null);
    return { id, provider_id: providerId, provider_email: e, block_type: block.block_type, start_datetime: block.start_datetime, end_datetime: block.end_datetime, title: block.title };
  }

  /**
   * Delete availability block
   * @param {string} email - Provider email
   * @param {string} blockId - Block ID
   * @returns {boolean} true if deleted
   */
  deleteAvailabilityBlock(email, blockId) {
    if (!email || !blockId) return false;
    const e = email.trim().toLowerCase();
    const result = db.db.prepare(`
      DELETE FROM provider_availability_blocks WHERE id = ? AND provider_email = ?
    `).run(blockId, e);
    return result.changes > 0;
  }

  /**
   * Get online provider emails for a clinic (customers with provider_profile + merchant matching clinic)
   * Used by BookingService to filter slots by provider availability
   * @param {string} clinicId - Clinic ID
   * @returns {string[]} Array of provider emails who are online
   */
  getOnlineProvidersForClinic(clinicId) {
    if (!clinicId) return [];
    try {
      this.expireStaleHeartbeats();
      const rows = db.db.prepare(`
        SELECT pp.id as provider_id, lower(pp.email) as email, pp.display_name
        FROM provider_profiles pp
        INNER JOIN provider_status ps
          ON (
            (ps.provider_id IS NOT NULL AND ps.provider_id = pp.id)
            OR lower(ps.email) = lower(pp.email)
          )
        WHERE pp.clinic_id = ?
          AND pp.is_active = 1
          AND ps.is_online = 1
      `).all(clinicId);
      console.log(`[ProviderService] clinic=${clinicId} canonical_online_providers=${rows.length}`);
      return rows.map((r) => ({
        provider_id: r.provider_id,
        email: r.email,
        display_name: r.display_name,
        ...this.getProviderBookingTier({ provider_id: r.provider_id, email: r.email }, 'sync')
      }));
    } catch (_) {
      return [];
    }
  }

  getBookableProvidersForClinic(clinicId, lane = 'sync') {
    const all = this.getOnlineProvidersForClinic(clinicId).map((p) => ({
      ...p,
      ...this.getProviderBookingTier(p, lane)
    }));
    if (lane !== 'sync') return all;
    const calendarRequired = this._toBool(process.env.CALENDAR_REQUIRED_FOR_SYNC || 'false');
    const blocksOnlyAllowed = this._toBool(process.env.BLOCKS_ONLY_ALLOWED === undefined ? 'true' : process.env.BLOCKS_ONLY_ALLOWED);
    // If calendar is required OR blocks-only mode is disabled, allow only tier A.
    if (calendarRequired || !blocksOnlyAllowed) {
      return all.filter((p) => p.tier === 'A');
    }
    return all.filter((p) => p.tier === 'A' || p.tier === 'B');
  }

  getProviderBookingReadinessForClinic(clinicId) {
    if (!clinicId) return [];
    try {
      const rows = db.db.prepare(`
        SELECT id as provider_id, display_name, lower(email) as email, is_active
        FROM provider_profiles
        WHERE clinic_id = ?
        ORDER BY display_name ASC
      `).all(clinicId);
      return rows.map((r) => {
        const status = this.getProviderStatus(r.email);
        const tierInfo = this.getProviderBookingTier(r, 'sync');
        return {
          ...r,
          is_online: !!status?.is_online,
          calendar_connected: tierInfo.calendar_connected,
          has_availability_blocks: tierInfo.has_availability_blocks,
          booking_tier: tierInfo.tier,
          booking_ready: !!r.is_active && !!status?.is_online && (tierInfo.tier === 'A' || tierInfo.tier === 'B')
        };
      });
    } catch (_) {
      return [];
    }
  }

  getActiveProviderCountForClinic(clinicId) {
    if (!clinicId) return 0;
    try {
      const row = db.db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM provider_profiles
        WHERE clinic_id = ? AND is_active = 1
      `).get(clinicId);
      return row?.cnt || 0;
    } catch (_) {
      return 0;
    }
  }

  getOnlineProviderEmailsForClinic(clinicId) {
    return this.getOnlineProvidersForClinic(clinicId).map((p) => p.email);
  }

  /**
   * Check if a datetime falls within provider's available blocks (and not out_of_office)
   * @param {string} providerEmail - Provider email
   * @param {Date} slotStart - Slot start datetime
   * @param {Date} slotEnd - Slot end datetime
   * @param {string} date - YYYY-MM-DD
   * @returns {boolean}
   */
  isSlotInProviderAvailability(providerRef, slotStart, slotEnd, date) {
    const providerEmail = typeof providerRef === 'string' ? providerRef : providerRef?.email;
    const blocks = this.getAvailabilityBlocks(providerEmail, date, date);
    const outOfOffice = blocks.filter(b => b.block_type === 'out_of_office');
    const available = blocks.filter(b => b.block_type === 'available');
    for (const b of outOfOffice) {
      const s = new Date(b.start_datetime).getTime();
      const e = new Date(b.end_datetime).getTime();
      const slotS = slotStart.getTime();
      const slotE = slotEnd.getTime();
      if (slotS < e && slotE > s) return false; // overlaps out_of_office
    }
    if (available.length === 0) return true; // No availability blocks = use clinic hours (legacy)
    for (const b of available) {
      const s = new Date(b.start_datetime).getTime();
      const e = new Date(b.end_datetime).getTime();
      const slotS = slotStart.getTime();
      const slotE = slotEnd.getTime();
      if (slotS >= s && slotE <= e) return true; // fully inside available block
    }
    return false;
  }

  /**
   * Get all providers (for multi-provider support)
   * @returns {Array} List of providers
   */
  getProviders() {
    const providers = db.db.prepare(`
      SELECT DISTINCT provider as name, COUNT(*) as appointment_count
      FROM appointments
      WHERE provider IS NOT NULL AND provider != ''
      GROUP BY provider
      ORDER BY appointment_count DESC
    `).all();
    
    return providers;
  }
  
  /**
   * Format time until appointment
   * @private
   */
  _formatTimeUntil(minutes) {
    if (minutes < 0) {
      const abs = Math.abs(minutes);
      if (abs < 60) return `${abs} min ago`;
      const hours = Math.floor(abs / 60);
      const mins = abs % 60;
      return `${hours}h ${mins}m ago`;
    } else if (minutes === 0) {
      return 'Now';
    } else if (minutes < 60) {
      return `in ${minutes} min`;
    } else {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `in ${hours}h ${mins}m`;
    }
  }
  
  /**
   * Get status display with context
   * @private
   */
  _getStatusDisplay(status, minutesUntil, duration) {
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'completed') return 'Completed';
    
    if (minutesUntil < -duration) {
      return 'Past';
    } else if (minutesUntil < 0) {
      return 'In Session';
    } else if (minutesUntil <= 15) {
      return 'Starting Soon';
    } else {
      return 'Upcoming';
    }
  }
}

module.exports = new ProviderService();

