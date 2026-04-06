/**
 * Split caption text into segments; matched skincare-related words are marked bold for display.
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'bold'; value: string }>}
 */
export function segmentCaptionWithKeywordEmphasis(text) {
  const s = String(text || '');
  if (!s) return [];
  const re =
    /\b(skin|rash|acne|moisturizer|moisturiser|spf|sunscreen|itch|itchy|dry|ointment|eczema|rosacea|hydrat\w*|cleanser|serum|retinoid|tretinoin|hydrocortisone|allergy|inflammation|blemish|pores|uv|burn)\b/gi;
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
    out.push({ type: 'bold', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
  return out.length ? out : [{ type: 'text', value: s }];
}
