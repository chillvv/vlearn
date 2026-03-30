import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { questionsApi } from './api';

export function useQuestionsRevalidator(enabled: boolean, intervalMs = 20_000) {
  const queryClient = useQueryClient();
  const previousRevisionRef = useRef<string | null>(null);
  const revisionQuery = useQuery({
    queryKey: ['questions', 'revision'],
    queryFn: () => questionsApi.getRevision(),
    enabled,
    staleTime: 10 * 1000,
    refetchInterval: intervalMs,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const current = revisionQuery.data || null;
    if (!current) return;
    const previous = previousRevisionRef.current;
    previousRevisionRef.current = current;
    if (!previous || previous === current) return;
    queryClient.invalidateQueries({ queryKey: ['questions', 'list'] });
    queryClient.invalidateQueries({ queryKey: ['questions', 'count'] });
    queryClient.invalidateQueries({ queryKey: ['questions', 'due-count'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge', 'node-mastery'] });
    queryClient.invalidateQueries({ queryKey: ['review', 'global-error-stats'] });
  }, [queryClient, revisionQuery.data]);
}
