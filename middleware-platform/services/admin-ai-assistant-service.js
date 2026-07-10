/**
 * Admin AI Assistant Service
 */

const ChatLLMService = require('./chat-llm-service');
const db = require('../database');
const facade = require('./admin-lead-facade');
const LeadIntelligenceService = require('./lead-intelligence-service');

class AdminAIAssistantService {
  constructor() {
    this.systemPrompt = `You are an AI assistant for the admin sales portal.`;
  }

  parseAdminCommandRegex(message) {
    const text = String(message || '').trim();
    const lower = text.toLowerCase();

    if (/^(help|what can you do)/i.test(lower)) {
      return { action: 'help', target: '', response: 'I can show leads, stats, call suggestions, and scrape status.' };
    }
    if (/scrape status|last scrape|when.*scrape/i.test(lower)) {
      return { action: 'run_scrape', target: '', response: 'Here is the latest scrape status.' };
    }
    if (/who should i call|suggest.*call|call list|call-ready/i.test(lower)) {
      return { action: 'suggest_call_list', target: '', response: 'Top call-ready leads:' };
    }
    if (/conversion|how many calls|stats|statistics/i.test(lower)) {
      return { action: 'show_stats', target: '', response: 'Pipeline statistics:' };
    }
    if (/^call\s+(.+)/i.test(text)) {
      return { action: 'call_lead', target: text.replace(/^call\s+/i, '').trim(), response: 'Confirm outbound call?' };
    }
    if (/show.*leads|list.*leads|needs phone/i.test(lower)) {
      return { action: 'show_leads', target: '', response: 'Matching leads:' };
    }
    return null;
  }

  resolveLeadTarget(target) {
    if (!target) return null;
    const t = String(target).trim();
    const byId = db.getLead(t);
    if (byId) return byId;

    const { leads } = facade.querySalesLeads({ limit: 200 });
    const lower = t.toLowerCase();
    const exact = leads.find((l) => String(l.clinic_name || '').toLowerCase() === lower);
    if (exact) return exact;
    const partial = leads.find((l) => String(l.clinic_name || '').toLowerCase().includes(lower));
    return partial || null;
  }

  async processMessage(message, conversationHistory = []) {
    try {
      const history = conversationHistory.map((msg) => ({
        role: msg.role || 'user',
        content: msg.content || msg.message || '',
      }));

      let response = await ChatLLMService.understandAdminCommand(message, { conversationHistory: history });
      if (!response) {
        response = this.parseAdminCommandRegex(message);
      }

      if (!response || !response.action) {
        return {
          action: 'help',
          message: 'I can help you manage leads, view statistics, and navigate the admin portal.',
          confidence: 0.5,
        };
      }

      const actionMap = {
        show: 'show_leads',
        count: 'show_stats',
        call: 'call_lead',
      };
      const mappedAction = actionMap[response.action] || response.action;
      const filters = this.parseFiltersFromMessage(message);

      if (['show_leads', 'show_stats', 'suggest_call_list', 'run_scrape'].includes(mappedAction)) {
        const result = await this.executeAction(mappedAction, {
          filters,
          target: response.target,
        });
        return {
          action: mappedAction,
          message: response.response || 'Action completed',
          confidence: response.confidence || 0.8,
          result,
        };
      }

      if (mappedAction === 'call_lead') {
        const lead = this.resolveLeadTarget(response.target);
        if (!lead) {
          return {
            action: 'error',
            message: `Could not find a lead matching "${response.target || message}". Try a clinic name or lead id.`,
            confidence: 0.9,
          };
        }
        if (!facade.hasValidPhone(lead.clinic_phone)) {
          return {
            action: 'error',
            message: `${lead.clinic_name} has no callable phone number yet.`,
            confidence: 0.9,
          };
        }
        return {
          action: 'call_lead',
          message: `Call ${lead.clinic_name}?`,
          requires_confirm: true,
          lead_id: lead.id,
          lead_name: lead.clinic_name,
          confidence: response.confidence || 0.7,
        };
      }

      if (mappedAction === 'help') {
        return {
          action: 'help',
          message: response.response || 'Ask me to show leads, stats, suggest calls, or scrape status.',
          confidence: 0.9,
        };
      }

      return { ...response, action: mappedAction };
    } catch (error) {
      return { action: 'error', message: `Sorry, I encountered an error: ${error.message}`, confidence: 1.0 };
    }
  }

