'use strict';

const HARNESS_COLLECT_ARGS = {
  payer_id: 'BCBS_PILOT',
  plan_id: 'plan_x',
  date_of_birth: '1990-01-15',
  member_id: 'MBR123'
};

async function withMockPost(KellyToolExecutor, mockFn, fn) {
  const origPost = KellyToolExecutor._post;
  KellyToolExecutor._post = mockFn;
  try {
    return await fn();
  } finally {
    KellyToolExecutor._post = origPost;
  }
}

module.exports = { withMockPost, HARNESS_COLLECT_ARGS };
