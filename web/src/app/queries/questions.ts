import { useQuery } from '@tanstack/react-query';
import { questionsApi, statsApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import type { QuestionQuery } from '../lib/types';

export function useQuestionsListQuery(query: QuestionQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.questionsList(query),
    queryFn: () => questionsApi.getAll(query),
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useQuestionsCountQuery(query: QuestionQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.questionsCount(query),
    queryFn: () => questionsApi.count(query),
    enabled,
    staleTime: 20 * 1000,
  });
}

export function useQuestionsDueCountQuery(subject?: string) {
  return useQuery({
    queryKey: queryKeys.questionsDueCount(subject),
    queryFn: () => questionsApi.countDue(subject ? { subject } : {}),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useRecentAttemptsQuery(questionId?: string, enabled = true, limit = 6) {
  return useQuery({
    queryKey: queryKeys.recentAttempts(questionId, limit),
    queryFn: async () => {
      if (!questionId) return [];
      return questionsApi.getRecentAttempts(questionId, limit);
    },
    enabled: enabled && Boolean(questionId),
    staleTime: 30 * 1000,
  });
}

export function useDashboardStatsQuery() {
  return useQuery({
    queryKey: queryKeys.dashboardStats(),
    queryFn: () => statsApi.get(),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useKnowledgeNodeMasteryQuery(subject: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.knowledgeNodeMastery(subject),
    queryFn: () => questionsApi.getKnowledgeNodeMastery(subject),
    staleTime: 60 * 1000,
    enabled: enabled && Boolean(subject),
  });
}
