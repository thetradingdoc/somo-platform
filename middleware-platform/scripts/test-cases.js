/**
 * Step 1 pipeline scenarios for keyword/entity behavior.
 * Includes target behavior + known failures so regressions are visible.
 */
'use strict';

module.exports = [
  {
    id: 'clean-english-symptom',
    label: 'Clean English symptom intake',
    message: 'I have a red itchy rash on my arm for two days.',
    expected: {
      intent: 'symptom',
      phase: 'TRIAGE_DISCOVERY',
      confidenceBand: 'high'
    },
    entityInput: {
      onset: '2 days ago',
      quality: 'red itchy rash',
      severity: 6,
      timing: 'constant',
      associated_sx: 'itching',
      skin_type: 'combination',
      skin_concerns_json: ['rash', 'itching'],
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: false, note: '' },
      functional_impact: 3
    }
  },
  {
    id: 'mixed-intent-symptom-billing',
    label: 'Mixed intent: symptom plus billing question',
    message: 'I have chest pain and also want to know if insurance covers this.',
    expected: {
      intent: 'symptom'
    },
    entityInput: {
      onset: 'today',
      quality: 'chest pain',
      severity: 7,
      timing: 'comes and goes'
    }
  },
  {
    id: 'noisy-voice-transcript',
    label: 'Noisy voice transcript duplication',
    message: 'i i i have have have rash rash on on my arm arm and and it it burns',
    expected: {
      collapsed: true,
      confidenceBand: 'low'
    },
    entityInput: {
      quality: 'rash',
      associated_sx: 'burning'
    }
  },
  {
    id: 'spanish-symptom',
    label: 'Spanish symptom message',
    message: 'Tengo picazon y enrojecimiento en la piel desde ayer.',
    expected: {
      intent: 'symptom'
    },
    knownFailure: true,
    knownFailureReason: 'keyword list has no Spanish symptom terms',
    entityInput: {
      onset: 'ayer',
      quality: 'picazon y enrojecimiento',
      timing: 'constante'
    }
  },
  {
    id: 'french-symptom',
    label: 'French symptom message',
    message: "J'ai une eruption cutanee avec demangeaisons depuis ce matin.",
    expected: {
      intent: 'symptom'
    },
    knownFailure: true,
    knownFailureReason: 'keyword list has no French symptom terms',
    entityInput: {
      onset: 'ce matin',
      quality: 'eruption cutanee avec demangeaisons',
      timing: 'constant'
    }
  },
  {
    id: 'mixed-language-mid-sentence',
    label: 'Mixed language in one sentence',
    message: 'I have rash y tambien me duele el pecho a veces.',
    expected: {
      intent: 'symptom'
    },
    entityInput: {
      quality: 'rash and chest discomfort',
      severity: 6,
      timing: 'sometimes'
    }
  },
  {
    id: 'entity-merge-no-overwrite',
    label: 'Second turn should not overwrite existing onset with blank',
    message: 'Actually it also itches.',
    expected: {
      onsetPreserved: true
    },
    priorState: {
      onset: '2 days ago',
      quality: 'red rash',
      severity: 5,
      timing: 'constant'
    },
    entityTurns: [
      { associated_sx: 'itching' }
    ]
  },
  {
    id: 'very-short-low-confidence',
    label: 'Very short utterance confidence proxy should be low',
    message: 'hurts',
    expected: {
      intent: 'symptom',
      confidenceBand: 'low'
    },
    entityInput: {
      quality: 'hurts'
    }
  },
  {
    id: 'full-opqrst-high-confidence',
    label: 'Full OPQRST confidence proxy should be high',
    message: 'Sharp chest pain started yesterday, 8 out of 10, comes and goes.',
    expected: {
      intent: 'symptom',
      confidenceBand: 'high'
    },
    entityInput: {
      onset: 'yesterday',
      quality: 'sharp chest pain',
      severity: 8,
      timing: 'comes and goes',
      associated_sx: 'none'
    }
  }
];

