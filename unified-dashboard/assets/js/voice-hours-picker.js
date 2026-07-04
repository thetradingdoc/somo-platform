/**
 * Business hours picker — outputs canonical JSON for voice_agent_settings.business_hours
 * Format: { mon: "09:00-17:00", tue: "09:00-17:00", ... } (24h HH:MM-HH:MM per enabled day)
 */
(function (global) {
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_LABELS = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday'
  };

  const DEFAULT_WEEKDAY = { enabled: true, start: '09:00', end: '17:00' };
  const DEFAULT_WEEKEND = { enabled: false, start: '09:00', end: '17:00' };

  function defaultSchedule() {
    const s = {};
    DAY_KEYS.forEach((key) => {
      const isWeekend = key === 'sat' || key === 'sun';
      s[key] = { ...(isWeekend ? DEFAULT_WEEKEND : DEFAULT_WEEKDAY) };
    });
    return s;
  }

  /** Parse API/storage value into internal schedule */
  function parseBusinessHours(raw) {
    const schedule = defaultSchedule();
    if (!raw) return schedule;

    let obj = raw;
    if (typeof raw === 'string') {
      try {
        obj = JSON.parse(raw);
      } catch (_) {
        return schedule;
      }
    }
    if (!obj || typeof obj !== 'object') return schedule;

    DAY_KEYS.forEach((key) => {
      const val = obj[key];
      if (!val) {
        schedule[key].enabled = false;
        return;
      }
      if (typeof val === 'string') {
        const m = val.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
        if (m) {
          schedule[key].enabled = true;
          schedule[key].start = normalizeTime(m[1]);
          schedule[key].end = normalizeTime(m[2]);
        }
        return;
      }
      if (typeof val === 'object') {
        schedule[key].enabled = val.enabled !== false;
        if (val.start) schedule[key].start = normalizeTime(val.start);
        if (val.end) schedule[key].end = normalizeTime(val.end);
      }
    });
    return schedule;
  }

  function normalizeTime(t) {
    const parts = String(t).trim().split(':');
    const h = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0));
    const m = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Serialize for API */
  function toBusinessHoursJson(schedule) {
    const out = {};
    DAY_KEYS.forEach((key) => {
      const day = schedule[key];
      if (day && day.enabled) {
        out[key] = `${normalizeTime(day.start)}-${normalizeTime(day.end)}`;
      }
    });
    return out;
  }

  function formatHoursSummary(raw) {
    const schedule = parseBusinessHours(raw);
    const enabled = DAY_KEYS.filter((k) => schedule[k].enabled);
    if (enabled.length === 0) return 'No hours set (always open)';
    if (
      enabled.length === 5 &&
      ['mon', 'tue', 'wed', 'thu', 'fri'].every((k) => enabled.includes(k)) &&
      schedule.mon.start === schedule.tue.start
    ) {
      const s = schedule.mon;
      return `Mon – Fri ${format12(s.start)} – ${format12(s.end)}`;
    }
    return enabled
      .map((k) => `${DAY_LABELS[k].slice(0, 3)} ${format12(schedule[k].start)}–${format12(schedule[k].end)}`)
      .join(', ');
  }

  function format12(t) {
    const [hStr, mStr] = normalizeTime(t).split(':');
    let h = parseInt(hStr, 10);
    const am = h < 12;
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${mStr} ${am ? 'AM' : 'PM'}`;
  }

  /**
   * Mount picker into container element
   * @param {HTMLElement} container
   * @param {object} options { businessHours, onChange }
   */
  function mount(container, options = {}) {
    if (!container) return null;
    const schedule = parseBusinessHours(options.businessHours);
    container.innerHTML = '';
    container.classList.add('vah-hours-picker');

    DAY_KEYS.forEach((key) => {
      const row = document.createElement('div');
      row.className = 'vah-hours-row';
      row.dataset.day = key;

      const label = document.createElement('label');
      label.className = 'vah-hours-day';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = schedule[key].enabled;
      cb.dataset.day = key;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(DAY_LABELS[key]));

      const times = document.createElement('div');
      times.className = 'vah-hours-times';

      const start = document.createElement('input');
      start.type = 'time';
      start.value = schedule[key].start;
      start.dataset.day = key;
      start.dataset.bound = 'start';
      start.disabled = !schedule[key].enabled;

      const sep = document.createElement('span');
      sep.className = 'vah-hours-sep';
      sep.textContent = 'to';

      const end = document.createElement('input');
      end.type = 'time';
      end.value = schedule[key].end;
      end.dataset.day = key;
      end.dataset.bound = 'end';
      end.disabled = !schedule[key].enabled;

      times.append(start, sep, end);
      row.append(label, times);
      container.appendChild(row);
    });

    function syncDisabled() {
      container.querySelectorAll('.vah-hours-row').forEach((row) => {
        const key = row.dataset.day;
        const enabled = row.querySelector('input[type=checkbox]').checked;
        row.querySelectorAll('input[type=time]').forEach((inp) => {
          inp.disabled = !enabled;
        });
        let badge = row.querySelector('.sfd-nameplate--off');
        if (!enabled) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'sfd-nameplate sfd-nameplate--off sfd-nameplate--sm';
            badge.innerHTML = '<span class="sfd-nameplate__led"></span>OFF';
            row.appendChild(badge);
          }
        } else if (badge) {
          badge.remove();
        }
      });
    }

    function emitChange() {
      if (typeof options.onChange === 'function') {
        options.onChange(getValue(container));
      }
    }

    container.addEventListener('change', (e) => {
      if (e.target.matches('input[type=checkbox]')) {
        syncDisabled();
      }
      emitChange();
    });

    syncDisabled();

    return {
      getValue: () => getValue(container),
      setValue: (hours) => {
        const next = parseBusinessHours(hours);
        DAY_KEYS.forEach((key) => {
          const row = container.querySelector(`.vah-hours-row[data-day="${key}"]`);
          if (!row) return;
          row.querySelector('input[type=checkbox]').checked = next[key].enabled;
          row.querySelector('input[data-bound=start]').value = next[key].start;
          row.querySelector('input[data-bound=end]').value = next[key].end;
        });
        syncDisabled();
      }
    };
  }

  function getValue(container) {
    const schedule = defaultSchedule();
    if (!container) return toBusinessHoursJson(schedule);
    container.querySelectorAll('.vah-hours-row').forEach((row) => {
      const key = row.dataset.day;
      const enabled = row.querySelector('input[type=checkbox]').checked;
      schedule[key].enabled = enabled;
      schedule[key].start = row.querySelector('input[data-bound=start]').value || '09:00';
      schedule[key].end = row.querySelector('input[data-bound=end]').value || '17:00';
    });
    return toBusinessHoursJson(schedule);
  }

  function defaultGreeting(companyName) {
    const name = (companyName || 'our office').trim();
    return `Hi, I'm Kelly, Somo's front desk receptionist. Thank you for calling ${name}. How can I help you today?`;
  }

  global.VoiceHoursPicker = {
    DAY_KEYS,
    DAY_LABELS,
    defaultSchedule,
    parseBusinessHours,
    toBusinessHoursJson,
    formatHoursSummary,
    mount,
    getValue,
    defaultGreeting
  };
})(typeof window !== 'undefined' ? window : global);
