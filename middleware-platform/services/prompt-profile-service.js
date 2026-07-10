'use strict';

const { v4: uuidv4 } = require('uuid');
const RetellService = require('./retell-service');
const { resolveUseCaseTemplate } = require('./prompt-profile-templates');
const { normalizeUseCase } = require('./voice-prompt-templates');
const { resolveClinicForCustomer } = require('./tenant-voice-config');

/**
 * Resolve tenant scope for prompt_profiles reads/writes.
 */
function resolvePromptProfileScope(db, { customerId, clinicId, merchantId } = {}) {
  const customer = customerId ? db.getCustomer?.(customerId) : null;
  const clinic = resolveClinicForCustomer(db, customerId, clinicId);
  const resolvedClinicId = clinic?.clinic_id || clinicId || null;
  const effectiveCustomerId = customerId || customer?.id || null;
  const useCase = normalizeUseCase(
    customer?.use_case || customer?.signup_persona || customer?.persona || 'healthcare_clinic'
  );
  let profile = null;
  if (typeof db.getClinicPromptProfile === 'function') {
    profile = db.getClinicPromptProfile(resolvedClinicId, effectiveCustomerId);
  }
  return {
    customer,
    clinic,
    clinicId: resolvedClinicId,
    customerId: effectiveCustomerId,
    merchantId: merchantId || customer?.merchant_id || null,
    useCase,
    profile
  };
}

/**
 * Create an active prompt_profile from the use_case template when missing.
 */
function ensurePromptProfile(db, scope) {
  if (scope.profile?.id) return scope.profile.id;
  if (!db?.db) throw new Error('Database unavailable');

  const template = resolveUseCaseTemplate(scope.useCase);
  const profileId = uuidv4();
  const clinicName = scope.clinic?.name || scope.customer?.company_name || 'Practice';
  const policyPayload = template.policy || {};
  const metadata = JSON.stringify({
    use_case: scope.useCase,
    tenant_policy: policyPayload
  });
  const policyJson = JSON.stringify(policyPayload);

  db.db.prepare(`
    INSERT INTO prompt_profiles (
      id, clinic_id, customer_id, name, specialty, use_case,
      system_prompt, allowed_tools, version, status, metadata, policy_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'v1', 'active', ?, ?, datetime('now'), datetime('now'))
  `).run(
    profileId,
    scope.clinicId,
    scope.customerId,
    `${clinicName} — ${template.specialty}`,
    template.specialty,
    scope.useCase,
    template.system_prompt,
    JSON.stringify(template.allowed_tools),
    metadata,
    policyJson
  );

  return profileId;
}

/**
 * Persist system_prompt to prompt_profiles (SSOT) and optionally sync Retell.
 */
async function savePromptProfileAndSyncRetell(db, params = {}) {
  const {
    customerId,
    clinicId,
    merchantId,
    systemPrompt,
    userId = null,
    retellService = new RetellService(),
    syncRetell = true
  } = params;

  const trimmed = String(systemPrompt || '').trim();
  if (!trimmed) {
    const err = new Error('system_prompt is required');
    err.code = 'prompt_required';
    throw err;
  }

  const scope = resolvePromptProfileScope(db, { customerId, clinicId, merchantId });
  let profileId = scope.profile?.id || ensurePromptProfile(db, scope);

  db.db.prepare(`
    UPDATE prompt_profiles
    SET system_prompt = ?, updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(trimmed, userId, profileId);

  if (typeof db.insertPromptAuditLog === 'function') {
    db.insertPromptAuditLog({
      prompt_id: profileId,
      user_id: userId,
      change_diff: { system_prompt: 'updated' }
    });
  }

  const customer = scope.customerId ? db.getCustomer(scope.customerId) : scope.customer;
  const agentId =
    customer?.retell_agent_id ||
    db.getVoiceAgentSettingsForProvider?.({
      merchantId: scope.merchantId,
      customerId: scope.customerId,
      clinicId: scope.clinicId
    })?.retell_agent_id ||
    null;

  let retellSynced = false;
  let syncError = null;
  if (syncRetell && agentId) {
    const updateResult = await retellService.updateAgent(agentId, { general_prompt: trimmed });
    if (!updateResult.success) {
      syncError = updateResult.error || 'Retell sync failed';
    } else {
      retellSynced = true;
    }
  }

  const syncedAt = retellSynced ? new Date().toISOString() : null;
  if (scope.customerId && retellSynced) {
    db.updateCustomer(scope.customerId, { prompt_synced_at: syncedAt });
  }

  if (syncError) {
    const err = new Error(syncError);
    err.code = 'retell_sync_failed';
    err.profile_id = profileId;
    throw err;
  }

  return {
    profile_id: profileId,
    prompt_synced_at: syncedAt,
    retell_synced: retellSynced,
    retell_agent_id: agentId || null
  };
}

/**
 * Read authoritative prompt text for a tenant (prompt_profiles SSOT).
 */
function getTenantSystemPrompt(db, { customerId, clinicId } = {}) {
  const scope = resolvePromptProfileScope(db, { customerId, clinicId });
  return scope.profile?.system_prompt?.trim() || null;
}

module.exports = {
  resolvePromptProfileScope,
  ensurePromptProfile,
  savePromptProfileAndSyncRetell,
  getTenantSystemPrompt
};
