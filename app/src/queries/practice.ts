import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@aiweb/mobile-shared';
import {
  generatePracticeQuestions,
  getPracticeOverview,
  startPracticeSession,
  submitPracticeAttempt,
  type PracticeGenerateInput,
  type StartPracticeSessionInput,
  type SubmitPracticeAttemptInput,
} from '../lib/practice-api';

export function usePracticeOverviewQuery() {
  return useQuery({
    queryKey: queryKeys.practiceOverview(),
    queryFn: () => getPracticeOverview(),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useGeneratePracticeQuestionsMutation() {
  return useMutation({
    mutationFn: (input: PracticeGenerateInput) => generatePracticeQuestions(input),
  });
}

export function useStartPracticeSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartPracticeSessionInput) => startPracticeSession(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.practiceOverview() });
    },
  });
}

export function useSubmitPracticeAttemptMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitPracticeAttemptInput) => submitPracticeAttempt(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.practiceOverview() });
    },
  });
}
