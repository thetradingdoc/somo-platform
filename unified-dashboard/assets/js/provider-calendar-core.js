/**
 * Shared calendar helpers for FullCalendar + schedule board.
 */
(function (global) {
  'use strict';

  function statusColor(status) {
    switch ((status || '').toLowerCase()) {
      case 'confirmed':
        return '#10b981';
      case 'cancelled':
        return '#ef4444';
      default:
        return '#06b6d4';
    }
  }

  /** Use legacy date + time as local wall clock (avoids UTC display skew). */
  function wallClockStartEnd(a) {
    if (!a || !a.date || a.time == null || a.time === '') return null;
    const tm = String(a.time);
    const parts = tm.split(':');
    const hh = String(parts[0] || '0').padStart(2, '0');
    const mm = String(parts[1] != null ? parts[1] : '0').padStart(2, '0');
    const ss = parts[2] != null ? String(parts[2]).padStart(2, '0') : '00';
    const isoLocal = `${String(a.date).slice(0, 10)}T${hh}:${mm}:${ss}`;
    const start = new Date(isoLocal);
    if (Number.isNaN(start.getTime())) return null;
    let durMs = 30 * 60 * 1000;
    if (a.duration_minutes) durMs = Number(a.duration_minutes) * 60 * 1000;
    if (a.start_time && a.end_time) {
      const d = new Date(a.end_time) - new Date(a.start_time);
      if (d > 0) durMs = d;
    }
    const end = new Date(start.getTime() + durMs);
    return { start, end };
  }

  function getLocalDateString(d) {
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) return null;
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function startOfWeekSunday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function filterAppointmentsForBoard(appts, opts) {
    const providerQ = (opts.providerFilter || '').trim().toLowerCase();
    const searchQ = (opts.boardSearch || '').trim().toLowerCase();
    return (appts || []).filter((a) => {
      if (providerQ) {
        const prov = String(a.provider || 'Unassigned').toLowerCase();
        if (!prov.includes(providerQ)) return false;
      }
      if (searchQ) {
        const hay = [
          a.patient_name,
          a.id,
          a.appointment_type,
          a.provider,
          a.patient_phone
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    });
  }

  global.ProviderCalendarCore = {
    statusColor,
    wallClockStartEnd,
    getLocalDateString,
    addDays,
    startOfWeekSunday,
    escapeHtml,
    filterAppointmentsForBoard
  };
})(typeof window !== 'undefined' ? window : global);
