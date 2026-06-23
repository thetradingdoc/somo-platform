/**
 * Usage Tracking Service
 * Aggregates usage data and calculates costs
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');

class UsageTracker {
  /**
   * Aggregate usage for a customer for a specific date
   */
  static async aggregateDailyUsage(customerId, date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    try {
      // Get API calls for the day
      const apiCalls = db.db.prepare(`
        SELECT COUNT(*) as count, SUM(response_time_ms) as total_time
        FROM api_usage_log
        WHERE customer_id = ? AND DATE(created_at) = ?
      `).get(customerId, targetDate);
      
      // Get voice calls for the day
      const voiceCalls = db.db.prepare(`
        SELECT COUNT(*) as count, SUM(call_duration_seconds) as total_duration
        FROM voice_call_log
        WHERE customer_id = ? AND DATE(created_at) = ?
      `).get(customerId, targetDate);
      
      // Get function calls for the day
      const functionCalls = db.db.prepare(`
        SELECT COUNT(*) as count, function_name, SUM(response_time_ms) as total_time
        FROM function_call_log
        WHERE customer_id = ? AND DATE(created_at) = ?
        GROUP BY function_name
      `).all(customerId, targetDate);
      
      // Aggregate API calls
      if (apiCalls.count > 0) {
        db.aggregateUsage(customerId, targetDate, 'api_calls', apiCalls.count, 0);
      }
      
      // Aggregate voice calls
      if (voiceCalls.count > 0) {
        db.aggregateUsage(customerId, targetDate, 'voice_calls', voiceCalls.count, 0);
      }
      
      // Aggregate function calls
      functionCalls.forEach(fc => {
        db.aggregateUsage(customerId, targetDate, `function_${fc.function_name}`, fc.count, 0);
      });
      
      return {
        success: true,
        date: targetDate,
        api_calls: apiCalls.count || 0,
        voice_calls: voiceCalls.count || 0,
        function_calls: functionCalls.reduce((sum, fc) => sum + fc.count, 0)
      };
    } catch (error) {
      console.error('❌ Error aggregating usage:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Get usage summary for a customer
   */
  static getUsageSummary(customerId, startDate, endDate) {
    try {
      const aggregates = db.getUsageAggregates(customerId, startDate, endDate);
      
      const summary = {
        customer_id: customerId,
        period: { start: startDate, end: endDate },
        metrics: {},
        total_cost: 0
      };
      
      aggregates.forEach(agg => {
        if (!summary.metrics[agg.metric_type]) {
          summary.metrics[agg.metric_type] = {
            count: 0,
            cost: 0
          };
        }
        summary.metrics[agg.metric_type].count += agg.metric_value;
        summary.metrics[agg.metric_type].cost += agg.cost_usd;
        summary.total_cost += agg.cost_usd;
      });
      
      return summary;
    } catch (error) {
      console.error('❌ Error getting usage summary:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Calculate cost for usage
   */
  static calculateCost(customerId, usageData) {
    // Get customer plan
    const customer = db.getCustomer(customerId);
    if (!customer) {
      return { success: false, error: 'Customer not found' };
    }
    
    const planTier = customer.plan_tier || 'starter';
    
    // Cost structure (can be configured later)
    const costRates = {
      starter: {
        api_call: 0.001, // $0.001 per API call
        voice_call: 0.10, // $0.10 per voice call
        function_call: 0.0005 // $0.0005 per function call
      },
      professional: {
        api_call: 0.0005,
        voice_call: 0.05,
        function_call: 0.0002
      },
      enterprise: {
        api_call: 0.0001,
        voice_call: 0.02,
        function_call: 0.0001
      }
    };
    
    const rates = costRates[planTier] || costRates.starter;
    
    let totalCost = 0;
    const breakdown = {};
    
    if (usageData.api_calls) {
      breakdown.api_calls = usageData.api_calls * rates.api_call;
      totalCost += breakdown.api_calls;
    }
    
    if (usageData.voice_calls) {
      breakdown.voice_calls = usageData.voice_calls * rates.voice_call;
      totalCost += breakdown.voice_calls;
    }
    
    if (usageData.function_calls) {
      breakdown.function_calls = usageData.function_calls * rates.function_call;
      totalCost += breakdown.function_calls;
    }
    
    return {
      success: true,
      customer_id: customerId,
      plan_tier: planTier,
      total_cost: totalCost,
      breakdown
    };
  }
}

module.exports = UsageTracker;

