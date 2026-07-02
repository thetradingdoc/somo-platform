'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');

const WINDOW_MS = Number(process.env.STEDI_CB_WINDOW_MS || 5 * 60 * 1000);
const FAIL_THRESHOLD = Number(process.env.STEDI_CB_FAIL_THRESHOLD || 5);

const state = { failures: [], openUntil: 0 };

function recordStediFailure() {
  const now = Date.now();
  state.failures = state.failures.filter((t) => now - t < WINDOW_MS);
  state.failures.push(now);
  if (state.failures.length >= FAIL_THRESHOLD) {
    state.openUntil = now + WINDOW_MS;
  }
}

function recordStediSuccess() {
  state.failures = [];
  state.openUntil = 0;
}

function isStediCircuitOpen() {
  return Date.now() < state.openUntil;
}

function getStediCircuitStatus() {
  return {
    open: isStediCircuitOpen(),
    failures_in_window: state.failures.length,
    open_until: state.openUntil ? new Date(state.openUntil).toISOString() : null
  };
}

module.exports = {
  recordStediFailure,
  recordStediSuccess,
  isStediCircuitOpen,
  getStediCircuitStatus,
  FAIL_THRESHOLD,
  WINDOW_MS
};
