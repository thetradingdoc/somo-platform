export const TRUST_BADGES = [
  { id: 'hipaa', title: 'HIPAA-aligned', sub: 'Workflows + security for PHI' },
  { id: 'encrypted', title: 'Encrypted calls', sub: 'TLS + encrypted storage' },
  { id: 'coverage', title: '24/7 coverage', sub: 'Never miss after-hours calls' },
  { id: 'billing', title: 'Automated Billing', sub: 'Patient balances & co-pay on every call' }
];

export const CAPABILITIES_SECTION = {
  titleAccent: '24/7',
  titleSuffix: ' calls, scheduling, & billing assistant',
  lead:
    'From specialty clinics to revenue cycle calls — Somo handles appointments, patient balances, co-pay questions, and multilingual intake on every line, 24/7.'
};

/** Image 1 — shared capability explorer theme */
export const CAPABILITY_THEME = {
  cardSurface: '#f4fbe8',
  cardBorder: '#d0ddd6',
  accentRail: 'linear-gradient(180deg, #b5e930 0%, #238108 55%, #164437 100%)',
  accentColor: '#164437',
  panelTitleColor: '#238108'
};

export const CAPABILITIES = [
  {
    id: 'specialties',
    icon: 'specialties',
    cardSurface: CAPABILITY_THEME.cardSurface,
    cardBorder: CAPABILITY_THEME.cardBorder,
    accentRail: CAPABILITY_THEME.accentRail,
    label: 'Specialties',
    seoTitle: 'AI front desk for medical and dental specialties',
    body:
      'Somo adapts to how your specialty answers the phone — routing referrals, capturing chief complaints, and matching your practice workflows without a one-size-fits-all script.',
    bullets: [
      'Dental, medical, and specialty practice workflows',
      'Referrals and prior-auth handoff to staff',
      'New-patient intake and insurance FAQs',
      'Multilingual support on every line'
    ],
    accentColor: CAPABILITY_THEME.accentColor,
    demoUseCase: 'medical_clinic'
  },
  {
    id: 'appointments',
    icon: 'appointments',
    cardSurface: CAPABILITY_THEME.cardSurface,
    cardBorder: CAPABILITY_THEME.cardBorder,
    accentRail: CAPABILITY_THEME.accentRail,
    label: 'Appointments',
    seoTitle: '24/7 AI appointment scheduling',
    body:
      'Patients call anytime. Somo books, reschedules, and confirms appointments — reducing no-shows and freeing your front desk from hold queues and phone tag.',
    bullets: [
      'Real-time scheduling conversations',
      'Waitlist and callback capture',
      'Calendar sync on Clinic Pro plans'
    ],
    accentColor: CAPABILITY_THEME.accentColor,
    demoUseCase: 'medical_clinic'
  },
  {
    id: 'rcm',
    icon: 'rcm',
    cardSurface: CAPABILITY_THEME.cardSurface,
    cardBorder: CAPABILITY_THEME.cardBorder,
    accentRail: CAPABILITY_THEME.accentRail,
    label: 'Revenue cycle',
    seoTitle: 'Healthcare revenue cycle call handling',
    body:
      'Route billing questions intelligently. Somo answers common RCM caller intents, captures account details, and escalates complex claims or denial follow-ups to your team with full context.',
    bullets: [
      'Claim status and denial inquiry routing',
      'Eligibility and benefits FAQ handling',
      'Structured handoff notes for billers'
    ],
    accentColor: CAPABILITY_THEME.accentColor,
    demoUseCase: 'patient_billing'
  },
  {
    id: 'copay',
    icon: 'copay',
    cardSurface: CAPABILITY_THEME.cardSurface,
    cardBorder: CAPABILITY_THEME.cardBorder,
    accentRail: CAPABILITY_THEME.accentRail,
    label: 'Co-pay & balances',
    seoTitle: 'Patient co-pay and balance collection calls',
    body:
      'Help patients understand what they owe and how to pay — without tying up staff. Somo explains balances, payment plan options, and can guide callers to secure payment flows.',
    bullets: [
      'Co-pay and outstanding balance questions',
      'Payment plan and statement requests',
      'Polite, compliant collections-style calls'
    ],
    accentColor: CAPABILITY_THEME.accentColor,
    demoUseCase: 'patient_billing'
  },
  {
    id: 'multilingual',
    icon: 'multilingual',
    cardSurface: CAPABILITY_THEME.cardSurface,
    cardBorder: CAPABILITY_THEME.cardBorder,
    accentRail: CAPABILITY_THEME.accentRail,
    label: 'Multilingual',
    seoTitle: 'Bilingual medical receptionist',
    body:
      'No press-1-for-Spanish menus. Somo detects the caller\'s language and responds naturally — critical for diverse patient populations and after-hours coverage.',
    bullets: [
      'Auto-detect English, Spanish, and more',
      'Same intake quality in every language',
      'No IVR language tree required'
    ],
    accentColor: CAPABILITY_THEME.accentColor,
    demoUseCase: 'bilingual_front_desk'
  },
  {
    id: 'after_hours',
    icon: 'after_hours',
    cardSurface: CAPABILITY_THEME.cardSurface,
    cardBorder: CAPABILITY_THEME.cardBorder,
    accentRail: CAPABILITY_THEME.accentRail,
    label: '24/7 coverage',
    tabLabel: '24/7',
    seoTitle: 'After-hours medical answering service',
    body:
      'Replace voicemail with a live AI front desk after hours. Somo triages urgent vs routine calls, books the next available slot, and leaves your team a clear morning summary.',
    bullets: [
      '24/7 coverage without extra headcount',
      'Urgent vs routine call routing',
      'Full transcripts by morning'
    ],
    accentColor: CAPABILITY_THEME.accentColor,
    demoUseCase: 'after_hours'
  }
];

