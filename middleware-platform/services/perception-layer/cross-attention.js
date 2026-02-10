/**
 * Cross-Attention Fusion - Layer 1 Perception
 *
 * Fuses visual and textual findings via GPT-4o.
 * Computes alignment scores and detects conflicts.
 */

const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage } = require('@langchain/core/messages');
const fs = require('fs').promises;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AZURE_OPENAI = !!(
  process.env.AZURE_OPENAI_API_KEY &&
  process.env.AZURE_OPENAI_ENDPOINT &&
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME
);

function getModel() {
  if (AZURE_OPENAI) {
    const { AzureChatOpenAI } = require('@langchain/openai');
    const instanceName = (process.env.AZURE_OPENAI_ENDPOINT || '')
      .replace(/^https?:\/\//, '')
      .split('.')[0];
    return new AzureChatOpenAI({
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiInstanceName: instanceName,
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
      temperature: 0.05,
      maxTokens: 3000
    });
  }
  return new ChatOpenAI({
    modelName: 'gpt-4o',
    openAIApiKey: OPENAI_API_KEY,
    temperature: 0.05,
    maxTokens: 3000
  });
}

function buildPrompt(visualFindings, textualFindings) {
  return `You are a medical AI performing CROSS-MODAL CONSISTENCY ANALYSIS.

TASK: Compare visual findings from imaging with textual findings from clinical notes.
Identify: (1) Which textual findings have VISUAL EVIDENCE, (2) Which visual findings have TEXTUAL SUPPORT, (3) CONFLICTS.

VISUAL FINDINGS:
${JSON.stringify(visualFindings, null, 2)}

TEXTUAL FINDINGS:
${JSON.stringify(textualFindings, null, 2)}

OUTPUT: Return a JSON array of cross-modal links. Each link connects a textual finding to a visual finding (or indicates absence).

\`\`\`json
[
  {
    "text_concept": "wrist_pain",
    "text_location": "distal_radius",
    "text_laterality": "right",
    "visual_finding": "cortical_discontinuity",
    "visual_location": "distal_radius",
    "visual_laterality": "right",
    "visual_confidence": 0.92,
    "alignment_score": 0.95,
    "alignment_type": "strong_match",
    "supporting_evidence": "Patient-reported right wrist pain matches location of definitive fracture on X-ray"
  }
]
\`\`\`

ALIGNMENT_TYPES: strong_match | moderate_match | weak_match | text_only | visual_only | conflict
- strong_match: Visual and textual findings directly correspond
- moderate_match: Related but not identical
- text_only: Symptom with no visual correlate (expected)
- visual_only: Imaging finding not mentioned in text
- conflict: Contradiction between modalities (set alignment_score to -1.0)

CRITICAL: If text says "left wrist" but image shows "right wrist fracture", set alignment_type to "conflict" and alignment_score to -1.0.

Return ONLY the JSON array, no other text.`;
}

function parseResponse(responseText) {
  const text = typeof responseText === 'string' ? responseText : (responseText?.content || '');
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('No JSON found in cross-modal response');
  }
  const jsonStr = (jsonMatch[1] || jsonMatch[0]).trim();
  const links = JSON.parse(jsonStr);
  if (!Array.isArray(links)) throw new Error('Cross-modal response is not an array');
  return links.map((l) => ({
    ...l,
    text_concept: l.text_concept || 'unknown',
    alignment_score: typeof l.alignment_score === 'number' ? l.alignment_score : 0.5,
    alignment_type: l.alignment_type || 'unknown'
  }));
}

function calculateAlignmentMetrics(links) {
  const metrics = {
    total_links: links.length,
    strong_matches: 0,
    moderate_matches: 0,
    weak_matches: 0,
    conflicts: 0,
    text_only: 0,
    visual_only: 0,
    average_alignment_score: 0,
    overall_confidence: 0.5
  };

  let totalScore = 0;
  for (const l of links) {
    if (l.alignment_type === 'strong_match') metrics.strong_matches++;
    else if (l.alignment_type === 'moderate_match') metrics.moderate_matches++;
    else if (l.alignment_type === 'weak_match') metrics.weak_matches++;
    else if (l.alignment_type === 'conflict') metrics.conflicts++;
    else if (l.alignment_type === 'text_only') metrics.text_only++;
    else if (l.alignment_type === 'visual_only') metrics.visual_only++;
    totalScore += Math.max(0, l.alignment_score);
  }

  metrics.average_alignment_score = links.length > 0 ? totalScore / links.length : 0;

  if (metrics.conflicts > 0) {
    metrics.overall_confidence = 0.3;
  } else if (links.length > 0 && metrics.strong_matches / links.length > 0.7) {
    metrics.overall_confidence = 0.9;
  } else if (links.length > 0 && (metrics.strong_matches + metrics.moderate_matches) / links.length > 0.5) {
    metrics.overall_confidence = 0.7;
  }

  return metrics;
}

/**
 * Fuse visual and textual findings via cross-modal reasoning
 * @param {Array} visualFindings
 * @param {Array} textualFindings
 * @param {string|null} imagePath - Optional, for re-grounding
 * @returns {Promise<{cross_modal_links, alignment_metrics}>}
 */
async function fuseModalities(visualFindings, textualFindings, imagePath = null) {
  if (!OPENAI_API_KEY && !AZURE_OPENAI) {
    return {
      cross_modal_links: [],
      alignment_metrics: { total_links: 0, conflicts: 0, average_alignment_score: 0, overall_confidence: 0.5 }
    };
  }

  const prompt = buildPrompt(visualFindings, textualFindings);
  const content = [{ type: 'text', text: prompt }];

  if (imagePath) {
    try {
      const buffer = await fs.readFile(imagePath);
      const base64 = buffer.toString('base64');
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' }
      });
    } catch (_) {
      // omit image if unreadable
    }
  }

  const message = new HumanMessage({ content });
  const model = getModel();
  const response = await model.invoke([message]);
  const links = parseResponse(response?.content || '');
  const alignment_metrics = calculateAlignmentMetrics(links);

  return { cross_modal_links: links, alignment_metrics };
}

module.exports = {
  fuseModalities,
  calculateAlignmentMetrics
};
