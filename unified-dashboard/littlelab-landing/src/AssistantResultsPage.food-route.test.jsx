import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssistantResultsPage from './AssistantResultsPage';

const noop = () => {};

function makeFoodSnapshot(overrides = {}) {
  return {
    schema_version: '1',
    confidence: { global: 0.74 },
    scanned_product: {
      product_name: 'Welch Family Farmed Fruit Snacks',
      category_route: 'food',
      source: 'open_food_facts',
      ingredients_text: 'Corn syrup, sugar, gelatin, citric acid, lactic acid, red 40, blue 1',
      ...overrides.scanned_product
    },
    result_summary: {
      disclaimer: 'informational_only',
      reasoning: {
        reasoning_mode: 'stub'
      },
      tiles: {
        key_actives: { status: 'unavailable', reason_unavailable: 'not_applicable_cosmetic_actives' },
        function: { status: 'unavailable', reason_unavailable: 'not_applicable_cosmetic_function' },
        skin_type: { status: 'deferred', reason_unavailable: 'not_applicable_skin_type_for_food' },
        formulation: { status: 'available', value: 'Mixed food / beverage' },
        safety_score: { status: 'deferred', reason_unavailable: 'no_scoring_pipeline' }
      },
      verdict: {
        product_overview: { what_it_does: 'Food/beverage item, not a topical skincare treatment.' },
        good_for_me: { answer: 'unknown', summary: 'Route-safe baseline only.', source: 'deterministic' },
        harmful: { severity: 'low', flags: [], top_evidence: '', summary: 'No immediate high-risk signals detected in the deterministic scan.' },
        children_safe: { answer: 'caution', summary: 'Contains artificial dyes (for example, Red 40 or Blue 1) that may concern some caregivers.' },
        side_effects: { summary: 'Not assessed in this scan.' },
        alternatives: { status: 'unavailable', candidates: [], footer: 'Ask Kelly for personalised food or supplement alternatives.' }
      },
      missing_more: ['Unlock route-aware guidance tailored to food and supplement products.']
    },
    ...overrides
  };
}

function makeCosmeticSnapshot() {
  return {
    schema_version: '1',
    confidence: { global: 0.8 },
    scanned_product: {
      product_name: 'Glow Serum',
      category_route: 'cosmetic',
      source: 'open_beauty_facts',
      ingredients_text: 'Water, Niacinamide, Glycerin'
    },
    result_summary: {
      tiles: {
        key_actives: { status: 'available', value: ['Niacinamide'] },
        function: { status: 'available', value: ['oil_balance'] },
        skin_type: { status: 'deferred', reason_unavailable: 'no_profile_context' },
        formulation: { status: 'available', value: 'Water-Based' },
        safety_score: { status: 'deferred', reason_unavailable: 'no_scoring_pipeline' }
      },
      verdict: {
        product_overview: { what_it_does: 'Topical cosmetic care product.' },
        good_for_me: { answer: 'yes', summary: 'Works with routine.' },
        harmful: { severity: 'low', flags: [], top_evidence: '', summary: '' },
        children_safe: { answer: 'insufficient_data', summary: 'No pediatric safety data available in the current deterministic catalog read.' },
        side_effects: { summary: 'Mild dryness may occur.' },
        alternatives: { candidates: [], footer: 'Ask Kelly for personalised food or supplement alternatives.' }
      }
    }
  };
}

