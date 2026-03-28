import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'aiweb.mobile.preview-session';

type SessionSnapshot = {
  userId: string;
  email: string;
};

type SessionState = {
  hydrated: boolean;
  session: SessionSnapshot | null;
  bootstrap: () => Promise<void>;
  signInPreview: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const useSessionStore = create<SessionState>((set) => ({
  hydrated: false,
  session: null,
  bootstrap: async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      set({ session: JSON.parse(stored) as SessionSnapshot, hydrated: true });
      return;
    }

    const activeSession = await supabase?.auth.getSession();
    const user = activeSession?.data.session?.user;
    set({
      session: user
        ? {
            userId: user.id,
            email: user.email ?? 'unknown@aiweb.dev',
          }
        : null,
      hydrated: true,
    });
  },
  signInPreview: async () => {
    const snapshot = {
      userId: 'preview-user',
      email: 'preview@aiweb.dev',
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    set({ session: snapshot, hydrated: true });
  },
  signOut: async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await supabase?.auth.signOut();
    set({ session: null, hydrated: true });
  },
}));
