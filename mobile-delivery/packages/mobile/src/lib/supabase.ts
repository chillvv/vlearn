import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { env } from './env';

const STORAGE_KEY = 'aiweb.mobile.session';

const storage = {
  getItem: async (key: string) => {
    const secureValue = await SecureStore.getItemAsync(`${STORAGE_KEY}.${key}`);
    if (secureValue) {
      return secureValue;
    }
    return AsyncStorage.getItem(`${STORAGE_KEY}.${key}`);
  },
  setItem: async (key: string, value: string) => {
    if (value.length <= 2048) {
      await SecureStore.setItemAsync(`${STORAGE_KEY}.${key}`, value);
      return;
    }
    await AsyncStorage.setItem(`${STORAGE_KEY}.${key}`, value);
  },
  removeItem: async (key: string) => {
    await SecureStore.deleteItemAsync(`${STORAGE_KEY}.${key}`);
    await AsyncStorage.removeItem(`${STORAGE_KEY}.${key}`);
  },
};

export const supabase: SupabaseClient | null =
  env.EXPO_PUBLIC_SUPABASE_URL && env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ? createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
        auth: {
          storage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;
