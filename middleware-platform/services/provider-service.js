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
  /**
   * Get today's schedule for a provider
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
      AND status IN ('scheduled', 'confirmed')
      AND datetime(end_time) < datetime(?)
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
      AND status IN ('scheduled', 'confirmed')
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
    const row = db.db.prepare(`
      SELECT is_online, availability_rules, updated_at
      FROM provider_status
      WHERE email = ?
    `).get(email.trim().toLowerCase());
    if (!row) return { is_online: false, availability_rules: null, updated_at: null };
    let rules = null;
    try {
      rules = row.availability_rules ? JSON.parse(row.availability_rules) : null;
    } catch (_) {}
    return {
      is_online: !!row.is_online,
      availability_rules: rules,
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
    db.db.prepare(`
      INSERT INTO provider_status (email, is_online, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        is_online = excluded.is_online,
        updated_at = datetime('now')
    `).run(e, isOnline ? 1 : 0);
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
    let query = `SELECT id, provider_email, block_type, start_datetime, end_datetime, title, created_at
      FROM provider_availability_blocks WHERE provider_email = ?`;
    const params = [e];
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
    db.db.prepare(`
      INSERT INTO provider_availability_blocks (id, provider_email, block_type, start_datetime, end_datetime, title)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, e, block.block_type, block.start_datetime, block.end_datetime, block.title || null);
    return { id, provider_email: e, block_type: block.block_type, start_datetime: block.start_datetime, end_datetime: block.end_datetime, title: block.title };
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
  getOnlineProviderEmailsForClinic(clinicId) {
    if (!clinicId) return [];
    try {
      const clinic = db.db.prepare('SELECT merchant_id FROM clinics WHERE clinic_id = ?').get(clinicId);
      if (!clinic?.merchant_id) return [];
      const customers = db.db.prepare(`
        SELECT id, email FROM customers
        WHERE merchant_id = ? AND provider_profile IS NOT NULL AND provider_profile != ''
      `).all(clinic.merchant_id);
      const online = [];
      for (const c of customers) {
        if (!c.email) continue;
        const status = this.getProviderStatus(c.email);
        if (status && status.is_online) online.push(c.email.trim().toLowerCase());
      }
      return online;
    } catch (_) {
      return [];
    }
  }

  /**
   * Check if a datetime falls within provider's available blocks (and not out_of_office)
   * @param {string} providerEmail - Provider email
   * @param {Date} slotStart - Slot start datetime
   * @param {Date} slotEnd - Slot end datetime
   * @param {string} date - YYYY-MM-DD
   * @returns {boolean}
   */
  isSlotInProviderAvailability(providerEmail, slotStart, slotEnd, date) {
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

