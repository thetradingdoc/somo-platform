import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasJourneyStarted, getStoredSession } from './healthStorage.js';

export function useJourneyGuard(requireSession = false) {
  const navigate = useNavigate();

  useEffect(() => {
    if (requireSession) {
      if (!getStoredSession()?.sessionId) {
        navigate('/start', { replace: true });
      }
      return;
    }
    if (!hasJourneyStarted()) {
      navigate('/start', { replace: true });
    }
  }, [navigate, requireSession]);
}
