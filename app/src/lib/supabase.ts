import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { env } from './env';

const STORAGE_KEY = 'aiweb.mobile.session';
const shouldUseSecureStore = Platform.OS !== 'web';
const SUPABASE_AUTH_STORAGE_KEY = 'aiweb-mobile-auth-token';

const storage = {
  getItem: async (key: string) => {
    if (shouldUseSecureStore) {
      try {
        const secureValue = await SecureStore.getItemAsync(`${STORAGE_KEY}.${key}`);
        if (secureValue) {
          return secureValue;
        }
      } catch {
      }
    }
    return AsyncStorage.getItem(`${STORAGE_KEY}.${key}`);
  },
  setItem: async (key: string, value: string) => {
    if (shouldUseSecureStore && value.length <= 2048) {
      try {
        await SecureStore.setItemAsync(`${STORAGE_KEY}.${key}`, value);
        return;
      } catch {
      }
    }
    await AsyncStorage.setItem(`${STORAGE_KEY}.${key}`, value);
  },
  removeItem: async (key: string) => {
    if (shouldUseSecureStore) {
      try {
        await SecureStore.deleteItemAsync(`${STORAGE_KEY}.${key}`);
      } catch {
      }
    }
    await AsyncStorage.removeItem(`${STORAGE_KEY}.${key}`);
  },
};

declare global {
  var __aiwebSupabaseClient__: SupabaseClient | null | undefined;
}

function createSupabaseClient() {
  if (!env.EXPO_PUBLIC_SUPABASE_URL || !env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  return createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      storage,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

if (globalThis.__aiwebSupabaseClient__ === undefined) {
  globalThis.__aiwebSupabaseClient__ = createSupabaseClient();
}

export const supabase: SupabaseClient | null = globalThis.__aiwebSupabaseClient__ ?? null;
