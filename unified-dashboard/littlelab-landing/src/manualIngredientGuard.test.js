import { prependManualIngredientGuard } from './manualIngredientGuard';

test('hallucination guard phrase is always prepended', () => {
  const out = prependManualIngredientGuard('This product may contain irritants.');
  expect(out.startsWith('Based on provided ingredients only:')).toBe(true);
  expect(out).not.toContain('identified product');
});

