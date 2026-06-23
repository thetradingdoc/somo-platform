/**
 * Admin AI Assistant Service
 * Handles natural language queries for admin portal
 * Extends ChatLLMService with admin-specific context
 */

const ChatLLMService = require('./chat-llm-service');
const db = require('../../database');
const LeadIntelligenceService = require('./lead-intelligence-service');

class AdminAIAssistantService {
  constructor() {
    this.systemPrompt = `You are an AI assistant for the admin sales portal. You help admins manage leads, analyze data, and automate sales processes.

Available actions:
1. show_leads - Show leads with filters (e.g., "show me high-value leads in NY", "find leads with score > 80")
2. show_stats - Show dashboard statistics (e.g., "what's our conversion rate?", "how many qualified leads?")
3. update_lead - Update lead properties (e.g., "qualify lead XYZ", "set priority for lead ABC to high")
4. filter_leads - Apply filters to leads (e.g., "show only qualified leads", "filter by location NY")
5. navigate - Navigate to different tabs (e.g., "go to leads tab", "open pipeline")
6. help - Show available commands

Always respond in a helpful, concise manner. When showing data, summarize key insights.`;

    this.tools = [
      {
        type: 'function',
        function: {
          name: 'show_leads',
          description: 'Show leads with optional filters. Returns list of leads matching criteria.',
          parameters: {
            type: 'object',
            properties: {
              filters: {
                type: 'object',
                description: 'Filter criteria for leads',
                properties: {
                  min_score: { type: 'number', description: 'Minimum lead score (0-100)' },
                  max_score: { type: 'number', description: 'Maximum lead score (0-100)' },
                  location: { type: 'string', description: 'Location filter (e.g., "NY", "California")' },
                  qualified: { type: 'boolean', description: 'Filter by qualification status' },
                  pipeline_stage: { type: 'string', description: 'Pipeline stage (new, contacted, qualified, demo, proposal, negotiation, closed_won, closed_lost)' },
                  limit: { type: 'number', description: 'Maximum number of leads to return' }
                }
              }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'show_stats',
          description: 'Show dashboard statistics and metrics',
          parameters: {
            type: 'object',
            properties: {
              metric: {
                type: 'string',
                enum: ['total_leads', 'qualified_leads', 'conversion_rate', 'calls_used', 'revenue', 'pipeline'],
                description: 'Specific metric to retrieve'
              }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'update_lead',
          description: 'Update a lead property',
          parameters: {
            type: 'object',
            properties: {
              lead_id: { type: 'string', description: 'Lead ID to update' },
              updates: {
                type: 'object',
                description: 'Fields to update',
                properties: {
                  is_qualified: { type: 'boolean' },
                  pipeline_stage: { type: 'string' },
                  priority: { type: 'number', description: 'Priority (1-10, 1 is highest)' },
                  notes: { type: 'string' }
                }
              }
            },
            required: ['lead_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'navigate',
          description: 'Navigate to a specific tab in the admin portal',
          parameters: {
            type: 'object',
            properties: {
              tab: {
                type: 'string',
                enum: ['dashboard', 'leads', 'pipeline', 'tenants', 'clients'],
                description: 'Tab to navigate to'
              }
            },
            required: ['tab']
          }
        }
      }
    ];
  }

  /**
   * Process admin chat message
   */
  async processMessage(message, conversationHistory = []) {
    try {
      // Use ChatLLMService's understandCommand with custom context
      const response = await ChatLLMService.understandCommand(message, {
        conversationHistory: conversationHistory.map(msg => ({
          role: msg.role || 'user',
          content: msg.content || msg.message || ''
        }))
      });

      if (!response || !response.action) {
        return {
          action: 'help',
          message: 'I can help you manage leads, view statistics, and navigate the admin portal. What would you like to do?',
          confidence: 0.5
        };
      }

      // Map actions to admin-specific actions
      const actionMap = {
        'show': 'show_leads',
        'count': 'show_stats'
      };

      const mappedAction = actionMap[response.action] || response.action;

      // Execute the action
      if (mappedAction !== 'help' && mappedAction !== 'error') {
        const result = await this.executeAction(mappedAction, {
          filters: this.parseFiltersFromMessage(message),
          target: response.target
        });
        return {
          action: mappedAction,
          message: response.response || 'Action completed',
          confidence: response.confidence || 0.8,
          result
        };
      }

      return {
        ...response,
        action: mappedAction
      };
    } catch (error) {
      console.error('Admin AI Assistant error:', error);
      return {
        action: 'error',
        message: `Sorry, I encountered an error: ${error.message}`,
        confidence: 1.0
      };
    }
  }

  /**
   * Parse filters from natural language message
   */
  parseFiltersFromMessage(message) {
    const filters = {};
    const lowerMessage = message.toLowerCase();

    // Score filters
    if (lowerMessage.includes('high score') || lowerMessage.includes('score >') || lowerMessage.includes('score above')) {
      filters.min_score = 80;
    } else if (lowerMessage.includes('low score') || lowerMessage.includes('score <')) {
      filters.max_score = 40;
    }

    // Location
    const locationMatch = message.match(/\b(NY|New York|California|CA|Texas|TX|Florida|FL|Illinois|IL)\b/i);
    if (locationMatch) {
      filters.location = locationMatch[1];
    }

    // Qualified
    if (lowerMessage.includes('qualified')) {
      filters.qualified = true;
    } else if (lowerMessage.includes('unqualified') || lowerMessage.includes('not qualified')) {
      filters.qualified = false;
    }

    // Limit
    const limitMatch = message.match(/\b(\d+)\s+(leads?|results?)\b/i);
    if (limitMatch) {
      filters.limit = parseInt(limitMatch[1], 10);
    }

    return filters;
  }

  /**
   * Execute action from LLM response
   */
  async executeAction(action, params) {
    switch (action) {
      case 'show_leads':
        return this.showLeads(params.filters || {});
      
      case 'show_stats':
        return this.showStats(params.metric);
      
      case 'update_lead':
        return this.updateLead(params.lead_id, params.updates || {});
      
      case 'navigate':
        return { tab: params.tab, message: `Navigating to ${params.tab} tab` };
      
      default:
        return { error: `Unknown action: ${action}` };
    }
  }

  /**
   * Show leads with filters
   */
  showLeads(filters) {
    let query = 'SELECT * FROM leads WHERE 1=1';
    const values = [];

    if (filters.min_score !== undefined) {
      query += ' AND lead_score >= ?';
      values.push(filters.min_score);
    }

    if (filters.max_score !== undefined) {
      query += ' AND lead_score <= ?';
      values.push(filters.max_score);
    }

    if (filters.location) {
      query += ' AND location LIKE ?';
      values.push(`%${filters.location}%`);
    }

    if (filters.qualified !== undefined) {
      query += ' AND is_qualified = ?';
      values.push(filters.qualified ? 1 : 0);
    }

    if (filters.pipeline_stage) {
      query += ' AND pipeline_stage = ?';
      values.push(filters.pipeline_stage);
    }

    query += ' ORDER BY lead_score DESC, priority DESC, created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      values.push(filters.limit);
    } else {
      query += ' LIMIT 50'; // Default limit
    }

    const leads = db.db.prepare(query).all(...values);
    
    return {
      count: leads.length,
      leads: leads.map(lead => ({
        id: lead.id,
        clinic_name: lead.clinic_name,
        location: lead.location,
        score: lead.lead_score || 0,
        qualified: lead.is_qualified === 1,
        pipeline_stage: lead.pipeline_stage,
        phone: lead.clinic_phone,
        email: lead.clinic_email
      }))
    };
  }

  /**
   * Show statistics
   */
  showStats(metric) {
    const stats = db.getPipelineStats();
    const usage = db.getCallUsageStats();
    const allLeads = db.getAllLeads();

    const statsData = {
      total_leads: stats.total || allLeads.length,
      qualified_leads: stats.qualified || allLeads.filter(l => l.is_qualified === 1).length,
      closed_won: stats.closed_won || 0,
      calls_used: usage.calls_used || 0,
      calls_remaining: usage.calls_remaining || 250
    };

    // Calculate conversion rate
    if (statsData.total_leads > 0) {
      statsData.conversion_rate = ((statsData.closed_won / statsData.total_leads) * 100).toFixed(2);
    } else {
      statsData.conversion_rate = 0;
    }

    if (metric) {
      return { [metric]: statsData[metric] };
    }

    return statsData;
  }

  /**
   * Update lead
   */
  updateLead(leadId, updates) {
    const lead = db.getLead(leadId);
    if (!lead) {
      return { error: `Lead ${leadId} not found` };
    }

    db.updateLead(leadId, updates);

    // If qualification status changed, update score
    if (updates.is_qualified !== undefined) {
      LeadIntelligenceService.updateLeadScore(leadId);
    }

    return {
      success: true,
      lead: db.getLead(leadId)
    };
  }
}

module.exports = new AdminAIAssistantService();

