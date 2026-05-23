import { Stack } from 'expo-router';

export default function RoutineStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="pick" options={{ title: 'Choose routine', headerShown: true }} />
      <Stack.Screen name="setup" options={{ title: 'Routine', headerShown: false }} />
    </Stack>
  );
}
