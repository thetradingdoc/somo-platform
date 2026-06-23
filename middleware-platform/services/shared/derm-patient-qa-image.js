/**
 * Phase 4.4 — Image path: disclaimers + text used alongside message for retrieval alignment.
 */

const CANNOT_DIAGNOSE_FROM_IMAGE =
  'Photos and image descriptions cannot replace an in-person skin exam. A clinician may need to examine the skin directly, and sometimes tests are required.';

function buildImageBlockForPrompt({ imagePresent, imageCaption }) {
  const hasCaption = !!(imageCaption && String(imageCaption).trim());
  if (!imagePresent && !hasCaption) return '';
  const lines = [CANNOT_DIAGNOSE_FROM_IMAGE];
  if (hasCaption) {
    lines.push(
      'The following description was provided with the image (may be incomplete or uncertain): summarize it only as context, not as a diagnosis.'
    );
  }
  return `Image / photo context:\n${lines.join('\n')}`;
}

/**
 * Text used for retrieval + grounding (aligns caption with user message).
 * @param {object} input
 * @param {string} input.message
 * @param {string} [input.imageCaption]
 */
function buildRetrievalFacingText(input = {}) {
  const message = (input.message || '').toString().trim();
  const cap = (input.imageCaption || '').toString().trim();
  if (!cap) return message;
  return `${message}\n\n[Image description for search: ${cap}]`.trim();
}

module.exports = {
  CANNOT_DIAGNOSE_FROM_IMAGE,
  buildImageBlockForPrompt,
  buildRetrievalFacingText
};
