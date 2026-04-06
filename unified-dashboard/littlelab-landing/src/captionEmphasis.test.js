import { segmentCaptionWithKeywordEmphasis } from './captionEmphasis';

describe('segmentCaptionWithKeywordEmphasis', () => {
  it('marks skincare-related words as bold segments', () => {
    const segs = segmentCaptionWithKeywordEmphasis('Try a gentle cleanser for dry skin');
    const bold = segs.filter((s) => s.type === 'bold').map((s) => s.value.toLowerCase());
    expect(bold).toContain('dry');
    expect(bold).toContain('skin');
    expect(bold).toContain('cleanser');
  });

  it('returns plain text when no keywords match', () => {
    const segs = segmentCaptionWithKeywordEmphasis('Hello there');
    expect(segs).toEqual([{ type: 'text', value: 'Hello there' }]);
  });
});
