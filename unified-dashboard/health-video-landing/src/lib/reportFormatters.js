export const OPQRST_LABELS = {
  onset: 'When it started',
  provocation: 'What makes it better or worse',
  quality: 'How it feels',
  region: 'Where on your body',
  severity: 'How severe',
  timing: 'How often / pattern'
};

export function formatOpqrstSection(opqrst = {}) {
  if (!opqrst || typeof opqrst !== 'object') return [];
  return Object.entries(OPQRST_LABELS)
    .map(([key, label]) => {
      const val = opqrst[key];
      if (!val) return null;
      return { key, label, value: String(val) };
    })
    .filter(Boolean);
}

export function hasThinReport(report) {
  if (!report) return true;
  const hasSummary = !!(report.summary && report.summary.trim());
  const hasOpqrst = formatOpqrstSection(report.opqrst).length > 0;
  const hasChief = !!(report.chief_complaint && report.chief_complaint.trim());
  return !hasSummary && !hasOpqrst && !hasChief;
}

export function formatPlainReport(report) {
  if (!report) {
    return {
      toldKelly: '',
      kellyNoticed: '',
      nextSteps: ''
    };
  }

  const opqrstParts = formatOpqrstSection(report.opqrst).map((r) => r.value);
  const toldParts = [report.chief_complaint, ...opqrstParts].filter(Boolean);
  const toldKelly = toldParts.length
    ? toldParts.join('. ')
    : (report.transcript_excerpt || 'What you shared during your chat with Somo.');

  const kellyNoticed = report.summary
    || (report.vision_artifacts?.length
      ? report.vision_artifacts.map((v) => (typeof v === 'string' ? v : v.caption)).filter(Boolean).join(' ')
      : '')
    || 'Somo reviewed what you described during the session.';

  let nextSteps = 'If symptoms worsen or you feel unsafe, contact a clinician or emergency services.';
  if (report.safety_flags?.length) {
    nextSteps = 'Urgent-care guidance was discussed. When in doubt, seek in-person care or call emergency services.';
  } else if (report.summary) {
    nextSteps = 'Share this summary with a doctor or nurse if you want a professional opinion. This is educational guidance only.';
  }

  return { toldKelly, kellyNoticed, nextSteps };
}

export function buildShareText(report) {
  const { toldKelly, kellyNoticed, nextSteps } = formatPlainReport(report);
  return [
    'Somo health chat summary',
    '',
    'What I told Somo:',
    toldKelly,
    '',
    'What Somo noticed:',
    kellyNoticed,
    '',
    'What to do next:',
    nextSteps
  ].join('\n');
}

export function urgencyClass(urgency) {
  const u = String(urgency || 'routine').toLowerCase();
  if (u.includes('emerg')) return 'hv-urgency-emergency';
  if (u.includes('urgent')) return 'hv-urgency-urgent';
  return 'hv-urgency-routine';
}

export function formatRichReport(report) {
  const plain = formatPlainReport(report);
  const opqrstRows = formatOpqrstSection(report?.opqrst);
  const symptomTags = [];

  if (report?.chief_complaint) symptomTags.push(report.chief_complaint);
  opqrstRows.forEach((r) => symptomTags.push(r.value));

  const timeline = opqrstRows.map((r) => ({ label: r.label, value: r.value }));

  const escalation = report?.safety_flags?.length
    ? {
        title: 'Safety guidance',
        body: report.safety_flags.join('. '),
        urgent: true
      }
    : null;

  const citations = (report?.citations || [])
    .map((c) => (typeof c === 'string' ? c : c.label || c.title || c.source))
    .filter(Boolean);

  return {
    ...plain,
    symptomTags: [...new Set(symptomTags)].slice(0, 8),
    timeline,
    escalation,
    opqrstRows,
    citations
  };
}
