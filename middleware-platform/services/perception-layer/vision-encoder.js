/**
 * Vision Encoder - Layer 1 Perception
 *
 * Extracts visual findings from medical images via GPT-4o.
 * Supports xray, mri, dermatology modalities.
 */

const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage } = require('@langchain/core/messages');
const fs = require('fs').promises;
const { preprocessImage, encodeToBase64 } = require('./image-preprocessor');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AZURE_OPENAI = !!(
  process.env.AZURE_OPENAI_API_KEY &&
  process.env.AZURE_OPENAI_ENDPOINT &&
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME
);

const IMAGING_CONFIG = {
  xray: {
    expectedFindings: ['fracture', 'dislocation', 'effusion', 'normal'],
    bodyRegions: ['skull', 'cervical_spine', 'thorax', 'pelvis', 'upper_extremity', 'lower_extremity'],
    laterality: ['left', 'right', 'bilateral', 'midline']
  },
  mri: {
    expectedFindings: ['mass', 'edema', 'hemorrhage', 'herniation', 'normal'],
    sequences: ['T1', 'T2', 'FLAIR', 'DWI'],
    planes: ['axial', 'sagittal', 'coronal']
  },
  dermatology: {
    expectedFindings: ['lesion', 'rash', 'ulcer', 'nodule', 'macule', 'papule'],
    features: ['asymmetry', 'border', 'color', 'diameter', 'evolution']
  }
};

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
      temperature: 0.1,
      maxTokens: 2000
    });
  }
  return new ChatOpenAI({
    modelName: 'gpt-4o',
    openAIApiKey: OPENAI_API_KEY,
    temperature: 0.1,
    maxTokens: 2000
  });
}

function buildVisionPrompt(modality, clinicalContext) {
  const config = IMAGING_CONFIG[modality] || IMAGING_CONFIG.xray;

  let prompt = `You are an expert radiologist analyzing a ${modality} image. `;

  if (clinicalContext?.chief_complaint) {
    prompt += `\n\nCLINICAL CONTEXT:\nPatient presents with: ${clinicalContext.chief_complaint}\n`;
    if (clinicalContext.symptoms?.length) {
      prompt += `Symptoms: ${clinicalContext.symptoms.join(', ')}\n`;
    }
  }

  prompt += `\n\nTASK:\nAnalyze this ${modality} image and identify ALL visible findings. For EACH finding provide:\n`;
  prompt += `1. finding (e.g., fracture, dislocation, effusion, cortical_discontinuity, normal)\n`;
  prompt += `2. body_region (anatomical location, e.g., distal_radius)\n`;
  prompt += `3. laterality (left, right, bilateral, or midline)\n`;
  prompt += `4. bounding_box [x_min, y_min, x_max, y_max] as pixel coordinates\n`;
  prompt += `5. confidence (0.0-1.0)\n`;
  prompt += `6. evidence_strength (definitive | probable | possible | absent)\n`;
  prompt += `7. details (optional object with fracture_type, displacement, angulation_degrees, etc.)\n\n`;
  prompt += `Return ONLY a JSON array. If NO abnormal findings, return: [{"finding":"normal","confidence":0.95,"body_region":"general","laterality":null,"evidence_strength":"definitive"}]\n\n`;
  prompt += `CRITICAL: Use medical terminology. Specify laterality when visible. Bounding boxes must be accurate. Set confidence < 0.7 if uncertain.`;

  return prompt;
}

function parseVisionResponse(responseText, modality) {
  const text = typeof responseText === 'string' ? responseText : (responseText?.content || '');
  let jsonStr = null;
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  } else {
    const arrMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrMatch) jsonStr = arrMatch[0];
  }
  if (!jsonStr) {
    throw new Error('No JSON found in vision response');
  }
  const findings = JSON.parse(jsonStr);
  if (!Array.isArray(findings)) {
    throw new Error('Vision response is not an array');
  }
  return findings.map((f) => {
    const out = { ...f };
    out.modality = modality;
    out.finding = (f.finding || '').toLowerCase().replace(/\s+/g, '_');
    out.confidence = typeof f.confidence === 'number' ? f.confidence : 0.5;
    out.evidence_strength = f.evidence_strength || 'possible';
    return out;
  });
}

/**
 * Extract visual findings from medical image
 * @param {string} imagePath - Path to image
 * @param {string} modality - 'xray' | 'mri' | 'dermatology'
 * @param {object} clinicalContext - { chief_complaint, symptoms }
 * @returns {Promise<Array>} visual_findings
 */
async function extractVisualFindings(imagePath, modality = 'xray', clinicalContext = null) {
  if (!OPENAI_API_KEY && !AZURE_OPENAI) {
    console.warn('⚠️  Vision encoder: OPENAI_API_KEY or Azure OpenAI not configured');
    return [];
  }

  try {
    await fs.access(imagePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`⚠️  Vision encoder: image not found (${imagePath}), skipping vision`);
      return [];
    }
    throw err;
  }

  try {
    const processed = await preprocessImage(imagePath, modality);
    const base64 = await encodeToBase64(processed.path);
    const prompt = buildVisionPrompt(modality, clinicalContext);

    const message = new HumanMessage({
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:${processed.mimeType};base64,${base64}`,
            detail: 'high'
          }
        }
      ]
    });

    const model = getModel();
    const response = await model.invoke([message]);
    const content = response?.content || '';
    const findings = parseVisionResponse(content, modality);

    findings.forEach((f) => {
      f.image_metadata = {
        original_path: imagePath,
        processed_path: processed.path,
        dimensions: processed.dimensions,
        modality,
        processed_at: new Date().toISOString()
      };
    });

    return findings;
  } catch (err) {
    console.error('Vision encoding error:', err);
    throw new Error(`Failed to extract visual findings: ${err.message}`);
  }
}

module.exports = {
  extractVisualFindings,
  buildVisionPrompt,
  parseVisionResponse
};
