import { Fonts } from './theme';

export const JournalTokens = {
  color: {
    cream: '#F8F3EA',
    card: '#FFFDF9',
    ink: '#1F2937',
    muted: '#6B7280',
    line: '#E9E2D6',
    brandBlue: '#314DB6',
    accent: '#57BFD4',
    terracotta: '#C16E52',
    success: '#4F8A5B',
  },
  font: {
    display: Fonts.serif,
    body: Fonts.sans,
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 20,
    xl: 28,
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 18,
    pill: 999,
  },
  shadow: {
    card: {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
  },
  motion: {
    quickMs: 120,
    standardMs: 220,
  },
  minTap: 48,
} as const;

