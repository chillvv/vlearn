import { PropsWithChildren, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../lib/query-client';
import { bootstrapAnalytics } from '../lib/analytics';
import { warmFeatureFlags } from '../lib/feature-flags';
import { useSessionStore } from '../store/session-store';

export function AppProviders({ children }: PropsWithChildren) {
  const bootstrap = useSessionStore((state) => state.bootstrap);

  useEffect(() => {
    bootstrap();
    bootstrapAnalytics();
    warmFeatureFlags();
  }, [bootstrap]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
