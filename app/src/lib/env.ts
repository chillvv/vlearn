import { z } from 'zod';

const DEFAULT_SUPABASE_URL = 'https://kepmdwisavomgrksvgff.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlcG1kd2lzYXZvbWdya3N2Z2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc1NDUsImV4cCI6MjA4OTMzMzU0NX0.Q0xU709C6boLIvDE_fWNex8477edSF-ehpicLQY0xiM';
const DEFAULT_API_BASE = 'http://localhost:8080/api';
const DEFAULT_DATA_ACCESS_MODE = 'local_api';

const schema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  EXPO_PUBLIC_API_BASE: z.string().optional(),
  EXPO_PUBLIC_DATA_ACCESS_MODE: z.enum(['supabase', 'local_api']).optional(),
  EXPO_PUBLIC_POSTHOG_KEY: z.string().optional(),
  EXPO_PUBLIC_POSTHOG_HOST: z.string().url().default('https://app.posthog.com'),
  EXPO_PUBLIC_SENTRY_DSN: z.string().optional(),
});

export const env = schema.parse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY:
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_API_BASE: process.env.EXPO_PUBLIC_API_BASE || process.env.VITE_API_BASE || DEFAULT_API_BASE,
  EXPO_PUBLIC_DATA_ACCESS_MODE:
    process.env.EXPO_PUBLIC_DATA_ACCESS_MODE || process.env.VITE_DATA_ACCESS_MODE || DEFAULT_DATA_ACCESS_MODE,
  EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
});
