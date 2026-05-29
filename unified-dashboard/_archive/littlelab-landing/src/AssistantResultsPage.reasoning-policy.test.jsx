/**
 * Reasoning render policy: model panel only when model + complete; pending/fallback banners.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssistantResultsPage from './AssistantResultsPage';

const noop = () => {};

function baseVerdict(overrides = {}) {
  return {
    product_overview: { what_it_does: 'Test product.', status: 'available', source: 'deterministic' },
    good_for_me: {
      answer: 'yes',
      summary: 'Looks fine for your profile.',
      source: 'reasoning',
      status: 'available',
      reasoning: {
        confidence: 0.9,
        reasoning_evidence_refs: ['model_reasoning:direct']
      },
      ...overrides.good_for_me
    },
    harmful: {
      severity: 'low',
      flags: [],
      top_evidence: '',
      summary: '',
      source: 'deterministic',
      status: 'available',
      ...overrides.harmful
    },
    children_safe: {
      answer: 'safe',
      summary: 'OK for children with context.',
      source: 'deterministic',
      status: 'available',
      ...overrides.children_safe
    },
    side_effects: {
      summary: 'Not assessed in this scan.',
      source: 'deterministic',
      status: 'available',
      ...overrides.side_effects
    },
    alternatives: {
      candidates: [],
      footer: '',
      source: 'deterministic',
      status: 'available',
      ...overrides.alternatives
    }
  };
}

function makeReasoningSnapshot(opts = {}) {
  const {
    reasoning_state = 'complete',
    reasoning_mode = 'model',
    reasoning_status = 'applied'
  } = opts;
  return {
    schema_version: '1.0',
    reasoning_state,
    scanned_product: {
      product_name: 'Test Cream',
      ingredients_text: 'water, glycerin',
      category_route: 'cosmetic',
      barcode: '1234567890123'
    },
    result_summary: {
      tiles: {
        skin_type: { status: 'deferred', source: 'none' },
        key_actives: { status: 'available', source: 'deterministic', value: [] },
        formulation: { status: 'available', source: 'deterministic', value: 'cream' },
        function: { status: 'unavailable', source: 'none' },
        safety_score: { status: 'unavailable', reason_unavailable: 'no_scoring_pipeline' }
      },
      reasoning: {
        reasoning_mode,
        status: reasoning_status,
        reasoning_evidence_refs: ['model_reasoning:direct']
      },
      verdict: baseVerdict(),
      missing_more: [],
      disclaimer: 'informational_only'
    }
  };
}

describe('AssistantResultsPage reasoning policy', () => {
  test('shows Why this answer panel only for model + complete', () => {
    render(<AssistantResultsPage snapshot={makeReasoningSnapshot()} onClose={noop} onAskKelly={noop} />);
    expect(screen.getByText('Why this answer')).toBeInTheDocument();
    expect(screen.queryByTestId('arp-reasoning-state-banner')).not.toBeInTheDocument();
  });

  test('hides model panel when reasoning_state is pending', () => {
    render(
      <AssistantResultsPage
        snapshot={makeReasoningSnapshot({ reasoning_state: 'pending', reasoning_mode: 'model' })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.queryByText('Why this answer')).not.toBeInTheDocument();
    const banner = screen.getByTestId('arp-reasoning-state-banner');
    expect(banner).toHaveAttribute('data-reasoning-state', 'pending');
  });

  test('hides model panel for fallback and shows fallback banner', () => {
    render(
      <AssistantResultsPage
        snapshot={makeReasoningSnapshot({ reasoning_state: 'fallback', reasoning_mode: 'model' })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.queryByText('Why this answer')).not.toBeInTheDocument();
    expect(screen.getByTestId('arp-reasoning-state-banner')).toHaveAttribute('data-reasoning-state', 'fallback');
  });

  test('hides model panel when mode is stub even if complete', () => {
    render(
      <AssistantResultsPage
        snapshot={makeReasoningSnapshot({ reasoning_state: 'complete', reasoning_mode: 'stub' })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.queryByText('Why this answer')).not.toBeInTheDocument();
  });

  test('pending to complete removes banner and shows model reasoning panel', () => {
    const { rerender } = render(
      <AssistantResultsPage
        snapshot={makeReasoningSnapshot({ reasoning_state: 'pending', reasoning_mode: 'model' })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByTestId('arp-reasoning-state-banner')).toHaveAttribute('data-reasoning-state', 'pending');
    expect(screen.queryByText('Why this answer')).not.toBeInTheDocument();
    rerender(
      <AssistantResultsPage
        snapshot={makeReasoningSnapshot({ reasoning_state: 'complete', reasoning_mode: 'model' })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.queryByTestId('arp-reasoning-state-banner')).not.toBeInTheDocument();
    expect(screen.getByText('Why this answer')).toBeInTheDocument();
  });
});
