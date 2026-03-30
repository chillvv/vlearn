import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@aiweb/mobile-shared';
import { createQuestion, getQuestionBank, type CreateQuestionInput } from '../lib/questions-api';

export function useQuestionBankQuery(limit = 30) {
  return useQuery({
    queryKey: queryKeys.questionsList({ sortBy: 'latestWrong', limit }),
    queryFn: () => getQuestionBank(limit),
    staleTime: 30 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useCreateQuestionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQuestionInput) => createQuestion(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.questionsList({ sortBy: 'latestWrong', limit: 30 }) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.questionsDueCount() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.questionsList({ onlyDue: true, limit: 20, sortBy: 'nearestDue' }) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats() }),
      ]);
    },
  });
}
