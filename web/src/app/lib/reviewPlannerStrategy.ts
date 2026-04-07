import type { Question } from './types';

export type ReviewPlannerScope = 'all' | 'due' | 'unmastered' | 'stubborn';

export interface ReviewPlannerStrategyMeta {
  strategy_template: string;
  strategy_label: string;
  prompt_hint: string;
  version_tag: string;
  fallback_summary: string;
  weighting_profile: {
    due: number;
    recall: number;
    lapse: number;
    stability: number;
    difficulty: number;
    new_question: number;
  };
}

export interface ReviewPlannerRolloutMetadata {
  planner_enabled: boolean;
  gray_percent: number;
  gray_bucket: number;
  selected: boolean;
  page_number: number;
}

const REVIEW_PLANNER_STRATEGY_REGISTRY: Record<string, ReviewPlannerStrategyMeta> = {
  'due-rescue': {
    strategy_template: 'due-rescue',
    strategy_label: '到期抢救',
    prompt_hint: '优先保障 due 题覆盖，先处理遗忘风险最高与已逾期题目。',
    version_tag: 'due-rescue',
    fallback_summary: '当前按到期优先策略回退到规则队列。',
    weighting_profile: {
      due: 52,
      recall: 24,
      lapse: 8,
      stability: 10,
      difficulty: 4,
      new_question: 2,
    },
  },
  'stubborn-focus': {
    strategy_template: 'stubborn-focus',
    strategy_label: '顽固错题攻坚',
    prompt_hint: '优先处理反复失误、召回率低且稳定性差的题目，减少无效重复。',
    version_tag: 'stubborn-focus',
    fallback_summary: '当前按顽固错题攻坚策略回退到规则队列。',
    weighting_profile: {
      due: 32,
      recall: 22,
      lapse: 18,
      stability: 14,
      difficulty: 8,
      new_question: 0,
    },
  },
  'weakness-reinforce': {
    strategy_template: 'weakness-reinforce',
    strategy_label: '薄弱点巩固',
    prompt_hint: '优先覆盖薄弱点与高波动题，但保留适量稳态巩固题。',
    version_tag: 'weakness-reinforce',
    fallback_summary: '当前按薄弱点巩固策略回退到规则队列。',
    weighting_profile: {
      due: 28,
      recall: 24,
      lapse: 14,
      stability: 16,
      difficulty: 10,
      new_question: 4,
    },
  },
  'daily-reinforce': {
    strategy_template: 'daily-reinforce',
    strategy_label: '日常巩固',
    prompt_hint: '平衡抢救、巩固与回访，避免单一高压刷题。',
    version_tag: 'daily-reinforce',
    fallback_summary: '当前按日常巩固策略回退到规则队列。',
    weighting_profile: {
      due: 24,
      recall: 28,
      lapse: 12,
      stability: 16,
      difficulty: 10,
      new_question: 6,
    },
  },
};

export function getReviewPlannerStrategyMeta(scope: ReviewPlannerScope, cards: Question[], dueMinRatio: number) {
  const dueCount = cards.filter((item) => !!item.next_review_date && new Date(item.next_review_date) <= new Date()).length;
  const dueRatio = cards.length > 0 ? dueCount / cards.length : 0;
  if (scope === 'due' || dueRatio >= Math.max(dueMinRatio, 0.6)) {
    return REVIEW_PLANNER_STRATEGY_REGISTRY['due-rescue'];
  }
  if (scope === 'stubborn') {
    return REVIEW_PLANNER_STRATEGY_REGISTRY['stubborn-focus'];
  }
  if (scope === 'unmastered') {
    return REVIEW_PLANNER_STRATEGY_REGISTRY['weakness-reinforce'];
  }
  return REVIEW_PLANNER_STRATEGY_REGISTRY['daily-reinforce'];
}

export function buildReviewPlannerPlanVersion(strategyTemplate: string) {
  const strategy = REVIEW_PLANNER_STRATEGY_REGISTRY[strategyTemplate] || REVIEW_PLANNER_STRATEGY_REGISTRY['daily-reinforce'];
  return `review-ai-live-v2-${strategy.version_tag}`;
}

export function formatReviewPlannerFallbackReason(reason?: string) {
  if (reason === 'planner_disabled') return '当前灰度未开启 AI 计划';
  if (reason === 'gray_not_selected') return '当前会话未命中 AI 灰度，使用规则队列';
  if (reason === 'planner_timeout') return 'AI 规划超时，已自动切回规则队列';
  if (reason === 'schema_invalid') return 'AI 返回结构无效，已自动切回规则队列';
  if (reason === 'due_min_ratio_unmet') return 'AI 计划未满足 due 覆盖护栏，已自动切回规则队列';
  if (reason === 'guardrail_unrecoverable') return 'AI 计划未通过护栏校验，已自动切回规则队列';
  if (reason === 'request_failed') return 'AI 请求失败，已自动切回规则队列';
  return '当前会话使用规则回退队列';
}

export function buildReviewPlannerGraySeed(input: {
  subject: string;
  scope: ReviewPlannerScope;
  pageNumber: number;
  questionIds: string[];
}) {
  return `${input.subject}:${input.scope}:${input.pageNumber}:${input.questionIds.join('|')}`;
}

export function hashReviewPlannerSeed(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 100);
}

export function resolveReviewPlannerRollout(input: {
  plannerEnabled: boolean;
  grayPercent: number;
  seed: string;
  pageNumber: number;
}): ReviewPlannerRolloutMetadata {
  const normalizedPercent = Math.min(100, Math.max(0, Math.round(input.grayPercent)));
  const grayBucket = hashReviewPlannerSeed(input.seed);
  const selected = input.plannerEnabled && (
    normalizedPercent >= 100
      ? true
      : normalizedPercent > 0 && grayBucket < normalizedPercent
  );
  return {
    planner_enabled: input.plannerEnabled,
    gray_percent: normalizedPercent,
    gray_bucket: grayBucket,
    selected,
    page_number: Math.max(1, Math.round(input.pageNumber || 1)),
  };
}
