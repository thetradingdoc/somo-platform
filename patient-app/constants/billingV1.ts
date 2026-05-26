export type BillingLifecycleStatus = 'due' | 'paid' | 'pending' | 'disputed' | 'needs_review';

export const BillingV1 = {
  lifecycleStatuses: ['due', 'paid', 'pending', 'disputed', 'needs_review'] as BillingLifecycleStatus[],
  successMetric: 'Track bills and receipts in one place.',
  copy: {
    offline: 'You appear offline.',
    genericRetry: 'Retry',
    emptyHomeTitle: 'No bills yet',
    emptyHomeBody: 'Capture a receipt to start tracking.',
  },
};
