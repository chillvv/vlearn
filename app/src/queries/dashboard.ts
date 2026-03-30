import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@aiweb/mobile-shared';
import { getDashboardStats } from '../lib/dashboard-api';

export function useDashboardStatsQuery() {
  return useQuery({
    queryKey: queryKeys.dashboardStats(),
    queryFn: getDashboardStats,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}
