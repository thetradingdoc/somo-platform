'use strict';

const { resolverMapToProviderCards } = require('../services/provider-card-normalizer');

describe('provider-card-normalizer', () => {
  test('maps resolver map to cards with phone_trust', () => {
    const m = new Map();
    m.set('p1', {
      display_name: 'Dr. A',
      specialty: ['Dermatology'],
      phone: '+15551234567',
      match_reason: 'Dermatology'
    });
    m.set('p2', {
      display_name: 'Dr. B',
      specialty: ['Cardiology'],
      phone: '',
      match_reason: 'Cardiology'
    });
    const cards = resolverMapToProviderCards(m, { limit: 2 });
    expect(cards).toHaveLength(2);
    expect(cards[0].phone_trust).toBe('verified_directory');
    expect(cards[0].phone).toBe('+15551234567');
    expect(cards[1].phone_trust).toBe('none');
    expect(cards[1].phone).toBeNull();
  });
});
