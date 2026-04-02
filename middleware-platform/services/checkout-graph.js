'use strict';

// Fallback shim: keeps server checkout route compatible when the
// dedicated checkout graph module is not present on this branch.
// Returning success:false allows server.js to use Kelly fallback path.
async function processTurn() {
  return {
    success: false,
    error: 'langgraph_unavailable'
  };
}

module.exports = {
  processTurn
};
