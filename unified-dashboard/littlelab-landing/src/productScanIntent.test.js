import { isProductTrackingIntent } from './productScanIntent';

test('does not treat generic ingredient questions as scan intent', () => {
  expect(isProductTrackingIntent('are these ingredients good for me')).toBe(false);
  expect(isProductTrackingIntent('What ingredients should I avoid?')).toBe(false);
});

test('detects explicit scan / barcode / list phrasing', () => {
  expect(isProductTrackingIntent('scan this barcode')).toBe(true);
  expect(isProductTrackingIntent('9780306401197')).toBe(false);
  expect(isProductTrackingIntent('UPC 1234567890123')).toBe(true);
  expect(isProductTrackingIntent('show me the ingredients list')).toBe(true);
  expect(isProductTrackingIntent('list of ingredients on the label')).toBe(true);
  expect(isProductTrackingIntent('review this product')).toBe(true);
});

test('face scan phrases do not enable product barcode tracking', () => {
  expect(isProductTrackingIntent('scan my face')).toBe(false);
  expect(isProductTrackingIntent('scan the skin on my cheek')).toBe(false);
});
