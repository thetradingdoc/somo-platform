export const TOOL_CARD_MAP = {
  request_body_region_capture: {
    title: 'Camera guidance',
    icon: 'VideoCameraIcon',
    iconClass: 'hv-tool-icon-blue'
  },
  vision_caption: {
    title: 'What Kelly noticed',
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
    default:
      return typeof result === 'string' ? result : '';
  }
}

export function extractBodyRegionGuidance(payload) {
  if (payload?.name !== 'request_body_region_capture') return null;
  return payload?.result?.guidance || 'Position the area of concern in view.';
}

export function extractCareUrgency(payload) {
  if (payload?.name !== 'recommend_care_pathway') return null;
  return payload?.result?.urgency || null;
}
