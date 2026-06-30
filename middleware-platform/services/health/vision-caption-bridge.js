'use strict';

const modelRouter = require('./model-router');

/**
 * Build image caption from YOLO detections; optionally escalate to Anthropic vision.
 */
function captionFromYolo(detections = []) {
  if (!Array.isArray(detections) || !detections.length) return '';
  const tags = detections
    .filter((d) => Number(d?.confidence || d?.conf || 0) >= 0.5)
    .map((d) => String(d?.class || d?.name || 'object'))
    .slice(0, 8);
  return tags.length ? `Visible regions/tags: ${tags.join(', ')}` : '';
}

async function buildImageCaption({ detections = [], frameQuality = 'fair', imageBase64 = null } = {}) {
  const yoloCaption = captionFromYolo(detections);
  const qualityGood = ['good', 'excellent'].includes(String(frameQuality).toLowerCase());

  if (!qualityGood || !imageBase64 || !modelRouter.canUseAnthropicVision()) {
    return { caption: yoloCaption, source: 'yolo' };
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const mediaType = 'image/jpeg';
    const response = await client.messages.create({
      model: modelRouter.getVisionModel(),
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: 'Describe visible skin or body surface findings for patient education only. No diagnosis.' }
        ]
      }]
    });
    const text = response.content?.find((c) => c.type === 'text')?.text?.trim() || yoloCaption;
    return { caption: text, source: 'anthropic' };
  } catch (e) {
    console.warn('[health-vision-caption] anthropic failed:', e.message);
    return { caption: yoloCaption, source: 'yolo_fallback' };
  }
}

module.exports = {
  captionFromYolo,
  buildImageCaption
};
