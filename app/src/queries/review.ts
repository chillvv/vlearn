import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@aiweb/mobile-shared';
import { getDueQuestions, getDueQuestionsCount } from '../lib/questions-api';
import { getDashboardStats } from '../lib/dashboard-api';
import { getRecentReviewAttempts, submitReviewAttempt, type SubmitReviewAttemptInput } from '../lib/review-api';

export function useDueQuestionsQuery(limit = 20) {
  return useQuery({
    queryKey: queryKeys.questionsList({
      onlyDue: true,
      limit,
      sortBy: 'nearestDue',
    }),
    queryFn: () => getDueQuestions(limit),
    staleTime: 30 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useDueQuestionsCountQuery() {
  return useQuery({
    queryKey: queryKeys.questionsDueCount(),
    queryFn: getDueQuestionsCount,
    staleTime: 30 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useRecentReviewAttemptsQuery(questionId?: string, limit = 6) {
  return useQuery({
    queryKey: queryKeys.recentAttempts(questionId, limit),
    queryFn: () => getRecentReviewAttempts(questionId || '', limit),
    enabled: Boolean(questionId),
    staleTime: 30 * 1000,
  });
}

export function useSubmitReviewAttemptMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SubmitReviewAttemptInput) => submitReviewAttempt(input),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.questionsDueCount() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.questionsList({ onlyDue: true, limit: 20, sortBy: 'nearestDue' }) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recentAttempts(variables.questionId, 6) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats() }),
      ]);
      await queryClient.prefetchQuery({
        queryKey: queryKeys.dashboardStats(),
        queryFn: getDashboardStats,
      });
    },
  });
}
