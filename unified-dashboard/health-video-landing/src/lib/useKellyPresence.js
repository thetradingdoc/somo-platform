import { useMemo, useState, useEffect } from 'react';
import { THINKING_LINES } from './sessionUtils.js';

export function useKellyPresence({
  thinking,
  listening,
  micOn,
  textOnly,
  riskVisible,
  urgencyLevel,
  patientMessageCount
}) {
  const [thinkingIndex, setThinkingIndex] = useState(0);

  useEffect(() => {
    if (!thinking) return undefined;
    const t = setInterval(() => {
      setThinkingIndex((i) => (i + 1) % THINKING_LINES.length);
    }, 2200);
    return () => clearInterval(t);
  }, [thinking]);

  return useMemo(() => {
    let avatarState = 'idle';
    let status = 'Here to help';

    if (riskVisible || urgencyLevel === 'emergency') {
      avatarState = 'urgent';
      status = 'Urgent concern flagged';
    } else if (urgencyLevel === 'urgent') {
      avatarState = 'concerned';
      status = 'Follow-up may be needed';
    } else if (thinking) {
      avatarState = 'thinking';
      status = THINKING_LINES[thinkingIndex];
    } else if (listening && micOn && !textOnly) {
      avatarState = 'listening';
      status = 'Somo is listening';
    } else if (patientMessageCount === 0) {
      status = 'Ready when you are';
    } else if (patientMessageCount >= 3) {
      status = 'Preparing recommendations';
    } else {
      status = 'Reviewing your symptoms';
    }

    return { avatarState, status, thinkingLine: THINKING_LINES[thinkingIndex] };
  }, [thinking, listening, micOn, textOnly, riskVisible, urgencyLevel, patientMessageCount, thinkingIndex]);
}
