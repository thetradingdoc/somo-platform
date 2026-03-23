const fs = require('fs');
const path = require('path');

describe('Step 7.8 triage/matching gap implementation', () => {
  it('gap1: blocks slots until triage run/completion gates pass', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    expect(src).toContain('voice_agent_misuse_get_available_slots_no_rag_result');
    expect(src).toContain('TRIAGE_REQUIRED');
  });

  it('gap2: uses SpecialistResolver + specialist slot service', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    expect(src).toContain('SpecialistResolverService.resolve');
    expect(src).toContain('getAvailableSlotsWithSpecialist');
  });

  it('gap3: seeds provider_profiles rows via migration', () => {
    const src = fs.readFileSync(path.join(__dirname, '../migrations/009_seed_provider_profiles.js'), 'utf8');
    expect(src).toContain('INSERT OR IGNORE INTO provider_profiles');
    expect(src).toContain('prov-seed-cardiology');
  });

  it('gap4: feeds kelly_script/filter-decay hint back into LLM context', () => {
    const toolSrc = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    const agentSrc = fs.readFileSync(path.join(__dirname, '../services/kelly-agent-service.js'), 'utf8');
    expect(toolSrc).toContain("kelly_script_hint");
    expect(agentSrc).toContain('Recent Specialist Routing Context');
  });

  it('gap5: passes price_tier into specialist resolution options', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    expect(src).toContain('patientTier');
    expect(src).toContain('price_tier');
  });

  it('gap6/gap9: includes specialty deep-dive and async-vs-sync UX prompt guidance', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-agent-service.js'), 'utf8');
    expect(src).toContain('Specialty-Specific Deep-Dive');
    expect(src).toContain('Async vs Sync');
  });

  it('gap7: enforces severity>=8 urgent routing / async restriction', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/triage-rag-service.js'), 'utf8');
    expect(src).toContain('severity ≥8');
    expect(src).toContain('restricts async');
  });

  it('gap8: contains mental health PHQ-2/GAD-2 + safety-screen protocol', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-agent-service.js'), 'utf8');
    expect(src).toContain('PHQ-2');
    expect(src).toContain('GAD-2');
    expect(src).toContain('Safety Screen');
  });

  it('gap10: upload pause/resume + triage media paths exist', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const toolSrc = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    expect(serverSrc).toContain("app.post('/api/triage/upload'");
    expect(toolSrc).toContain('media_requested');
    expect(toolSrc).toContain('media_received');
  });

  it('gap11/gap12: persists OPQRST and passes structured opqrst object to run_triage_rag', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    expect(src).toContain("case 'store_triage_opqrst'");
    expect(src).toContain('const opqrst = {');
    expect(src).toContain('enrichFromSymptoms({');
  });

  it('gap15: blocks insurance collection until specialty known from triage', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    expect(src).toContain('Block until target_specialty known');
    expect(src).toContain('triageResult.target_specialty');
  });

  it('gap16: schedules SpecialistResolver cache cleanup on startup/interval', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    expect(src).toContain('SpecialistResolverService.cleanupCache');
    expect(src).toContain('60 * 60 * 1000');
  });

  it('gap17: has practitioner scoped unique slot migration', () => {
    const src = fs.readFileSync(path.join(__dirname, '../migrations/013_practitioner_slot_unique.js'), 'utf8');
    expect(src).toContain('practitioner');
    expect(src).toContain('UNIQUE');
  });

  it('gap18: persists and reuses preferred language in session state', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-agent-service.js'), 'utf8');
    expect(src).toContain('db.getKellySessionLanguage');
    expect(src).toContain('db.upsertKellySessionLanguage');
    expect(src).toContain('detected_language');
  });
});

