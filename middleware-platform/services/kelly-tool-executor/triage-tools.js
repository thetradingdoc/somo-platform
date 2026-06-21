'use strict';

/**
 * Kelly triage tool helpers (OPQRST, rich intake, run_triage_rag).
 * Implementation remains on KellyToolExecutor; this module is the extraction boundary.
 */

module.exports = {
  triageToolNames: ['run_triage_rag', 'store_triage_opqrst', 'store_triage_rich_intake', 'get_triage_session']
};
