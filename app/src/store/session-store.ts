import { create } from 'zustand';
import { supabase } from '../lib/supabase';

type SessionSnapshot = {
  userId: string;
  email: string;
};

type AuthResponse = {
  session: SessionSnapshot | null;
  requiresEmailConfirmation?: boolean;
};

type SessionState = {
  hydrated: boolean;
  session: SessionSnapshot | null;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthResponse>;
  register: (email: string, password: string, name?: string) => Promise<AuthResponse>;
  signOut: () => Promise<void>;
};

let authListenerBound = false;

function toSessionSnapshot(user?: { id?: string; email?: string } | null): SessionSnapshot | null {
  if (!user?.id) return null;
  return {
    userId: user.id,
    email: user.email ?? 'unknown@aiweb.dev',
  };
}

export const useSessionStore = create<SessionState>((set) => ({
  hydrated: false,
  session: null,
  bootstrap: async () => {
    if (supabase && !authListenerBound) {
      supabase.auth.onAuthStateChange((_event, session) => {
        set({
          session: toSessionSnapshot(session?.user),
          hydrated: true,
        });
      });
      authListenerBound = true;
    }

    const activeSession = await supabase?.auth.getSession();
    set({
      session: toSessionSnapshot(activeSession?.data.session?.user),
      hydrated: true,
    });
  },
  signIn: async (email, password) => {
    if (!supabase) {
      throw new Error('未配置 Supabase，无法登录真实数据');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      throw new Error(error.message);
    }

    const session = toSessionSnapshot(data.session?.user ?? data.user);
    set({ session, hydrated: true });
    return { session };
  },
  register: async (email, password, name) => {
    if (!supabase) {
      throw new Error('未配置 Supabase，无法注册真实账号');
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name || '',
        },
      },
    });
    if (error) {
      throw new Error(error.message);
    }

    const session = toSessionSnapshot(data.session?.user);
    set({ session, hydrated: true });
    return {
      session,
      requiresEmailConfirmation: Boolean(data.user && !data.session),
    };
  },
  signOut: async () => {
    await supabase?.auth.signOut();
    set({ session: null, hydrated: true });
  },
}));
