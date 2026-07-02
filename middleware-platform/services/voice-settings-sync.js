'use strict';

const RetellService = require('./retell-service');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Persist settings to DB, sync to Retell with retries, update sync metadata.
 * @param {object} db
 * @param {object} params
 */
async function saveAndSyncVoiceSettings(db, params) {
  const {
    merchantId,
    customerId,
    clinicId = null,
    settingsPatch,
    retellService = new RetellService(),
    expectedVersion = null
  } = params;

  const existing = db.getVoiceAgentSettingsForProvider({ merchantId, customerId, clinicId });
  if (expectedVersion != null && existing?.settings_version != null) {
    if (Number(existing.settings_version) !== Number(expectedVersion)) {
      const err = new Error('Settings were updated elsewhere. Refresh and try again.');
      err.code = 'settings_conflict';
      err.current_version = existing.settings_version;
      throw err;
    }
  }

  const merged = {
    ...(existing || {}),
    ...settingsPatch
  };
  const nextVersion = (Number(existing?.settings_version) || 0) + 1;

  db.upsertVoiceAgentSettings(merchantId, {
    ...merged,
    settings_version: nextVersion,
    sync_status: 'pending',
    last_sync_error: null
  }, customerId, { clinicId });

  const agentId =
    merged.retell_agent_id ||
    (customerId && db.getCustomer(customerId)?.retell_agent_id) ||
    null;

  let syncError = null;
  if (agentId) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await retellService.applyAgentSettings({
          agentId,
          enabled: merged.enabled !== 0 && merged.enabled !== false,
          // Custom LLM websocket speaks openers; avoid syncing inbound greeting to Retell (outbound would inherit it)
          business_hours:
            typeof merged.business_hours === 'string'
              ? JSON.parse(merged.business_hours)
              : merged.business_hours,
          after_hours_message: merged.after_hours_message
        });
        if (result && result.success === false) {
          throw new Error(result.error || 'Retell sync failed');
        }
        syncError = null;
        break;
      } catch (e) {
        syncError = e.message || String(e);
        if (attempt < MAX_RETRIES - 1) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        }
      }
    }
  }

  const syncedAt = new Date().toISOString();
  const syncStatus = syncError ? 'failed' : agentId ? 'synced' : 'synced';
  db.upsertVoiceAgentSettings(merchantId, {
    sync_status: syncStatus,
    synced_at: syncedAt,
    last_sync_error: syncError,
    settings_version: nextVersion
  }, customerId, { clinicId });

  if (customerId) {
    db.updateCustomer(customerId, { prompt_synced_at: syncedAt });
  }

  if (syncError) {
    const err = new Error(syncError);
    err.code = 'retell_sync_failed';
    throw err;
  }

  return {
    settings_version: nextVersion,
    sync_status: syncStatus,
    synced_at: syncedAt,
    retell_agent_id: agentId
  };
}

function normalizeSettingsRow(row) {
  if (!row) return null;
  const out = { ...row };
  if (out.business_hours && typeof out.business_hours === 'string') {
    try {
      out.business_hours = JSON.parse(out.business_hours);
    } catch (_) {
      out.business_hours = null;
    }
  }
  if (out.outbound_quiet_hours && typeof out.outbound_quiet_hours === 'string') {
    try {
      out.outbound_quiet_hours = JSON.parse(out.outbound_quiet_hours);
    } catch (_) {
      out.outbound_quiet_hours = null;
    }
  }
  if (out.outbound_allowed_types && typeof out.outbound_allowed_types === 'string') {
    try {
      out.outbound_allowed_types = JSON.parse(out.outbound_allowed_types);
    } catch (_) {
      out.outbound_allowed_types = [];
    }
  }
  out.outbound_enabled = out.outbound_enabled === 1 || out.outbound_enabled === true;
  out.inbound_greeting = out.greeting;
  if (out.supported_languages && typeof out.supported_languages === 'string') {
    try {
      out.supported_languages = JSON.parse(out.supported_languages);
    } catch (_) {
      out.supported_languages = ['en'];
    }
  }
  return out;
}

module.exports = {
  saveAndSyncVoiceSettings,
  normalizeSettingsRow,
  MAX_RETRIES
};
