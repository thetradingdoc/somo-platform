'use strict';

const { DynamicStructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const toolRegistry = require('../tools/registry');

function buildHealthLangChainTools(context = {}) {
  return [
    new DynamicStructuredTool({
      name: 'analyze_skin_concern',
      description: 'Derm education Q&A for skin/rash concerns.',
      schema: z.object({
        message: z.string(),
        image_caption: z.string().optional()
      }),
      func: async (args) => JSON.stringify(await toolRegistry.executeTool('analyze_skin_concern', args, context))
    }),
    new DynamicStructuredTool({
      name: 'request_body_region_capture',
      description: 'Request camera positioning on a body region.',
      schema: z.object({
        region: z.string(),
        guidance: z.string().optional()
      }),
      func: async (args) => JSON.stringify(await toolRegistry.executeTool('request_body_region_capture', args, context))
    }),
    new DynamicStructuredTool({
      name: 'recommend_care_pathway',
      description: 'Recommend education-only care urgency tier.',
      schema: z.object({
        urgency: z.enum(['self_care', 'routine_visit', 'urgent_care', 'emergency']).optional(),
        summary: z.string().optional(),
        reasons: z.array(z.string()).optional()
      }),
      func: async (args) => JSON.stringify(await toolRegistry.executeTool('recommend_care_pathway', args, context))
    }),
    new DynamicStructuredTool({
      name: 'generate_visit_summary',
      description: 'Structured visit summary for report.',
      schema: z.object({ include_transcript_excerpt: z.boolean().optional() }),
      func: async (args) => JSON.stringify(await toolRegistry.executeTool('generate_visit_summary', args, context))
    })
  ];
}

module.exports = {
  buildHealthLangChainTools
};