export const ROI_OLD_WAY = {
  badge: 'The old way',
  title: 'Expensive, fragmented, slow',
  items: [
    {
      icon: 'cost',
      title: '$3,500+/mo fully loaded',
      sub: 'Salary, benefits, PTO, and sick days'
    },
    {
      icon: 'turnover',
      title: 'Hiring & training drag',
      sub: 'Turnover and rehiring costs add up fast'
    },
    {
      icon: 'calls',
      title: 'Missed calls & no-shows',
      sub: 'After-hours and hold queues go unanswered'
    },
    {
      icon: 'billing',
      title: 'Manual billing follow-up',
      sub: 'Delayed collections, frustrated staff'
    }
  ]
};

export const ROI_NEW_WAY = {
  badge: 'The new way',
  title: 'AI front desk =',
  titleAccent: 'Lower cost, always on',
  items: [
    {
      icon: 'agent',
      title: 'Somo AI front desk',
      sub: 'Answers calls, books, verifies, handles billing'
    },
    {
      icon: 'cost',
      title: '$199/mo',
      sub: 'No turnover. No benefits. Always on.'
    },
    {
      icon: 'calls',
      title: 'Never miss a call',
      sub: '24/7 multilingual coverage'
    },
    {
      icon: 'payments',
      title: 'Faster patient payments',
      sub: 'Copay, balances, and self-pay on every call'
    }
  ]
};

export const ROI_SAVINGS = {
  label: 'Save',
  amount: '$50K+',
  unit: 'per year',
  sub: 'per location'
};

