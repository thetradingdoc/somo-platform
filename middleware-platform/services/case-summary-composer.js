function composeCaseSummary({ fused = {}, audience = 'patient' } = {}) {
  const m = fused?.merged || {};
  const lines = [];
  lines.push(audience === 'provider' ? 'Clinical case summary:' : 'Here is a summary of your case so far:');
  if (m.specialty) lines.push(`- Likely specialty: ${m.specialty}`);
  if (m.urgency) lines.push(`- Urgency: ${m.urgency}`);
  if (Array.isArray(m.risk_flags) && m.risk_flags.length) {
    lines.push(`- Risk flags: ${m.risk_flags.slice(0, 5).join(', ')}`);
  }
  if (Array.isArray(m.vision_tags) && m.vision_tags.length) {
    const tags = m.vision_tags.slice(0, 5).map((v) => v.finding || v.label || v.class || 'visual finding');
    lines.push(`- Visual findings: ${tags.join(', ')}`);
  }
  if (m.records_summary && audience === 'provider') {
    lines.push(`- Records context: ${String(m.records_summary).slice(0, 220)}`);
  }
  return {
    summary_text: lines.join('\n'),
    structured: {
      specialty: m.specialty || null,
      urgency: m.urgency || null,
      risk_flags: Array.isArray(m.risk_flags) ? m.risk_flags : [],
      confidence: fused?.confidence ?? null
    }
  };
}

module.exports = {
  composeCaseSummary
};
