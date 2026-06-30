'use strict';

const PINNED_STATES = ['New York'];

/**
 * Parse JSearch-style location strings: "Alexandria, Virginia, US"
 */
function parseLeadLocation(raw) {
  if (!raw || typeof raw !== 'string') {
    return { city: null, state: null, country: null, raw: raw || null };
  }
  const trimmed = raw.trim();
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const country = parts[parts.length - 1];
    const state = parts[parts.length - 2];
    const city = parts.slice(0, -2).join(', ');
    return { city, state, country, raw: trimmed };
  }
  if (parts.length === 2) {
    return { city: parts[0], state: parts[1], country: null, raw: trimmed };
  }
  return { city: trimmed, state: null, country: null, raw: trimmed };
}

function normalizeStateName(state) {
  return String(state || '').trim();
}

function leadMatchesState(leadLocation, stateName) {
  const state = normalizeStateName(stateName);
  if (!state) return true;
  const parsed = parseLeadLocation(leadLocation);
  if (parsed.state && parsed.state.toLowerCase() === state.toLowerCase()) return true;
  const raw = (leadLocation || '').toLowerCase();
  const needle = state.toLowerCase();
  if (needle === 'virginia') {
    return /,\s*virginia(?:,|\s|$)/i.test(leadLocation || '');
  }
  return raw.includes(`, ${needle},`) || raw.includes(`, ${needle} `) || raw.endsWith(`, ${needle}`);
}

function leadMatchesCity(leadLocation, cityOrRaw) {
  const target = String(cityOrRaw || '').trim();
  if (!target) return true;
  const raw = (leadLocation || '').trim();
  if (raw === target) return true;
  const parsed = parseLeadLocation(raw);
  const targetParsed = parseLeadLocation(target);
  if (targetParsed.city && parsed.city && parsed.state && targetParsed.state) {
    return parsed.city.toLowerCase() === targetParsed.city.toLowerCase()
      && parsed.state.toLowerCase() === targetParsed.state.toLowerCase();
  }
  return raw.toLowerCase().includes(target.toLowerCase());
}

function matchesLocationFilter(lead, location, locationMode) {
  if (!location) return true;
  const mode = (locationMode || 'legacy').toLowerCase();
  const loc = lead?.location || lead;
  if (mode === 'state') {
    return leadMatchesState(typeof loc === 'string' ? loc : lead.location, location);
  }
  if (mode === 'city') {
    return leadMatchesCity(typeof loc === 'string' ? loc : lead.location, location);
  }
  const f = String(location).toLowerCase().trim();
  if (!f) return true;
  return String(typeof loc === 'string' ? loc : lead.location || '').toLowerCase().includes(f);
}

function sortStatesWithPin(states) {
  const pinned = [];
  const rest = [];
  for (const row of states) {
    if (PINNED_STATES.some((p) => p.toLowerCase() === (row.state || '').toLowerCase())) {
      pinned.push(row);
    } else {
      rest.push(row);
    }
  }
  pinned.sort((a, b) => (b.count || 0) - (a.count || 0));
  rest.sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.state).localeCompare(String(b.state)));
  return [...pinned, ...rest];
}

module.exports = {
  PINNED_STATES,
  parseLeadLocation,
  leadMatchesState,
  leadMatchesCity,
  matchesLocationFilter,
  sortStatesWithPin,
};
