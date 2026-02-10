/**
 * Layer 1: Multimodal Perception
 *
 * Transforms raw clinical inputs into structured perceptual state.
 * See docs/architecture/intelligence-layer/LAYER1_PERCEPTION_IMPLEMENTATION_GUIDE.md
 */

const { buildPerceptualState } = require('./perceptual-state-builder');
const textEncoder = require('./text-encoder');
const visionEncoder = require('./vision-encoder');
const crossAttention = require('./cross-attention');

module.exports = {
  buildPerceptualState,
  textEncoder,
  visionEncoder,
  crossAttention
};
