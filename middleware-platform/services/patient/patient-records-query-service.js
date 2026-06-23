/**
 * M-Doc.3: Patient Records Query Service
 * Loads patient document extracts, runs RAG with LLM, returns patient-friendly answer.
 */

const db = require('../../database');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/**
 * Query patient records with RAG.
 * @param {string} patientId - FHIR patient ID
 * @param {string} query - Patient question (e.g. "explain my labs", "what did my last visit say")
 * @returns {Promise<{answer: string, sources: number}>}
 */
async function queryPatientRecords(patientId, query) {
  if (!patientId || !query || typeof query !== 'string') {
    return { answer: 'I need a patient ID and a question to look up your records.', sources: 0 };
  }

  const q = query.trim();
  if (!q) return { answer: 'What would you like to know about your records?', sources: 0 };

  const getExtracts = db.getPatientDocumentExtractsByPatient;
  if (!getExtracts) {
    return { answer: 'Record search is not available right now.', sources: 0 };
  }

  const extracts = getExtracts(patientId);
  if (!extracts || extracts.length === 0) {
    return {
      answer: "I don't have any uploaded documents for you yet. If you've shared lab results, visit notes, or other documents, I can help explain them once they're in the system.",
      sources: 0
    };
  }

  const combined = extracts
    .filter(e => e.extracted_text && e.extracted_text.trim())
    .map(e => `[Document ${e.doc_id}]:\n${(e.extracted_text || '').trim().slice(0, 8000)}`)
    .join('\n\n---\n\n');

  if (!combined.trim()) {
    return {
      answer: "Your documents are in the system but I couldn't read the text from them yet. Please try again later or ask your care team.",
      sources: 0
    };
  }

  const context = combined.slice(0, 24000);
  const systemPrompt = `You are a helpful medical assistant. The patient has asked a question about their health records. 
Given the following extracted text from their uploaded documents, provide a clear, patient-friendly answer.
- Use plain language. Avoid jargon unless necessary, and explain it.
- Be concise. If the documents don't contain enough information to answer, say so clearly.
- Do NOT make up or infer information that isn't in the documents.
- If lab values or medical terms appear, explain what they mean when relevant.`;

  const userContent = `Patient documents:\n\n${context}\n\n---\n\nPatient question: ${q}`;

  try {
    const answer = await callLLM(systemPrompt, userContent);
    return { answer: answer || "I couldn't generate an answer. Please try rephrasing your question.", sources: extracts.length };
  } catch (e) {
    console.warn('[patient-records-query] LLM error:', e.message);
    return {
      answer: "I'm sorry, I couldn't process that request right now. Please try again later.",
      sources: extracts.length
    };
  }
}

async function callLLM(systemPrompt, userContent) {
  if (GROQ_API_KEY) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: 1024,
        temperature: 0.3
      })
    });
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || '';
  }
  if (OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: 1024,
        temperature: 0.3
      })
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || '';
  }
  throw new Error('No LLM API key (GROQ_API_KEY or OPENAI_API_KEY)');
}

module.exports = { queryPatientRecords };
