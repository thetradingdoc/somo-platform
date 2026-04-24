import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { JournalTokens } from '@/constants/journalTokens';
import { patientGet } from '@/lib/patient-api';

export default function TabLayout() {
  const router = useRouter();
  const [showScanFab, setShowScanFab] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await patientGet('/api/patient/home/progress-summary');
        if (alive) setShowScanFab(Boolean(data?.has_template));
      } catch {
        if (alive) setShowScanFab(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={styles.root}>
      <Tabs
        initialRouteName="home"
        screenOptions={{
          tabBarActiveTintColor: JournalTokens.color.brandBlue,
          tabBarInactiveTintColor: JournalTokens.color.muted,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabLabel,
          sceneStyle: { backgroundColor: JournalTokens.color.cream },
        }}>
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="house.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: 'Calendar',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="calendar" color={color} />,
          }}
        />
        <Tabs.Screen
          name="products"
          options={{
            title: 'Products',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="square.grid.2x2.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="routine"
          options={{
            title: 'Routine',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="checklist" color={color} />,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="ellipsis.circle.fill" color={color} />,
          }}
        />
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="journal" options={{ href: null }} />
        <Tabs.Screen name="shelf" options={{ href: null }} />
        <Tabs.Screen name="insights" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
      </Tabs>

      {showScanFab ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan product"
          accessibilityHint="Open the product scan entry sheet"
          onPress={() => router.push('/scan-entry')}
          style={styles.scanFab}>
          <Text allowFontScaling style={styles.scanFabText}>+ Scan</Text>
        </Pressable>
      ) : null}
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
    backgroundColor: JournalTokens.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: JournalTokens.spacing.lg,
    ...JournalTokens.shadow.card,
  },
  scanFabText: {
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
    color: JournalTokens.color.card,
    fontSize: 15,
  },
});
