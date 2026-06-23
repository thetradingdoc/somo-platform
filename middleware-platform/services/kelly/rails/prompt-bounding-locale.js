'use strict';

/**
 * CR-053 — Unified prompt bounding: subrail step objective + locale lock.
 */
const {
  getStepObjective,
  subrailPromptBlock,
  localePromptBlock,
  STEP_OBJECTIVES
} = require('./prompts/subrail-step-objectives');
const { resolveStickyLocale } = require('./resolve-locale');

function buildBoundedPromptContext(state = {}) {
  const locale = resolveStickyLocale(state);
  const boundedState = { ...state, locale };
  return {
    locale,
    stepObjective: getStepObjective(
      boundedState.active_subrail || boundedState.flags?.active_subrail,
      boundedState.active_subrail_step || boundedState.flags?.active_subrail_step
    ),
    subrailBlock: subrailPromptBlock(boundedState),
    localeBlock: localePromptBlock(locale, boundedState),
    promptSuffix: `${subrailPromptBlock(boundedState)}${localePromptBlock(locale, boundedState)}`
  };
}

module.exports = {
  buildBoundedPromptContext,
  getStepObjective,
  subrailPromptBlock,
  localePromptBlock,
  STEP_OBJECTIVES,
  resolveStickyLocale
};
