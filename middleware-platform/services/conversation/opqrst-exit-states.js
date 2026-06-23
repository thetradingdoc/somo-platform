'use strict';

/** OPQRST subrail exit states after triage assessment. */
const OpqrstExitState = Object.freeze({
  COMPLETED_BOOK: 'completed_book',
  COMPLETED_ESCALATE: 'completed_escalate',
  COMPLETED_REFER: 'completed_refer',
  INCOMPLETE_HOLD: 'incomplete_hold',
  INCONCLUSIVE_TRIAGE: 'inconclusive_triage'
});

const ALL_OPQRST_EXIT_STATES = Object.values(OpqrstExitState);

/** Tenant policy actions when triage is inconclusive. */
const InconclusiveTriageAction = Object.freeze({
  BOOK_GENERAL: 'book_general',
  NURSE_CALLBACK: 'nurse_callback',
  HANDOFF: 'handoff'
});

function isOpqrstExitState(v) {
  return ALL_OPQRST_EXIT_STATES.includes(v);
}

module.exports = {
  OpqrstExitState,
  InconclusiveTriageAction,
  ALL_OPQRST_EXIT_STATES,
  isOpqrstExitState
};
