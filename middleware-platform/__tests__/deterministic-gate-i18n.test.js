'use strict';

const { getDeterministicReply } = require('../services/kelly-rails/prompts/deterministic');

describe('deterministic gate i18n copy', () => {
  test('ES cancel/reschedule/records failure keys resolve', () => {
    expect(getDeterministicReply('cancel_failed', 'es')).toMatch(/cancelar|recepción/i);
    expect(getDeterministicReply('reschedule_failed', 'es')).toMatch(/reprogramar/i);
    expect(getDeterministicReply('records_failed', 'es')).toMatch(/registros/i);
  });

  test('ZH slots_empty and gate_processing keys resolve', () => {
    expect(getDeterministicReply('slots_empty', 'zh')).toMatch(/预约|前台/);
    expect(getDeterministicReply('gate_processing', 'zh')).toMatch(/系统|电话|邮箱/);
  });
});
