'use strict';

const fs = require('fs');
const path = require('path');
const RetellService = require('./retell-service');

const VOICE_COMMERCE_TOOL_NAMES = new Set([
  'search_products',
  'create_checkout',
  'get_available_payment_methods',
  'verify_checkout_code',
  'get_order_tracking',
  'end_call'
]);

let _cachedTools = null;

function retellFnToOpenAiTool(fn) {
  return {
    type: 'function',
    function: {
      name: fn.name,
      description: fn.description || '',
      parameters: fn.parameters || { type: 'object', properties: {} }
    }
  };
}

function loadPstnVoiceCommerceTools() {
  if (_cachedTools) return _cachedTools;
  const jsonPath = path.join(__dirname, '../retell-functions/retell-functions.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  _cachedTools = (raw.functions || [])
    .filter((fn) => VOICE_COMMERCE_TOOL_NAMES.has(fn.name))
    .map(retellFnToOpenAiTool);
  return _cachedTools;
}

function buildPstnVoiceCommerceSystemPrompt(opts = {}) {
  const shop = new RetellService().getDefaultShopPrompt();
  const merchantLine = opts.merchantId
    ? `Merchant context: supplements catalog for merchant ${opts.merchantId}.`
    : '';
  const localeLine = opts.preferredLanguage
    ? `Respond in ${String(opts.preferredLanguage).slice(0, 2) === 'es' ? 'Spanish' : 'English'}.`
    : '';
  return `${shop}

${merchantLine}
${localeLine}

You are Kelly at Somo Supplements (twenty-four seven phone line).
- Use search_products when the caller wants to buy or browse supplements.
- Collect name and email before create_checkout; confirm spelling when needed.
- For payment questions, call get_available_payment_methods.
- After create_checkout, use verify_checkout_code when the caller reads their email code.
- Use get_order_tracking for shipment status questions.
- Keep replies concise and natural for voice.`;
}

module.exports = {
  VOICE_COMMERCE_TOOL_NAMES,
  loadPstnVoiceCommerceTools,
  buildPstnVoiceCommerceSystemPrompt
};