describe('AssistantResultsPage.food-route', () => {
  describe('Section A - ingredient text integrity', () => {
    test('A1: renders full ingredient line block', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByRole('region', { name: /Catalog ingredient list/i })).toBeInTheDocument();
    });

    test('A2: uses food source label', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      const region = screen.getByRole('region', { name: /Catalog ingredient list/i });
      expect(within(region).getByText(/Open Food Facts/i)).toBeInTheDocument();
    });

    test('A3: no raw HTML leakage in rendered content', () => {
      const { container } = render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(container.textContent).not.toMatch(/<span class=|<\/span>|<div class=/i);
    });
  });

  describe('Section B - route gating (food should not look cosmetic)', () => {
    test('B1: food route shows food category pill', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/^Food & beverage$/)).toBeInTheDocument();
    });

    test('B2: cosmetic-only section "Works for you" is hidden', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.queryByText(/Works for you/i)).not.toBeInTheDocument();
    });

    test('B3: no niacinamide cosmetic chip appears for food route', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.queryByText(/^Niacinamide$/i)).not.toBeInTheDocument();
    });

    test('B4: no salicylic acid warning copy appears for food route acids', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.queryByText(/salicylic|retinoid|exfoliant/i)).not.toBeInTheDocument();
    });

    test('B5: side-effects row keeps route-safe not-assessed messaging', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/Side effect profile not yet assessed for this scan\./i)).toBeInTheDocument();
    });

    test('B6: NYC metals panel is hidden on food route', () => {
      render(
        <AssistantResultsPage
          snapshot={makeFoodSnapshot({
            scanned_product: {
              nyc_metal_context: {
                summary: 'Should be hidden',
                metals: [{ metal: 'Lead', max_ppm: 10 }]
              }
            }
          })}
          onClose={noop}
          onAskKelly={noop}
        />
      );
      expect(screen.queryByRole('region', { name: /NYC Health Department reference metal tests/i })).not.toBeInTheDocument();
    });
  });

  describe('Section C - reasoning fallback/string leakage guards', () => {
    test('C1: "Reasoning is disabled" string is not rendered', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.queryByText(/Reasoning is disabled/i)).not.toBeInTheDocument();
    });

    test('C2: model/version internals are not shown to users', () => {
      render(
        <AssistantResultsPage
          snapshot={makeFoodSnapshot({
            result_summary: {
              ...makeFoodSnapshot().result_summary,
              reasoning: { reasoning_mode: 'stub', reasoning_model: 'deterministic-stub' }
            }
          })}
          onClose={noop}
          onAskKelly={noop}
        />
      );
      expect(screen.queryByText(/deterministic-stub|reasoning_mode|model_reasoning/i)).not.toBeInTheDocument();
    });

    test('C3: internal reason_unavailable enum strings are not user-visible', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.queryByText(/reasoning_low_confidence|unsupported_for_route|reasoning_pending/i)).not.toBeInTheDocument();
    });

    test('C4: decision answers block still renders with deterministic fallback', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByRole('region', { name: /Decision answers/i })).toBeInTheDocument();
    });

    test('C5: verdict rows remain rendered (architecture guard)', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/Is this good for me\?/i)).toBeInTheDocument();
      expect(screen.getByText(/Harmful ingredients \/ risk/i)).toBeInTheDocument();
      expect(screen.getByText(/Good for children\?/i)).toBeInTheDocument();
    });
  });

  describe('Section D - duplicate alternatives CTA guard', () => {
    test('D1: alternatives row renders once', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getAllByText(/Alternatives I can use/i)).toHaveLength(1);
    });

    test('D2: single "Ask Kelly" alternatives CTA copy is shown', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getAllByText(/Ask Kelly for personalised food or supplement alternatives\./i)).toHaveLength(1);
    });
  });

  describe('Section E - reasoning panel gate', () => {
    test('E1: model reasoning row can show AI-assisted panel', () => {
      const snapshot = makeFoodSnapshot({
        result_summary: {
          ...makeFoodSnapshot().result_summary,
          reasoning: {
            reasoning_mode: 'model',
            reasoning_evidence_refs: ['route_context:food']
          },
          verdict: {
            ...makeFoodSnapshot().result_summary.verdict,
            good_for_me: {
              ...makeFoodSnapshot().result_summary.verdict.good_for_me,
              source: 'reasoning',
              reasoning: { confidence: 0.9, reasoning_evidence_refs: ['route_context:food'] }
            }
          }
        }
      });
      render(<AssistantResultsPage snapshot={snapshot} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/AI-assisted analysis/i)).toBeInTheDocument();
    });

    test('E2: stub mode never shows AI-assisted reasoning panel', () => {
      const snapshot = makeFoodSnapshot({
        result_summary: {
          ...makeFoodSnapshot().result_summary,
          reasoning: { reasoning_mode: 'stub' },
          verdict: {
            ...makeFoodSnapshot().result_summary.verdict,
            good_for_me: {
              ...makeFoodSnapshot().result_summary.verdict.good_for_me,
              source: 'reasoning',
              reasoning: { confidence: 0.9 }
            }
          }
        }
      });
      render(<AssistantResultsPage snapshot={snapshot} onClose={noop} onAskKelly={noop} />);
      expect(screen.queryByText(/AI-assisted analysis/i)).not.toBeInTheDocument();
    });

    test('E3: deterministic mode never shows reasoning refs panel', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.queryByText(/Reasoning refs:/i)).not.toBeInTheDocument();
    });

    test('E4: reasoning panel copy does not expose version details', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.queryByText(/claude|sonnet|v1/i)).not.toBeInTheDocument();
    });

    test('E5: verdict block remains visible when reasoning panel hidden', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/What does it do\?/i)).toBeInTheDocument();
    });
  });

  describe('Section H - route-aware heading and labeling', () => {
    test('H1: food route nav title uses "Food scan"', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/^Food scan$/i)).toBeInTheDocument();
    });

    test('H2: food route section heading is "Ingredients"', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/^Ingredients$/i)).toBeInTheDocument();
    });

    test('H3: food route category pill is "Food & beverage"', () => {
      render(<AssistantResultsPage snapshot={makeFoodSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/^Food & beverage$/)).toBeInTheDocument();
    });

    test('H4: cosmetic route nav title uses "Skincare analysis"', () => {
      render(<AssistantResultsPage snapshot={makeCosmeticSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/^Skincare analysis$/i)).toBeInTheDocument();
    });

    test('H5: cosmetic route heading is "Ingredients & Formulation"', () => {
      render(<AssistantResultsPage snapshot={makeCosmeticSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/^Ingredients & Formulation$/i)).toBeInTheDocument();
    });

    test('H6: cosmetic route category pill is "Cosmetic"', () => {
      render(<AssistantResultsPage snapshot={makeCosmeticSnapshot()} onClose={noop} onAskKelly={noop} />);
      expect(screen.getByText(/^Cosmetic$/i)).toBeInTheDocument();
    });
  });
});

