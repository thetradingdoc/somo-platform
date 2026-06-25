'use strict';

const KellyToolExecutor = require('./kelly-tool-executor');
const visionCaptureStore = require('./vision-capture-store');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'analyze_skin_concern',
      description: 'Run derm education Q&A for skin/rash concerns using patient description and optional image caption.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Patient description of skin concern' },
          image_caption: { type: 'string', description: 'Optional vision caption from camera frame' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_body_region_capture',
      description: 'Request patient to position camera on a body region for guided capture.',
      parameters: {
        type: 'object',
        properties: {
          region: { type: 'string', description: 'Body region e.g. arm, face, chest, back' },
          guidance: { type: 'string', description: 'Short positioning instruction' }
        },
        required: ['region']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recommend_care_pathway',
      description: 'Recommend urgency tier and education-only care pathway (no booking in MVP).',
      parameters: {
        type: 'object',
        properties: {
          urgency: { type: 'string', enum: ['self_care', 'routine_visit', 'urgent_care', 'emergency'] },
          summary: { type: 'string', description: 'Brief education summary' },
          reasons: { type: 'array', items: { type: 'string' } }
        },
        required: ['urgency', 'summary']
      }
    }
  }
];

async function executeTool(name, args, context = {}) {
  const { sessionId, roomId } = context;
  switch (name) {
    case 'analyze_skin_concern': {
      const result = await KellyToolExecutor._runDermPatientQA(
        {
          message: args.message || '',
          image_caption: args.image_caption || args.imageCaption || '',
          image_present: !!(args.image_caption || args.imageCaption)
        },
        null
      );
      return {
        tool: name,
        success: !!result.success,
        answer: result.answer_text || result.answer || result.message || 'I could not find education content for that concern.',
        abstain: result.compose?.abstain_reason || null,
        raw: result
      };
    }
    case 'request_body_region_capture': {
      const region = String(args.region || 'general').toLowerCase();
      const guidance = args.guidance || `Please position your camera on your ${region} with good lighting.`;
      try {
        visionCaptureStore.ensureVisionCaptureTables?.();
        visionCaptureStore.upsertChecklistRow?.({
          session_id: roomId || sessionId,
          requested_region: region,
          status: 'requested',
          guidance_text: guidance
        });
        visionCaptureStore.insertVisionCaptureEvent?.({
          event_type: 'vision_capture_guidance',
          session_id: roomId || sessionId,
          actor: 'kelly_pa',
          payload: { region, guidance }
        });
      } catch (e) {
        console.warn('[video-tool-registry] vision capture:', e.message);
      }
      return { tool: name, success: true, region, guidance };
    }
    case 'recommend_care_pathway': {
      return {
        tool: name,
        success: true,
        urgency: args.urgency || 'routine_visit',
        summary: args.summary || '',
        reasons: args.reasons || [],
        payment_required: false,
        stub: true
      };
    }
    default:
      return { tool: name, success: false, error: 'unknown_tool' };
  }
}

function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}

module.exports = {
  getToolDefinitions,
  executeTool,
  TOOL_DEFINITIONS
};
