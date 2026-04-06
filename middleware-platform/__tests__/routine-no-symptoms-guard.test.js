'use strict';

const db = require('../database');
const KellyToolExecutor = require('../services/kelly-tool-executor');

describe('routine_no_symptoms guard (E1 / E2)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('_triageRowHasConcernOrOnsetStored is true when quality is set', () => {
    jest.spyOn(db, 'getTriageSession').mockReturnValue({ quality: 'acne on cheeks', onset: null });
    expect(KellyToolExecutor._triageRowHasConcernOrOnsetStored('sess-a')).toBe(true);
  });

  test('_triageRowHasConcernOrOnsetStored is true when only onset is set', () => {
    jest.spyOn(db, 'getTriageSession').mockReturnValue({ quality: null, onset: '2 weeks' });
    expect(KellyToolExecutor._triageRowHasConcernOrOnsetStored('sess-b')).toBe(true);
  });

  test('_routineNoSymptomsEffective is false when meta is 1 but row has concern (acne + no symptoms scenario)', () => {
    jest.spyOn(db, 'getTriageSession').mockReturnValue({
      quality: 'acne',
      onset: 'one month'
    });
    jest.spyOn(KellyToolExecutor, '_getSessionMeta').mockImplementation((sid, key) => {
      if (key === 'routine_no_symptoms') return '1';
      return null;
    });
    expect(KellyToolExecutor._routineNoSymptomsEffective('sess-c')).toBe(false);
  });

  test('_routineNoSymptomsEffective is true when meta is 1 and row is empty', () => {
    jest.spyOn(db, 'getTriageSession').mockReturnValue(null);
    jest.spyOn(KellyToolExecutor, '_getSessionMeta').mockImplementation((sid, key) => {
      if (key === 'routine_no_symptoms') return '1';
      return null;
    });
    expect(KellyToolExecutor._routineNoSymptomsEffective('sess-d')).toBe(true);
  });
});
