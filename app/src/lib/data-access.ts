import { env } from './env';

export const dataAccessMode = env.EXPO_PUBLIC_DATA_ACCESS_MODE === 'supabase' ? 'supabase' : 'local_api';
export const apiBase = String(env.EXPO_PUBLIC_API_BASE || '').trim().replace(/\/$/, '');

export function isLocalApiMode() {
  return dataAccessMode === 'local_api' && apiBase.length > 0;
}