export function capabilitiesJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${CAPABILITIES_SECTION.titleAccent}${CAPABILITIES_SECTION.titleSuffix}`,
    description: CAPABILITIES_SECTION.lead,
    itemListElement: CAPABILITIES.map((cap, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Service',
        name: cap.seoTitle,
        description: cap.body,
        provider: {
          '@type': 'Organization',
          name: 'Somo'
        }
      }
    }))
  };
}

export const HOW_IT_WORKS_SECTION = {
  title: 'How it works',
  lead: 'Get your unique number once. Somo answers 24/7 calls. You get updated on your portal.'
};

export const HOW_IT_WORKS = [
  {
    step: 1,
    panelTheme: 'setup',
    tabLabel: 'Get your number',
    title: 'Patients call your Somo number',
    body: 'Sign up and get a dedicated Somo line for your practice. Share it on your website, Google listing, and patient materials — Somo picks up every call, 24/7.'
  },
  {
    step: 2,
    panelTheme: 'assist',
    tabLabel: 'Somo helps them',
    title: 'Appointments, questions, and routing — handled',
    body: 'Somo books and reschedules visits, answers common billing and insurance questions, captures new-patient intake, and sends urgent calls to your team with context.'
  },
  {
    step: 3,
    panelTheme: 'control',
    tabLabel: 'You stay in control',
    title: 'Transcripts and summaries in your dashboard',
    body: 'Review every call log, transcript, and action Somo took. Your team stays in the loop without answering every ring. Clinic Pro syncs with your calendar.'
  }
];

export function howItWorksJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: HOW_IT_WORKS_SECTION.title,
    description: HOW_IT_WORKS_SECTION.lead,
    step: HOW_IT_WORKS.map((step, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: step.title,
      text: step.body
    }))
  };
}

export const PRICING_SECTION = {
  title: 'Simple, transparent pricing',
  lead: "Start free — upgrade when you're ready. No long-term contracts. Cancel anytime."
};

export const PRICING_TIERS = [
  {
    id: 'free',
    name: 'Free trial',
    healthcareLabel: 'Try Somo',
    price: 0,
    features: [
      '60 included minutes',
      '7-day trial period',
      'Dedicated Somo number',
      'No credit card to start'
    ],
    hipaa: false,
    popular: false,
    isFree: true,
    ctaLabel: 'Try for $0'
  },
  {
    id: 'starter',
    name: 'Starter',
    healthcareLabel: 'Solo Practice',
    price: 79,
    minutes: 300,
    features: ['300 included minutes/mo', '1 phone number', 'Inbound calls only'],
    hipaa: false,
    popular: false,
    ctaLabel: 'Get started'
  },
  {
    id: 'practice',
    name: 'Practice',
    healthcareLabel: 'Small Clinic',
    price: 199,
    minutes: 900,
    features: ['900 included minutes/mo', 'HIPAA + BAA', 'Inbound & outbound calls'],
    hipaa: true,
    popular: true,
    ctaLabel: 'Get started'
  },
  {
    id: 'clinic_pro',
    name: 'Clinic Pro',
    healthcareLabel: 'Group Practice',
    price: 399,
    minutes: 2000,
    features: ['2,000 included minutes/mo', '2 phone numbers', 'Calendar integration'],
    hipaa: true,
    popular: false,
    ctaLabel: 'Get started'
  }
];

export const LANGUAGES = [
  { label: 'English', flagCode: 'gb' },
  { label: 'Spanish', flagCode: 'es' },
  { label: 'French', flagCode: 'fr' },
  { label: 'German', flagCode: 'de' },
  { label: 'Russian', flagCode: 'ru' },
  { label: 'Chinese', flagCode: 'cn' }
];

export const LANGUAGES_SECTION_NOTE =
  'English, Spanish, French, German, Russian, and Chinese — auto-detected on every call. Additional languages supported; no press-1 menus.';

export const FAQ_ITEMS = [
  {
    question: 'Is Somo HIPAA compliant?',
    answer:
      'Somo implements HIPAA-aligned workflows and security measures for protected health information. Business Associate Agreements (BAAs) are available on Practice ($199/mo) and Clinic Pro plans. Starter is designed for non-PHI use cases.'
  },
  {
    question: 'How quickly can I get started?',
    answer:
      'Most practices are live in minutes. Sign up, forward your line or provision a Somo number, and your AI front desk starts answering calls immediately. No credit card required for trial.'
  },
  {
    question: 'What languages does Somo support?',
    answer:
      'Somo automatically detects the caller\'s language and responds in kind — including English, Spanish, French, German, Russian, Chinese, and more. No IVR language menu required.'
  },
  {
    question: 'Does Somo integrate with my calendar or EHR?',
    answer:
      'Clinic Pro includes calendar integration for appointment booking. EHR integrations vary by vendor — contact us for your specific setup.'
  },
  {
    question: 'What happens on the live demo call?',
    answer:
      'Enter your phone number and Somo will call you within seconds. You\'ll experience a real AI front desk conversation tailored to your selected practice type — dental, medical, specialty, and more.'
  },
  {
    question: 'Can I cancel anytime?',
    answer:
      'Yes. Somo is month-to-month with no long-term contract. Cancel from your dashboard at any time.'
  },
  {
    question: 'How does pricing compare to hiring a receptionist?',
    answer:
      'A full-time US front desk receptionist costs $3,500+/mo loaded (salary, benefits, PTO). Somo Practice is $199/mo with 900 included minutes, 24/7 coverage, and multilingual support built in.'
  },
  {
    question: 'What if I exceed my included minutes?',
    answer:
      'Top-up minute packs are available from your dashboard. You\'ll receive alerts before running low so there are no surprises.'
  }
];

export function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer
      }
    }))
  };
}
