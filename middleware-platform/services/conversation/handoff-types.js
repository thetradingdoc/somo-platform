'use strict';

/** Who may end a conversation turn after dispatch. */
const Handoff = {
  SCRIPT_ONLY: 'script_only',
  KELLY_REQUIRED: 'kelly_required',
  KELLY_OPTIONAL: 'kelly_optional'
};

module.exports = { Handoff };
