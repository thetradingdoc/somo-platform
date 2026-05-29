import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssistantResultsPage from './AssistantResultsPage';

const noop = () => {};

function makeSnapshot(route) {
  const base = {
    schema_version: '1.0',
    confidence: { global: 0.62 },
    scanned_product: {
      product_name: `Route-${route}`,
      category_route: route,
      source: route === 'food' ? 'open_food_facts' : 'open_beauty_facts',
      ingredients_text:
        route === 'food'
          ? 'fruit puree, sugar, red 40, blue 1'
          : 'water, niacinamide, glycerin'
    },
    scan_summary: {
      tiles: {
        key_actives:
          route === 'cosmetic' || route === 'hygiene'
            ? { status: 'available', value: [{ display: 'Niacinamide' }] }
            : { status: 'unavailable', reason_unavailable: 'not_applicable_cosmetic_actives' },
        formulation: { status: 'available', value: route === 'food' ? 'Mixed food / beverage' : 'Water-Based' },
        function:
          route === 'cosmetic' || route === 'hygiene'
            ? { status: 'available', value: ['oil_balance'] }
            : { status: 'unavailable', reason_unavailable: 'not_applicable_cosmetic_function' },
        skin_type:
          route === 'cosmetic' || route === 'hygiene'
            ? { status: 'deferred', reason_unavailable: 'no_profile_context' }
            : { status: 'unavailable', reason_unavailable: 'not_applicable_skin_type_for_food' },
        safety_score: { status: 'deferred', reason_unavailable: 'no_scoring_pipeline' }
      }
    },
    result_summary: {
      verdict: {
        product_overview: { what_it_does: route === 'food' ? 'Food/beverage item, not a topical skincare treatment.' : 'Topical cosmetic care product.' },
        children_safe: { answer: route === 'food' ? 'caution' : 'insufficient_data', summary: 'Contract snapshot' },
        side_effects: { summary: route === 'food' ? 'Not assessed in this scan.' : 'Potential flushing.' },
        alternatives: { status: 'deferred', candidates: [] }
      }
    }
  };
  return base;
}

describe('AssistantResultsPage route snapshots', () => {
  test.each(['cosmetic', 'food', 'supplement', 'unknown'])('route snapshot %s', (route) => {
    const { container } = render(<AssistantResultsPage snapshot={makeSnapshot(route)} onClose={noop} onAskKelly={noop} />);
    const categoryChipNode = container.querySelector('.arp-category-pill');
    const summary = {
      route,
      categoryChip: categoryChipNode ? categoryChipNode.textContent : '',
      tileHeading: screen.getByRole('heading', {
        name: /Ingredients & Formulation|Ingredients|Product composition/i
      }).textContent,
      hasWorksForYou: !!screen.queryByRole('heading', { name: /Works for you/i }),
      hasHeadsUp: !!screen.queryByRole('heading', { name: /Heads up/i }),
      hasNycRegion: !!screen.queryByRole('region', { name: /NYC Health Department reference metal tests/i })
    };
    expect(summary).toMatchSnapshot();
  });
});

