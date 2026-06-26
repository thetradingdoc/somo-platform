'use strict';

const KellyToolExecutor = require('./kelly-tool-executor');
const visionCaptureStore = require('./vision-capture-store');
const healthSessionService = require('./health-session-service');
const { recommendPathway } = require('./health-care-pathway');
const { buildVisitSummary } = require('./health-visit-summary');
const { latestVisionCaption } = require('./health-video-skin-router');
const healthEducationRetriever = require('./health-education-retriever');

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
  },
  {
    type: 'function',
    function: {
      name: 'generate_visit_summary',
      description: 'Generate structured visit summary JSON for the session report.',
      parameters: {
        type: 'object',
        properties: {
          include_transcript_excerpt: { type: 'boolean' }
        }
      }
    }
  }
];

async function executeTool(name, args, context = {}) {
  const { sessionId, roomId } = context;
  const session = sessionId
    ? healthSessionService.getById(sessionId)
    : (roomId ? healthSessionService.getByRoom(roomId) : null);
  const metadata = session?.metadata || {};

  switch (name) {
    case 'analyze_skin_concern': {
      const caption = args.image_caption || args.imageCaption || latestVisionCaption(metadata);
      const result = await KellyToolExecutor._runDermPatientQA(
        {
          message: args.message || '',
          image_caption: caption,
          image_present: !!caption
        },
        null
      );
      const citations = result.compose?.citations_for_ui
        || result.raw?.compose?.citations_for_ui
        || result.citations_for_ui
        || [];
      return {
        tool: name,
        success: !!result.success,
        answer: result.answer_text || result.answer || result.message || 'I could not find education content for that concern.',
        citations,
        abstain: result.compose?.abstain_reason || null,
        raw: result
      };
    }
    case 'request_body_region_capture': {
      const region = String(args.region || 'general').toLowerCase();
      const guidance = args.guidance || `Please position your camera on your ${region} with good lighting. Align the skin lesion in frame.`;
      try {
        visionCaptureStore.ensureVisionCaptureTables?.();
        visionCaptureStore.upsertChecklistRow?.({
          session_id: roomId || sessionId,
          requested_region: region,
          status: 'requested',
          guidance_text: guidance
        });
        visionCaptureStore.insertVisionCaptureEvent?.({
          event_type: 'vision_capture_requested',
          session_id: roomId || sessionId,
          actor: 'kelly_pa',
          payload: { region, guidance, action: 'vision_capture_requested' }
        });
      } catch (e) {
        console.warn('[video-tool-registry] vision capture:', e.message);
      }
      return { tool: name, success: true, region, guidance, action: 'vision_capture_requested' };
    }
    case 'recommend_care_pathway': {
      const computed = recommendPathway({ metadata, safetyFlags: metadata.safety_flags || [] });
      return {
        tool: name,
        success: true,
        urgency: args.urgency || computed.urgency,
        summary: args.summary || computed.summary,
        reasons: args.reasons?.length ? args.reasons : computed.reasons,
        payment_required: false
      };
    }
    case 'generate_visit_summary': {
      const summary = buildVisitSummary(sessionId, roomId);
      if (sessionId && summary) {
        healthSessionService.updateMetadata(sessionId, { visit_summary: summary });
      }
      return { tool: name, success: true, summary };
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
