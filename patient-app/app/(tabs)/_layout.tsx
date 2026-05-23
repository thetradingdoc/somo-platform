import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { BillingTheme } from '@/constants/billingTheme';
import { JournalTokens } from '@/constants/journalTokens';

export default function TabLayout() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Tabs
        initialRouteName="today"
        screenOptions={{
          tabBarActiveTintColor: JournalTokens.color.brandAccent,
          tabBarInactiveTintColor: BillingTheme.color['color.nav.inactive'],
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabLabel,
          sceneStyle: { backgroundColor: JournalTokens.color.cream },
        }}>
        <Tabs.Screen
          name="today"
          options={{
            title: 'Today',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="sun.max.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="timeline"
          options={{
            title: 'Timeline',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="calendar" color={color} />,
          }}
        />
        <Tabs.Screen
          name="money"
          options={{
            title: 'Money',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="creditcard.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: 'Account',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="person.fill" color={color} />,
          }}
        />
        <Tabs.Screen name="home" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ href: null }} />
        <Tabs.Screen name="products" options={{ href: null }} />
        <Tabs.Screen name="routine" options={{ href: null }} />
        <Tabs.Screen name="more" options={{ href: null }} />
        <Tabs.Screen name="shelf" options={{ href: null }} />
        <Tabs.Screen name="insights" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
      </Tabs>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add progress photo"
        accessibilityHint="Opens camera to log today's progress photo"
        onPress={() => router.push({ pathname: '/(tabs)/today', params: { photo: '1' } })}
        style={styles.scanFab}>
        <Text allowFontScaling style={styles.scanFabText}>
          + Photo
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JournalTokens.color.cream,
  },
  tabBar: {
    height: 72,
    paddingBottom: 10,
    backgroundColor: JournalTokens.color.card,
    borderTopColor: JournalTokens.color.line,
  },
  tabLabel: {
    fontFamily: JournalTokens.font.body,
    fontSize: 12,
    marginBottom: 2,
  },
  scanFab: {
    position: 'absolute',
    bottom: 42,
    alignSelf: 'center',
    minWidth: 120,
    minHeight: JournalTokens.minTap,
    borderRadius: JournalTokens.radius.pill,
    backgroundColor: BillingTheme.button.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: JournalTokens.spacing.lg,
    ...JournalTokens.shadow.card,
  },
  scanFabText: {
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
    color: BillingTheme.button.primaryText,
    fontSize: 15,
  },
});
