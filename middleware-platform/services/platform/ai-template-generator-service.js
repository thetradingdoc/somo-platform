/**
 * AI TEMPLATE GENERATOR SERVICE
 * 
 * Uses AI (Groq LLM) to generate email and SMS templates
 * 
 * Features:
 * - Generate templates from natural language descriptions
 * - Optimize existing templates
 * - Generate variations
 * - Performance suggestions
 */

const Groq = require('groq-sdk');
const db = require('../../database');

class AITemplateGeneratorService {
  constructor() {
    this.groq = null;
    if (process.env.GROQ_API_KEY) {
      this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
  }

  /**
   * Check if AI is available
   */
  isAvailable() {
    return !!this.groq;
  }

  /**
   * Generate a template from a description
   */
  async generateTemplate(description, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Groq API key not configured');
    }

    const {
      type = 'email', // 'email' or 'sms'
      tone = 'professional', // 'professional', 'friendly', 'casual', 'urgent'
      purpose = 'follow-up', // 'welcome', 'follow-up', 'promotion', 'reminder', etc.
      includeVariables = true,
      maxLength = type === 'sms' ? 160 : 500
    } = options;

    const systemPrompt = `You are an expert copywriter specializing in ${type === 'email' ? 'email marketing' : 'SMS marketing'} for healthcare and medical businesses.

Your task is to create effective ${type} templates that:
- Are clear and concise
- Use a ${tone} tone
- Are appropriate for ${purpose} purposes
- Include placeholders for personalization when needed
- Follow best practices for ${type === 'email' ? 'email' : 'SMS'} marketing

${type === 'sms' ? 'Keep SMS messages under 160 characters when possible.' : 'Email templates should be well-structured with a clear subject line.'}

${includeVariables ? 'Use variables like {{lead.name}}, {{lead.clinic_name}}, {{lead.location}} for personalization.' : ''}`;

    const userPrompt = `Generate a ${type} template for: ${description}

Requirements:
- Purpose: ${purpose}
- Tone: ${tone}
- Max length: ${maxLength} ${type === 'sms' ? 'characters' : 'words'}
${includeVariables ? '- Include variables for personalization (e.g., {{lead.name}})' : ''}

${type === 'email' ? 'Provide both a subject line and body content.' : 'Provide only the message content.'}

Format your response as JSON:
{
  "subject": "${type === 'email' ? 'Email subject line' : 'N/A'}",
  "content": "The ${type} message content",
  "variables": ["list", "of", "variables", "used"],
  "suggestions": ["suggestion1", "suggestion2"]
}`;

    try {
      const completion = await this.groq.chat.completions.create({
        model: 'llama-3.1-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      const responseText = completion.choices[0]?.message?.content || '';
      
      // Try to parse JSON response
      let parsed;
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/```\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : responseText;
        parsed = JSON.parse(jsonText);
      } catch (e) {
        // If JSON parsing fails, extract content manually
        parsed = {
          subject: type === 'email' ? this._extractSubject(responseText) : null,
          content: this._extractContent(responseText, type),
          variables: this._extractVariables(responseText),
          suggestions: []
        };
      }

      return {
        success: true,
        template: {
          type: type,
          subject: parsed.subject || (type === 'email' ? 'Follow-up' : null),
          content: parsed.content || responseText,
          variables: parsed.variables || this._extractVariables(parsed.content || responseText),
          suggestions: parsed.suggestions || []
        }
      };
    } catch (error) {
      console.error('❌ AI template generation error:', error);
      throw new Error(`Failed to generate template: ${error.message}`);
    }
  }

  /**
   * Optimize an existing template
   */
  async optimizeTemplate(templateId, focusAreas = []) {
    if (!this.isAvailable()) {
      throw new Error('Groq API key not configured');
    }

    const template = db.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const systemPrompt = `You are an expert ${template.type === 'email' ? 'email' : 'SMS'} marketing copywriter specializing in optimization.

Analyze the provided template and suggest improvements focusing on:
${focusAreas.length > 0 ? focusAreas.map(area => `- ${area}`).join('\n') : '- Clarity and readability\n- Engagement and conversion\n- Best practices\n- Personalization opportunities'}

Provide specific, actionable suggestions.`;

    const userPrompt = `Optimize this ${template.type} template:

${template.type === 'email' ? `Subject: ${template.subject || 'N/A'}\n\n` : ''}Content:
${template.content}

${focusAreas.length > 0 ? `\nFocus on: ${focusAreas.join(', ')}` : ''}

Format your response as JSON:
{
  "optimized_subject": "${template.type === 'email' ? 'Optimized subject' : 'N/A'}",
  "optimized_content": "Optimized content",
  "improvements": ["improvement1", "improvement2"],
  "metrics_expected": {
    "open_rate": "expected improvement",
    "click_rate": "expected improvement"
  }
}`;

    try {
      const completion = await this.groq.chat.completions.create({
        model: 'llama-3.1-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      const responseText = completion.choices[0]?.message?.content || '';
      
      let parsed;
      try {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/```\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : responseText;
        parsed = JSON.parse(jsonText);
      } catch (e) {
        parsed = {
          optimized_subject: template.subject,
          optimized_content: template.content,
          improvements: ['Failed to parse AI response'],
          metrics_expected: {}
        };
      }

      return {
        success: true,
        original: {
          subject: template.subject,
          content: template.content
        },
        optimized: {
          subject: parsed.optimized_subject || template.subject,
          content: parsed.optimized_content || template.content
        },
        improvements: parsed.improvements || [],
        metrics_expected: parsed.metrics_expected || {}
      };
    } catch (error) {
      console.error('❌ AI template optimization error:', error);
      throw new Error(`Failed to optimize template: ${error.message}`);
    }
  }

  /**
   * Generate variations of a template
   */
  async generateVariations(templateId, count = 3) {
    if (!this.isAvailable()) {
      throw new Error('Groq API key not configured');
    }

    const template = db.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const systemPrompt = `You are an expert ${template.type === 'email' ? 'email' : 'SMS'} marketing copywriter.

Generate ${count} variations of the provided template, each with a different approach:
- Variation 1: More direct/urgent
- Variation 2: More friendly/personal
- Variation 3: More value-focused
${count > 3 ? `- Additional variations: Creative approaches` : ''}

Each variation should maintain the core message but use different wording, structure, or emphasis.`;

    const userPrompt = `Generate ${count} variations of this ${template.type} template:

${template.type === 'email' ? `Subject: ${template.subject || 'N/A'}\n\n` : ''}Content:
${template.content}

Format as JSON array:
[
  {
    "name": "Variation 1 - Direct",
    "subject": "${template.type === 'email' ? 'Subject' : 'N/A'}",
    "content": "Content",
    "approach": "direct/urgent"
  },
  ...
]`;

    try {
      const completion = await this.groq.chat.completions.create({
        model: 'llama-3.1-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.9, // Higher temperature for more creativity
        max_tokens: 1500
      });

      const responseText = completion.choices[0]?.message?.content || '';
      
      let variations;
      try {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/```\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : responseText;
        variations = JSON.parse(jsonText);
      } catch (e) {
        // Fallback: create single variation
        variations = [{
          name: 'Variation 1',
          subject: template.subject,
          content: responseText.substring(0, template.type === 'sms' ? 160 : 500),
          approach: 'generated'
        }];
      }

      return {
        success: true,
        variations: Array.isArray(variations) ? variations : [variations]
      };
    } catch (error) {
      console.error('❌ AI template variation generation error:', error);
      throw new Error(`Failed to generate variations: ${error.message}`);
    }
  }

  /**
   * Get performance suggestions for a template
   */
  async getPerformanceSuggestions(templateId, performanceData = {}) {
    if (!this.isAvailable()) {
      throw new Error('Groq API key not configured');
    }

    const template = db.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const systemPrompt = `You are an expert ${template.type === 'email' ? 'email' : 'SMS'} marketing analyst.

Analyze the template and performance data to provide actionable suggestions for improvement.

Consider:
- Open rates (for emails)
- Click rates
- Conversion rates
- Best practices
- A/B testing opportunities`;

    const performanceInfo = Object.keys(performanceData).length > 0
      ? `Performance Data:\n${JSON.stringify(performanceData, null, 2)}`
      : 'No performance data available. Provide general best practice suggestions.';

    const userPrompt = `Analyze this ${template.type} template and provide performance suggestions:

${template.type === 'email' ? `Subject: ${template.subject || 'N/A'}\n\n` : ''}Content:
${template.content}

${performanceInfo}

Format as JSON:
{
  "suggestions": [
    {
      "category": "subject line" | "content" | "timing" | "personalization",
      "suggestion": "Specific suggestion",
      "impact": "high" | "medium" | "low",
      "effort": "low" | "medium" | "high"
    }
  ],
  "ab_test_ideas": ["idea1", "idea2"]
}`;

    try {
      const completion = await this.groq.chat.completions.create({
        model: 'llama-3.1-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 1000
      });

      const responseText = completion.choices[0]?.message?.content || '';
      
      let parsed;
      try {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/```\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : responseText;
        parsed = JSON.parse(jsonText);
      } catch (e) {
        parsed = {
          suggestions: [{ category: 'general', suggestion: 'Review template for best practices', impact: 'medium', effort: 'low' }],
          ab_test_ideas: []
        };
      }

      return {
        success: true,
        suggestions: parsed.suggestions || [],
        ab_test_ideas: parsed.ab_test_ideas || []
      };
    } catch (error) {
      console.error('❌ AI performance suggestions error:', error);
      throw new Error(`Failed to get suggestions: ${error.message}`);
    }
  }

  /**
   * Helper: Extract subject from text
   * @private
   */
  _extractSubject(text) {
    const subjectMatch = text.match(/subject[:\s]+(.+?)(?:\n|$)/i);
    return subjectMatch ? subjectMatch[1].trim() : null;
  }

  /**
   * Helper: Extract content from text
   * @private
   */
  _extractContent(text, type) {
    // Remove markdown code blocks
    text = text.replace(/```[\w]*\n?/g, '');
    
    // For SMS, return first 160 chars
    if (type === 'sms') {
      return text.substring(0, 160).trim();
    }
    
    // For email, try to find body content
    const bodyMatch = text.match(/body[:\s]+(.+?)(?:\n\n|\n$|$)/is);
    if (bodyMatch) return bodyMatch[1].trim();
    
    // Return text without subject line
    const lines = text.split('\n');
    const withoutSubject = lines.filter(line => !line.toLowerCase().includes('subject')).join('\n');
    return withoutSubject.trim() || text.trim();
  }

  /**
   * Helper: Extract variables from text
   * @private
   */
  _extractVariables(text) {
    const variableRegex = /\{\{(\w+(?:\.\w+)*)\}\}/g;
    const matches = [];
    let match;
    while ((match = variableRegex.exec(text)) !== null) {
      if (!matches.includes(match[1])) {
        matches.push(match[1]);
      }
    }
    return matches;
  }
}

// Export singleton instance
const service = new AITemplateGeneratorService();
module.exports = service;

