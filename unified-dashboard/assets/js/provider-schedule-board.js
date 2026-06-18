/**
 * Filllo-inspired provider schedule board: provider rows × day columns.
 */
(function (global) {
  'use strict';

  const core = global.ProviderCalendarCore;
  const DAY_START_HOUR = 8;
  const DAY_END_HOUR = 20;
  const DAY_HOURS = DAY_END_HOUR - DAY_START_HOUR;
  const CELL_HEIGHT_PX = DAY_HOURS * 48;

  function statusColor(status) {
    return core ? core.statusColor(status) : '#06b6d4';
  }

  function wallClockStartEnd(a) {
    return core ? core.wallClockStartEnd(a) : null;
  }

  function escapeHtml(s) {
    return core ? core.escapeHtml(s) : String(s || '');
  }

  function addDays(date, days) {
    return core ? core.addDays(date, days) : new Date(date.getTime() + days * 86400000);
  }

  function startOfWeekSunday(date) {
    return core ? core.startOfWeekSunday(date) : new Date(date);
  }

  function getLocalDateString(d) {
    return core ? core.getLocalDateString(d) : null;
  }

  function formatDayHeader(d) {
    const wd = d.toLocaleDateString(undefined, { weekday: 'short' });
    const day = String(d.getDate()).padStart(2, '0');
    return `${wd} ${day}`;
  }

  function formatRangeLabel(start) {
    const end = addDays(start, 6);
    const opts = { month: 'short', day: 'numeric' };
    const y = start.getFullYear() !== end.getFullYear();
    const a = start.toLocaleDateString(undefined, y ? { ...opts, year: 'numeric' } : opts);
    const b = end.toLocaleDateString(undefined, { ...opts, year: 'numeric' });
    return `${a} – ${b}`;
  }

  function barPosition(we) {
    if (!we) return null;
    const startMin = we.start.getHours() * 60 + we.start.getMinutes();
    const endMin = we.end.getHours() * 60 + we.end.getMinutes();
    const winStart = DAY_START_HOUR * 60;
    const winEnd = DAY_END_HOUR * 60;
    const topMin = Math.max(startMin, winStart);
    const bottomMin = Math.min(Math.max(endMin, topMin + 15), winEnd);
    if (bottomMin <= winStart || topMin >= winEnd) return null;
    const topPct = ((topMin - winStart) / (winEnd - winStart)) * 100;
    const heightPct = ((bottomMin - topMin) / (winEnd - winStart)) * 100;
    return { topPct, heightPct };
  }

  function shortTime(d) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function groupProviders(appts) {
    const map = new Map();
    (appts || []).forEach((a) => {
      const key = (a.provider || '').trim() || 'Unassigned';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    });
    const names = [...map.keys()].sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
    return names.map((name) => ({ name, appts: map.get(name) }));
  }

  function apptsForDay(appts, ymd) {
    return (appts || []).filter((a) => {
      if (a.date && String(a.date).slice(0, 10) === ymd) return true;
      const we = wallClockStartEnd(a);
      if (we && getLocalDateString(we.start) === ymd) return true;
      if (a.start_time && getLocalDateString(new Date(a.start_time)) === ymd) return true;
      return false;
    });
  }

  function renderScheduleBoard(opts) {
    const container = opts.container;
    if (!container) return;
    const rangeStart = opts.rangeStart || startOfWeekSunday(new Date());
    const appointments = opts.appointments || [];
    const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;
    const onRangeChange =
      typeof opts.onRangeChange === 'function' ? opts.onRangeChange : null;

    const days = [];
    for (let i = 0; i < 7; i += 1) {
      days.push(addDays(rangeStart, i));
    }

    const dayYmds = days.map((d) => getLocalDateString(d));
    const providers = groupProviders(appointments);

    const summaryCounts = dayYmds.map((ymd) =>
      apptsForDay(appointments, ymd).length
    );

    let html = '<div class="pp-schedule-board-inner">';
    html += '<div class="pp-schedule-board-nav">';
    html += '<button type="button" class="pp-btn pp-btn-outline pp-btn-sm" data-board-action="prev" aria-label="Previous week">←</button>';
    html += '<button type="button" class="pp-btn pp-btn-ghost pp-btn-sm" data-board-action="today">Today</button>';
    html += '<button type="button" class="pp-btn pp-btn-outline pp-btn-sm" data-board-action="next" aria-label="Next week">→</button>';
    html += `<span class="pp-schedule-board-range-label">${escapeHtml(formatRangeLabel(rangeStart))}</span>`;
    html += '</div>';

    html += '<div class="pp-schedule-board-grid-wrap"><table class="pp-schedule-board-grid" role="grid">';
    html += '<thead><tr><th class="pp-schedule-board-corner" scope="col">Provider</th>';
    days.forEach((d, i) => {
      const today = getLocalDateString(new Date()) === dayYmds[i];
      html += `<th scope="col" class="pp-schedule-board-day${today ? ' is-today' : ''}">${escapeHtml(formatDayHeader(d))}</th>`;
    });
    html += '</tr><tr class="pp-schedule-board-summary"><th scope="row"></th>';
    summaryCounts.forEach((n) => {
      html += `<td class="pp-schedule-board-summary-cell">${n} appt${n === 1 ? '' : 's'}</td>`;
    });
    html += '</tr></thead><tbody>';

    if (providers.length === 0) {
      html +=
        '<tr><td colspan="8" class="pp-schedule-board-empty">No appointments in this range.</td></tr>';
    } else {
      providers.forEach(({ name, appts }) => {
        html += `<tr><th scope="row" class="pp-schedule-board-provider">${escapeHtml(name)}</th>`;
        dayYmds.forEach((ymd) => {
          const dayAppts = apptsForDay(appts, ymd);
          html += `<td class="pp-schedule-board-cell" style="height:${CELL_HEIGHT_PX}px">`;
          dayAppts.forEach((a) => {
            const we = wallClockStartEnd(a);
            const pos = barPosition(we);
            if (!pos) return;
            const patient = (a.patient_name || 'Unknown').trim();
            const type = (a.appointment_type || 'Visit').trim();
            const label = `${shortTime(we.start)} · ${patient}`;
            const color = statusColor(a.status);
            html += `<button type="button" class="pp-schedule-bar" data-appt-id="${escapeHtml(a.id)}" style="top:${pos.topPct}%;height:${Math.max(pos.heightPct, 8)}%;background:${color};border-color:${color}" title="${escapeHtml(`${patient} — ${type}`)}">`;
            html += `<span class="pp-schedule-bar-label">${escapeHtml(label)}</span>`;
            html += `<span class="pp-schedule-bar-sub">${escapeHtml(type)}</span>`;
            html += '</button>';
          });
          html += '</td>';
        });
        html += '</tr>';
      });
    }

    html += '</tbody></table></div></div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-board-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!onRangeChange) return;
        const action = btn.getAttribute('data-board-action');
        if (action === 'prev') onRangeChange(addDays(rangeStart, -7));
        else if (action === 'next') onRangeChange(addDays(rangeStart, 7));
        else if (action === 'today') onRangeChange(startOfWeekSunday(new Date()));
      });
    });

    container.querySelectorAll('.pp-schedule-bar').forEach((bar) => {
      bar.addEventListener('click', () => {
        const id = bar.getAttribute('data-appt-id');
        const appt = appointments.find((x) => String(x.id) === String(id));
        if (appt && onSelect) onSelect(appt);
      });
    });
  }

  global.ProviderScheduleBoard = {
    renderScheduleBoard,
    startOfWeekSunday,
    addDays
  };
})(typeof window !== 'undefined' ? window : global);
