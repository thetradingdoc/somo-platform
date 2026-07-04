'use strict';

const { getTenantVoiceLanguageConfig, isLanguageSupported } = require('../services/tenant-language-config');

describe('tenant-language-config clinic resolution', () => {
  test('getTenantVoiceLanguageConfig reads clinic-scoped voice_agent_settings', () => {
    const db = {
      db: {
        prepare: () => ({
          get: () => ({
            language_mode: 'en_es',
            supported_languages: '["en","es"]'
          })
        })
      },
      getClinic: () => null,
      getVoiceAgentSettingsForProvider: () => null
    };
    const cfg = getTenantVoiceLanguageConfig(db, { clinicId: 'clinic-1' });
    expect(cfg.language_mode).toBe('en_es');
    expect(isLanguageSupported('es', cfg.supported_languages)).toBe(true);
  });
});
