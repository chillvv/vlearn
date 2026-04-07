import { useQuery } from '@tanstack/react-query';
import { questionsApi, statsApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import type { QuestionQuery } from '../lib/types';

export type ReviewChunkKey = 'due_rescue' | 'stubborn_focus' | 'unmastered_boost';

export type ReviewChunkItem = {
  key: ReviewChunkKey;
  label: string;
  description: string;
  amount: number;
  query: QuestionQuery;
};

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

export function useReviewChunksQuery(subject: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reviewChunks(subject),
    queryFn: async (): Promise<ReviewChunkItem[]> => {
      const chunkDefs: Array<{ key: ReviewChunkKey; label: string; description: string; amount: number; query: QuestionQuery }> = [
        {
          key: 'due_rescue',
          label: '近期遗忘抢救',
          description: '优先处理已经到期、最容易继续遗忘的题目',
          amount: 12,
          query: { subject, onlyDue: true, sortBy: 'nearestDue' },
        },
        {
          key: 'stubborn_focus',
          label: '高频易错突击',
          description: '集中处理顽固错题，打断重复犯错链路',
          amount: 10,
          query: { subject, onlyStubborn: true, sortBy: 'lowestMastery' },
        },
        {
          key: 'unmastered_boost',
          label: '未掌握补强',
          description: '补齐未掌握题目，快速提升当前薄弱面',
          amount: 15,
          query: { subject, onlyUnmastered: true, sortBy: 'latestWrong' },
        },
      ];
      const counts = await Promise.all(
        chunkDefs.map(async (chunk) => ({
          ...chunk,
          total: await questionsApi.count(chunk.query),
        })),
      );
      return counts
        .filter((item) => item.total > 0)
        .map((item) => ({
          key: item.key,
          label: item.label,
          description: item.description,
          amount: Math.max(1, Math.min(item.amount, item.total)),
          query: item.query,
        }));
    },
    enabled: enabled && Boolean(subject),
    staleTime: 20 * 1000,
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
