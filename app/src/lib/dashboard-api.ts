import { createEmptyStats, normalizeDashboardStatsFromRpc, type Stats } from '@aiweb/mobile-shared';
import { isLocalApiMode } from './data-access';
import { localApiRequest } from './local-data-api';
import { supabase } from './supabase';

export type DashboardStatsState =
  | {
      source: 'live';
      stats: Stats;
    }
  | {
      source: 'unconfigured' | 'unauthenticated';
      stats: Stats;
    };

export async function getDashboardStats(): Promise<DashboardStatsState> {
  if (isLocalApiMode()) {
    try {
      const row = await localApiRequest<Record<string, unknown> | null>('/stats/dashboard');
      const normalized = normalizeDashboardStatsFromRpc(row);
      return {
        source: 'live',
        stats: normalized ?? createEmptyStats(),
      };
    } catch (error) {
      const message = String((error as Error)?.message || '');
      if (message.includes('请先登录')) {
        return {
          source: 'unauthenticated',
          stats: createEmptyStats(),
        };
      }
      throw error;
    }
  }
  if (!supabase) {
    return {
      source: 'unconfigured',
      stats: createEmptyStats(),
    };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new Error(error.message);
  }

  const user = data.user;
  if (!user) {
    return {
      source: 'unauthenticated',
      stats: createEmptyStats(),
    };
  }

  const rpcResult = await supabase.rpc('get_dashboard_stats', { p_user_id: user.id });
  if (rpcResult.error) {
    throw new Error(rpcResult.error.message);
  }

  const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
  const normalized = normalizeDashboardStatsFromRpc(rpcRow);

  return {
    source: 'live',
    stats: normalized ?? createEmptyStats(),
  };
}
