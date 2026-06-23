/**
 * Dialogue policy for vision capture outcomes.
 * Batch scope: pass / wrong_region / quality_fail / good_enough / give_up.
 */

function buildVisionAssistantGuidance({
  requestedRegion = 'area',
  status = 'retry_needed',
  qualityIssues = [],
  providerReviewRequired = false
} = {}) {
  const region = String(requestedRegion || 'area').replace(/_/g, ' ');
  const issues = Array.isArray(qualityIssues) ? qualityIssues : [];
  const wrongRegion = issues.includes('wrong_region');
  const poorQuality = issues.some((i) => i !== 'wrong_region');

  if (status === 'failed_max_retries') {
    return {
      type: 'give_up_escalation',
      message: `I am having trouble getting a clear view of your ${region}, but do not worry. I saved what we have for the doctor to review manually.`,
      next_action: 'manual_provider_review'
    };
  }

  if (status === 'passed' && providerReviewRequired) {
    return {
      type: 'good_enough_saved',
      message: `This view of your ${region} is a bit limited, but I saved it for clinician review. Let us try one more clearer capture if possible.`,
      next_action: 'optional_retry'
    };
  }

  if (status === 'passed') {
    return {
      type: 'pass_confirmed',
      message: `Great, I captured your ${region} clearly. We can move to the next area.`,
      next_action: 'advance_checklist'
    };
  }

  if (wrongRegion) {
    return {
      type: 'wrong_region_reposition',
      message: `I am not seeing your ${region} yet. Please reposition the camera and center that area in the frame.`,
      next_action: 'retry_capture'
    };
  }

  if (poorQuality) {
    return {
      type: 'quality_retry',
      message: `The image quality is not clear enough for your ${region}. Please improve lighting, hold still, and move slightly closer, then try again.`,
      next_action: 'retry_capture'
    };
  }

  return {
    type: 'retry_generic',
    message: `Please show your ${region} again so I can confirm it clearly.`,
    next_action: 'retry_capture'
  };
}

module.exports = {
  buildVisionAssistantGuidance
};
