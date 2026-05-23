#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');
const lines = fs.readFileSync(serverPath, 'utf8').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function wrapRegister(name, body, extraDestructure = '') {
  return `'use strict';

function ${name}(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    ensureRoutineTables,
    ensureBillingTables,
    ensurePatientShelfInventoryColumns,
    loadPatientShelfProductRows,
    formatShelfProductApiRow,
    parseBillingDocumentUpload,
    safeParseJsonArray,
    isIsoDateOnly,
    localDateFromIso,
    isoFromLocalDate,
    weekdayKeyForIsoLocal,
    enumerateIsoDates,
    issuePatientDocumentDownloadUrl,
    fetchBillingAggregatesByDay,
    fieldsFromSqlAggRow,
    PatientPortalService,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    getPatientStep3Status,
    ensureProductsPhase2Tables,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
    withIdempotency,
    assertPatientOwnsAppointmentOrThrow,
    validatePatientAvailableSlotsQuery,
    validatePatientBookingScheduleBody,
    validatePatientTriageBody,
    requireCsrfForCookieAuth,
    auditBookingEvent,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
  } = deps;
  ${extraDestructure}

${body}
}

module.exports = { ${name} };
`;
}

const routineBody = `${slice(2488, 3383)}\n\n${slice(4490, 4679)}`;
fs.writeFileSync(
  path.join(__dirname, '../routes/patient-routine.js'),
  wrapRegister('registerPatientRoutineRoutes', routineBody)
);

const shelfBody = slice(1966, 2087);
fs.writeFileSync(
  path.join(__dirname, '../routes/patient-shelf.js'),
  wrapRegister('registerPatientShelfRoutes', shelfBody)
);

const productsBody = slice(2245, 2486);
fs.writeFileSync(
  path.join(__dirname, '../routes/patient-products.js'),
  wrapRegister('registerPatientProductsRoutes', productsBody)
);

const billingBody = slice(3708, 4466);
fs.writeFileSync(
  path.join(__dirname, '../routes/patient-billing-portal.js'),
  wrapRegister('registerPatientBillingPortalRoutes', billingBody)
);

const bookingParts = [
  slice(18599, 19023),
  slice(19118, 19254),
  slice(21372, 21390),
  slice(22736, 23520),
].join('\n\n');
fs.writeFileSync(
  path.join(__dirname, '../routes/patient-booking.js'),
  wrapRegister('registerPatientBookingRoutes', bookingParts)
);

console.log('Wrote route modules from server.js line ranges');
