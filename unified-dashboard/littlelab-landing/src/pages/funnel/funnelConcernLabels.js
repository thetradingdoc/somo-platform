/** Consumer-facing chip labels (not internal concern ids). */
export const CONCERN_CHIP_LABELS = {
  acne: 'Breakouts',
  anti_aging: 'Lines & texture',
  hyperpigmentation: 'Dark spots',
  rosacea: 'Redness',
  barrier_repair: 'Barrier repair',
};

export const DEFAULT_CONCERN_ID = 'barrier_repair';

export function concernChipLabel(concernId) {
  return CONCERN_CHIP_LABELS[concernId] || concernId;
}
