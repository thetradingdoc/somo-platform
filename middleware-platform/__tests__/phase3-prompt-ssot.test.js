'use strict';

const { saveAndSyncVoiceSettings } = require('../services/voice-settings-sync');
const { ensureCustomerRetellAgent } = require('../services/ensure-retell-agent');
const { getEffectiveTenantPolicy, USE_CASE_PROFILES } = require('../services/prompt-profile-templates');
const { PROFILE_ALLOWED_TOOLS } = require('../services/kelly-rails/tool-allowlists');
const { TEMPLATES } = require('../services/voice-prompt-templates');
const { USE_CASE_POLICIES, TriagePolicy } = require('../services/conversation-mode/tenant-policy');
const fs = require('fs');
const path = require('path');

describe('Phase 3 prompt SSOT', () => {
  test('3.2 saveAndSyncVoiceSettings does not touch prompt_synced_at without prompt sync', async () => {
    const updates = [];
    const db = {
      getVoiceAgentSettingsForProvider: () => ({ settings_version: 1, enabled: 1 }),
      upsertVoiceAgentSettings: () => {},
      getCustomer: () => ({ id: 'cust-1', prompt_synced_at: '2020-01-01T00:00:00.000Z' }),
      updateCustomer: (_id, patch) => updates.push(patch)
    };
    const retellService = {
      applyAgentSettings: async () => ({ success: true })
    };
    await saveAndSyncVoiceSettings(db, {
      merchantId: 'm1',
      customerId: 'cust-1',
      settingsPatch: { greeting: 'Hello' },
      retellService
    });
    expect(updates.some((p) => p.prompt_synced_at)).toBe(false);
  });

  test('3.2 saveAndSyncVoiceSettings updates prompt_synced_at when promptSyncedAt passed', async () => {
    const updates = [];
    const db = {
      getVoiceAgentSettingsForProvider: () => ({ settings_version: 1, enabled: 1, retell_agent_id: 'a1' }),
      upsertVoiceAgentSettings: () => {},
      getCustomer: () => ({ id: 'cust-1' }),
      updateCustomer: (_id, patch) => updates.push(patch)
    };
    await saveAndSyncVoiceSettings(db, {
      merchantId: 'm1',
      customerId: 'cust-1',
      settingsPatch: { greeting: 'Hello' },
      retellService: { applyAgentSettings: async () => ({ success: true }) },
      promptSyncedAt: '2026-07-05T12:00:00.000Z'
    });
    expect(updates.some((p) => p.prompt_synced_at === '2026-07-05T12:00:00.000Z')).toBe(true);
  });

  test('3.3 ensureCustomerRetellAgent fails without use_case', async () => {
    const db = {
      getCustomer: () => ({ id: 'c1', company_name: 'Test Clinic' })
    };
    const result = await ensureCustomerRetellAgent(db, 'c1', {
      retellService: { createAgent: jest.fn() }
    });
    expect(result.error).toMatch(/use_case/i);
    expect(result.agentId).toBeNull();
  });

  test('3.4 single canonical default prompt literals via TEMPLATES', () => {
    expect(USE_CASE_PROFILES.dental.system_prompt).toBe(TEMPLATES.dental);
    expect(USE_CASE_PROFILES.healthcare_clinic.system_prompt).toBe(TEMPLATES.healthcare_clinic);
    expect(USE_CASE_PROFILES.dermatology.system_prompt).toBe(TEMPLATES.dermatology);
  });

  test('3.5 PROFILE_ALLOWED_TOOLS matches USE_CASE_PROFILES', () => {
    for (const [useCase, tools] of Object.entries(PROFILE_ALLOWED_TOOLS)) {
      expect(USE_CASE_PROFILES[useCase].allowed_tools).toEqual(tools);
    }
  });

  test('3.14 partial dental profile does not inherit healthcare_clinic triage defaults', () => {
    const policy = getEffectiveTenantPolicy({
      use_case: 'dental',
      policy_json: JSON.stringify({ copay_quote_speak_enabled: true })
    });
    expect(policy.triage_policy).toBe(TriagePolicy.DISABLED);
    expect(policy.copay_quote_speak_enabled).toBe(true);
    expect(policy).not.toEqual(USE_CASE_POLICIES.healthcare_clinic);
  });

  test('3.13 retell-service uses update-agent endpoint pattern', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/retell-service.js'), 'utf8');
    expect(src).toMatch(/\/update-agent\//);
    expect(src).toMatch(/\/v2\/create-agent/);
    expect(src).not.toMatch(/\/v2\/agents\/\$\{agentId\}/);
  });
});
