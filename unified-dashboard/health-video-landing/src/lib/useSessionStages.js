import { useMemo } from 'react';

const STAGES = [
  { id: 'intake', label: 'Understanding your concern' },
  { id: 'clarification', label: 'Gathering more information' },
  { id: 'assessment', label: 'Reviewing your symptoms' },
  { id: 'summary', label: 'Preparing recommendations' }
];

export function useSessionStages({ patientMessageCount, toolEventCount, endSheetOpen }) {
  return useMemo(() => {
    let current = 'intake';
    if (endSheetOpen) current = 'summary';
    else if (toolEventCount > 0 || patientMessageCount >= 3) current = 'assessment';
    else if (patientMessageCount >= 1) current = 'clarification';

    const currentIdx = STAGES.findIndex((s) => s.id === current);
    return {
      stages: STAGES.map((s, i) => ({
        ...s,
        done: i < currentIdx,
        active: i === currentIdx
      })),
      current
    };
  }, [patientMessageCount, toolEventCount, endSheetOpen]);
}
