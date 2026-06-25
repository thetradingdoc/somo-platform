import { useMemo } from 'react';

const DURATION_RE = /(\d+)\s*(day|days|week|weeks|month|months|hour|hours)/i;
const SEVERITY_RE = /(\d+)\s*\/\s*10|mild|moderate|severe/i;
const LOCATION_RE = /(arm|leg|chest|head|back|skin|stomach|throat|groin|private)/i;

export function useSymptomNotes(messages, toolEvents) {
  return useMemo(() => {
    const notes = [];
    const patientLines = messages
      .filter((m) => m.speaker === 'patient')
      .map((m) => m.text);

    if (patientLines[0]) {
      notes.push({ label: 'Symptom', value: patientLines[0].slice(0, 80) });
    }

    const joined = patientLines.join(' ');
    const duration = joined.match(DURATION_RE);
    if (duration) notes.push({ label: 'Duration', value: duration[0] });

    const severity = joined.match(SEVERITY_RE);
    if (severity) notes.push({ label: 'Severity', value: severity[0] });

    const location = joined.match(LOCATION_RE);
    if (location) notes.push({ label: 'Location', value: location[0] });

    for (const ev of toolEvents || []) {
      if (ev?.name === 'vision_caption' && ev?.result?.caption) {
        notes.push({ label: 'Kelly noticed', value: ev.result.caption.slice(0, 100) });
      }
    }

    return notes.slice(0, 8);
  }, [messages, toolEvents]);
}
