'use strict';

const KellyToolExecutor = require('../../kelly-tool-executor');
const { KELLY_LANE } = require('../state-schema');
const { getDeterministicReply } = require('../prompts/deterministic');
const { isConfirmatoryUtterance } = require('../confirm-utterance');
const {
  argsFromMeta,
  resolveBookingSlot,
  parseProviderFromMessage,
  bundleMatchesProvider,
  executeDeterministicTool
} = require('./shared');

async function runDeterministicBookingConflict(state, ctx) {
  if (state.active_lane !== KELLY_LANE.BOOKING) return null;
  if (!state.flags?.booking_conflict && !state.flags?.provider_mismatch) return null;

  const resolved = resolveBookingSlot(state, ctx);
  const altBundles = state.flags._conflict_slot_bundles || [];
  const msg = String(ctx.message || '').toLowerCase();
  if (
    resolved.hasSlot &&
    isConfirmatoryUtterance(ctx.message) &&
    /book|confirm|go ahead|please book|schedule/.test(msg) &&
    !altBundles.length &&
    !state.flags.provider_mismatch &&
    !state.flags.provider_preference
  ) {
    return null;
  }

  const locale = state.locale || 'en';
  const toolsUsed = [];
  const slot = state.flags.current_booking_slot || {};
  const targetDate =
    slot.date ||
    argsFromMeta(ctx.sessionId, 'last_slot_date') ||
    (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();

  const timePick = msg.match(/\b(\d{1,2}:\d{2})\b/);
  const picksAlt =
    isConfirmatoryUtterance(ctx.message) ||
    /first one|first option|that works|yes|book that|works for me/.test(msg);

  if (altBundles.length && (timePick || picksAlt)) {
    const pick = timePick
      ? altBundles.find((b) => String(b.time || '').startsWith(timePick[1])) || altBundles[0]
      : altBundles[0];
    if (pick) {
      const sid = pick.id || pick.slot_id || pick.practitioner_id;
      const slotDate = pick.date || targetDate;
      const slotTime = pick.time || '12:00';
      state.flags.current_booking_slot = {
        slot_id: sid,
        date: slotDate,
        time: slotTime,
        practitioner_name: pick.practitioner_name
      };
      if (sid) KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_id', String(sid));
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', slotDate);
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', slotTime);
      state.flags.booking_conflict = false;
      state.flags.provider_mismatch = false;
      state.step = 'confirm_visit';
      return {
        reply: getDeterministicReply('slots_offered', locale),
        toolsUsed,
        endCall: false
      };
    }
  }

  const providerPref = state.flags.provider_preference || parseProviderFromMessage(ctx.message);
  const slots = await executeDeterministicTool(
    state.active_lane,
    state.step || 'schedule_visit',
    'get_available_slots',
    {
      date: targetDate,
      specialty: 'Dermatology',
      days_ahead: 7,
      provider: providerPref || undefined
    },
    ctx
  );
  toolsUsed.push('get_available_slots');
  if (!slots || slots.error) return null;

  const bundles = Array.isArray(slots.slot_bundles) ? slots.slot_bundles : [];
  let offers = bundles;

  if (providerPref) {
    const matched = bundles.filter((b) => bundleMatchesProvider(b, providerPref));
    if (!matched.length) {
      state.flags.provider_mismatch = true;
      offers = bundles.slice(0, 3);
      if (!offers.length) {
        return {
          reply: getDeterministicReply('no_slots_available', locale),
          toolsUsed,
          endCall: false
        };
      }
      const lines = offers.map((b) => `${b.time} (${b.practitioner_name || 'provider'})`).join(', ');
      state.flags._conflict_slot_bundles = offers;
      return {
        reply: getDeterministicReply('provider_mismatch', locale, {
          provider: providerPref,
          slots: lines
        }),
        toolsUsed,
        endCall: false
      };
    }
    offers = matched;
  }

  offers = offers.slice(0, 3);
  state.flags._conflict_slot_bundles = offers;
  const lines = offers.map((b) => `${b.time} (${b.practitioner_name || 'provider'})`).join(', ');
  return {
    reply:
      getDeterministicReply('slot_conflict', locale, { slots: lines }) +
      ' ' +
      getDeterministicReply('slots_offered', locale),
    toolsUsed,
    endCall: false
  };
}

module.exports = { runDeterministicBookingConflict };
