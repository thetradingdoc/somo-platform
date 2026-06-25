import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { getStoredSession, saveSession, clearSession, getReport, saveReport } from './healthStorage.js';

const HealthSessionContext = createContext(null);

export function HealthSessionProvider({ children }) {
  const [session, setSessionState] = useState(() => getStoredSession());
  const [report, setReportState] = useState(() => getReport());

  const setSession = useCallback((data) => {
    saveSession(data);
    setSessionState(data);
  }, []);

  const setReport = useCallback((data) => {
    saveReport(data);
    setReportState(data);
  }, []);

  const reset = useCallback(() => {
    clearSession();
    setSessionState(null);
    setReportState(null);
  }, []);

  const value = useMemo(() => ({
    session,
    report,
    setSession,
    setReport,
    reset,
    hasSession: !!session?.sessionId
  }), [session, report, setSession, setReport, reset]);

  return (
    <HealthSessionContext.Provider value={value}>
      {children}
    </HealthSessionContext.Provider>
  );
}

export function useHealthSession() {
  const ctx = useContext(HealthSessionContext);
  if (!ctx) throw new Error('useHealthSession must be used within HealthSessionProvider');
  return ctx;
}
