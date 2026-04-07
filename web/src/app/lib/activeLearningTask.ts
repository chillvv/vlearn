import type { LearningSessionProposal } from './learningSession';
import type { Question, ReviewPlannerRunResult, VariantQuestion } from './types';

type ReviewConfig = {
  subject: '英语' | 'C语言';
  scope: 'all' | 'due' | 'unmastered' | 'stubborn';
  sortBy: 'latestWrong' | 'lowestMastery' | 'nearestDue';
  amount: number;
};

type DrillConfig = {
  subject: '英语' | 'C语言';
  nodes: string[];
  amount: number;
  strategy: '递进' | '随机' | '攻坚';
};

type PracticeEntryMode = 'recommended' | 'custom';
type PracticeMissionId = 'weakness' | 'recent' | 'sprint' | 'custom';
type PracticeJudgeSource = 'server' | 'local';
type PracticeAttemptSummary = {
  node: string;
  isCorrect: boolean;
  judgeSource: PracticeJudgeSource;
};

type PersistedEnvelope<T> = {
  version: 'v1';
  updatedAt: number;
  data: T;
};

export type PersistedReviewTask = {
  proposal: LearningSessionProposal;
  config: ReviewConfig;
  status: 'active';
  cards: Question[];
  currentIndex: number;
  flipped: boolean;
  showDetails: boolean;
  userAnswer: string;
  lastScheduleText: string;
  sessionReviewed: number;
  sessionCorrect: number;
  sessionPlanUpdated: number;
  sessionPatternCounts: Record<string, number>;
  plannerResult: ReviewPlannerRunResult | null;
  reviewPage: number;
  totalCount: number;
  hasNextPage: boolean;
};

export type PersistedPracticeTask = {
  proposal: LearningSessionProposal;
  config: DrillConfig;
  entryMode: PracticeEntryMode;
  selectedMissionId: PracticeMissionId;
  showAdvanced: boolean;
  status: 'active' | 'partial' | 'fallback';
  questions: VariantQuestion[];
  currentIdx: number;
  selectedOption: string;
  correctCount: number;
  attemptSummaries: PracticeAttemptSummary[];
  timeElapsed: number;
  isExplanationOpen: boolean;
  showAiHint: boolean;
  isAnswerSubmitted: boolean;
  practiceSessionId: string | null;
  questionStartedAt: number;
  generationFallbackNotice: string;
  judgeFallbackNotice: string;
  judgeSource: PracticeJudgeSource;
  targetAmount: number;
};

const REVIEW_TASK_KEY = 'vlearn.active-review-task.v1';
const PRACTICE_TASK_KEY = 'vlearn.active-practice-task.v1';

function readEnvelope<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEnvelope<T> | null;
    if (!parsed || parsed.version !== 'v1' || !parsed.data) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeEnvelope<T>(key: string, data: T) {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedEnvelope<T> = {
      version: 'v1',
      updatedAt: Date.now(),
      data,
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
  }
}

function clearEnvelope(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
  }
}

export function readPersistedReviewTask() {
  return readEnvelope<PersistedReviewTask>(REVIEW_TASK_KEY);
}

export function writePersistedReviewTask(task: PersistedReviewTask) {
  writeEnvelope(REVIEW_TASK_KEY, task);
}

export function clearPersistedReviewTask() {
  clearEnvelope(REVIEW_TASK_KEY);
}

export function readPersistedPracticeTask() {
  return readEnvelope<PersistedPracticeTask>(PRACTICE_TASK_KEY);
}

export function writePersistedPracticeTask(task: PersistedPracticeTask) {
  writeEnvelope(PRACTICE_TASK_KEY, task);
}

export function clearPersistedPracticeTask() {
  clearEnvelope(PRACTICE_TASK_KEY);
}
