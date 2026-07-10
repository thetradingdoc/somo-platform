'use strict';

const { USE_CASE_PROFILES, resolveSpecialtyToUseCase } = require('../services/prompt-profile-templates');
const { USE_CASE_POLICIES, TriagePolicy } = require('../services/conversation-mode/tenant-policy');

describe('front-desk prompt profiles', () => {
  test('dental use_case exists with disabled triage', () => {
    expect(USE_CASE_PROFILES.dental).toBeDefined();
    expect(USE_CASE_PROFILES.dental.policy.triage_policy).toBe(TriagePolicy.DISABLED);
    expect(USE_CASE_PROFILES.dental.allowed_tools).not.toContain('run_triage_rag');
  });

  test('healthcare_clinic includes cancel/reschedule/search tools', () => {
    expect(USE_CASE_PROFILES.healthcare_clinic.allowed_tools).toContain('cancel_appointment');
    expect(USE_CASE_PROFILES.healthcare_clinic.allowed_tools).toContain('reschedule_appointment');
    expect(USE_CASE_PROFILES.healthcare_clinic.allowed_tools).toContain('search_appointments');
    expect(USE_CASE_PROFILES.healthcare_clinic.allowed_tools).not.toContain('run_triage_rag');
  });

  test('dermatology includes run_triage_rag for clinical lane', () => {
    expect(USE_CASE_PROFILES.dermatology.allowed_tools).toContain('run_triage_rag');
  });

  test('dental specialty maps to dental use_case', () => {
    expect(resolveSpecialtyToUseCase('General Dentistry')).toBe('dental');
  });
});
