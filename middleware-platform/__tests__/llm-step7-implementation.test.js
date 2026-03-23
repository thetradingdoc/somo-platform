const fs = require('fs');
const path = require('path');

describe('Step 7.0 LLM implementation', () => {
  it('keeps explicit tool-sequence + low-confidence clarifier in Kelly prompt (LLM-1/LLM-3)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-agent-service.js'), 'utf8');
    expect(src).toContain('TOOL ORDER (hard rule)');
    expect(src).toContain('rag_confidence < rag_confidence_threshold');
    expect(src).toContain('ask ONE more clarifying question');
  });

  it('persists preferred language across turns (LLM-4/gap18)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-agent-service.js'), 'utf8');
    expect(src).toContain('db.getKellySessionLanguage');
    expect(src).toContain('db.upsertKellySessionLanguage');
    expect(src).toContain('UPDATE triage_sessions SET detected_language');
  });

  it('maps option/ordinal slot choices deterministically (LLM-2)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-agent-service.js'), 'utf8');
    expect(src).toContain('_resolveSlotBundleFromUserMessage');
    expect(src).toContain('Option ${idx + 1}:');
    expect(src).toContain('_parseSlotOrdinal');
  });

  it('stores and recovers payment token for verify path (LLM-5/A7)', () => {
    const toolSrc = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    expect(toolSrc).toContain("_setSessionMeta(sessionId, 'payment_token'");
    expect(toolSrc).toContain("_getSessionMeta(sessionId, 'payment_token')");

    const retellSrc = fs.readFileSync(path.join(__dirname, '../webhooks/retell-websocket.js'), 'utf8');
    expect(retellSrc).toContain('connection.lastPaymentToken');
    expect(retellSrc).toContain('MISSING_TOKEN');
  });
});
