import { DefaultTheme, type Theme } from '@react-navigation/native';

import { JournalTokens } from '@/constants/journalTokens';

export const SkinCareNavigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: JournalTokens.color.brandBlue,
    background: JournalTokens.color.cream,
    card: JournalTokens.color.card,
    text: JournalTokens.color.ink,
    border: JournalTokens.color.line,
  },
};
