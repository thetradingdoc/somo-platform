'use strict';

/**
 * Status transition FSM extracted from database.js (appointments, payments, checkout).
 */

function isSameStatus(a, b) {
  return (a || '').toString().trim().toLowerCase() === (b || '').toString().trim().toLowerCase();
}

function canTransitionAppointmentStatus(current, next) {
  let cur = (current || 'scheduled').toString().trim().toLowerCase();
  let nxt = (next || '').toString().trim().toLowerCase();
  if (cur === 'cancelled') cur = 'canceled';
  if (nxt === 'cancelled') nxt = 'canceled';
  if (!nxt) return false;
  if (cur === nxt) return true;

  const allowed = {
    pending: ['scheduled', 'confirmed', 'canceled'],
    pending_payment: ['scheduled', 'confirmed', 'canceled'],
    scheduled: ['confirmed', 'canceled', 'completed', 'arrived', 'in_room', 'no_show'],
    confirmed: ['completed', 'canceled', 'arrived', 'in_room', 'no_show'],
    arrived: ['in_room', 'completed', 'canceled', 'no_show'],
    in_room: ['completed', 'canceled', 'no_show'],
    no_show: ['completed'],
    completed: ['documented'],
    documented: [],
    canceled: []
  };

  if (!allowed[cur]) {
    return ['canceled', 'cancelled', 'confirmed', 'completed', 'documented'].includes(nxt);
  }
  return allowed[cur].includes(nxt);
}

function canTransitionPaymentStatus(current, next) {
  const cur = (current || 'unpaid').toString().trim().toLowerCase();
  const nxt = (next || '').toString().trim().toLowerCase();
  if (!nxt) return false;
  if (cur === nxt) return true;
  const allowed = {
    unpaid: ['paid'],
    paid: ['refunded'],
    refunded: []
  };
  if (!allowed[cur]) return ['paid', 'refunded'].includes(nxt);
  return allowed[cur].includes(nxt);
}

function canTransitionCheckoutStatus(current, next) {
  const cur = (current || 'pending').toString().trim().toLowerCase();
  const nxt = (next || '').toString().trim().toLowerCase();
  if (!nxt) return false;
  if (cur === nxt) return true;
  const allowed = {
    pending: ['completed', 'failed', 'cancelled', 'canceled'],
    failed: [],
    completed: ['refunded'],
    refunded: [],
    cancelled: ['completed'],
    canceled: ['completed']
  };
  if (!allowed[cur]) return ['completed', 'failed', 'refunded', 'cancelled', 'canceled'].includes(nxt);
  return allowed[cur].includes(nxt);
}

module.exports = {
  isSameStatus,
  canTransitionAppointmentStatus,
  canTransitionPaymentStatus,
  canTransitionCheckoutStatus
};
