'use strict';

async function withMockPost(KellyToolExecutor, mockFn, fn) {
  const origPost = KellyToolExecutor._post;
  KellyToolExecutor._post = mockFn;
  try {
    return await fn();
  } finally {
    KellyToolExecutor._post = origPost;
  }
}

module.exports = { withMockPost };
