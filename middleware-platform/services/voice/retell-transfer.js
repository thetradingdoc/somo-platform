'use strict';

/**
 * Retell Custom LLM transfer — single response frame with transfer_number.
 * @see https://docs.retellai.com/api-references/llm-websocket
 */

function buildTransferResponse({
  content,
  responseId,
  transferNumber,
  endCall,
  noInterruptionAllowed = true,
  contentComplete = true
}) {
  const safeResponseId = responseId === undefined || responseId === null ? 0 : responseId;
  const payload = {
    response_type: 'response',
    response_id: safeResponseId,
    content: content || '',
    content_complete: contentComplete !== false
  };
  if (endCall) payload.end_call = true;
  if (transferNumber) {
    payload.transfer_number = transferNumber;
    if (noInterruptionAllowed !== false) {
      payload.no_interruption_allowed = true;
    }
  }
  return payload;
}

/** @param {(payload: object) => void} sendFn — typically ws sendToRetell */
function sendEscalationReply(sendFn, { content, responseId, transferNumber, endCall, noInterruptionAllowed }) {
  if (!content && !transferNumber) return;
  sendFn(
    buildTransferResponse({
      content,
      responseId,
      transferNumber,
      endCall,
      noInterruptionAllowed
    })
  );
}

module.exports = {
  buildTransferResponse,
  sendEscalationReply
};
