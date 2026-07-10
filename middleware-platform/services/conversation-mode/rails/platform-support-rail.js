'use strict';

const {
  handleSomoSalesInboundTurn,
  buildPlatformSalesOpener,
  SALES_STAGES,
  stageReply,
  FORBIDDEN_PERSONA_RE
} = require('./somo-sales-inbound-rail');

/** @deprecated use buildPlatformSalesOpener */
const OPENER = buildPlatformSalesOpener();

async function handlePlatformSupportTurn(ctx = {}) {
  return handleSomoSalesInboundTurn(ctx);
}

module.exports = {
  handlePlatformSupportTurn,
  handleSomoSalesInboundTurn,
  buildPlatformSalesOpener,
  SALES_STAGES,
  PLATFORM_STAGES: SALES_STAGES,
  stageReply,
  OPENER,
  FORBIDDEN_PERSONA_RE
};
