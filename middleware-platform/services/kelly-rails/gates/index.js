'use strict';

const { runDeterministicSafety } = require('./safety');
const { runDeterministicPostPaymentConfirmation } = require('./post-payment');
const { runDeterministicPayment } = require('./payment');
const { runDeterministicSchedule } = require('./schedule');
const { runDeterministicClinicalIntro } = require('./clinical');
const { runDeterministicOpqrst } = require('./opqrst');
const { runDeterministicRecords } = require('./records');
const { runDeterministicCancel } = require('./cancel');
const { runDeterministicReschedule } = require('./reschedule');
const { runDeterministicApptLookup } = require('./lookup');
const { runDeterministicBookingConflict } = require('./conflict');
const { runDeterministicFrontDeskIntake } = require('./front-desk-intake');

module.exports = {
  runDeterministicSafety,
  runDeterministicPostPaymentConfirmation,
  runDeterministicPayment,
  runDeterministicSchedule,
  runDeterministicClinicalIntro,
  runDeterministicOpqrst,
  runDeterministicFrontDeskIntake,
  runDeterministicRecords,
  runDeterministicCancel,
  runDeterministicReschedule,
  runDeterministicApptLookup,
  runDeterministicBookingConflict
};
