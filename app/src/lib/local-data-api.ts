import { apiBase } from './data-access';
import { supabase } from './supabase';

async function getAccessToken() {
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('请先登录');
  }
  return accessToken;
}

export async function localApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBase) {
    throw new Error('缺少 EXPO_PUBLIC_API_BASE');
  }
  const token = await getAccessToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `请求失败(${response.status})`);
  }
  if (payload && 'error' in payload && payload.error) {
    throw new Error(payload.error);
  }
  return payload.data as T;
}
