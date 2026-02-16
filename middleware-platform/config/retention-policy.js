/**
 * Data Retention Policy (Section 21)
 *
 * Retention periods by data type. Use with cleanup scripts.
 */

module.exports = {
  voice_call_log: 365,        // 1 year (days)
  coding_decisions: 2555,     // 7 years for billing compliance
  llm_usage_log: 90,          // 90 days
  function_call_log: 90,      // 90 days
  voice_conversation_memory: 30,  // 30 days (configurable elsewhere)
  idempotency_keys: 1,        // 24h - handled by daily cleanup job
  postgres_sync_retry: 7,     // 7 days - DLQ separate
  postgres_sync_dlq: 90,      // 90 days in DLQ before manual review
  hipaa_access_log: 2555,     // 7 years - HIPAA requirement
  video_consult_sessions: 30, // 30 days - P2 data retention
  video_consult_ai_decisions: 30,
  video_consult_review_tasks: 90  // Keep HITL tasks longer for audit
};
