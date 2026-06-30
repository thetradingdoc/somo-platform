'use strict';

jest.mock('../services/health-vision-caption-bridge', () => ({
  buildImageCaption: jest.fn()
}));

const healthVisionCaption = require('../services/health-vision-caption-bridge');
const healthSessionService = require('../services/health-session-service');
const tokenBudget = require('../utils/token-budget');

/**
 * Exercises the health-* vision_frame branch logic (mirrors video-consult.js).
 */
async function processHealthVisionFrame(room, payload = {}) {
  const sessionId = healthSessionService.sessionIdFromRoom(room);
  if (!sessionId) return { skipped: true, reason: 'no_session' };
  if (!tokenBudget.canProceedHealthSession(sessionId, { frames: 1 })) {
    return { skipped: true, reason: 'health_frame_limit' };
  }
  const captionResult = await healthVisionCaption.buildImageCaption({
    detections: payload.detections || [],
    frameQuality: payload.frame_quality || 'fair',
    imageBase64: payload.image_base64 || null
  });
  tokenBudget.addHealthSessionUsage(sessionId, { frames: 1 });
  const session = healthSessionService.getById(sessionId);
  const artifacts = (session?.metadata?.vision_artifacts || []).concat([{
    caption: captionResult.caption,
    source: captionResult.source,
    ts: payload.timestamp || new Date().toISOString()
  }]);
  healthSessionService.updateMetadata(sessionId, { vision_artifacts: artifacts });
  return { success: true, caption: captionResult };
}

describe('health vision_frame processing', () => {
  beforeEach(() => {
    healthVisionCaption.buildImageCaption.mockReset();
    healthVisionCaption.buildImageCaption.mockResolvedValue({
      caption: 'Visible neck region with mild redness',
      source: 'yolo'
    });
  });

  afterEach(() => {
    tokenBudget.resetHealthSession('vision-test-session');
  });

  test('vision_frame populates metadata.vision_artifacts', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const room = session.room_id;

    const result = await processHealthVisionFrame(room, {
      detections: [{ class: 'neck', confidence: 0.9 }],
      timestamp: new Date().toISOString()
    });

    expect(result.success).toBe(true);
    const updated = healthSessionService.getById(session.id);
    expect(updated.metadata.vision_artifacts).toHaveLength(1);
    expect(updated.metadata.vision_artifacts[0].caption).toMatch(/neck/i);
  });
});
