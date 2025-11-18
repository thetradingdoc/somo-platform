/**
 * COST TRACKER UTILITY
 * 
 * Functions to fetch call costs from Twilio and Retell APIs
 */

const axios = require('axios');

// Pricing constants (per minute)
const TWILIO_COST_PER_MINUTE = 0.013; // $0.013/min for voice calls
const RETELL_COST_PER_MINUTE = 0.02; // $0.02/min for Retell usage

/**
 * Fetch Twilio cost for a call using CallSid
 * @param {string} callSid - Twilio Call SID
 * @returns {Promise<number|null>} Cost in USD or null if fetch fails
 */
async function fetchTwilioCost(callSid) {
  if (!callSid) {
    console.warn('⚠️  No Twilio CallSid provided');
    return null;
  }

  try {
    // Initialize Twilio client
    let twilio;
    try {
      twilio = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    } catch (twilioError) {
      console.warn('⚠️  Twilio SDK not available:', twilioError.message);
      return null;
    }

    // Fetch call details from Twilio API
    const call = await twilio.calls(callSid).fetch();
    
    // Twilio returns price as negative (cost to account), convert to positive
    let cost = null;
    if (call.price !== null && call.price !== undefined) {
      // Price is in the account currency, convert to USD if needed
      // If price is negative (typical), make it positive
      cost = Math.abs(parseFloat(call.price || 0));
      
      // If priceUnit is provided, use it (price * priceUnit = actual cost)
      if (call.priceUnit && parseFloat(call.priceUnit) !== 1) {
        cost = cost * parseFloat(call.priceUnit);
      }
    } else {
      // Price not available yet (call may have just ended)
      console.warn(`⚠️  Twilio price not available for call ${callSid}`);
      return null;
    }

    console.log(`✅ Fetched Twilio cost for ${callSid}: $${cost.toFixed(4)}`);
    return cost;
  } catch (error) {
    if (error.code === 20004) {
      // Call not found (might have just ended, price not ready yet)
      console.warn(`⚠️  Twilio call ${callSid} not found or price not available yet`);
    } else {
      console.warn(`⚠️  Failed to fetch Twilio cost for ${callSid}:`, error.message);
    }
    return null;
  }
}

/**
 * Fetch Retell cost for a call using call_id
 * @param {string} callId - Retell call ID
 * @returns {Promise<number|null>} Cost in USD or null if fetch fails
 */
async function fetchRetellCost(callId) {
  if (!callId) {
    console.warn('⚠️  No Retell call_id provided');
    return null;
  }

  try {
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
      console.warn('⚠️  RETELL_API_KEY not configured');
      return null;
    }

    // Fetch call details from Retell API
    const response = await axios.get(
      `https://api.retellai.com/v2/get-call/${callId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // 5 second timeout
      }
    );

    // Retell API response structure may vary
    // Try common cost field locations
    const callData = response.data;
    let cost = null;

    if (callData.call?.cost !== null && callData.call?.cost !== undefined) {
      cost = parseFloat(callData.call.cost);
    } else if (callData.cost !== null && callData.cost !== undefined) {
      cost = parseFloat(callData.cost);
    } else if (callData.call?.price !== null && callData.call?.price !== undefined) {
      cost = parseFloat(callData.call.price);
    } else {
      console.warn(`⚠️  Retell cost not found in API response for call ${callId}`);
      return null;
    }

    console.log(`✅ Fetched Retell cost for ${callId}: $${cost.toFixed(4)}`);
    return cost;
  } catch (error) {
    if (error.response?.status === 404) {
      console.warn(`⚠️  Retell call ${callId} not found`);
    } else if (error.response?.status === 429) {
      console.warn(`⚠️  Retell API rate limited for call ${callId}`);
    } else {
      console.warn(`⚠️  Failed to fetch Retell cost for ${callId}:`, error.message);
    }
    return null;
  }
}

/**
 * Calculate estimated costs based on call duration
 * @param {number} durationMinutes - Call duration in minutes
 * @returns {Object} Calculated costs for Twilio and Retell
 */
function calculateEstimatedCosts(durationMinutes) {
  const twilioCost = durationMinutes * TWILIO_COST_PER_MINUTE;
  const retellCost = durationMinutes * RETELL_COST_PER_MINUTE;
  const totalCost = twilioCost + retellCost;

  return {
    twilio_cost_calculated_usd: parseFloat(twilioCost.toFixed(4)),
    retell_cost_calculated_usd: parseFloat(retellCost.toFixed(4)),
    total_cost_calculated_usd: parseFloat(totalCost.toFixed(4))
  };
}

/**
 * Fetch costs from both APIs and calculate fallback costs
 * @param {string} twilioCallSid - Twilio Call SID
 * @param {string} retellCallId - Retell call ID
 * @param {number} durationMinutes - Call duration in minutes (for fallback)
 * @returns {Promise<Object>} Cost data with both real and calculated costs
 */
async function fetchCallCosts(twilioCallSid, retellCallId, durationMinutes) {
  // Fetch costs in parallel
  const [twilioCost, retellCost] = await Promise.all([
    fetchTwilioCost(twilioCallSid),
    fetchRetellCost(retellCallId)
  ]);

  // Always calculate estimated costs as fallback
  const calculatedCosts = calculateEstimatedCosts(durationMinutes);

  // Determine cost source
  const costSource = (twilioCost !== null || retellCost !== null) ? 'api' : 'calculated';

  // Use real costs if available, otherwise use calculated
  const finalTwilioCost = twilioCost !== null ? twilioCost : calculatedCosts.twilio_cost_calculated_usd;
  const finalRetellCost = retellCost !== null ? retellCost : calculatedCosts.retell_cost_calculated_usd;
  const totalCost = finalTwilioCost + finalRetellCost;

  return {
    twilio_cost_usd: finalTwilioCost > 0 ? finalTwilioCost : null,
    retell_cost_usd: finalRetellCost > 0 ? finalRetellCost : null,
    total_cost_usd: totalCost,
    twilio_cost_calculated_usd: calculatedCosts.twilio_cost_calculated_usd,
    retell_cost_calculated_usd: calculatedCosts.retell_cost_calculated_usd,
    cost_source: costSource
  };
}

module.exports = {
  fetchTwilioCost,
  fetchRetellCost,
  calculateEstimatedCosts,
  fetchCallCosts,
  TWILIO_COST_PER_MINUTE,
  RETELL_COST_PER_MINUTE
};

