/**
 * Lead Intelligence Service
 * Handles AI-powered lead scoring, qualification, and enrichment
 */

const db = require('../database');
const { v4: uuidv4 } = require('uuid');

class LeadIntelligenceService {
  /**
   * Calculate lead score (0-100)
   * Scoring factors:
   * - Profile completeness (20 points)
   * - Contact quality (15 points)
   * - Industry fit (20 points)
   * - Location signals (15 points)
   * - Historical patterns (15 points)
   * - Engagement signals (15 points)
   */
  calculateLeadScore(lead) {
    let score = 0;

    // 1. Profile Completeness (20 points)
    let completenessScore = 0;
    if (lead.clinic_name) completenessScore += 5;
    if (lead.clinic_phone) completenessScore += 5;
    if (lead.clinic_email) completenessScore += 5;
    if (lead.location) completenessScore += 3;
    if (lead.opening_hours) completenessScore += 2;
    score += Math.min(completenessScore, 20);

    // 2. Contact Quality (15 points)
    let contactScore = 0;
    if (lead.clinic_phone) {
      // Validate phone format (basic check)
      const phoneDigits = lead.clinic_phone.replace(/\D/g, '');
      if (phoneDigits.length >= 10) {
        contactScore += 8;
      }
    }
    if (lead.clinic_email) {
      // Basic email validation
      if (lead.clinic_email.includes('@') && lead.clinic_email.includes('.')) {
        contactScore += 7;
      }
    }
    score += Math.min(contactScore, 15);

    // 3. Industry Fit (20 points)
    // Higher score for medical/healthcare related keywords
    const industryKeywords = ['medical', 'clinic', 'health', 'care', 'dental', 'therapy', 'physician', 'doctor', 'hospital'];
    const nameLower = (lead.clinic_name || '').toLowerCase();
    const titleLower = (lead.title || '').toLowerCase();
    const combinedText = nameLower + ' ' + titleLower;
    
    let industryScore = 0;
    industryKeywords.forEach(keyword => {
      if (combinedText.includes(keyword)) {
        industryScore += 3;
      }
    });
    score += Math.min(industryScore, 20);

    // 4. Location Signals (15 points)
    // Prioritize US locations
    if (lead.location) {
      const locationLower = lead.location.toLowerCase();
      if (locationLower.includes('us') || locationLower.includes('united states') || 
          locationLower.includes('usa') || /^[A-Z]{2},?\s*US/i.test(lead.location)) {
        score += 15;
      } else if (locationLower.match(/\d{5}/)) { // ZIP code
        score += 10;
      } else if (locationLower.includes(',') || locationLower.match(/[A-Z]{2}/)) {
        score += 8;
      }
    }

    // Reset and recalculate properly
    score = 0;

    // 1. Profile Completeness (20 points)
    score += Math.min(completenessScore, 20);

    // 2. Contact Quality (15 points)
    score += Math.min(contactScore, 15);

    // 3. Industry Fit (20 points)
    score += Math.min(industryScore, 20);

    // 4. Location Signals (15 points)
    if (lead.location) {
      const locationLower = lead.location.toLowerCase();
      if (locationLower.includes('us') || locationLower.includes('united states') || 
          locationLower.includes('usa') || /^[A-Z]{2},?\s*US/i.test(lead.location)) {
        score += 15;
      } else if (locationLower.match(/\d{5}/)) {
        score += 10;
      } else if (locationLower.includes(',') || locationLower.match(/[A-Z]{2}/)) {
        score += 8;
      }
    }

    // 5. Historical Patterns (15 points) - Past activity
    let historyScore = 0;
    // Has been contacted before
    if (lead.call_count > 0) historyScore += 7;
    // Has call history recorded
    if (lead.last_called_at) {
      const lastCalled = new Date(lead.last_called_at);
      const now = new Date();
      const daysSince = Math.floor((now - lastCalled) / (1000 * 60 * 60 * 24));
      // Recent contact (within 30 days) is better
      if (daysSince <= 30) historyScore += 8;
      else if (daysSince <= 90) historyScore += 5;
    }
    score += Math.min(historyScore, 15);

    // 6. Engagement Signals (15 points) - Current/ongoing engagement
    let engagementScore = 0;
    // Has scheduled follow-up (shows active interest)
    if (lead.follow_up_date) {
      const followUpDate = new Date(lead.follow_up_date);
      const now = new Date();
      const daysUntilFollowUp = Math.floor((followUpDate - now) / (1000 * 60 * 60 * 24));
      // Upcoming follow-up (active engagement)
      if (daysUntilFollowUp >= 0 && daysUntilFollowUp <= 7) {
        engagementScore += 10;
      } else if (daysUntilFollowUp > 7 && daysUntilFollowUp <= 30) {
        engagementScore += 5;
      }
    }
    // Has next action defined (organized engagement)
    if (lead.next_action) engagementScore += 5;
    score += Math.min(engagementScore, 15);

    // Cap at 100
    return Math.min(Math.round(score), 100);
  }

