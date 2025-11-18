const Groq = require('groq-sdk');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const knowledgeService = require('./knowledge-service');

// Make Groq optional - only initialize if API key is available
let groq = null;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (GROQ_API_KEY) {
  try {
    groq = new Groq({ apiKey: GROQ_API_KEY });
    console.log('✅ Groq configured - Medical coding AI enabled');
  } catch (error) {
    console.warn('⚠️  Groq initialization failed:', error.message);
    groq = null;
  }
} else {
  console.warn('⚠️  GROQ_API_KEY not set - Medical coding AI features will be disabled');
  console.warn('   Set GROQ_API_KEY in environment variables to enable AI-powered medical coding');
}

const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function buildPrompt({ clinicalNote, encounterType, patientContext, cptCandidates, icdReference }) {
  const context = patientContext ? JSON.stringify(patientContext, null, 2) : 'Not provided';
  const cptSection = cptCandidates.length
    ? cptCandidates.map(item => `- ${item.code}: ${item.description} (keywords: ${item.matched_keywords.join(', ')})`).join('\n')
    : 'No candidate CPT codes found';
  const icdSection = icdReference.length
    ? icdReference.map(item => `- ${item.code}: ${item.description}`).join('\n')
    : 'No ICD-10 reference codes available';

  return `You are a certified medical coding specialist. Review the clinical note and recommended code references.
Respond with JSON containing three keys: "icd10" (array), "cpt" (array), and "rationale" (string).
Each array element must include "code", "description", and "confidence" (0-1).
Only select codes from the provided reference lists. If no code applies, return an empty array.

Clinical Note:
${clinicalNote}

Encounter Type: ${encounterType || 'Unknown'}
Patient Context:
${context}

Candidate CPT Codes:
${cptSection}

Reference ICD-10 Codes:
${icdSection}
`;
}

async function generateCodingSuggestion({ clinicalNote, encounterType, patientContext }) {
  if (!clinicalNote || typeof clinicalNote !== 'string') {
    throw new Error('Clinical note is required for coding suggestions');
  }

  // If Groq is not available, fall back to knowledge service
  if (!groq) {
    console.warn('⚠️  Groq not available - using knowledge service fallback for medical coding');
    const cptCandidates = knowledgeService.getCandidateCptCodes(clinicalNote, { limit: 5 });
    const icdReference = knowledgeService.getReferenceIcdCodes(3);
    
    return {
      icd10: icdReference,
      cpt: cptCandidates.slice(0, 1),
      rationale: 'Selected highest-ranked CPT candidate with reference ICD-10 list (Groq AI unavailable).',
      model: 'knowledge-service-fallback',
      raw: null,
      promptContext: {
        cptCandidates,
        icdReference
      }
    };
  }

  const cptCandidates = knowledgeService.getCandidateCptCodes(clinicalNote, { limit: 12 });
  const icdReference = knowledgeService.getReferenceIcdCodes(15);

  const prompt = buildPrompt({ clinicalNote, encounterType, patientContext, cptCandidates, icdReference });

  try {
    const response = await groq.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a certified medical coder. Always follow AMA and CMS guidelines.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0.2
    });

    let parsed;
    const message = response?.choices?.[0]?.message?.content;
    try {
      parsed = message ? JSON.parse(message) : null;
    } catch (error) {
      throw new Error(`Failed to parse Groq response: ${error.message}`);
    }

    return {
      icd10: Array.isArray(parsed?.icd10) ? parsed.icd10 : [],
      cpt: Array.isArray(parsed?.cpt) ? parsed.cpt : [],
      rationale: parsed?.rationale || '',
      model: DEFAULT_MODEL,
      raw: parsed,
      promptContext: {
        cptCandidates,
        icdReference
      }
    };
  } catch (error) {
    console.error('❌ Groq API error:', error.message);
    // Fall back to knowledge service on error
    console.warn('⚠️  Falling back to knowledge service due to Groq error');
    const cptCandidates = knowledgeService.getCandidateCptCodes(clinicalNote, { limit: 5 });
    const icdReference = knowledgeService.getReferenceIcdCodes(3);
    
    return {
      icd10: icdReference,
      cpt: cptCandidates.slice(0, 1),
      rationale: `Groq AI error: ${error.message}. Using knowledge service fallback.`,
      model: 'knowledge-service-fallback',
      raw: null,
      promptContext: {
        cptCandidates,
        icdReference
      }
    };
  }
}

module.exports = {
  generateCodingSuggestion
};
