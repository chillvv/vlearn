import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppProviders } from '../src/providers/AppProviders';
import { initErrorReporting } from '../src/lib/error-reporting';
import { syncSystemUi } from '../src/lib/system-ui';

SplashScreen.preventAutoHideAsync();

initErrorReporting();

export default function RootLayout() {
  useEffect(() => {
    syncSystemUi();
    void SplashScreen.hideAsync();
  }, []);

  return (
    <AppProviders>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </AppProviders>
  );
}