  /**
   * Auto-qualify lead based on configurable rules
   * Returns { qualified: boolean, matchedRule?: object, reason?: string }
   */
  shouldAutoQualify(lead, merchantId = null) {
    // Get active qualification rules (ordered by priority)
    const rules = db.getQualificationRules(merchantId, true);
    
    // If no rules configured, use default hardcoded logic
    if (rules.length === 0) {
      return this._defaultQualificationLogic(lead);
    }

    // Evaluate rules in priority order
    for (const rule of rules) {
      if (this._evaluateQualificationRule(lead, rule)) {
        return {
          qualified: true,
          matchedRule: rule,
          reason: `Matched rule: ${rule.name}`
        };
      }
    }

    return {
      qualified: false,
      reason: 'No qualification rules matched'
    };
  }

  /**
   * Default qualification logic (fallback when no rules configured)
   * @private
   */
  _defaultQualificationLogic(lead) {
    // Qualification criteria:
    // 1. Has valid phone AND email
    const hasPhone = lead.clinic_phone && lead.clinic_phone.trim() !== '';
    const hasEmail = lead.clinic_email && lead.clinic_email.trim() !== '';
    
    if (!hasPhone || !hasEmail) {
      return { qualified: false, reason: 'Missing phone or email' };
    }

    // 2. Score >= 60
    const score = this.calculateLeadScore(lead);
    if (score < 60) {
      return { qualified: false, reason: `Score too low: ${score}` };
    }

    // 3. Has industry-related keywords (basic check)
    const industryKeywords = ['medical', 'clinic', 'health', 'care', 'dental', 'therapy', 'physician', 'doctor'];
    const text = ((lead.clinic_name || '') + ' ' + (lead.title || '')).toLowerCase();
    const hasIndustryKeywords = industryKeywords.some(keyword => text.includes(keyword));
    
    if (!hasIndustryKeywords) {
      return { qualified: false, reason: 'No industry keywords found' };
    }

    return { qualified: true, reason: 'Default qualification criteria met' };
  }

