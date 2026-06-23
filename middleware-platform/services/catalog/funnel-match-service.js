'use strict';

const { runMatch } = require('./funnel-sales-match-pipeline');

/**
 * Public funnel match — delegates to goal-aware sales pipeline.
 *
 * @param {object} input
 * @param {string} [input.inquiry]
 * @param {string} [input.concern_chip]
 * @param {string[]} [input.concern_chips]
 * @param {string} [input.user_goal] track_program | anti_aging | find_specialist | both
 * @param {object} [input.clarify_answers]
 * @param {object} [input.face_read]
 * @param {number} [input.confirmed_age]
 * @param {string} [input.zip]
 */
function match(input = {}) {
  return runMatch(input);
}

module.exports = { match };
