export const TOOL_CARD_MAP = {
  request_body_region_capture: {
    title: 'Camera guidance',
    icon: 'VideoCameraIcon',
    iconClass: 'hv-tool-icon-blue'
  },
  vision_caption: {
    title: 'What Somo noticed',
    icon: 'EyeIcon',
    iconClass: 'hv-tool-icon-gray'
  },
  analyze_skin_concern: {
    title: 'Skin education',
    icon: 'BeakerIcon',
    iconClass: 'hv-tool-icon-amber'
  },
  recommend_care_pathway: {
    title: 'Care pathway',
    icon: 'MapIcon',
    iconClass: 'hv-tool-icon-green'
  },
  generate_visit_summary: {
    title: 'Visit summary',
    icon: 'InformationCircleIcon',
    iconClass: 'hv-tool-icon-gray'
  }
};

export function getToolCardMeta(name) {
  return TOOL_CARD_MAP[name] || {
    title: name || 'Update',
    icon: 'InformationCircleIcon',
    iconClass: 'hv-tool-icon-gray'
  };
}

export function extractToolBody(payload) {
  const name = payload?.name;
  const result = payload?.result || {};
  switch (name) {
    case 'request_body_region_capture':
      return result.guidance || 'Position your camera as guided.';
    case 'vision_caption':
      return result.caption || '';
    case 'analyze_skin_concern':
      return result.answer || '';
    case 'recommend_care_pathway':
      return result.summary || '';
    case 'generate_visit_summary':
      return result.summary?.pathway_summary || result.summary?.chief_complaint || '';
    default:
      return typeof result === 'string' ? result : '';
  }
}

export function extractCitations(payload) {
  const cites = payload?.result?.citations || payload?.citations || [];
  if (!Array.isArray(cites)) return [];
  return cites
    .map((c) => c.label || c.title || c.source || c.id)
    .filter(Boolean)
    .slice(0, 5);
}

export function extractBodyRegionGuidance(payload) {
  if (payload?.name !== 'request_body_region_capture') return null;
  return payload?.result?.guidance || 'Align the skin lesion in frame.';
}

export function extractCareUrgency(payload) {
  if (payload?.name !== 'recommend_care_pathway') return null;
  return payload?.result?.urgency || null;
}
