'use strict';

const { runDermPatientQAPipeline } = require('../../derm-patient-qa-pipeline');

function isEnabled() {
  return String(process.env.DERM_EDUCATION_PIPELINE_ENABLED || 'false').toLowerCase() === 'true';
}

/**
 * Health-owned derm education pipeline.
 */
async function runHealthDermPipeline(args, patientId = null) {
  if (!isEnabled()) {
    return {
      success: false,
      error: 'derm_education_pipeline_disabled',
      message: 'Derm Q&A pipeline is not enabled in this environment.'
    };
  }
  const message = (args.message || '').toString().trim();
  if (!message) {
    return { success: false, error: 'message_required' };
  }
  try {
    const out = await runDermPatientQAPipeline({
      message,
      imageCaption: (args.image_caption || args.imageCaption || '').toString().trim(),
      imagePresent: args.image_present === true || args.imagePresent === true,
      patient_id: patientId || null
    });
    return {
      ...out,
      answer: out.answer_text,
      patient_id: patientId || null,
      tool: 'analyze_skin_concern'
    };
  } catch (e) {
    return { success: false, error: 'run_failed', message: e.message };
  }
}

module.exports = {
  runHealthDermPipeline,
  isEnabled
};
