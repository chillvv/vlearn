import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { chatApi, questionsApi } from '../lib/api';
import type { Question, ReviewAttemptDiagnosis, ReviewAttemptRecord, ReviewPlannerRunResult, Subject } from '../lib/types';
import { reviewAiDueMinRatio, reviewAiFallbackEnabled } from '../lib/config';
import { formatReviewPlannerFallbackReason } from '../lib/reviewPlannerStrategy';
import { Zap, Settings, Trophy, CheckCircle2, AlertCircle, RefreshCw, RotateCcw, BookOpen, Calculator, Play, PieChart, LogOut, Info, Sparkles, X, ChevronLeft, ChevronRight, Target, Flame, ArrowUpCircle, Rocket } from 'lucide-react';
import { MistakeQuestionPreview } from '../components/business/MistakeQuestionPreview';
import { useConfirm } from '../components/business/ConfirmProvider';
import { parseQuestionPreview } from '../lib/questionPreview';
import { normalizeChoiceAnswerLabel, normalizeCorrectAnswer } from '../lib/questionPayload';
import { toast } from 'sonner';
import { useQuestionsCountQuery, useQuestionsDueCountQuery, useRecentAttemptsQuery, useReviewChunksQuery, type ReviewChunkKey } from '../queries/questions';
import { useSubmitReviewAttemptMutation } from '../mutations/questions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { clearPersistedReviewTask, readPersistedReviewTask, writePersistedReviewTask, type PersistedReviewTask } from '../lib/activeLearningTask';
import { buildLearningSessionNavigation, createLearningSessionProposal, resolveLearningSessionProposal, type LearningSessionRouteState } from '../lib/learningSession';
import { queryKeys } from '../lib/queryKeys';

type ReviewStatus = 'configuring' | 'ready' | 'loading' | 'active' | 'completed';

type ReviewConfig = {
  subject: Subject;
  scope: 'all' | 'due' | 'unmastered' | 'stubborn';
  sortBy: 'latestWrong' | 'lowestMastery' | 'nearestDue';
  amount: number;
};

type ReviewPresetState = LearningSessionRouteState & {
  preset?: Partial<ReviewConfig>;
};

type ReviewAction = 'forgot' | 'vague' | 'mastered';
type ReviewChunkStrategy = ReviewChunkKey | 'custom';
type ReviewChunkPreset = {
  strategy: ReviewChunkStrategy;
  amount?: number;
  scope?: ReviewConfig['scope'];
  sortBy?: ReviewConfig['sortBy'];
};

const REVIEW_PATTERN_LABELS: Record<string, string> = {
  repeat_same_option: '重复误选',
  keyword_missing: '关键词缺失',
  knowledge_gap: '知识断层',
  careless: '粗心失误',
  unknown: '待归类',
};

const toReviewConfig = (state: ReviewPresetState, search: string) => {
  const proposalResolution = resolveLearningSessionProposal({
    sessionKind: 'review',
    search,
    state,
    fallbackSourceSurface: 'manual',
  });
  return {
    proposalResolution,
    config: {
      subject: proposalResolution.proposal.scope.subject,
      scope: proposalResolution.proposal.scope.reviewScope,
      sortBy: proposalResolution.proposal.scope.sortBy,
      amount: proposalResolution.proposal.scope.amount,
    } satisfies ReviewConfig,
  };
};

function normalizeAnswerText(value: string) {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}

