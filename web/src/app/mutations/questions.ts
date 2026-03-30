import { useMutation, useQueryClient } from '@tanstack/react-query';
import { questionsApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import type { Question, SubmitReviewAttemptInput } from '../lib/types';

function patchQuestionInList(list: Question[] | undefined, nextQuestion: Question) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => (item.id === nextQuestion.id ? nextQuestion : item));
}

export function useSubmitReviewAttemptMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitReviewAttemptInput) => questionsApi.submitReviewAttempt(input),
    onSuccess: (result, variables) => {
      queryClient.setQueriesData(
        { queryKey: ['questions', 'list'] },
        (prev: Question[] | undefined) => patchQuestionInList(prev, result.question),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.questionsCount() });
      queryClient.invalidateQueries({ queryKey: ['questions', 'due-count'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats() });
      queryClient.invalidateQueries({ queryKey: ['knowledge', 'node-mastery'] });
      queryClient.invalidateQueries({ queryKey: ['review', 'global-error-stats'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.recentAttempts(variables.questionId, 6) });
    },
  });
}

export function useCreateQuestionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Question>) => questionsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['questions', 'count'] });
      queryClient.invalidateQueries({ queryKey: ['questions', 'due-count'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge', 'node-mastery'] });
      queryClient.invalidateQueries({ queryKey: ['review', 'global-error-stats'] });
    },
  });
}
