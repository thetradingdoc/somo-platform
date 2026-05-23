/**
 * Client-side hints only — server POST /api/public/funnel/match is authoritative.
 */
export const CONCERN_HINTS = {
  acne: ['breakouts', 'cystic', 'pimples', 'oily'],
  hyperpigmentation: ['dark spots', 'melasma', 'uneven tone'],
  rosacea: ['redness', 'flushing'],
  anti_aging: ['fine lines', 'wrinkles', 'aging'],
  barrier_repair: ['dry', 'flaky', 'sensitive', 'barrier'],
};