  parseFiltersFromMessage(message) {
    const filters = {};
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('high score') || lowerMessage.includes('score >')) filters.min_score = 80;
    if (lowerMessage.includes('qualified')) filters.qualified = true;
    if (lowerMessage.includes('call-ready') || lowerMessage.includes('callable')) {
      filters.contact_status = 'verified';
      filters.callable_only = true;
    }
    if (lowerMessage.includes('needs phone')) filters.contact_status = 'needs_phone';
    const limitMatch = message.match(/\b(\d+)\s+(leads?|results?)\b/i);
    if (limitMatch) filters.limit = parseInt(limitMatch[1], 10);
    return filters;
  }

  async executeAction(action, params) {
    switch (action) {
      case 'show_leads':
        return this.showLeads(params.filters || {});
      case 'show_stats':
        return this.showStats(params.metric);
      case 'suggest_call_list':
        return this.suggestCallList(params.filters?.limit || 5);
      case 'run_scrape':
        return this.runScrapeStatus();
      case 'update_lead':
        return this.updateLead(params.lead_id, params.updates || {});
      default:
        return { error: `Unknown action: ${action}` };
    }
  }

  showLeads(filters) {
    const { leads, total } = facade.querySalesLeads({
      contact_status: filters.contact_status,
      callable_only: filters.callable_only === true,
      source: filters.source,
      limit: filters.limit || 20,
      offset: 0,
    });
    let filtered = leads;
    if (filters.min_score !== undefined) {
      filtered = filtered.filter((l) => (l.lead_score || 0) >= filters.min_score);
    }
    if (filters.qualified) {
      filtered = filtered.filter((l) => l.is_qualified === 1 || l.is_qualified === true);
    }
    return {
      count: filtered.length,
      total,
      leads: filtered.map((lead) => ({
        id: lead.id,
        clinic_name: lead.clinic_name,
        location: lead.location,
        score: lead.lead_score || 0,
        pipeline_stage: lead.pipeline_stage,
        phone: lead.clinic_phone,
        email: lead.clinic_email,
        contact_status: lead.contact_status,
        callable: lead.callable,
      })),
    };
  }

  suggestCallList(limit = 5) {
    const { leads } = facade.querySalesLeads({
      contact_status: 'verified',
      callable_only: true,
      call_ready: true,
      limit: Math.min(limit, 20),
    });
    const callReady = facade.filterCallableLeads(leads);
    return {
      count: callReady.length,
      leads: callReady.map((l) => ({
        id: l.id,
        clinic_name: l.clinic_name,
        location: l.location,
        score: l.lead_score || 0,
      })),
    };
  }

  runScrapeStatus() {
    const jobTracker = require('./admin-job-tracker');
    const scheduler = jobTracker.getSchedulerState();
    let scrapeResult = null;
    try {
      scrapeResult = scheduler.scrape?.last_result_json
        ? JSON.parse(scheduler.scrape.last_result_json)
        : null;
    } catch {
      scrapeResult = null;
    }
    const counts = facade.getLeadCountsByContactStatus();
    return {
      last_scrape: scrapeResult,
      last_run_at: scheduler.scrape?.last_run_at,
      craigslist_enabled: process.env.CRAIGSLIST_ENABLED === '1',
      jsearch_configured: !!(process.env.JOB_SEARCH_API_URL && process.env.JOB_SEARCH_API_KEY),
      leads: counts,
    };
  }

  showStats(metric) {
    const stats = db.getPipelineStats?.() || {};
    const usage = db.getCallUsageStats();
    const counts = facade.getLeadCountsByContactStatus();
    const statsData = {
      total_leads: stats.total || counts.verified + counts.needs_phone,
      verified_leads: counts.verified,
      needs_phone: counts.needs_phone,
      closed_won: stats.closed_won || 0,
      calls_used: usage.calls_used || 0,
      calls_remaining: usage.calls_remaining || 250,
    };
    if (statsData.total_leads > 0) {
      statsData.conversion_rate = ((statsData.closed_won / statsData.total_leads) * 100).toFixed(2);
    } else {
      statsData.conversion_rate = 0;
    }
    if (metric) return { [metric]: statsData[metric] };
    return statsData;
  }

  updateLead(leadId, updates) {
    const lead = db.getLead(leadId);
    if (!lead) return { error: `Lead ${leadId} not found` };
    db.updateLead(leadId, updates);
    if (updates.is_qualified !== undefined) LeadIntelligenceService.updateLeadScore(leadId);
    return { success: true, lead: db.getLead(leadId) };
  }

  getSuggestions() {
    const callList = this.suggestCallList(5);
    const counts = facade.getLeadCountsByContactStatus();
    const suggestions = [];
    if (counts.needs_phone > 0) {
      suggestions.push({
        type: 'enrich',
        message: `${counts.needs_phone} leads need phone enrichment`,
        action: 'enrich',
      });
    }
    if (callList.count > 0) {
      suggestions.push({
        type: 'call',
        message: `${callList.count} call-ready leads in queue`,
        leads: callList.leads.slice(0, 3),
      });
    }
    return suggestions;
  }
}

module.exports = new AdminAIAssistantService();
