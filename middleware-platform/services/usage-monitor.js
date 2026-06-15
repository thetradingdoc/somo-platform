/**
 * USAGE MONITOR SERVICE
 * Tracks all usage per tenant: SMS, Calls, Retell, Twilio, Azure costs
 * Generates monthly billing breakdowns
 */

const db = require('../database');
const { v4: uuidv4 } = require('uuid');

class UsageMonitor {
  // Cost constants
  static TWILIO_VOICE_COST_PER_MIN = 0.013;
  static RETELL_COST_PER_MIN = 0.02;
  static TWILIO_SMS_COST_OUTBOUND = 0.0075; // $0.0075 per SMS
  static TWILIO_SMS_COST_INBOUND = 0.0; // Free for inbound
  static TWILIO_PHONE_NUMBER_COST = 1.0; // $1/month per number
  static AZURE_BASE_COST = 80; // Base Azure cost per month (shared)
  static TAX_RATE = 0.30; // 30% tax on profit

  /**
   * Log SMS usage (inbound or outbound)
   */
  static logSMSUsage(customerId, merchantId, phoneNumber, direction, messageSid = null, segments = 1) {
    try {
      const id = `sms_${uuidv4()}`;
      const cost = direction === 'outbound' 
        ? segments * this.TWILIO_SMS_COST_OUTBOUND 
        : 0; // Inbound is free

      db.db.prepare(`
        INSERT INTO sms_usage_log (
          id, customer_id, merchant_id, phone_number, direction, 
          message_sid, segments, cost_usd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        customerId,
        merchantId,
        phoneNumber,
        direction,
        messageSid,
        segments,
        cost,
        new Date().toISOString()
      );

      console.log(`📱 SMS logged: ${direction} - ${phoneNumber} - Cost: $${cost.toFixed(4)}`);
      return { success: true, id, cost };
    } catch (error) {
      console.error('❌ Error logging SMS usage:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Log voice call usage (already tracked in voice_call_log, but we enhance it)
   * Calculates costs from duration and updates the database
   */
  static async logVoiceCallUsage(callData) {
    try {
      // Calculate duration in minutes from either minutes or seconds
      let durationMinutes = callData.call_duration_minutes;
      if (!durationMinutes && callData.call_duration_seconds) {
        durationMinutes = callData.call_duration_seconds / 60;
      }

      // Calculate costs if duration is available and costs not already set
      let twilioCost = callData.twilio_cost_calculated_usd || callData.twilio_cost_usd;
      let retellCost = callData.retell_cost_calculated_usd || callData.retell_cost_usd;
      let totalCost = callData.total_cost_usd;

      if (durationMinutes && (!twilioCost || !retellCost)) {
        twilioCost = durationMinutes * this.TWILIO_VOICE_COST_PER_MIN;
        retellCost = durationMinutes * this.RETELL_COST_PER_MIN;
        totalCost = twilioCost + retellCost;
      }

      // Update voice_call_log if it exists
      const existing = db.db.prepare('SELECT * FROM voice_call_log WHERE call_id = ?').get(callData.call_id);
      
      if (existing) {
        // Update with calculated costs
        db.db.prepare(`
          UPDATE voice_call_log 
          SET twilio_cost_calculated_usd = ?,
              retell_cost_calculated_usd = ?,
              total_cost_usd = ?,
              call_duration_minutes = COALESCE(?, call_duration_minutes),
              cost_updated_at = ?
          WHERE call_id = ?
        `).run(
          twilioCost || 0,
          retellCost || 0,
          totalCost || 0,
          durationMinutes || null,
          new Date().toISOString(),
          callData.call_id
        );
      } else if (callData.call_id) {
        // Create new entry if it doesn't exist
        const id = `call_${require('uuid').v4()}`;
        db.db.prepare(`
          INSERT INTO voice_call_log (
            id, customer_id, call_id, twilio_call_sid,
            call_duration_seconds, call_duration_minutes,
            twilio_cost_calculated_usd, retell_cost_calculated_usd, total_cost_usd,
            status, cost_updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          callData.customer_id || null,
          callData.call_id,
          callData.twilio_call_sid || null,
          callData.call_duration_seconds || null,
          durationMinutes || null,
          twilioCost || 0,
          retellCost || 0,
          totalCost || 0,
          callData.status || 'active',
          new Date().toISOString(),
          new Date().toISOString()
        );
      }

      return { success: true, costs: { twilio: twilioCost, retell: retellCost, total: totalCost } };
    } catch (error) {
      console.error('❌ Error logging voice call usage:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get credit balance for a customer
   * @param {string} customerId - Customer ID
   * @returns {Object} Credit balance information
   */
  static getCreditBalance(customerId) {
    try {
      const credits = db.getCustomerCredits(customerId);
      if (!credits) {
        return {
          balance: 0,
          free_allocated: 0,
          free_used: 0,
          free_remaining: 0,
          paid_purchased: 0,
          paid_used: 0,
          paid_remaining: 0
        };
      }

      return {
        balance: credits.credits_balance_minutes || 0,
        free_allocated: credits.free_credits_allocated || 0,
        free_used: credits.free_credits_used || 0,
        free_remaining: Math.max(0, (credits.free_credits_allocated || 0) - (credits.free_credits_used || 0)),
        paid_purchased: credits.paid_credits_purchased || 0,
        paid_used: credits.paid_credits_used || 0,
        paid_remaining: Math.max(0, (credits.paid_credits_purchased || 0) - (credits.paid_credits_used || 0))
      };
    } catch (error) {
      console.error('❌ Error getting credit balance:', error);
      return {
        balance: 0,
        free_allocated: 0,
        free_used: 0,
        free_remaining: 0,
        paid_purchased: 0,
        paid_used: 0,
        paid_remaining: 0
      };
    }
  }

  /**
   * Get monthly usage summary for a tenant
   */
  static getMonthlyUsage(customerId, merchantId, year, month) {
    try {
      const billingMonth = `${year}-${String(month).padStart(2, '0')}`;
      const startDate = `${billingMonth}-01`;
      // Get last day of month: month is 1-indexed (1-12), JavaScript Date uses 0-indexed months
      // new Date(year, month, 0) where month is 1-indexed gives last day of that month
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${billingMonth}-${String(lastDay).padStart(2, '0')}`;

      // Get voice call usage
      const voiceCalls = db.db.prepare(`
        SELECT 
          COUNT(*) as total_calls,
          SUM(call_duration_minutes) as total_minutes,
          SUM(twilio_cost_calculated_usd) as twilio_cost,
          SUM(retell_cost_calculated_usd) as retell_cost,
          SUM(total_cost_usd) as total_voice_cost,
          SUM(CASE WHEN call_duration_minutes IS NULL THEN 1 ELSE 0 END) as incomplete_calls
        FROM voice_call_log
        WHERE customer_id = ? 
          AND DATE(created_at) >= ? 
          AND DATE(created_at) <= ?
      `).get(customerId, startDate, endDate);

      // Get SMS usage
      const smsUsage = db.db.prepare(`
        SELECT 
          COUNT(*) as total_sms,
          SUM(CASE WHEN direction = 'outbound' THEN segments ELSE 0 END) as outbound_segments,
          SUM(CASE WHEN direction = 'inbound' THEN segments ELSE 0 END) as inbound_segments,
          SUM(cost_usd) as sms_cost
        FROM sms_usage_log
        WHERE customer_id = ? 
          AND DATE(created_at) >= ? 
          AND DATE(created_at) <= ?
      `).get(customerId, startDate, endDate);

      // Get phone numbers for this tenant
      const customer = db.getCustomer(customerId);
      const phoneNumbers = customer?.twilio_phone_number ? [customer.twilio_phone_number] : [];
      // TODO: Get all phone numbers for merchant if stored separately
      const phoneNumberCost = phoneNumbers.length * this.TWILIO_PHONE_NUMBER_COST;

      // Calculate Azure allocation (shared cost divided by active tenants)
      const activeTenants = db.db.prepare(`
        SELECT COUNT(DISTINCT merchant_id) as count 
        FROM customers 
        WHERE merchant_id IS NOT NULL AND status = 'active'
      `).get();
      const azureAllocation = this.AZURE_BASE_COST / Math.max(activeTenants.count, 1);

      return {
        billing_month: billingMonth,
        voice_calls: {
          total_calls: voiceCalls.total_calls || 0,
          total_minutes: Math.round((voiceCalls.total_minutes || 0) * 100) / 100,
          twilio_cost: voiceCalls.twilio_cost || 0,
          retell_cost: voiceCalls.retell_cost || 0,
          total_cost: voiceCalls.total_voice_cost || 0,
          incomplete_calls: voiceCalls.incomplete_calls || 0
        },
        sms: {
          total_sms: smsUsage.total_sms || 0,
          outbound_segments: smsUsage.outbound_segments || 0,
          inbound_segments: smsUsage.inbound_segments || 0,
          cost: smsUsage.sms_cost || 0
        },
        infrastructure: {
          phone_numbers: phoneNumbers.length,
          phone_number_cost: phoneNumberCost,
          azure_allocation: Math.round(azureAllocation * 100) / 100
        },
        totals: {
          total_variable_cost: (voiceCalls.total_voice_cost || 0) + (smsUsage.sms_cost || 0),
          total_fixed_cost: phoneNumberCost + azureAllocation,
          total_cost: (voiceCalls.total_voice_cost || 0) + (smsUsage.sms_cost || 0) + phoneNumberCost + azureAllocation
        }
      };
    } catch (error) {
      console.error('❌ Error getting monthly usage:', error);
      return null;
    }
  }

  /**
   * Calculate monthly billing for a tenant
   */
  static calculateMonthlyBilling(customerId, merchantId, year, month) {
    try {
      const usage = this.getMonthlyUsage(customerId, merchantId, year, month);
      if (!usage) return null;

      const customer = db.getCustomer(customerId);
      const pricingTier = customer?.pricing_tier || 'starter';

      // Get pricing tier limits
      const tierLimits = this.getTierLimits(pricingTier);
      
      // Calculate included vs overage
      // Included minutes are the minimum of (total minutes used, tier limit)
      // Overage is anything above the tier limit
      const totalMinutes = usage.voice_calls.total_minutes || 0;
      const includedMinutes = Math.min(totalMinutes, tierLimits.included_minutes);
      const overageMinutes = Math.max(0, totalMinutes - tierLimits.included_minutes);
      const overageCost = overageMinutes * tierLimits.overage_rate;

      // Base subscription cost
      const baseCost = tierLimits.monthly_fee;

      // Calculate subtotal
      const subtotal = baseCost + overageCost;

      // Calculate profit (revenue - costs)
      const profit = subtotal - usage.totals.total_cost;

      // Calculate tax (30% on profit)
      const tax = Math.max(0, profit * this.TAX_RATE);

      // Final total
      const total = subtotal + tax;

      return {
        billing_month: usage.billing_month,
        customer_id: customerId,
        merchant_id: merchantId,
        pricing_tier: pricingTier,
        usage: usage,
        billing: {
          base_subscription: baseCost,
          included_minutes: includedMinutes,
          overage_minutes: overageMinutes,
          overage_cost: Math.round(overageCost * 100) / 100,
          subtotal: Math.round(subtotal * 100) / 100,
          tax: Math.round(tax * 100) / 100,
          total: Math.round(total * 100) / 100
        },
        costs: {
          variable: {
            voice_twilio: Math.round(usage.voice_calls.twilio_cost * 100) / 100,
            voice_retell: Math.round(usage.voice_calls.retell_cost * 100) / 100,
            sms: Math.round(usage.sms.cost * 100) / 100,
            total_variable: Math.round(usage.totals.total_variable_cost * 100) / 100
          },
          fixed: {
            phone_numbers: Math.round(usage.infrastructure.phone_number_cost * 100) / 100,
            azure: Math.round(usage.infrastructure.azure_allocation * 100) / 100,
            total_fixed: Math.round(usage.totals.total_fixed_cost * 100) / 100
          },
          total_cost: Math.round(usage.totals.total_cost * 100) / 100
        },
        profit: {
          gross_profit: Math.round(profit * 100) / 100,
          tax: Math.round(tax * 100) / 100,
          net_profit: Math.round((profit - tax) * 100) / 100,
          margin_percentage: Math.round((profit / subtotal) * 10000) / 100
        }
      };
    } catch (error) {
      console.error('❌ Error calculating monthly billing:', error);
      return null;
    }
  }

  /**
   * Get pricing tier limits
   */
  static getTierLimits(tier) {
    const tiers = {
      starter: {
        monthly_fee: 99,
        included_minutes: 500,
        overage_rate: 0.10,
        max_phone_numbers: 2
      },
      professional: {
        monthly_fee: 199,
        included_minutes: 2000,
        overage_rate: 0.08,
        max_phone_numbers: 5
      },
      enterprise: {
        monthly_fee: 449,
        included_minutes: 5000,
        overage_rate: 0.06,
        max_phone_numbers: 10
      }
    };

    return tiers[tier] || tiers.starter;
  }

  /**
   * Save monthly billing to database
   */
  static saveMonthlyBilling(billingData) {
    try {
      const id = `billing_${uuidv4()}`;
      const invoiceNumber = `INV-${billingData.billing_month.replace('-', '')}-${id.substring(0, 8).toUpperCase()}`;

      // Save to monthly_usage table
      db.db.prepare(`
        INSERT OR REPLACE INTO monthly_usage (
          id, customer_id, billing_month,
          voice_minutes_used, overage_voice_minutes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        billingData.customer_id,
        billingData.billing_month,
        billingData.usage.voice_calls.total_minutes,
        billingData.billing.overage_minutes,
        new Date().toISOString(),
        new Date().toISOString()
      );

      // Save to monthly_invoices table
      const dueDate = new Date();
      dueDate.setMonth(dueDate.getMonth() + 1);
      dueDate.setDate(1); // First day of next month

      db.db.prepare(`
        INSERT OR REPLACE INTO monthly_invoices (
          id, customer_id, billing_month, invoice_number,
          voice_minutes, voice_minutes_cost,
          subtotal, total, status, due_date,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        billingData.customer_id,
        billingData.billing_month,
        invoiceNumber,
        billingData.usage.voice_calls.total_minutes,
        billingData.billing.overage_cost,
        billingData.billing.subtotal,
        billingData.billing.total,
        'pending',
        dueDate.toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      );

      console.log(`✅ Monthly billing saved: ${invoiceNumber} - Total: $${billingData.billing.total}`);
      return { success: true, id, invoice_number: invoiceNumber };
    } catch (error) {
      console.error('❌ Error saving monthly billing:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate monthly billing for all active tenants
   */
  static async generateMonthlyBillingForAll(year, month) {
    try {
      const activeCustomers = db.db.prepare(`
        SELECT DISTINCT c.id, c.merchant_id
        FROM customers c
        WHERE c.merchant_id IS NOT NULL 
          AND c.status = 'active'
      `).all();

      const results = [];
      for (const customer of activeCustomers) {
        const billing = this.calculateMonthlyBilling(customer.id, customer.merchant_id, year, month);
        if (billing) {
          const saved = this.saveMonthlyBilling(billing);
          results.push({
            customer_id: customer.id,
            merchant_id: customer.merchant_id,
            invoice_number: saved.invoice_number,
            total: billing.billing.total,
            success: saved.success
          });
        }
      }

      console.log(`✅ Generated billing for ${results.length} tenants`);
      return results;
    } catch (error) {
      console.error('❌ Error generating monthly billing:', error);
      return [];
    }
  }

  /**
   * Voice usage breakdown by direction with USD cost margin (G2/F3).
   */
  static getVoiceUsageByDirection(customerId, days = 30) {
    try {
      const cols = db.db.prepare('PRAGMA table_info(voice_call_log)').all().map((c) => c.name);
      const hasDirection = cols.includes('direction');
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const rows = db.db.prepare(`
        SELECT * FROM voice_call_log
        WHERE customer_id = ? AND created_at >= ?
        ORDER BY created_at DESC
      `).all(customerId, since);

      const breakdown = { inbound: { minutes: 0, cost_usd: 0 }, outbound: { minutes: 0, cost_usd: 0 } };
      for (const row of rows) {
        const dir = hasDirection ? (row.direction || 'inbound') : 'inbound';
        const key = dir === 'outbound' ? 'outbound' : 'inbound';
        breakdown[key].minutes += row.call_duration_minutes || 0;
        breakdown[key].cost_usd += row.total_cost_usd || 0;
      }

      const usageRows = db.db.prepare(`
        SELECT minutes_applied, direction FROM usage_events
        WHERE customer_id = ? AND created_at >= ? AND minutes_applied > 0
      `).all(customerId, since);
      let windowedMinutes = 0;
      for (const u of usageRows) {
        windowedMinutes += u.minutes_applied || 0;
      }
      const minuteValue = 0.05;
      const totalCostUsd = breakdown.inbound.cost_usd + breakdown.outbound.cost_usd;
      return {
        breakdown,
        windowed_minutes_billed: windowedMinutes,
        margin_estimate_usd: windowedMinutes * minuteValue - totalCostUsd
      };
    } catch (error) {
      console.error('❌ getVoiceUsageByDirection:', error.message);
      return null;
    }
  }
}

module.exports = UsageMonitor;