  /**
   * Evaluate a qualification rule against a lead
   * @private
   */
  _evaluateQualificationRule(lead, rule) {
    const rules = rule.rules || [];
    if (rules.length === 0) return false;

    // Rules are evaluated with AND logic (all must pass)
    for (const condition of rules) {
      if (!this._evaluateCondition(lead, condition)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a single condition
   * @private
   */
  _evaluateCondition(lead, condition) {
    const { field, operator, value } = condition;
    
    let fieldValue;
    
    // Get field value from lead
    switch (field) {
      case 'lead_score':
        fieldValue = lead.lead_score || 0;
        break;
      case 'has_phone':
        fieldValue = (lead.clinic_phone && lead.clinic_phone.trim() !== '') ? 1 : 0;
        break;
      case 'has_email':
        fieldValue = (lead.clinic_email && lead.clinic_email.trim() !== '') ? 1 : 0;
        break;
      case 'has_location':
        fieldValue = (lead.location && lead.location.trim() !== '') ? 1 : 0;
        break;
      case 'is_qualified':
        fieldValue = lead.is_qualified ? 1 : 0;
        break;
      case 'pipeline_stage':
        fieldValue = lead.pipeline_stage || '';
        break;
      case 'source':
        fieldValue = lead.source || '';
        break;
      case 'call_count':
        fieldValue = lead.call_count || 0;
        break;
      case 'contains_keywords':
        // Special case: value should be an array of keywords
        const text = ((lead.clinic_name || '') + ' ' + (lead.title || '') + ' ' + (lead.location || '')).toLowerCase();
        const keywords = Array.isArray(value) ? value : [value];
        fieldValue = keywords.some(keyword => text.includes(keyword.toLowerCase())) ? 1 : 0;
        return this._evaluateConditionOperator(fieldValue, 'eq', 1);
      default:
        fieldValue = lead[field];
    }

    return this._evaluateConditionOperator(fieldValue, operator, value);
  }

  /**
   * Evaluate condition operator
   * @private
   */
  _evaluateConditionOperator(left, operator, right) {
    switch (operator) {
      case 'eq':
      case 'equals':
        return left == right;
      case 'ne':
      case 'not_equals':
        return left != right;
      case 'gt':
      case 'greater_than':
        return left > right;
      case 'gte':
      case 'greater_than_or_equal':
        return left >= right;
      case 'lt':
      case 'less_than':
        return left < right;
      case 'lte':
      case 'less_than_or_equal':
        return left <= right;
      case 'contains':
        return String(left).toLowerCase().includes(String(right).toLowerCase());
      case 'in':
        const rightArray = Array.isArray(right) ? right : [right];
        return rightArray.includes(left);
      case 'not_in':
        const notInArray = Array.isArray(right) ? right : [right];
        return !notInArray.includes(left);
      case 'starts_with':
        return String(left).toLowerCase().startsWith(String(right).toLowerCase());
      case 'ends_with':
        return String(left).toLowerCase().endsWith(String(right).toLowerCase());
      default:
        console.warn(`Unknown operator: ${operator}`);
        return false;
    }
  }

  /**
   * Update lead score
   */
  updateLeadScore(leadId) {
    const lead = db.getLead(leadId);
    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }

    const score = this.calculateLeadScore(lead);
    const now = new Date().toISOString();

    // Update lead score
    db.updateLead(leadId, {
      lead_score: score,
      last_score_update: now
    });

    // Auto-qualify if criteria met
    const qualificationResult = this.shouldAutoQualify({ ...lead, lead_score: score }, null);
    if (qualificationResult.qualified) {
      if (!lead.is_qualified) {
        db.updateLead(leadId, {
          is_qualified: 1,
          auto_qualified: 1,
          qualified_at: now
        });
      }
    }

    return score;
  }

  /**
   * Batch update scores for multiple leads
   */
  batchUpdateScores(leadIds = null) {
    const leads = leadIds 
      ? leadIds.map(id => db.getLead(id)).filter(Boolean)
      : db.getAllLeads();

    const results = leads.map(lead => {
      try {
        const score = this.updateLeadScore(lead.id);
        return { leadId: lead.id, score, success: true };
      } catch (error) {
        console.error(`Failed to update score for lead ${lead.id}:`, error.message);
        return { leadId: lead.id, score: null, success: false, error: error.message };
      }
    });

    return {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  /**
   * Get lead insights (AI-generated insights about the lead)
   */
  getLeadInsights(lead) {
    const insights = [];

    const score = lead.lead_score || this.calculateLeadScore(lead);

    if (score >= 80) {
      insights.push('High-value lead with strong qualification signals');
    } else if (score >= 60) {
      insights.push('Good lead with decent qualification signals');
    } else if (score < 40) {
      insights.push('Low score - may need more information to qualify');
    }

    if (lead.clinic_phone && !lead.clinic_email) {
      insights.push('Has phone but missing email - consider email extraction');
    } else if (lead.clinic_email && !lead.clinic_phone) {
      insights.push('Has email but missing phone - consider phone extraction');
    }

    if (lead.call_count > 0 && !lead.last_called_at) {
      insights.push('Has call history but missing last call date - data inconsistency');
    }

    if (lead.follow_up_date) {
      const followUpDate = new Date(lead.follow_up_date);
      const now = new Date();
      if (followUpDate < now) {
        const daysOverdue = Math.floor((now - followUpDate) / (1000 * 60 * 60 * 24));
        insights.push(`Follow-up overdue by ${daysOverdue} day(s) - prioritize contact`);
      }
    }

    return insights;
  }
}

module.exports = new LeadIntelligenceService();

