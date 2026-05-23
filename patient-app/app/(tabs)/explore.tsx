import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { JournalTokens } from '@/constants/journalTokens';
import { DEMO_CHECKOUT_PRODUCT_ID, DEMO_PROVIDER_ID, getApiReachabilityIssue } from '@/config';
import { Fonts } from '@/constants/theme';

/**
 * Explore: entry to agentic checkout chat (same shell as web) via modal route /checkout-chat.
 */
export default function ExploreScreen() {
  const apiIssue = getApiReachabilityIssue();

  const openCheckoutChat = () => {
    const q = new URLSearchParams({ product_id: DEMO_CHECKOUT_PRODUCT_ID });
    if (DEMO_PROVIDER_ID) q.set('provider_id', DEMO_PROVIDER_ID);
    router.push(`/checkout-chat?${q.toString()}` as never);
  };

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="bag.fill"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title" style={{ fontFamily: Fonts.rounded }}>
          Manage prescriptions
        </ThemedText>
      </ThemedView>

      {apiIssue ? (
        <ThemedView style={styles.warn}>
          <ThemedText style={styles.warnText}>{apiIssue}</ThemedText>
        </ThemedView>
      ) : null}

      <ThemedText>
        Chat with Kelly in the app (streaming replies), switch products from the catalog, then pay — same trusted
        checkout as the website.
      </ThemedText>

      <Pressable
        style={styles.cta}
        onPress={openCheckoutChat}
        accessibilityRole="button"
        accessibilityLabel="Open checkout chat in the app">
        <ThemedText type="defaultSemiBold" style={styles.ctaText}>
          Open checkout chat
        </ThemedText>
      </Pressable>

      <ThemedText style={styles.muted}>
        Configure <ThemedText type="defaultSemiBold">EXPO_PUBLIC_API_BASE_URL</ThemedText>, optional{' '}
        <ThemedText type="defaultSemiBold">EXPO_PUBLIC_MERCHANT_ID</ThemedText> and{' '}
        <ThemedText type="defaultSemiBold">EXPO_PUBLIC_DEMO_PRODUCT_ID</ThemedText> in{' '}
        <ThemedText type="defaultSemiBold">patient-app/.env</ThemedText>.
      </ThemedText>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute'
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8
  },
  warn: {
    backgroundColor: '#fff7ed',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fed7aa'
  },
  warnText: {
    color: '#9a3412',
    fontSize: 14
  },
  cta: {
    backgroundColor: JournalTokens.color.brandBlue,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginVertical: 16
  },
  ctaText: {
    color: '#fff',
    fontSize: 16
  },
  muted: {
    fontSize: 13,
    opacity: 0.85,
    marginTop: 8
  }
});
