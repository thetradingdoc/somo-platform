/**
 * Layer 1: Multimodal Perception
 *
 * Transforms raw clinical inputs into structured perceptual state.
 * See docs/architecture/README.md#intelligence-layer-layer1-perception-implementation-guide
 *
 * Set PERCEPTION_GRAPH_ENABLED=true to use the LangGraph DAG (Vision + Text + ClinicalBERT → Fusion).
 */

const perceptualStateBuilder = require('./perceptual-state-builder');
const textEncoder = require('./text-encoder');
const visionEncoder = require('./vision-encoder');
const crossAttention = require('./cross-attention');
const perceptionGraph = require('./perception-graph');

const USE_PERCEPTION_GRAPH = process.env.PERCEPTION_GRAPH_ENABLED === 'true' || process.env.PERCEPTION_GRAPH_ENABLED === '1';

async function buildPerceptualState(inputs, db = null) {
  if (USE_PERCEPTION_GRAPH) {
    return perceptionGraph.runPerceptionGraph(inputs, db);
  }
  return perceptualStateBuilder.buildPerceptualState(inputs);
}

module.exports = {
  buildPerceptualState,
  textEncoder,
  visionEncoder,
  crossAttention,
  runPerceptionGraph: perceptionGraph.runPerceptionGraph,
  perceptionGraph
};
