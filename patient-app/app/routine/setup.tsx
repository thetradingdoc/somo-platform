import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JournalTokens } from '@/constants/journalTokens';

/** Legacy deep link `routine/setup?concern=` → routine picker. */
export default function RoutineSetupRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams<{ concern?: string }>();

  useEffect(() => {
    const concern = typeof params.concern === 'string' ? params.concern : undefined;
    router.replace({
      pathname: '/routine/pick',
      params: concern ? { concern } : {},
    });
  }, [params.concern, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: JournalTokens.color.cream }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    </SafeAreaView>
  );
}