function normalizeOpenAnswer(value: string) {
  return normalizeAnswerText(value).replace(/[。．.,，!！?？;；:："'“”‘’()（）\[\]【】]/g, '');
}

const OPEN_ANSWER_CANONICAL_MAP: Record<string, string> = {
  although: 'although',
  though: 'although',
  eventhough: 'although',
};

function normalizeOpenAnswerForCompare(value: string) {
  const normalized = normalizeOpenAnswer(value);
  if (!normalized) return '';
  return OPEN_ANSWER_CANONICAL_MAP[normalized] || normalized;
}

function evaluateAnswerCorrectness(input: { isChoice: boolean; userAnswer: string; correctAnswer: string; acceptableAnswers?: string[] }) {
  if (input.isChoice) {
    const userLabel = normalizeChoiceAnswerLabel(input.userAnswer);
    const correctLabel = normalizeChoiceAnswerLabel(input.correctAnswer) || input.correctAnswer;
    return Boolean(userLabel) && userLabel === correctLabel;
  }
  const left = normalizeOpenAnswerForCompare(input.userAnswer);
  if (!left) return false;
  const candidates = [input.correctAnswer, ...(input.acceptableAnswers || [])]
    .map((item) => normalizeOpenAnswerForCompare(item || ''))
    .filter(Boolean);
  if (candidates.length === 0) return false;
  return candidates.includes(left);
}

function buildReviewDiagnosis(input: {
  isCorrect: boolean;
  isChoice: boolean;
  userAnswer: string;
  correctAnswer: string;
  selectedOptionText?: string;
  recentAttempts: ReviewAttemptRecord[];
}): ReviewAttemptDiagnosis {
  const previousAttempts = input.recentAttempts || [];
  let previousWrongStreak = 0;
  for (const item of previousAttempts) {
    if (item.is_correct) break;
    previousWrongStreak += 1;
  }
  const repeatedSameWrongChoice = input.isChoice
    ? previousAttempts.some((item) => !item.is_correct && item.user_answer && item.user_answer === input.userAnswer)
    : false;
  const keywordMissing = !input.isChoice && normalizeAnswerText(input.userAnswer).length > 0 && normalizeAnswerText(input.userAnswer).length <= 4;
  if (input.isCorrect) {
    return {
      why_wrong: '回答正确，当前题目知识点已命中',
      evidence: `你的答案为「${input.userAnswer || '未填写'}」且与标准答案一致`,
      fix_strategy: '间隔复习时优先回顾同知识点变式题，巩固迁移能力',
      next_practice_type: '间隔复习 + 同类巩固',
      error_pattern: 'unknown',
      confidence_score: 0.92,
      history_hint: previousWrongStreak > 0 ? `本题在本次前已连续错 ${previousWrongStreak} 次，当前已打断错误链。` : '本题近期表现稳定，可保持间隔复习。',
    };
  }
  if (repeatedSameWrongChoice) {
    return {
      why_wrong: '重复选择同一干扰项，说明辨析路径被固定误导',
      evidence: `你本次与近期历史都倾向选择「${input.userAnswer || '未选择'}${input.selectedOptionText ? `. ${input.selectedOptionText}` : ''}」，正确答案是「${input.correctAnswer || '无'}」`,
      fix_strategy: '先写出正确选项成立证据，再写出当前干扰项不成立证据，形成二次判别模板',
      next_practice_type: '同类干扰项对比训练',
      error_pattern: 'repeat_same_option',
      confidence_score: 0.88,
      history_hint: '系统检测到重复误选，建议优先做同知识点的相似干扰项训练。',
    };
  }
  if (keywordMissing) {
    return {
      why_wrong: '作答关键词不足，答案信息密度偏低',
      evidence: `你的答案为「${input.userAnswer || '未填写'}」，标准答案是「${input.correctAnswer || '无'}」`,
      fix_strategy: '按“关键词-结论-验证”三段式补全答案，再与标准答案逐项对齐',
      next_practice_type: '关键词回忆 + 结构化改写',
      error_pattern: 'keyword_missing',
      confidence_score: 0.83,
      history_hint: previousWrongStreak >= 2 ? `本题近期连续错误 ${previousWrongStreak} 次，先降速审题再作答。` : '本题建议优先提升答案完整度。',
    };
  }
  if (input.isChoice) {
    return {
      why_wrong: '选项辨析出现偏差，可能被干扰项诱导',
      evidence: `你选择「${input.userAnswer || '未选择'}${input.selectedOptionText ? `. ${input.selectedOptionText}` : ''}」，正确答案是「${input.correctAnswer || '无'}」`,
      fix_strategy: '先回看题干限定词，再逐项排除干扰选项，保留证据最充分的一项',
      next_practice_type: '重做原题 + 同类干扰项训练',
      error_pattern: 'knowledge_gap',
      confidence_score: 0.8,
      history_hint: previousWrongStreak >= 2 ? `本题已连续错 ${previousWrongStreak} 次，建议先复盘知识点再刷题。` : '当前更像单次辨析偏差，建议立即重做一次。',
    };
  }
  return {
    why_wrong: '答案与标准答案不一致，知识提取或表述存在偏差',
    evidence: `你的答案为「${input.userAnswer || '未填写'}」，标准答案是「${input.correctAnswer || '无'}」`,
    fix_strategy: '先拆解标准答案关键词，再按关键词重写一次完整作答',
    next_practice_type: '关键词回忆 + 二次作答',
    error_pattern: 'knowledge_gap',
    confidence_score: 0.78,
    history_hint: previousWrongStreak >= 2 ? `本题连续错误 ${previousWrongStreak} 次，建议改为分步作答。` : '建议先关键词对齐后再作答。',
  };
}

function formatNextReviewText(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const REVIEW_ACTION_META: Record<ReviewAction, { label: string; scheduleLabel: string; nextPracticeType: string; summary: string }> = {
  forgot: {
    label: '遗忘',
    scheduleLabel: '建议 1 天后复习',
    nextPracticeType: '明日重做 + 同类基础题',
    summary: '需要尽快回到该知识点，先稳住基础记忆。',
  },
  vague: {
    label: '模糊',
    scheduleLabel: '建议 2 天后复习',
    nextPracticeType: '2天后复习 + 同类辨析',
    summary: '已经有印象，但还需要一次巩固确认。',
  },
  mastered: {
    label: '完全掌握',
    scheduleLabel: '建议 4 天后复习',
    nextPracticeType: '4天后复习 + 变式迁移',
    summary: '当前题目已基本掌握，可以拉开复习间隔。',
  },
};

function inferSuggestedReviewAction(input: { hasCorrectAnswer: boolean; autoIsCorrect: boolean; recentAttempts: ReviewAttemptRecord[] }): ReviewAction {
  if (!input.hasCorrectAnswer) return 'vague';
  if (input.autoIsCorrect) return 'mastered';
  const wrongStreak = (input.recentAttempts || []).reduce((count, item) => {
    if (item.is_correct) return count;
    return count + 1;
  }, 0);
  return wrongStreak >= 2 ? 'forgot' : 'vague';
}

function parseDiagnosisFromModel(content: string): ReviewAttemptDiagnosis {
  const plain = content.replace(/```json|```/gi, '').trim();
  const jsonMatch = plain.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('诊断解析失败');
  }
  const parsed = JSON.parse(jsonMatch[0]);
  const why_wrong = String(parsed?.why_wrong || '').trim();
  const evidence = String(parsed?.evidence || '').trim();
  const fix_strategy = String(parsed?.fix_strategy || '').trim();
  const next_practice_type = String(parsed?.next_practice_type || '').trim();
  if (!why_wrong || !evidence || !fix_strategy || !next_practice_type) {
    throw new Error('诊断字段不完整');
  }
  const rawPattern = String(parsed?.error_pattern || '').trim();
  const error_pattern = (
    rawPattern === 'repeat_same_option' ||
    rawPattern === 'keyword_missing' ||
    rawPattern === 'knowledge_gap' ||
    rawPattern === 'careless' ||
    rawPattern === 'unknown'
  ) ? rawPattern : undefined;
  const confidence_score = Number.isFinite(Number(parsed?.confidence_score))
    ? Number(parsed?.confidence_score)
    : undefined;
  const history_hint = String(parsed?.history_hint || '').trim() || undefined;
  return {
    why_wrong,
    evidence,
    fix_strategy,
    next_practice_type,
    error_pattern,
    confidence_score,
    history_hint,
  };
}

type ReviewStateSeed = {
  proposal: ReturnType<typeof createLearningSessionProposal>;
  config: ReviewConfig;
  status: ReviewStatus;
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

function createDefaultReviewStateSeed(
  proposal: ReturnType<typeof createLearningSessionProposal>,
  config: ReviewConfig,
): ReviewStateSeed {
  return {
    proposal,
    config,
    status: 'ready',
    cards: [],
    currentIndex: 0,
    flipped: false,
    showDetails: false,
    userAnswer: '',
    lastScheduleText: '',
    sessionReviewed: 0,
    sessionCorrect: 0,
    sessionPlanUpdated: 0,
    sessionPatternCounts: {},
    plannerResult: null,
    reviewPage: 1,
    totalCount: 0,
    hasNextPage: false,
  };
}

function createReviewStateSeed(
  proposal: ReturnType<typeof createLearningSessionProposal>,
  config: ReviewConfig,
  snapshot: PersistedReviewTask | null,
): ReviewStateSeed {
  if (!snapshot || snapshot.status !== 'active' || snapshot.cards.length === 0) {
    return createDefaultReviewStateSeed(proposal, config);
  }
  return {
    proposal: snapshot.proposal,
    config: snapshot.config,
    status: snapshot.status,
    cards: snapshot.cards,
    currentIndex: Math.max(0, Math.min(snapshot.currentIndex, snapshot.cards.length - 1)),
    flipped: snapshot.flipped,
    showDetails: snapshot.showDetails,
    userAnswer: snapshot.userAnswer,
    lastScheduleText: snapshot.lastScheduleText,
    sessionReviewed: snapshot.sessionReviewed,
    sessionCorrect: snapshot.sessionCorrect,
    sessionPlanUpdated: snapshot.sessionPlanUpdated,
    sessionPatternCounts: snapshot.sessionPatternCounts,
    plannerResult: snapshot.plannerResult,
    reviewPage: snapshot.reviewPage,
    totalCount: snapshot.totalCount,
    hasNextPage: snapshot.hasNextPage,
  };
}

function buildPersistedReviewTask(input: {
  proposal: ReturnType<typeof createLearningSessionProposal>;
  config: ReviewConfig;
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
}): PersistedReviewTask {
  return {
    proposal: input.proposal,
    config: input.config,
    status: 'active',
    cards: input.cards,
    currentIndex: input.currentIndex,
    flipped: input.flipped,
    showDetails: input.showDetails,
    userAnswer: input.userAnswer,
    lastScheduleText: input.lastScheduleText,
    sessionReviewed: input.sessionReviewed,
    sessionCorrect: input.sessionCorrect,
    sessionPlanUpdated: input.sessionPlanUpdated,
    sessionPatternCounts: input.sessionPatternCounts,
    plannerResult: input.plannerResult,
    reviewPage: input.reviewPage,
    totalCount: input.totalCount,
    hasNextPage: input.hasNextPage,
  };
}

export function ReviewModePage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const location = useLocation();
  const state = (location.state || {}) as ReviewPresetState;
  const proposalState = useMemo(() => toReviewConfig(state, location.search), [location.search, state]);
  const proposalResolution = proposalState.proposalResolution;
  const proposalConfig = proposalState.config;
  const initialSeed = useMemo(
    () => createReviewStateSeed(proposalResolution.proposal, proposalConfig, readPersistedReviewTask()),
    [proposalConfig, proposalResolution.proposal],
  );

  const [proposal, setProposal] = useState(initialSeed.proposal);
  const [status, setStatus] = useState<ReviewStatus>(initialSeed.status);
  const [config, setConfig] = useState<ReviewConfig>(initialSeed.config);
  const [cards, setCards] = useState<Question[]>(initialSeed.cards);
  const [currentIndex, setCurrentIndex] = useState(initialSeed.currentIndex);
  const [flipped, setFlipped] = useState(initialSeed.flipped);
  const [showDetails, setShowDetails] = useState(initialSeed.showDetails);
  const [userAnswer, setUserAnswer] = useState(initialSeed.userAnswer);
  const [actionLoading, setActionLoading] = useState(false);
  const [lastScheduleText, setLastScheduleText] = useState(initialSeed.lastScheduleText);
  const [sessionReviewed, setSessionReviewed] = useState(initialSeed.sessionReviewed);
  const [sessionCorrect, setSessionCorrect] = useState(initialSeed.sessionCorrect);
  const [sessionPlanUpdated, setSessionPlanUpdated] = useState(initialSeed.sessionPlanUpdated);
  const [sessionPatternCounts, setSessionPatternCounts] = useState<Record<string, number>>(initialSeed.sessionPatternCounts);
  const [isExplanationExpanded, setIsExplanationExpanded] = useState(false);
  const [aiDiagnosis, setAiDiagnosis] = useState<ReviewAttemptDiagnosis | null>(null);
  const [aiExplanation, setAiExplanation] = useState('');
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisFallbackNotice, setDiagnosisFallbackNotice] = useState('');
  const [cachedExplanations, setCachedExplanations] = useState<Record<string, string>>({});
  const [plannerResult, setPlannerResult] = useState<ReviewPlannerRunResult | null>(initialSeed.plannerResult);
  const [autoStarted, setAutoStarted] = useState(initialSeed.status === 'active');
  const [reviewPage, setReviewPage] = useState(initialSeed.reviewPage);
  useEffect(() => {
    setIsExplanationExpanded(false);
  }, [currentIndex]);
  const [totalCount, setTotalCount] = useState(initialSeed.totalCount);
  const [hasNextPage, setHasNextPage] = useState(initialSeed.hasNextPage);
  const exitReviewRequestedRef = useRef(false);

  const configQuery = {
    subject: config.subject,
    onlyDue: config.scope === 'due',
    onlyUnmastered: config.scope === 'unmastered',
    onlyStubborn: config.scope === 'stubborn',
  };
  const totalCountQuery = useQuestionsCountQuery(configQuery, status !== 'active');
  const dueCountQuery = useQuestionsDueCountQuery(config.subject);
  const reviewChunksQuery = useReviewChunksQuery(config.subject, status === 'ready');
  useEffect(() => {
    setTotalCount(totalCountQuery.data || 0);
  }, [totalCountQuery.data]);
  const dueCount = dueCountQuery.data || 0;

  useEffect(() => {
    const nextSeed = createReviewStateSeed(proposalResolution.proposal, proposalConfig, readPersistedReviewTask());
    exitReviewRequestedRef.current = false;
    setProposal(nextSeed.proposal);
    setConfig(nextSeed.config);
    setStatus(nextSeed.status);
    setCards(nextSeed.cards);
    setCurrentIndex(nextSeed.currentIndex);
    setFlipped(nextSeed.flipped);
    setShowDetails(nextSeed.showDetails);
    setUserAnswer(nextSeed.userAnswer);
    setLastScheduleText(nextSeed.lastScheduleText);
    setSessionReviewed(nextSeed.sessionReviewed);
    setSessionCorrect(nextSeed.sessionCorrect);
    setSessionPlanUpdated(nextSeed.sessionPlanUpdated);
    setSessionPatternCounts(nextSeed.sessionPatternCounts);
    setAiDiagnosis(null);
    setAiExplanation('');
    setDiagnosisLoading(false);
    setDiagnosisFallbackNotice('');
    setPlannerResult(nextSeed.plannerResult);
    setReviewPage(nextSeed.reviewPage);
    setTotalCount(nextSeed.totalCount);
    setHasNextPage(nextSeed.hasNextPage);
    setAutoStarted(nextSeed.status === 'active');
  }, [proposalConfig, proposalResolution.proposal]);

  useEffect(() => {
    if (!proposalResolution.notice) return;
    toast.message(proposalResolution.notice);
  }, [proposalResolution.notice]);

  const current = cards[currentIndex];
  const fallbackPreview = current ? parseQuestionPreview(current.question_text) : null;
  const payload = current?.normalized_payload;
  const previewOptions = payload?.options?.length ? payload.options : (fallbackPreview?.options || []);
  const isChoice = Boolean(current && previewOptions.length > 0 && (payload?.questionType || fallbackPreview?.kind) === 'choice');
  const rawCorrectAnswer = isChoice
    ? (payload?.answerSchema?.correctAnswer || current?.correct_answer || '')
    : (current?.correct_answer || payload?.answerSchema?.correctAnswer || '');
  const correctAnswer = isChoice ? normalizeCorrectAnswer(rawCorrectAnswer, previewOptions) : rawCorrectAnswer;
  const acceptableAnswers = !isChoice
    ? (payload?.answerSchema?.acceptableAnswers?.length
      ? payload.answerSchema.acceptableAnswers
      : String(current?.correct_answer || '')
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean))
    : [];
  const canReveal = isChoice ? Boolean(userAnswer) : userAnswer.trim().length > 0;
  const selectedOptionText = isChoice ? (previewOptions.find((item) => item.label === userAnswer)?.text || '') : '';
  const autoIsCorrect = evaluateAnswerCorrectness({
    isChoice,
    userAnswer,
    correctAnswer,
    acceptableAnswers,
  });
  const recentAttemptsQuery = useRecentAttemptsQuery(current?.id, status === 'active', 6);
  const recentAttempts = recentAttemptsQuery.data || [];
  const ruleDiagnosis = buildReviewDiagnosis({
    isCorrect: autoIsCorrect,
    isChoice,
    userAnswer,
    correctAnswer,
    selectedOptionText,
    recentAttempts,
  });
  const liveDiagnosis = aiDiagnosis || ruleDiagnosis;
  const suggestedAction = inferSuggestedReviewAction({
    hasCorrectAnswer: Boolean(correctAnswer),
    autoIsCorrect,
    recentAttempts,
  });
  const sourceLabel = proposal.sourceSurface === 'copilot-draft' || proposal.sourceSurface === 'copilot-node'
    ? '来自 AI 管家建议'
    : proposal.returnPath.pathname === '/practice'
      ? '来自专项练习补弱'
      : proposal.sourceSurface === 'dashboard'
        ? '来自首页复习推荐'
        : proposal.objectiveCode === 'custom_scope'
          ? '自定义复习任务'
          : '系统复习任务';
  const planSummary = proposal.explanationSummary || proposal.sourceReason;
  const expectedGain = proposal.handoffContext.summary || proposal.nextStepHint.label || '完成本轮复习后获得下一步建议';
  const returnPathLabel = proposal.returnPath.label || '回到来源入口';
  const shouldSuggestPractice = sessionReviewed > 0 && (sessionCorrect / Math.max(sessionReviewed, 1) < 0.75 || Object.keys(sessionPatternCounts).length > 0);
  const submitAttemptMutation = useSubmitReviewAttemptMutation();

  useEffect(() => {
    if (!flipped || status !== 'active' || !current) {
      setAiDiagnosis(null);
      setAiExplanation('');
      setDiagnosisLoading(false);
      setDiagnosisFallbackNotice('');
      return;
    }
    
    if (current && cachedExplanations[current.id]) {
      setAiExplanation(cachedExplanations[current.id]);
      return;
    }

    if (current) {
      const fallbackText = current.explanation || current.note || '';
      setAiExplanation(fallbackText);
      setCachedExplanations(prev => ({ ...prev, [current.id]: fallbackText }));
    }
  }, [flipped, status, current?.id, current?.question_text, current?.subject, isChoice, correctAnswer, userAnswer, selectedOptionText, recentAttempts, autoIsCorrect]);

  const requestPlanCacheRebuild = async (silent = true) => {
    try {
      await questionsApi.triggerPlanCacheRebuild();
    } catch {
      if (!silent) {
        toast.error('计划缓存刷新失败，请稍后重试');
      }
    }
  };

  useEffect(() => {
    return () => {
      if (sessionPlanUpdated > 0) {
        void requestPlanCacheRebuild(true);
      }
    };
  }, [sessionPlanUpdated]);

  useEffect(() => {
    if (exitReviewRequestedRef.current) {
      return;
    }
    if (status === 'active' && cards.length > 0) {
      writePersistedReviewTask(buildPersistedReviewTask({
        proposal,
        config,
        cards,
        currentIndex,
        flipped,
        showDetails,
        userAnswer,
        lastScheduleText,
        sessionReviewed,
        sessionCorrect,
        sessionPlanUpdated,
        sessionPatternCounts,
        plannerResult,
        reviewPage,
        totalCount,
        hasNextPage,
      }));
      return;
    }
    if (status === 'completed' || status === 'ready' || status === 'configuring') {
      clearPersistedReviewTask();
    }
  }, [
    cards,
    config,
    currentIndex,
    flipped,
    hasNextPage,
    lastScheduleText,
    plannerResult,
    proposal,
    reviewPage,
    sessionCorrect,
    sessionPatternCounts,
    sessionPlanUpdated,
    sessionReviewed,
    showDetails,
    status,
    totalCount,
    userAnswer,
  ]);

  useEffect(() => {
    const flushPersistedTask = () => {
      if (exitReviewRequestedRef.current) return;
      if (status !== 'active' || cards.length === 0) return;
      writePersistedReviewTask(buildPersistedReviewTask({
        proposal,
        config,
        cards,
        currentIndex,
        flipped,
        showDetails,
        userAnswer,
        lastScheduleText,
        sessionReviewed,
        sessionCorrect,
        sessionPlanUpdated,
        sessionPatternCounts,
        plannerResult,
        reviewPage,
        totalCount,
        hasNextPage,
      }));
    };
    window.addEventListener('pagehide', flushPersistedTask);
    return () => {
      flushPersistedTask();
      window.removeEventListener('pagehide', flushPersistedTask);
    };
  }, [
    cards,
    config,
    currentIndex,
    flipped,
    hasNextPage,
    lastScheduleText,
    plannerResult,
    proposal,
    reviewPage,
    sessionCorrect,
    sessionPatternCounts,
    sessionPlanUpdated,
    sessionReviewed,
    showDetails,
    status,
    totalCount,
    userAnswer,
  ]);

  const startReview = async (targetPage = 1, chunkPreset?: ReviewChunkPreset) => {
    setStatus('loading');
    try {
      const safePage = Math.max(1, targetPage);
      const activeScope = chunkPreset?.scope || config.scope;
      const activeSortBy = chunkPreset?.sortBy || config.sortBy;
      const PAGE_SIZE = Math.max(1, chunkPreset?.amount || config.amount || 20);
      const offset = (safePage - 1) * PAGE_SIZE;
      const query = {
        subject: config.subject,
        onlyDue: activeScope === 'due',
        onlyUnmastered: activeScope === 'unmastered',
        onlyStubborn: activeScope === 'stubborn',
        sortBy: activeSortBy,
        limit: PAGE_SIZE,
        offset,
      };
      const [next, total] = await Promise.all([
        questionsApi.getAll(query),
        questionsApi.count(query),
      ]);
      let plannedQueue = next;
      let nextPlannerResult: ReviewPlannerRunResult | null = null;
      if (next.length > 0) {
        nextPlannerResult = await questionsApi.runReviewPlanner({
          subject: config.subject,
          scope: activeScope,
          budget_count: PAGE_SIZE,
          due_min_ratio: reviewAiDueMinRatio,
          page_number: safePage,
          rule_queue: next,
        });
        plannedQueue = nextPlannerResult.execution_queue.length > 0 ? nextPlannerResult.execution_queue : next;
        if (nextPlannerResult.plan_source === 'rule_fallback' && reviewAiFallbackEnabled) {
          console.info('Using rule fallback for review plan');
        }
      }

      if (safePage === 1) {
        setCards(plannedQueue.length > 0 ? plannedQueue : []);
        setCurrentIndex(0);
        setSessionReviewed(0);
        setSessionCorrect(0);
        setSessionPlanUpdated(0);
        setSessionPatternCounts({});
        setPlannerResult(nextPlannerResult);
      } else {
        if (plannedQueue.length === 0) {
          setHasNextPage(false);
          setStatus('completed');
          void requestPlanCacheRebuild(false);
          return;
        }
        const mergedLength = cards.length + plannedQueue.length;
        setCards(prev => [...prev, ...plannedQueue]);
        setCurrentIndex(Math.min(currentIndex + 1, mergedLength - 1));
        if (nextPlannerResult) {
          setPlannerResult(nextPlannerResult);
        }
      }
      
      setTotalCount(total);
      setHasNextPage(offset + plannedQueue.length < total);
      setReviewPage(safePage);
      if (chunkPreset) {
        setConfig((prev) => ({
          ...prev,
          amount: PAGE_SIZE,
          scope: activeScope,
          sortBy: activeSortBy,
        }));
      }
      setFlipped(false);
      setShowDetails(false);
      setUserAnswer('');
      setAiExplanation('');
      setLastScheduleText('');
      setStatus('active');
    } catch (error: any) {
      toast.error(error?.message || '开始复习失败');
      setStatus('ready');
    }
  };

  useEffect(() => {
    if (!state.autoStart || autoStarted || status !== 'ready') return;
    setAutoStarted(true);
    void startReview();
  }, [state.autoStart, autoStarted, status]);

  const handleAction = async (action: 'forgot' | 'vague' | 'mastered') => {
    if (!current) return;
    if (actionLoading) return;
    if (!flipped) return toast.error('请先作答并查看解析');
    if (!canReveal) return toast.error('请先作答');
    setActionLoading(true);
    try {
      const actionMeta = REVIEW_ACTION_META[action];
      const diagnosisForSubmit = {
        ...liveDiagnosis,
        why_wrong: aiExplanation || liveDiagnosis.why_wrong,
        next_practice_type: actionMeta.nextPracticeType,
      };
      const finalIsCorrect = action === 'mastered' ? true : action === 'forgot' ? false : (!correctAnswer ? false : autoIsCorrect);

      const applyActionResult = (nextDateText?: string) => {
        setLastScheduleText(nextDateText ? `已记录为「${actionMeta.label}」，${actionMeta.summary} 下次复习：${nextDateText}` : `已记录为「${actionMeta.label}」，${actionMeta.summary}`);
        setSessionReviewed((prev) => prev + 1);
        setSessionPlanUpdated((prev) => prev + 1);
        if (finalIsCorrect) {
          setSessionCorrect((prev) => prev + 1);
          return;
        }
        const patternKey = diagnosisForSubmit.error_pattern || 'unknown';
        setSessionPatternCounts((prev) => ({
          ...prev,
          [patternKey]: (prev[patternKey] || 0) + 1,
        }));
      };

      try {
        const result = await submitAttemptMutation.mutateAsync({
          questionId: current.id,
          userAnswer,
          selectedOptionText,
          correctAnswer,
          isCorrect: finalIsCorrect,
          rating: action,
          diagnosis: diagnosisForSubmit,
        });
        const nextText = formatNextReviewText(result.nextReviewDate || result.question?.next_review_date || current.next_review_date);
        applyActionResult(nextText);
        toast.success(nextText ? `已记录，下次复习 ${nextText}` : '已记录复习结果');
      } catch (submitError: any) {
        const fallbackAction = action === 'forgot' ? 'again' : action === 'mastered' ? 'easy' : 'hard';
        const fallbackQuestion = await questionsApi.swipeReview(current.id, fallbackAction);
        const nextText = formatNextReviewText(fallbackQuestion.next_review_date || current.next_review_date);
        applyActionResult(nextText);
        toast.success(nextText ? `提交已降级处理，下次复习 ${nextText}` : '提交已降级处理并记录');
      }
    } catch (error: any) {
      toast.error(error?.message || '提交失败，请重试');
      setActionLoading(false);
      return;
    }
    setActionLoading(false);
    if (currentIndex >= cards.length - 1) {
      if (hasNextPage) {
        void startReview(reviewPage + 1);
        return;
      } else {
        setStatus('completed');
        void requestPlanCacheRebuild(false);
        return;
      }
    }

    setCurrentIndex(prev => prev + 1);
    setFlipped(false);
    setShowDetails(false);
    setUserAnswer('');
    setLastScheduleText('');
  };

  const startTargetedPractice = () => {
    const topWeakNodes = Object.entries(sessionPatternCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => REVIEW_PATTERN_LABELS[key] || REVIEW_PATTERN_LABELS.unknown)
      .slice(0, 2);
    const practiceTarget = buildLearningSessionNavigation(createLearningSessionProposal({
      sessionKind: 'practice',
      sourceSurface: 'review-stats',
      sourceReason: '复习结束后建议立刻转专项补弱',
      objectiveCode: 'weakness_reinforce',
      explanationSummary: topWeakNodes.length > 0
        ? `针对 ${topWeakNodes.join('、')} 相关薄弱模式进行专项补强`
        : '根据本轮复习结果进入专项补弱',
      successCriteria: `完成 ${Math.max(8, Math.min(15, config.amount))} 题专项训练并验证薄弱点是否改善`,
      scope: {
        subject: config.subject,
        amount: Math.max(8, Math.min(15, config.amount)),
        nodes: cards.slice(0, 3).map((item) => item.knowledge_point).filter(Boolean),
        strategy: shouldSuggestPractice ? '攻坚' : '递进',
      },
      handoffContext: {
        sourceMode: 'review-result',
        summary: topWeakNodes.length > 0 ? `重点补强 ${topWeakNodes.join('、')}` : '根据复习结果补强薄弱点',
        activeNode: cards.find((item) => item.knowledge_point)?.knowledge_point || '',
        activeQuestionId: '',
      },
      returnPath: {
        pathname: '/review',
        search: location.search,
        label: '回到复习中心',
      },
      nextStepHint: {
        kind: 'copilot',
        label: '完成后回 AI 管家复盘',
        pathname: '/draft-review',
        search: '',
      },
    }));
    navigate(`${practiceTarget.pathname}${practiceTarget.search}`, { state: practiceTarget.state });
  };

  const continueReview = () => {
    setReviewPage(1);
    void startReview(1);
  };

  const goToCopilot = () => {
    navigate('/draft-review');
  };

  const goToReturnPath = () => {
    navigate({
      pathname: proposal.returnPath.pathname || '/',
      search: proposal.returnPath.search || '',
    });
  };

  const handleExit = async () => {
    const remainingCount = status === 'active' ? Math.max(0, cards.length - (currentIndex + 1)) : 0;
    if (remainingCount > 0) {
      const confirmed = await confirm({
        title: '确认退出复习',
        description: `当前还有 ${remainingCount} 题未完成。\n已完成的 ${sessionReviewed} 题会保留记录，未完成题目将不计入本轮。`,
        confirmText: '退出并返回复习中心',
        cancelText: '继续复习',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    exitReviewRequestedRef.current = true;
    clearPersistedReviewTask();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['questions'] }),
      queryClient.invalidateQueries({ queryKey: ['review'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.questionsDueCount(config.subject) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.questionsCount({ subject: config.subject }) }),
    ]);
    setCards([]);
    setCurrentIndex(0);
    setFlipped(false);
    setShowDetails(false);
    setUserAnswer('');
    setAiExplanation('');
    setLastScheduleText('');
    setPlannerResult(null);
    setStatus('ready');
  };

  const taskPackages = (reviewChunksQuery.data || []).map((chunk) => {
    const presetByKey: Record<ReviewChunkKey, Omit<ReviewChunkPreset, 'amount'>> = {
      due_rescue: { strategy: 'due_rescue', scope: 'due', sortBy: 'nearestDue' },
      stubborn_focus: { strategy: 'stubborn_focus', scope: 'stubborn', sortBy: 'lowestMastery' },
      unmastered_boost: { strategy: 'unmastered_boost', scope: 'unmastered', sortBy: 'latestWrong' },
    };
    return {
      ...chunk,
      preset: {
        ...presetByKey[chunk.key],
        amount: chunk.amount,
      },
    };
  });

  useEffect(() => {
    if (status !== 'active' || !flipped || actionLoading) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') {
        e.preventDefault();
        void handleAction('forgot');
      } else if (e.key === '2') {
        e.preventDefault();
        void handleAction('vague');
      } else if (e.key === '3') {
        e.preventDefault();
        void handleAction('mastered');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status, flipped, actionLoading]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-8 animate-in fade-in duration-700 zoom-in-95">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl animate-pulse scale-150" />
            <div className="relative bg-background p-4 rounded-full border border-primary/20 shadow-lg shadow-primary/10">
              <RefreshCw className="h-12 w-12 text-primary animate-[spin_3s_linear_infinite]" />
              <span className="text-xl drop-shadow-sm absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse">✨</span>
            </div>
          </div>
          <div className="space-y-2 text-center">
            <h3 className="text-lg font-bold text-foreground">正在生成本次复习计划</h3>
            <p className="text-sm text-muted-foreground font-medium tracking-wide">系统正在整理本轮目标、排序原因与待处理题目，请稍候...</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'active' && current) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="space-y-4 rounded-3xl border border-white/70 dark:border-slate-700/50 bg-white/88 dark:bg-slate-900/88 p-4 sm:p-5 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-300 bg-gradient-to-br from-violet-600/5 via-blue-600/5 to-cyan-500/5 dark:from-violet-900/10 dark:via-blue-900/10 dark:to-cyan-900/10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
              智能复习
            </h1>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-4 bg-white dark:bg-slate-800/80 px-5 py-2.5 rounded-2xl border border-border/50 shadow-sm">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Progress</span>
                <div className="flex items-center gap-1.5 max-w-[200px] overflow-hidden">
                  {cards.map((_, idx) => (
                    <div 
                      key={idx} 
                      className={`h-1.5 shrink-0 rounded-full transition-all duration-500 ease-out ${
                        idx < currentIndex 
                          ? 'w-4 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' 
                          : idx === currentIndex 
                            ? 'w-6 bg-primary shadow-[0_0_8px_rgba(245,158,11,0.4)] animate-pulse' 
                            : 'w-2 bg-slate-200 dark:bg-slate-700'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex items-baseline gap-0.5 ml-1 shrink-0">
                  <span className="text-base font-black text-foreground">{currentIndex + 1}</span>
                  <span className="text-xs font-bold text-muted-foreground/50">/ {cards.length}</span>
                </div>
              </div>
              
              {/* Mobile Progress */}
              <div className="sm:hidden flex items-center gap-2 bg-white dark:bg-slate-800/80 px-4 py-2 rounded-2xl border border-border/50 shadow-sm">
                <span className="text-primary animate-pulse">⏳</span>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm font-black text-foreground">{currentIndex + 1}</span>
                  <span className="text-xs font-bold text-muted-foreground/50">/ {cards.length}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleExit}
                className="flex items-center justify-center w-11 h-11 rounded-2xl bg-white dark:bg-slate-800/80 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-all shadow-sm border border-border/50 hover:border-rose-200 active:scale-95"
                title="退出复习"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
        
        <section className="rounded-3xl border border-white/70 dark:border-slate-700/50 bg-white/88 dark:bg-slate-900/88 p-6 md:p-10 min-h-[400px] flex flex-col shadow-[0_20px_50px_-28px_rgba(15,23,42,0.22)] dark:shadow-[0_20px_50px_-28px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-500 ease-in-out relative overflow-hidden group">
          <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-blue-300/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/4 h-32 w-32 rounded-full bg-indigo-300/10 blur-3xl" />
          
          <div className="flex-1 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500 relative z-10" key={current.id}>
            {/* Question Section - Always visible */}
            <div className="space-y-6">
              <div className="flex gap-2">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{current.subject}</span>
                <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">{current.category || current.knowledge_point}</span>
              </div>
              <div className="mt-4">
                <MistakeQuestionPreview
                  questionText={current.question_text}
                  normalizedPayload={current.normalized_payload}
                  validationStatus={current.validation_status}
                  stemClassName="text-xl font-medium text-foreground leading-relaxed"
                  optionClassName="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground"
                  maxOptions={8}
                  showKindBadge
                  hideOptions={isChoice} // Hide original preview options because we render clickable ones below
                />
              </div>
              
              {/* User Answer Section */}
              {isChoice ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {previewOptions.slice(0, 8).map((opt) => {
                    const active = userAnswer === opt.label;
                    const isCorrect = correctAnswer && (correctAnswer === opt.label);
                    const isWrong = active && !isCorrect && Boolean(correctAnswer);
                    const showCorrectness = flipped;
                    
                    let btnClass = `group/opt relative overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all duration-300 ${active ? 'border-primary bg-primary/5 text-primary shadow-sm scale-[1.02]' : 'border-border/60 bg-white dark:bg-slate-900 hover:border-primary/30 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.02)] hover:shadow-sm hover:-translate-y-0.5'}`;
                    
                    if (showCorrectness) {
                      if (isCorrect) {
                        btnClass = 'relative overflow-hidden rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 px-4 py-3 text-left shadow-sm scale-[1.02] transition-all duration-500';
                      } else if (isWrong) {
                        btnClass = 'relative overflow-hidden rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 px-4 py-3 text-left shadow-sm scale-[1.02] transition-all duration-500';
                      } else if (active && !correctAnswer) {
                        btnClass = 'relative overflow-hidden rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-4 py-3 text-left shadow-sm scale-[1.02] transition-all duration-500';
                      } else {
                        btnClass = 'relative overflow-hidden rounded-2xl border border-border/40 bg-slate-50/50 dark:bg-slate-800/20 text-slate-400 dark:text-slate-500 px-4 py-3 text-left opacity-50 transition-all duration-500';
                      }
                    }

                    return (
                      <button
                        key={`${opt.label}-${opt.text}`}
                        type="button"
                        disabled={flipped}
                        onClick={() => !flipped && setUserAnswer(opt.label)}
                        className={btnClass}
                      >
                        {!showCorrectness && active && (
                          <div className="absolute inset-0 bg-primary/10 animate-in fade-in zoom-in-50 duration-300 rounded-xl" />
                        )}
                        {showCorrectness && isCorrect && (
                          <div className="absolute inset-0 bg-emerald-100/50 animate-in fade-in duration-500" />
                        )}
                        {showCorrectness && isWrong && (
                          <div className="absolute inset-0 bg-rose-100/50 animate-in fade-in duration-500" />
                        )}
                        {showCorrectness && active && !correctAnswer && (
                          <div className="absolute inset-0 bg-amber-100/50 animate-in fade-in duration-500" />
                        )}
                        
                        <div className="relative z-10 flex items-center justify-between">
                          <div>
                            <span className={`font-bold mr-2 inline-block transition-transform duration-300 ${active && !showCorrectness ? 'scale-110 text-primary' : ''}`}>{opt.label}.</span>
                            <span className="break-words">{opt.text}</span>
                          </div>
                          {showCorrectness && isCorrect && <span className="text-emerald-500 text-lg animate-in zoom-in spin-in-12 duration-500 drop-shadow-sm">✅</span>}
                          {showCorrectness && isWrong && <span className="text-rose-500 text-lg animate-in zoom-in duration-300 drop-shadow-sm">❌</span>}
                          {showCorrectness && active && !correctAnswer && <span className="text-amber-500 text-lg animate-in zoom-in duration-300 drop-shadow-sm">❓</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  {!flipped ? (
                    <>
                      <label className="text-sm font-semibold text-foreground">你的答案</label>
                      <textarea
                        value={userAnswer}
                        onChange={(e) => setUserAnswer(e.target.value)}
                        placeholder="请输入你的答案（至少1个字符）"
                        className="min-h-[120px] w-full rounded-2xl border bg-white dark:bg-slate-900 p-4 text-sm leading-relaxed outline-none transition-all shadow-[0_2px_10px_-4px_rgba(0,0,0,0.02)] focus:shadow-sm border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 ring-primary/20 focus:border-primary"
                      />
                    </>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 animate-in fade-in slide-in-from-top-2 duration-500 mt-4">
                      <div className={`p-4 rounded-2xl border ${autoIsCorrect ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800'}`}>
                        <p className={`text-sm font-bold mb-2 flex items-center gap-1.5 ${autoIsCorrect ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          你的答案
                        </p>
                        <p className={`text-sm font-medium whitespace-pre-wrap leading-relaxed break-words ${autoIsCorrect ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}`}>
                          {userAnswer || '未作答'}
                        </p>
                      </div>
                      
                      <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-bold mb-2 flex items-center gap-1.5">
                          标准答案
                        </p>
                        <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium whitespace-pre-wrap leading-relaxed break-words">
                          {correctAnswer || '无'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Explanation Section - Only visible when flipped */}
              {flipped && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden transition-all duration-300">
                    <button 
                      type="button"
                      onClick={() => setIsExplanationExpanded(!isExplanationExpanded)}
                      className="flex w-full cursor-pointer items-center justify-between p-5 font-semibold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 outline-none focus:bg-slate-50 dark:focus:bg-slate-800/50"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-base drop-shadow-sm">✨</span>
                        查看解析与上次误区
                      </span>
                      <ChevronRight className={`h-5 w-5 transition-transform duration-300 text-slate-400 ${isExplanationExpanded ? 'rotate-90' : ''}`} />
                    </button>
                    {isExplanationExpanded && (
                      <div className="p-6 pt-2 border-t border-slate-100 dark:border-slate-800/50 space-y-6 animate-in slide-in-from-top-2 fade-in duration-300">
                        <div className="space-y-2">
                          <p className="text-sm font-black text-indigo-900 dark:text-indigo-300 flex items-center gap-2 mb-4">
                            解析
                          </p>
                          <div className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">{aiExplanation || '暂无解析'}</div>
                        </div>
                        {current.summary && (
                          <div className="rounded-2xl border border-rose-100 dark:border-rose-900/30 bg-rose-50/30 dark:bg-rose-950/10 p-4 space-y-2">
                            <p className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1 mb-2">
                              <AlertCircle className="h-3 w-3" />
                              上次误区
                            </p>
                            <p className="text-sm text-rose-700/80 dark:text-rose-300/80 leading-relaxed">{current.summary}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          
          <div className="mt-8 pt-6 border-t border-border/50 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 relative z-10">
            {lastScheduleText && (
              <p className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary animate-in fade-in shadow-sm">
                {lastScheduleText}
              </p>
            )}
            {!flipped ? (
              <button 
                type="button" 
                onClick={() => {
                  if (!canReveal) {
                    toast.error(isChoice ? '请先选择答案' : '请先输入答案');
                    return;
                  }
                  setFlipped(true);
                  if (!autoIsCorrect) {
                    setIsExplanationExpanded(true);
                  }
                }}
                disabled={!canReveal}
                className="group relative overflow-hidden w-full rounded-2xl bg-gradient-to-r from-primary to-indigo-600 px-4 py-4 text-lg font-black text-white hover:opacity-90 transition-all shadow-md disabled:opacity-50 disabled:shadow-none hover:scale-[1.01] active:scale-95"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                <span className="relative z-10 flex items-center justify-center gap-2 drop-shadow-sm">
                  <span className="text-lg">✨</span>
                  查看解析
                </span>
              </button>
            ) : (
              <div className="space-y-5 animate-in fade-in slide-in-from-bottom-8 duration-700">
                <p className="text-center text-xs font-black text-muted-foreground uppercase tracking-widest relative before:absolute before:top-1/2 before:left-4 before:w-[25%] before:h-[1px] before:bg-border/60 after:absolute after:top-1/2 after:right-4 after:w-[25%] after:h-[1px] after:bg-border/60">评估掌握情况</p>
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                    <button 
                      type="button" 
                      onClick={() => handleAction('forgot')} 
                      disabled={actionLoading}
                      className="group relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-3xl border border-rose-100 py-5 transition-all hover:-translate-y-1 hover:shadow-lg active:scale-95 disabled:opacity-60 disabled:hover:translate-y-0 bg-white hover:bg-rose-50 hover:border-rose-200 dark:bg-slate-900 dark:border-rose-900/30 dark:hover:bg-rose-950/30 text-rose-600 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.02)]"
                    >
                      <span className="absolute top-2 left-3 text-[10px] font-bold text-rose-400 bg-rose-50/50 dark:bg-rose-950/50 rounded px-1.5 py-0.5 group-hover:bg-white dark:group-hover:bg-rose-950 transition-all">1</span>
                      <span className="relative z-10 text-base font-bold flex items-center gap-1.5"><RotateCcw className="h-5 w-5" /> 遗忘</span>
                    </button>
                    <button 
                      type="button" 
                      onClick={() => handleAction('vague')} 
                      disabled={actionLoading}
                      className="group relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-3xl border border-amber-100 py-5 transition-all hover:-translate-y-1 hover:shadow-lg active:scale-95 disabled:opacity-60 disabled:hover:translate-y-0 bg-white hover:bg-amber-50 hover:border-amber-200 dark:bg-slate-900 dark:border-amber-900/30 dark:hover:bg-amber-950/30 text-amber-600 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.02)]"
                    >
                      <span className="absolute top-2 left-3 text-[10px] font-bold text-amber-400 bg-amber-50/50 dark:bg-amber-950/50 rounded px-1.5 py-0.5 group-hover:bg-white dark:group-hover:bg-amber-950 transition-all">2</span>
                      <span className="relative z-10 text-base font-bold flex items-center gap-1.5"><RefreshCw className="h-5 w-5" /> 模糊</span>
                    </button>
                    <button 
                      type="button" 
                      onClick={() => handleAction('mastered')} 
                      disabled={actionLoading}
                      className="group relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-3xl border border-emerald-100 py-5 transition-all hover:-translate-y-1 hover:shadow-lg active:scale-95 disabled:opacity-60 disabled:hover:translate-y-0 bg-white hover:bg-emerald-50 hover:border-emerald-200 dark:bg-slate-900 dark:border-emerald-900/30 dark:hover:bg-emerald-950/30 text-emerald-600 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.02)]"
                    >
                      <span className="absolute top-2 left-3 text-[10px] font-bold text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/50 rounded px-1.5 py-0.5 group-hover:bg-white dark:group-hover:bg-emerald-950 transition-all">3</span>
                      <span className="relative z-10 text-base font-bold flex items-center gap-1.5"><CheckCircle2 className="h-5 w-5" /> 完全掌握</span>
                    </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (status === 'completed' || (status === 'active' && cards.length === 0)) {
    const accuracy = sessionReviewed > 0 ? Math.round((sessionCorrect / sessionReviewed) * 100) : 0;
    const wrongTotal = Math.max(0, sessionReviewed - sessionCorrect);
    const patternRows = Object.entries(sessionPatternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key, count]) => ({
        key,
        label: REVIEW_PATTERN_LABELS[key] || REVIEW_PATTERN_LABELS.unknown,
        count,
        percent: wrongTotal > 0 ? Math.round((count / wrongTotal) * 100) : 0,
      }));
    return (
      <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-12 sm:px-6 animate-in fade-in zoom-in-95 duration-700">
        <div className="relative mx-auto w-32 h-32 mb-8">
          <div className="absolute inset-0 bg-primary/5 blur-3xl rounded-full scale-150 animate-pulse" />
          <div className="relative w-full h-full rounded-full bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center shadow-xl shadow-primary/5 border-4 border-background">
            <span className="text-[60px] drop-shadow-md animate-[bounce_2s_infinite]">🏆</span>
          </div>
        </div>
        <div className="space-y-3 animate-in slide-in-from-bottom-4 fade-in duration-500 delay-150">
          <h1 className="text-center text-4xl font-black text-foreground tracking-tight">今日复习达标！</h1>
          <p className="text-center text-lg text-muted-foreground">你已完成本轮复习，会话总结与下一步建议已生成。</p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">{sourceLabel}</span>
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-muted-foreground">{shouldSuggestPractice ? '建议转专项补弱' : '建议继续复习巩固'}</span>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="space-y-6">
            <div className="grid grid-cols-1 gap-4 rounded-3xl border border-border bg-card p-8 text-left sm:grid-cols-3 shadow-lg shadow-primary/5">
              <div className="flex flex-col items-center justify-center p-2 relative">
                <p className="text-sm font-medium text-muted-foreground mb-2">本次正确率</p>
                <p className="text-4xl font-black text-primary drop-shadow-sm">{accuracy}<span className="text-xl text-primary/70">%</span></p>
              </div>
              <div className="flex flex-col items-center justify-center p-2 border-t sm:border-t-0 sm:border-l border-border relative">
                <p className="text-sm font-medium text-muted-foreground mb-2">错误题数</p>
                <p className="text-4xl font-black text-rose-500 drop-shadow-sm">{Math.max(0, sessionReviewed - sessionCorrect)}</p>
              </div>
              <div className="flex flex-col items-center justify-center p-2 border-t sm:border-t-0 sm:border-l border-border relative">
                <p className="text-sm font-medium text-muted-foreground mb-2">已更新计划</p>
                <p className="text-4xl font-black text-emerald-500 drop-shadow-sm">{sessionPlanUpdated}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-border bg-card p-5 text-left shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">本轮收益</p>
                <p className="mt-3 text-sm leading-6 text-foreground">
                  {accuracy >= 80 ? '本轮复习稳定度较高，可以把更多精力放到迁移练习。' : '本轮已暴露需要重点盯防的知识点与错因模式。'}
                </p>
              </div>
              <div className="rounded-3xl border border-border bg-card p-5 text-left shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">主要弱点</p>
                <p className="mt-3 text-sm leading-6 text-foreground">
                  {patternRows.length > 0 ? `${patternRows[0].label} 最突出，建议优先围绕该模式补强。` : '当前没有明显集中错因，可以继续维持间隔复习节奏。'}
                </p>
              </div>
              <div className="rounded-3xl border border-border bg-card p-5 text-left shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">下一步判断</p>
                <p className="mt-3 text-sm leading-6 text-foreground">
                  {shouldSuggestPractice ? '建议立刻转专项补弱，把集中问题做成一轮任务。' : '建议继续复习巩固，把当前节奏保持住。'}
                </p>
              </div>
            </div>

            {patternRows.length > 0 ? (
              <section className="rounded-3xl border border-border bg-card p-8 text-left shadow-lg shadow-primary/5">
                <p className="text-lg font-bold text-foreground flex items-center gap-2 mb-6">
                  <span className="text-xl drop-shadow-sm">📊</span>
                  本次错因分布
                </p>
                <div className="space-y-5">
                  {patternRows.map((item, i) => (
                    <div key={`${item.key}-${item.count}`} className="animate-in slide-in-from-right-8 fade-in" style={{ animationDelay: `${500 + i * 150}ms`, animationFillMode: 'both' }}>
                      <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground font-medium">
                        <span className="text-foreground">{item.label}</span>
                        <span>{item.count}题 · <span className="opacity-70">{item.percent}%</span></span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-full rounded-full bg-primary transition-all duration-1000 ease-out" style={{ width: `${item.percent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </section>

          <aside className="space-y-4">
            <button type="button" onClick={startTargetedPractice} className="w-full flex items-center justify-between rounded-2xl bg-primary px-6 py-4 text-left font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-sm group">
              <span className="flex items-center gap-2"><span className="text-lg drop-shadow-sm">🚀</span> 一键转专项补弱</span>
              <ChevronRight className="h-5 w-5 opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
            </button>
            <button type="button" onClick={continueReview} className="w-full flex items-center gap-2 rounded-2xl border border-border bg-card px-6 py-4 text-left font-semibold text-foreground hover:bg-accent transition-all shadow-sm">
              <span className="text-lg drop-shadow-sm">▶️</span> 继续复习
            </button>
            <button type="button" onClick={goToCopilot} className="w-full flex items-center gap-2 rounded-2xl border border-border bg-card px-6 py-4 text-left font-semibold text-foreground hover:bg-accent transition-all shadow-sm">
              <span className="text-lg drop-shadow-sm">✨</span> 去 AI 管家复盘
            </button>
            <button type="button" onClick={goToReturnPath} className="w-full flex items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-4 text-left font-medium text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
              <ChevronLeft className="h-5 w-5" /> {returnPathLabel}
            </button>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 space-y-10 animate-in fade-in duration-500">
      <section className="group rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.22)] transition-all duration-300 hover:shadow-[0_30px_65px_-28px_rgba(15,23,42,0.32)] relative overflow-hidden mb-2">
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-1/4 h-32 w-32 rounded-full bg-orange-300/20 blur-3xl" />
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center">
              <span className="text-[40px] drop-shadow-md">✨</span>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">晚上好！今日状态极佳，建议优先消灭“遗忘题”。</h1>
              <div className="mt-2 flex items-center gap-3">
                <div className="inline-flex bg-slate-100/80 dark:bg-slate-800/80 p-1 rounded-xl backdrop-blur-sm">
                  <button
                    onClick={() => {
                      setConfig(prev => ({ ...prev, subject: '英语' }));
                      setReviewPage(1);
                    }}
                    className={`px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${config.subject === '英语' ? 'bg-white dark:bg-slate-700 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    英语
                  </button>
                  <button
                    onClick={() => {
                      setConfig(prev => ({ ...prev, subject: 'C语言' }));
                      setReviewPage(1);
                    }}
                    className={`px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${config.subject === 'C语言' ? 'bg-white dark:bg-slate-700 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    C语言
                  </button>
                </div>
                <span className="text-sm font-medium text-muted-foreground ml-2">{sourceLabel}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">待复习</p>
              <p className="mt-0.5 text-3xl font-black text-foreground tracking-tight">{dueCount}</p>
            </div>
            <div className="relative w-14 h-14 flex-shrink-0">
              <svg className="w-full h-full -rotate-90 transform drop-shadow-sm" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#f97316" />
                  </linearGradient>
                </defs>
                <circle className="text-slate-200 dark:text-slate-800 stroke-current" strokeWidth="12" cx="50" cy="50" r="40" fill="transparent"></circle>
                <circle stroke="url(#progress-gradient)" strokeWidth="12" strokeLinecap="round" cx="50" cy="50" r="40" fill="transparent" strokeDasharray="251.2" strokeDashoffset={251.2 - (251.2 * Math.min(100, Math.max(0, sessionReviewed > 0 ? (sessionReviewed / Math.max(1, sessionReviewed + dueCount)) * 100 : 0))) / 100}></circle>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] font-black text-foreground">{sessionReviewed > 0 ? Math.round((sessionReviewed / Math.max(1, sessionReviewed + dueCount)) * 100) : 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            AI 为你规划的分包任务
          </h2>
          {reviewChunksQuery.isFetching ? <span className="text-xs font-medium text-muted-foreground flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" /> 更新中...</span> : null}
        </div>
        {taskPackages.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {taskPackages.map((task) => {
              let icon = '▶️';
              let iconBgClass = 'bg-primary/10 text-primary';
              let cardBgClass = 'bg-card hover:bg-slate-50/50 dark:hover:bg-slate-900/50';
              
              if (task.key === 'due_rescue') {
                icon = '🔥';
                iconBgClass = 'bg-rose-100 dark:bg-rose-500/20 text-rose-500';
                cardBgClass = 'bg-gradient-to-br from-rose-50/60 to-card dark:from-rose-950/30 dark:to-card';
              } else if (task.key === 'stubborn_focus') {
                icon = '🎯';
                iconBgClass = 'bg-amber-100 dark:bg-amber-500/20 text-amber-500';
                cardBgClass = 'bg-gradient-to-br from-amber-50/60 to-card dark:from-amber-950/30 dark:to-card';
              } else if (task.key === 'unmastered_boost') {
                icon = '📈';
                iconBgClass = 'bg-teal-100 dark:bg-teal-500/20 text-teal-500';
                cardBgClass = 'bg-gradient-to-br from-teal-50/60 to-card dark:from-teal-950/30 dark:to-card';
              }

              return (
                <article key={task.key} className={`group rounded-3xl border border-border p-5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.1)] hover:-translate-y-1 hover:border-primary/20 relative overflow-hidden flex flex-col h-full ${cardBgClass}`}>
                  <div className="flex items-center justify-between relative z-10 mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg text-lg flex items-center justify-center ${iconBgClass}`}>
                        {icon}
                      </div>
                      <h3 className="text-base font-bold text-[#1A1A1A]">{task.label}</h3>
                    </div>
                    <span className="text-[13px] font-bold text-[#1A1A1A]">
                      {task.amount} 题
                    </span>
                  </div>
                  <p className="text-[13px] text-[#8C8C8C] leading-relaxed relative z-10 flex-1">{task.description}</p>
                  
                  <div className="mt-5 relative z-10">
                    <button
                      type="button"
                      onClick={() => { void startReview(1, task.preset); }}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#F4F5F8] dark:bg-muted text-[#1A1A1A] dark:text-foreground px-4 py-2.5 text-sm font-bold transition-all group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-md group-hover:shadow-primary/20 active:scale-95"
                    >
                      <span className="text-base drop-shadow-sm opacity-90 group-hover:opacity-100 transition-opacity">🚀</span> 
                      开始这组任务 
                      <ChevronLeft className="h-3.5 w-3.5 rotate-180 opacity-70 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm font-medium text-muted-foreground shadow-sm">
            <div className="mx-auto w-10 h-10 bg-slate-100 dark:bg-slate-800/50 rounded-full flex items-center justify-center mb-3">
              <span className="text-xl opacity-50 drop-shadow-sm">📌</span>
            </div>
            当前学科暂无可执行分包任务，试试切换学科或使用下方自定义复习。
          </div>
        )}
      </section>

      <section className="mt-4 pt-4 border-t border-border/50">
        <div className="rounded-xl border border-border bg-card p-2 sm:p-3 shadow-sm flex flex-col sm:flex-row items-center gap-3 transition-colors hover:bg-accent/50">
          <div className="flex items-center gap-2 px-2 border-r border-border/50">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-bold text-foreground">自定义</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 flex-1 px-2">
            <Select
              value={config.scope}
              onValueChange={(val: any) => setConfig(prev => ({ ...prev, scope: val as ReviewConfig['scope'] }))}
            >
              <SelectTrigger className="w-auto h-8 border-none bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-sm font-medium text-foreground shadow-none focus:ring-0 px-2 gap-1">
                <SelectValue placeholder="复习范围" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="due" className="rounded-lg py-2">到期优先</SelectItem>
                <SelectItem value="unmastered" className="rounded-lg py-2">未掌握优先</SelectItem>
                <SelectItem value="stubborn" className="rounded-lg py-2">顽固错题</SelectItem>
                <SelectItem value="all" className="rounded-lg py-2">全部错题</SelectItem>
              </SelectContent>
            </Select>

            <div className="w-px h-4 bg-border/50 hidden sm:block"></div>

            <Select
              value={config.sortBy}
              onValueChange={(val: any) => setConfig(prev => ({ ...prev, sortBy: val as ReviewConfig['sortBy'] }))}
            >
              <SelectTrigger className="w-auto h-8 border-none bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-sm font-medium text-foreground shadow-none focus:ring-0 px-2 gap-1">
                <SelectValue placeholder="排序方式" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="nearestDue" className="rounded-lg py-2">最近到期</SelectItem>
                <SelectItem value="latestWrong" className="rounded-lg py-2">最近做错</SelectItem>
                <SelectItem value="lowestMastery" className="rounded-lg py-2">最低掌握度</SelectItem>
              </SelectContent>
            </Select>
            
            <div className="w-px h-4 bg-border/50 hidden sm:block"></div>
            
            <div className="flex items-center gap-1.5 px-2">
               <span className="text-xs text-muted-foreground font-medium">每次抽取</span>
               <input 
                 type="number" 
                 className="w-12 h-7 text-center border border-border bg-background rounded-md text-sm font-bold text-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all" 
                 value={config.amount || 20} 
                 onChange={(e) => setConfig(prev => ({...prev, amount: Number(e.target.value) || 20}))} 
               />
               <span className="text-xs text-muted-foreground font-medium">题</span>
            </div>
          </div>

          <button
            onClick={() => { void startReview(1, { strategy: 'custom' }); }}
            className="w-full sm:w-auto h-9 px-5 bg-[#1A1A1A] dark:bg-primary dark:text-primary-foreground text-white rounded-lg text-sm font-bold shadow-sm hover:bg-black dark:hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2 flex-shrink-0"
          >
            <span className="text-base drop-shadow-sm">🚀</span>
            开始复习
          </button>
        </div>
      </section>
    </main>
  );
}
