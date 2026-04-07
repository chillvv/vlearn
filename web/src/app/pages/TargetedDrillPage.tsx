import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { practiceApi, questionsApi } from '../lib/api';
import type { Subject, VariantQuestion } from '../lib/types';
import { Dice5, Flame, Target, Sparkles, Clock, BookOpen, Calculator, BarChart3, X, Lightbulb, CheckCircle2, ChevronRight, ChevronUp, TrendingUp, RefreshCw, Rocket } from 'lucide-react';
import { Slider } from '../components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';
import { toast } from 'sonner';
import { normalizeCorrectAnswer } from '../lib/questionPayload';
import { formatQuestionTextForStorage } from '../lib/questionPreview';
import { normalizeQuestionTags } from '../lib/questionTagEngine';
import { useDashboardStatsQuery, useKnowledgeNodeMasteryQuery } from '../queries/questions';
import { useCreateQuestionMutation } from '../mutations/questions';
import { clearPersistedPracticeTask, readPersistedPracticeTask, writePersistedPracticeTask, type PersistedPracticeTask } from '../lib/activeLearningTask';
import { buildLearningSessionNavigation, createLearningSessionProposal, resolveLearningSessionProposal, type LearningSessionProposal, type LearningSessionRouteState } from '../lib/learningSession';

type DrillStatus = 'configuring' | 'loading' | 'partial' | 'active' | 'fallback' | 'completed';

type DrillConfig = {
  subject: Subject;
  nodes: string[];
  amount: number;
  strategy: '递进' | '随机' | '攻坚';
};

type PresetState = LearningSessionRouteState & {
  preset?: Partial<DrillConfig>;
};

type PracticeEntryMode = 'recommended' | 'custom';
type PracticeMissionId = 'weakness' | 'recent' | 'sprint' | 'custom';
type PracticeJudgeSource = 'server' | 'local';
type PracticeAttemptSummary = {
  node: string;
  isCorrect: boolean;
  judgeSource: PracticeJudgeSource;
};

type PracticeMission = {
  id: PracticeMissionId;
  title: string;
  badge: string;
  description: string;
  reason: string;
  objective: string;
  successCriteria: string;
  nodes: string[];
  amount: number;
  strategy: DrillConfig['strategy'];
};

const NODE_UI_PAGE_SIZE = 18;
const PRACTICE_AI_PROMPT_VERSION = 'targeted_drill_v3';
const toDrillConfig = (state: PresetState, search: string) => {
  const proposalResolution = resolveLearningSessionProposal({
    sessionKind: 'practice',
    search,
    state,
    fallbackSourceSurface: 'manual',
  });
  return {
    proposalResolution,
    config: {
      subject: proposalResolution.proposal.scope.subject,
      nodes: proposalResolution.proposal.scope.nodes,
      amount: proposalResolution.proposal.scope.amount,
      strategy: proposalResolution.proposal.scope.strategy,
    } satisfies DrillConfig,
  };
};

const normalizeAnswerText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const inferChoiceAnswer = (value: string) => {
  const match = value.match(/答案\s*[:：]?\s*([A-H])/i);
  return match?.[1]?.toUpperCase() || '';
};

const normalizeOptionText = (value: unknown, idx: number) => {
  if (typeof value === 'string') {
    const text = value.trim().replace(/^[A-H][\.．、:：\)）\]]\s*/i, '').trim();
    return text ? `${String.fromCharCode(65 + idx)}. ${text}` : '';
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const textValue = typeof record.text === 'string' ? record.text.trim() : '';
    if (textValue) return `${String.fromCharCode(65 + idx)}. ${textValue}`;
    const pair = Object.entries(record).find(([, item]) => typeof item === 'string' && String(item).trim().length > 0);
    if (pair) return `${String.fromCharCode(65 + idx)}. ${String(pair[1]).trim()}`;
  }
  const fallback = String(value ?? '').trim();
  if (!fallback) return '';
  const text = fallback.replace(/^[A-H][\.．、:：\)）\]]\s*/i, '').trim();
  return `${String.fromCharCode(65 + idx)}. ${text || fallback}`;
};

const dedupeNodes = (values: string[]) => Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));

const deriveEntryMode = (proposal: LearningSessionProposal): PracticeEntryMode => (
  proposal.objectiveCode === 'custom_scope' && proposal.sourceSurface === 'manual' ? 'custom' : 'recommended'
);

const deriveMissionId = (proposal: LearningSessionProposal): PracticeMissionId => {
  if (proposal.objectiveCode === 'sprint_drill') return 'sprint';
  if (proposal.objectiveCode === 'custom_scope' && proposal.sourceSurface === 'manual') return 'custom';
  if (/近期|最近|recent/i.test(proposal.sourceReason) || /近期|最近|recent/i.test(proposal.explanationSummary)) return 'recent';
  return 'weakness';
};

type PracticeStateSeed = {
  proposal: LearningSessionProposal;
  config: DrillConfig;
  status: DrillStatus;
  entryMode: PracticeEntryMode;
  selectedMissionId: PracticeMissionId;
  showAdvanced: boolean;
  questions: VariantQuestion[];
  currentIdx: number;
  selectedOption: string;
  correctCount: number;
  attemptSummaries: PracticeAttemptSummary[];
  timeElapsed: number;
  isExplanationOpen: boolean;
  showAiHint: boolean;
  isAnswerSubmitted: boolean;
  autoStarted: boolean;
  practiceSessionId: string | null;
  questionStartedAt: number;
  generationFallbackNotice: string;
  judgeFallbackNotice: string;
  judgeSource: PracticeJudgeSource;
  targetAmount: number;
};

function createDefaultPracticeStateSeed(proposal: LearningSessionProposal, config: DrillConfig): PracticeStateSeed {
  return {
    proposal,
    config,
    status: 'configuring',
    entryMode: deriveEntryMode(proposal),
    selectedMissionId: deriveMissionId(proposal),
    showAdvanced: deriveEntryMode(proposal) === 'custom',
    questions: [],
    currentIdx: 0,
    selectedOption: '',
    correctCount: 0,
    attemptSummaries: [],
    timeElapsed: 0,
    isExplanationOpen: false,
    showAiHint: false,
    isAnswerSubmitted: false,
    autoStarted: false,
    practiceSessionId: null,
    questionStartedAt: Date.now(),
    generationFallbackNotice: '',
    judgeFallbackNotice: '',
    judgeSource: 'server',
    targetAmount: config.amount,
  };
}

function createPracticeStateSeed(
  proposal: LearningSessionProposal,
  config: DrillConfig,
  snapshot: PersistedPracticeTask | null,
): PracticeStateSeed {
  if (!snapshot || snapshot.questions.length === 0) {
    return createDefaultPracticeStateSeed(proposal, config);
  }
  return {
    proposal: snapshot.proposal,
    config: snapshot.config,
    status: snapshot.status,
    entryMode: snapshot.entryMode,
    selectedMissionId: snapshot.selectedMissionId,
    showAdvanced: snapshot.showAdvanced,
    questions: snapshot.questions,
    currentIdx: Math.max(0, Math.min(snapshot.currentIdx, snapshot.questions.length - 1)),
    selectedOption: snapshot.selectedOption,
    correctCount: snapshot.correctCount,
    attemptSummaries: snapshot.attemptSummaries,
    timeElapsed: snapshot.timeElapsed,
    isExplanationOpen: snapshot.isExplanationOpen,
    showAiHint: snapshot.showAiHint,
    isAnswerSubmitted: snapshot.isAnswerSubmitted,
    autoStarted: true,
    practiceSessionId: snapshot.practiceSessionId,
    questionStartedAt: snapshot.questionStartedAt || Date.now(),
    generationFallbackNotice: snapshot.generationFallbackNotice,
    judgeFallbackNotice: snapshot.judgeFallbackNotice,
    judgeSource: snapshot.judgeSource,
    targetAmount: snapshot.targetAmount,
  };
}

function buildPersistedPracticeTask(input: {
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
}): PersistedPracticeTask {
  return {
    proposal: input.proposal,
    config: input.config,
    entryMode: input.entryMode,
    selectedMissionId: input.selectedMissionId,
    showAdvanced: input.showAdvanced,
    status: input.status,
    questions: input.questions,
    currentIdx: input.currentIdx,
    selectedOption: input.selectedOption,
    correctCount: input.correctCount,
    attemptSummaries: input.attemptSummaries,
    timeElapsed: input.timeElapsed,
    isExplanationOpen: input.isExplanationOpen,
    showAiHint: input.showAiHint,
    isAnswerSubmitted: input.isAnswerSubmitted,
    practiceSessionId: input.practiceSessionId,
    questionStartedAt: input.questionStartedAt,
    generationFallbackNotice: input.generationFallbackNotice,
    judgeFallbackNotice: input.judgeFallbackNotice,
    judgeSource: input.judgeSource,
    targetAmount: input.targetAmount,
  };
}

export function TargetedDrillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as PresetState;
  const proposalState = useMemo(() => toDrillConfig(state, location.search), [location.search, state]);
  const proposalResolution = proposalState.proposalResolution;
  const proposalConfig = proposalState.config;
  const initialSeed = useMemo(
    () => createPracticeStateSeed(proposalResolution.proposal, proposalConfig, readPersistedPracticeTask()),
    [proposalConfig, proposalResolution.proposal],
  );

  const [proposal, setProposal] = useState(initialSeed.proposal);
  const [status, setStatus] = useState<DrillStatus>(initialSeed.status);
  const [allNodes, setAllNodes] = useState<{name: string, mastery: number}[]>([]);
  const [config, setConfig] = useState<DrillConfig>(initialSeed.config);
  const [entryMode, setEntryMode] = useState<PracticeEntryMode>(initialSeed.entryMode);
  const [selectedMissionId, setSelectedMissionId] = useState<PracticeMissionId>(initialSeed.selectedMissionId);
  const [showAdvanced, setShowAdvanced] = useState(initialSeed.showAdvanced);
  const [questions, setQuestions] = useState<VariantQuestion[]>(initialSeed.questions);
  const [currentIdx, setCurrentIdx] = useState(initialSeed.currentIdx);
  const [selectedOption, setSelectedOption] = useState<string>(initialSeed.selectedOption);
  const [correctCount, setCorrectCount] = useState(initialSeed.correctCount);
  const [attemptSummaries, setAttemptSummaries] = useState<PracticeAttemptSummary[]>(initialSeed.attemptSummaries);
  const [timeElapsed, setTimeElapsed] = useState(initialSeed.timeElapsed);
  const [isExplanationOpen, setIsExplanationOpen] = useState(initialSeed.isExplanationOpen);
  const [showAiHint, setShowAiHint] = useState(initialSeed.showAiHint);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(initialSeed.isAnswerSubmitted);
  const [autoStarted, setAutoStarted] = useState(initialSeed.autoStarted);
  const [confirmExit, setConfirmExit] = useState(false);
  const [practiceSessionId, setPracticeSessionId] = useState<string | null>(initialSeed.practiceSessionId);
  const [questionStartedAt, setQuestionStartedAt] = useState<number>(initialSeed.questionStartedAt);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);
  const [generationFallbackNotice, setGenerationFallbackNotice] = useState(initialSeed.generationFallbackNotice);
  const [judgeFallbackNotice, setJudgeFallbackNotice] = useState(initialSeed.judgeFallbackNotice);
  const [judgeSource, setJudgeSource] = useState<PracticeJudgeSource>(initialSeed.judgeSource);
  const [targetAmount, setTargetAmount] = useState(initialSeed.targetAmount);
  const [nodeLoadMs, setNodeLoadMs] = useState(0);
  const [nodeLoadedPages, setNodeLoadedPages] = useState(0);
  const [nodeUiPage, setNodeUiPage] = useState(1);
  const [cachedExplanations, setCachedExplanations] = useState<Record<string, string>>({});
  const [aiExplanation, setAiExplanation] = useState('');
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisFallbackNotice, setDiagnosisFallbackNotice] = useState('');
  const savedWrongKeysRef = useRef<Set<string>>(new Set());
  const generationRunRef = useRef(0);
  const practiceStatsQuery = useDashboardStatsQuery();
  const nodeMasteryQuery = useKnowledgeNodeMasteryQuery(config.subject, true);
  const createQuestionMutation = useCreateQuestionMutation();

  const currentQuestion = questions[currentIdx];
  const normalizedOptions = useMemo(
    () => (Array.isArray(currentQuestion?.options) ? currentQuestion.options : [])
      .map((item, idx) => normalizeOptionText(item, idx))
      .filter((item) => item.length > 0),
    [currentQuestion],
  );
  const effectiveCorrectAnswer = useMemo(() => {
    if (!currentQuestion) return '';
    const inferred = inferChoiceAnswer(currentQuestion.explanation || '');
    const raw = inferred || currentQuestion.correct_answer || '';
    const options = normalizedOptions.map((item, idx) => ({
      label: String.fromCharCode(65 + idx),
      text: item.replace(/^[A-H]\.\s*/, ''),
    }));
    return normalizeCorrectAnswer(raw, options);
  }, [currentQuestion, normalizedOptions]);

  const isChoice = Boolean(currentQuestion && (currentQuestion.question_type === 'choice' || normalizedOptions.length > 1));

  const autoIsCorrect = useMemo(() => {
    if (!currentQuestion || !isAnswerSubmitted) return false;
    const summary = attemptSummaries[currentIdx];
    if (summary) return summary.isCorrect;
    
    const answer = normalizeAnswerText(selectedOption);
    const normalizedCorrect = normalizeAnswerText(currentQuestion.correct_answer || '');
    const acceptable = (currentQuestion.acceptable_answers || []).map((item) => normalizeAnswerText(item));
    
    return isChoice
      ? selectedOption === effectiveCorrectAnswer
      : (answer.length > 0 && (answer === normalizedCorrect || acceptable.includes(answer)));
  }, [currentQuestion, isAnswerSubmitted, attemptSummaries, currentIdx, isChoice, selectedOption, effectiveCorrectAnswer]);

  const resetDrillState = () => {
    setQuestions([]);
    setCurrentIdx(0);
    setSelectedOption('');
    setCorrectCount(0);
    setAttemptSummaries([]);
    setTimeElapsed(0);
    setIsAnswerSubmitted(false);
    setIsExplanationOpen(false);
    setShowAiHint(false);
    setPracticeSessionId(null);
    setQuestionStartedAt(Date.now());
    setIsSubmitting(false);
    setIsGeneratingMore(false);
    setGenerationFallbackNotice('');
    setJudgeFallbackNotice('');
    setJudgeSource('server');
    setTargetAmount(proposalConfig.amount);
    setConfirmExit(false);
    setAiExplanation('');
    setDiagnosisLoading(false);
    setDiagnosisFallbackNotice('');
    savedWrongKeysRef.current.clear();
  };

  useEffect(() => {
    if (!proposalResolution.notice) return;
    toast.message(proposalResolution.notice);
  }, [proposalResolution.notice]);

  useEffect(() => {
    let timer: any;
    if (status === 'active' || status === 'partial' || status === 'fallback') {
      timer = setInterval(() => setTimeElapsed(t => t + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleExit = () => {
    generationRunRef.current += 1;
    if (practiceSessionId) {
      void practiceApi.abandonSession(practiceSessionId).catch(() => {});
    }
    clearPersistedPracticeTask();
    setStatus('configuring');
    resetDrillState();
  };

  useEffect(() => {
    if (nodeMasteryQuery.isLoading) return;
    if (nodeMasteryQuery.error) {
      toast.error((nodeMasteryQuery.error as any)?.message || '加载错题知识点失败');
      setAllNodes([]);
      setNodeLoadedPages(0);
      setNodeLoadMs(0);
      return;
    }
    const nodesWithMastery = nodeMasteryQuery.data || [];
    setAllNodes(nodesWithMastery);
    setNodeLoadedPages(1);
    setNodeLoadMs(nodeMasteryQuery.dataUpdatedAt ? Math.max(0, Date.now() - nodeMasteryQuery.dataUpdatedAt) : 0);
    setNodeUiPage(1);
    if (config.nodes.length === 0 && nodesWithMastery.length > 0) {
      setConfig((prev) => ({ ...prev, nodes: [nodesWithMastery[0].name] }));
    }
  }, [config.nodes.length, nodeMasteryQuery.data, nodeMasteryQuery.dataUpdatedAt, nodeMasteryQuery.error, nodeMasteryQuery.isLoading]);

  useEffect(() => {
    const nextSeed = createPracticeStateSeed(proposalResolution.proposal, proposalConfig, readPersistedPracticeTask());
    setProposal(nextSeed.proposal);
    setConfig(nextSeed.config);
    setTargetAmount(nextSeed.targetAmount);
    setEntryMode(nextSeed.entryMode);
    setSelectedMissionId(nextSeed.selectedMissionId);
    setShowAdvanced(nextSeed.showAdvanced);
    setQuestions(nextSeed.questions);
    setCurrentIdx(nextSeed.currentIdx);
    setSelectedOption(nextSeed.selectedOption);
    setCorrectCount(nextSeed.correctCount);
    setAttemptSummaries(nextSeed.attemptSummaries);
    setTimeElapsed(nextSeed.timeElapsed);
    setIsExplanationOpen(nextSeed.isExplanationOpen);
    setShowAiHint(nextSeed.showAiHint);
    setIsAnswerSubmitted(nextSeed.isAnswerSubmitted);
    setPracticeSessionId(nextSeed.practiceSessionId);
    setQuestionStartedAt(nextSeed.questionStartedAt);
    setGenerationFallbackNotice(nextSeed.generationFallbackNotice);
    setJudgeFallbackNotice(nextSeed.judgeFallbackNotice);
    setJudgeSource(nextSeed.judgeSource);
    setStatus(nextSeed.status);
    setAutoStarted(nextSeed.autoStarted);
    setConfirmExit(false);
  }, [proposalConfig, proposalResolution.proposal]);

  useEffect(() => {
    if (isAnswerSubmitted && !isChoice && (!autoIsCorrect || !effectiveCorrectAnswer)) {
      const diagnosisText = currentQuestion.explanation || '';
      if (diagnosisText && !aiExplanation) {
        setAiExplanation(diagnosisText);
        setCachedExplanations(prev => ({ ...prev, [currentQuestion.id]: diagnosisText }));
      } else if (!diagnosisText && !diagnosisLoading && !aiExplanation && !cachedExplanations[currentQuestion.id]) {
        setDiagnosisLoading(true);
        const prompt = `请用一段简短、高效的分析（不超过150字），告诉我为什么做错，以及正确的解题关键是什么。不要废话，不要排版太多结构。
题目信息：
学科：${config.subject || '未知'}
题目内容：${currentQuestion.question_text || ''}
我的答案：${selectedOption || ''}
标准答案：${effectiveCorrectAnswer || ''}`;

        let alive = true;
        let fullContent = '';
        
        const run = async () => {
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('timeout')), 30000);
              chatApi.streamChat(
                [{ role: 'user', content: prompt }],
                () => {},
                (content) => {
                  clearTimeout(timer);
                  fullContent = content;
                  if (alive) {
                    setAiExplanation(content);
                    setCachedExplanations(prev => ({ ...prev, [currentQuestion.id]: content }));
                  }
                  resolve();
                },
                (error) => {
                  clearTimeout(timer);
                  reject(new Error(error));
                },
                {
                  systemPrompt: '你是专业的AI学习管家，请用极其精简、一针见血的语言帮学生解析错题。',
                },
              );
            });
            if (alive) {
              setDiagnosisFallbackNotice('');
            }
          } catch (err: any) {
            if (alive) {
              setDiagnosisFallbackNotice('AI解析生成失败，请稍后重试。');
            }
          } finally {
            if (alive) {
              setDiagnosisLoading(false);
            }
          }
        };
        void run();
        return () => { alive = false; };
      }
    }
  }, [isAnswerSubmitted, isChoice, autoIsCorrect, effectiveCorrectAnswer, currentQuestion?.explanation, aiExplanation, currentQuestion?.id, cachedExplanations, config.subject, currentQuestion?.question_text, selectedOption]);

  useEffect(() => {
    if (status === 'active' || status === 'partial' || status === 'fallback') {
      writePersistedPracticeTask(buildPersistedPracticeTask({
        proposal,
        config,
        entryMode,
        selectedMissionId,
        showAdvanced,
        status,
        questions,
        currentIdx,
        selectedOption,
        correctCount,
        attemptSummaries,
        timeElapsed,
        isExplanationOpen,
        showAiHint,
        isAnswerSubmitted,
        practiceSessionId,
        questionStartedAt,
        generationFallbackNotice,
        judgeFallbackNotice,
        judgeSource,
        targetAmount,
      }));
      return;
    }
    if (status === 'completed' || status === 'configuring') {
      clearPersistedPracticeTask();
    }
  }, [
    attemptSummaries,
    config,
    correctCount,
    currentIdx,
    entryMode,
    generationFallbackNotice,
    isAnswerSubmitted,
    isExplanationOpen,
    judgeFallbackNotice,
    judgeSource,
    practiceSessionId,
    proposal,
    questionStartedAt,
    questions,
    selectedMissionId,
    selectedOption,
    showAdvanced,
    showAiHint,
    status,
    targetAmount,
    timeElapsed,
  ]);

  useEffect(() => {
    const flushPersistedTask = () => {
      if ((status !== 'active' && status !== 'partial' && status !== 'fallback') || questions.length === 0) return;
      writePersistedPracticeTask(buildPersistedPracticeTask({
        proposal,
        config,
        entryMode,
        selectedMissionId,
        showAdvanced,
        status,
        questions,
        currentIdx,
        selectedOption,
        correctCount,
        attemptSummaries,
        timeElapsed,
        isExplanationOpen,
        showAiHint,
        isAnswerSubmitted,
        practiceSessionId,
        questionStartedAt,
        generationFallbackNotice,
        judgeFallbackNotice,
        judgeSource,
        targetAmount,
      }));
    };
    window.addEventListener('pagehide', flushPersistedTask);
    return () => {
      flushPersistedTask();
      window.removeEventListener('pagehide', flushPersistedTask);
    };
  }, [
    attemptSummaries,
    config,
    correctCount,
    currentIdx,
    entryMode,
    generationFallbackNotice,
    isAnswerSubmitted,
    isExplanationOpen,
    judgeFallbackNotice,
    judgeSource,
    practiceSessionId,
    proposal,
    questionStartedAt,
    questions,
    selectedMissionId,
    selectedOption,
    showAdvanced,
    showAiHint,
    status,
    targetAmount,
    timeElapsed,
  ]);

  const sourceLabel = useMemo(() => {
    if (proposal.returnPath.pathname === '/review') return '来自复习补弱';
    if (proposal.sourceSurface === 'copilot-draft' || proposal.sourceSurface === 'copilot-node') return '来自 AI 管家建议';
    if (proposal.sourceSurface === 'dashboard') return '来自首页推荐';
    if (proposal.sourceSurface === 'mistake-book' || proposal.sourceSurface === 'mistake-node-hub') return '来自错题洞察';
    if (proposal.objectiveCode === 'custom_scope') return '自定义任务';
    return '系统推荐任务';
  }, [proposal]);
  const practiceStats = practiceStatsQuery.data;
  const recentNodes = useMemo(
    () => dedupeNodes((practiceStats?.recent || []).filter((item) => item.subject === config.subject).map((item) => item.knowledge_point)).slice(0, 3),
    [config.subject, practiceStats?.recent],
  );
  const recommendedNodes = useMemo(
    () => dedupeNodes([
      ...proposal.scope.nodes,
      ...(proposal.returnPath.pathname === '/review' ? [proposal.handoffContext.activeNode] : []),
      ...(practiceStats?.topWeakness?.knowledge_point && practiceStats.topWeakness.knowledge_point ? [practiceStats.topWeakness.knowledge_point] : []),
      ...allNodes.slice(0, 3).map((item) => item.name),
    ]).slice(0, 3),
    [allNodes, practiceStats?.topWeakness?.knowledge_point, proposal.handoffContext.activeNode, proposal.returnPath.pathname, proposal.scope.nodes],
  );
  const sprintNodes = useMemo(
    () => dedupeNodes([...allNodes.slice(0, 4).map((item) => item.name), ...recentNodes]).slice(0, 4),
    [allNodes, recentNodes],
  );
  const missionCards = useMemo<PracticeMission[]>(() => ([
    {
      id: 'weakness',
      title: proposal.returnPath.pathname === '/review' ? '复习补弱强化' : '补薄弱点',
      badge: proposal.returnPath.pathname === '/review' ? 'Review Follow-up' : 'Recommended',
      description: recommendedNodes.length > 0 ? `围绕 ${recommendedNodes.join('、')} 做一轮重点突破。` : '先集中处理当前最需要补强的薄弱点。',
      reason: proposal.returnPath.pathname === '/review'
        ? '上一轮复习暴露了集中弱点，适合立即转入专项补强。'
        : proposal.explanationSummary || proposal.sourceReason,
      objective: proposal.returnPath.pathname === '/review' ? '清理复习中暴露的连续失分点' : '优先补齐当前最明显的知识点短板',
      successCriteria: `完成 ${Math.max(proposal.scope.amount, 10)} 题，并让薄弱点形成可复述的做题套路`,
      nodes: recommendedNodes,
      amount: Math.max(proposal.scope.amount, 10),
      strategy: proposal.scope.strategy === '随机' ? '攻坚' : proposal.scope.strategy,
    },
    {
      id: 'recent',
      title: '近期错题强化',
      badge: 'Recent',
      description: recentNodes.length > 0 ? `把最近反复出错的 ${recentNodes.join('、')} 再练一轮。` : '优先回看最近错过的题型与关联知识点。',
      reason: recentNodes.length > 0 ? '最近错题最容易遗忘，适合趁热强化。' : '系统准备从最近错题中抽取同类训练。',
      objective: '快速重做近期高风险知识点，打断连续错误',
      successCriteria: `完成 ${Math.max(5, Math.min(15, proposal.scope.amount))} 题，并能说明自己错在什么地方`,
      nodes: recentNodes.length > 0 ? recentNodes : recommendedNodes,
      amount: Math.max(5, Math.min(15, proposal.scope.amount)),
      strategy: '递进',
    },
    {
      id: 'sprint',
      title: '冲刺训练',
      badge: 'Sprint',
      description: sprintNodes.length > 0 ? `混合 ${sprintNodes.join('、')} 做一轮快节奏冲刺。` : '用更高密度的练习快速激活知识点。',
      reason: '适合在考前或刷题状态较好时做一轮高密度训练。',
      objective: '在有限时间内覆盖更多高频弱点与常见变式',
      successCriteria: `完成 ${Math.max(15, proposal.scope.amount)} 题，并保持稳定节奏`,
      nodes: sprintNodes.length > 0 ? sprintNodes : recommendedNodes,
      amount: Math.max(15, proposal.scope.amount),
      strategy: '随机',
    },
    {
      id: 'custom',
      title: '自定义任务',
      badge: 'Custom',
      description: '自己决定知识点、题量与训练策略。',
      reason: '需要精确控制范围时，手动配置更适合。',
      objective: '按自己的节奏组织一轮练习任务',
      successCriteria: `完成你设定的 ${config.amount} 题目标`,
      nodes: config.nodes,
      amount: config.amount,
      strategy: config.strategy,
    },
  ]), [config.amount, config.nodes, config.strategy, practiceStats, proposal, recentNodes, recommendedNodes, sprintNodes]);
  const selectedMission = missionCards.find((item) => item.id === selectedMissionId) || missionCards[0];
  const weakPatternSummary = useMemo(() => {
    const counts = attemptSummaries.filter((item) => !item.isCorrect).reduce<Record<string, number>>((result, item) => {
      result[item.node] = (result[item.node] || 0) + 1;
      return result;
    }, {});
    return Object.entries(counts).sort((left, right) => right[1] - left[1]).slice(0, 3);
  }, [attemptSummaries]);
  const performanceLevel = questions.length === 0 ? 0 : Math.round((correctCount / questions.length) * 100);
  const resultHeadline = performanceLevel >= 85 ? '这一轮表现很稳，适合继续拉高难度。' : performanceLevel >= 60 ? '已经抓到部分关键点，接下来重点补齐薄弱环节。' : '这轮暴露了集中薄弱点，马上再练或转复习最有效。';
  const isCopilotEntry = proposal.sourceSurface === 'copilot-draft' || proposal.sourceSurface === 'copilot-node';
  const isReviewFollowUp = proposal.returnPath.pathname === '/review';
  const recommendedMissionCards = missionCards.filter((item) => item.id !== 'custom');
  const localJudgeCount = attemptSummaries.filter((item) => item.judgeSource === 'local').length;
  const practiceStageLabel = status === 'fallback'
    ? '降级判题'
    : status === 'partial'
      ? '部分补题'
      : status === 'completed'
        ? '练习完成'
        : '正式作答';
  const practiceStageDescription = status === 'fallback'
    ? '服务端判题暂不可用，当前答案已切换到本地稳定模式。'
    : status === 'partial'
      ? '已先生成首批题目，你可以边做边等系统继续补题。'
      : '当前练习按正常节奏推进。';
  const missionSummary = selectedMission.nodes.length > 0 ? selectedMission.nodes.join('、') : '系统将按当前任务自动选题';
  const resultNextStepLabel = proposal.nextStepHint.label || '完成后去复习巩固';
  const returnPathLabel = isReviewFollowUp ? '回到复习中心继续清单' : (proposal.returnPath.label || '回到来源入口');

  const enterCustomMode = () => {
    setEntryMode('custom');
    setSelectedMissionId('custom');
    setShowAdvanced(true);
  };

  const updateCustomConfig = (updater: (prev: DrillConfig) => DrillConfig) => {
    enterCustomMode();
    setConfig(updater);
  };

  const applyMission = (mission: PracticeMission) => {
    setSelectedMissionId(mission.id);
    if (mission.id === 'custom') {
      enterCustomMode();
      if (config.nodes.length === 0 && mission.nodes.length > 0) {
        setConfig((prev) => ({ ...prev, nodes: mission.nodes }));
      }
      return;
    }
    setEntryMode('recommended');
    setShowAdvanced(false);
    setConfig((prev) => ({
      ...prev,
      subject: proposal.scope.subject,
      nodes: mission.nodes.length > 0 ? mission.nodes : prev.nodes,
      amount: mission.amount,
      strategy: mission.strategy,
    }));
  };

  const canGenerate = useMemo(
    () => config.nodes.length > 0 && config.amount > 0 && status !== 'loading',
    [config.nodes.length, config.amount, status],
  );
  const totalNodePages = useMemo(() => Math.max(1, Math.ceil(allNodes.length / NODE_UI_PAGE_SIZE)), [allNodes.length]);
  const visibleNodes = useMemo(() => {
    const start = (nodeUiPage - 1) * NODE_UI_PAGE_SIZE;
    return allNodes.slice(start, start + NODE_UI_PAGE_SIZE);
  }, [allNodes, nodeUiPage]);

  useEffect(() => {
    if (nodeUiPage > totalNodePages) {
      setNodeUiPage(totalNodePages);
    }
  }, [nodeUiPage, totalNodePages]);

  const toggleNode = (node: string) => {
    updateCustomConfig(prev => ({
      ...prev,
      nodes: prev.nodes.includes(node) ? prev.nodes.filter(item => item !== node) : [...prev.nodes, node],
    }));
  };

  const autoSelectWeakest = () => {
    const weakest = allNodes.slice(0, 3).map(n => n.name);
    updateCustomConfig(prev => ({ ...prev, nodes: weakest }));
  };

  const startGenerate = async () => {
    if (!canGenerate) return;
    const runId = Date.now();
    generationRunRef.current = runId;
    setStatus('loading');
    setQuestions([]);
    setAttemptSummaries([]);
    setCorrectCount(0);
    setCurrentIdx(0);
    setSelectedOption('');
    setIsAnswerSubmitted(false);
    setIsExplanationOpen(false);
    setShowAiHint(false);
    setPracticeSessionId(null);
    savedWrongKeysRef.current.clear();
    setTargetAmount(config.amount);
    setIsGeneratingMore(true);
    setGenerationFallbackNotice('');
    setJudgeFallbackNotice('');
    setJudgeSource('server');
    try {
      let activated = false;
      const data = await questionsApi.generateVariantsProgressive(
        config.subject,
        config.nodes,
        config.amount,
        config.strategy,
        (batch, generated, total) => {
          if (generationRunRef.current !== runId) return;
          if (!Array.isArray(batch) || batch.length === 0) return;
          setQuestions((prev) => (prev.length === 0 ? batch : [...prev, ...batch]));
          const hasMore = generated < total;
          setIsGeneratingMore(hasMore);
          setGenerationFallbackNotice(hasMore ? `已先生成 ${generated}/${total} 题，你可以先开始作答，系统会继续补题。` : '');
          setStatus((prev) => prev === 'fallback' ? 'fallback' : hasMore ? 'partial' : 'active');
          if (!activated) {
            activated = true;
            setCurrentIdx(0);
            setSelectedOption('');
            setCorrectCount(0);
            setTimeElapsed(0);
            setIsAnswerSubmitted(false);
            setIsExplanationOpen(false);
            setShowAiHint(false);
            setQuestionStartedAt(Date.now());
            setIsSubmitting(false);
            void practiceApi.startSession({
              subject: config.subject,
              strategy: config.strategy,
              nodes: config.nodes,
              planned_amount: total,
              generated_amount: batch.length,
            }).then((sessionId) => {
              if (generationRunRef.current !== runId) return;
              setPracticeSessionId(sessionId);
            }).catch(() => {
              if (generationRunRef.current !== runId) return;
              setPracticeSessionId(null);
            });
          }
        },
      );
      if (generationRunRef.current !== runId) return;
      setIsGeneratingMore(false);
      if (!Array.isArray(data.variants) || data.variants.length === 0) {
        toast.error('未生成可用题目，请稍后重试');
        setQuestions([]);
        setStatus('configuring');
        return;
      }
      if (data.variants.length < config.amount) {
        const notice = `本轮目标 ${config.amount} 题，当前可用 ${data.variants.length} 题。请先完成已生成题目。`;
        setGenerationFallbackNotice(notice);
        setStatus((prev) => prev === 'fallback' ? 'fallback' : 'partial');
        toast.message(notice);
      } else {
        setGenerationFallbackNotice('');
        setStatus((prev) => prev === 'fallback' ? 'fallback' : 'active');
      }
    } catch (error: any) {
      if (generationRunRef.current !== runId) return;
      setIsGeneratingMore(false);
      toast.error(error?.message || '组卷失败，请稍后重试');
      setStatus('configuring');
    }
  };

  useEffect(() => {
    if (!state.autoStart || autoStarted || status !== 'configuring' || config.nodes.length === 0) return;
    setAutoStarted(true);
    void startGenerate();
  }, [state.autoStart, autoStarted, status, config.nodes.length, config.subject, config.amount, config.strategy]);

  const submitCurrent = async () => {
    if (!currentQuestion || !selectedOption || isSubmitting) return;
    
    if (!isAnswerSubmitted) {
      setIsSubmitting(true);
      setIsAnswerSubmitted(true);
      const questionType = currentQuestion.question_type || (normalizedOptions.length > 1 ? 'choice' : 'essay');
      const mappedNode = config.nodes[currentIdx % Math.max(config.nodes.length, 1)] || currentQuestion.question_text.slice(0, 8);
      const durationSeconds = Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000));
      const canonicalTags = normalizeQuestionTags({
        subject: config.subject,
        knowledgePoint: mappedNode,
      });
      const isFinal = currentIdx >= questions.length - 1;
      let isCorrect = false;
      let usedServerJudge = false;
      if (practiceSessionId) {
        const startTime = Date.now();
        const rpc = await practiceApi.submitAttempt({
          session_id: practiceSessionId,
          question_index: currentIdx,
          question_text: currentQuestion.question_text,
          question_type: questionType,
          correct_answer: currentQuestion.correct_answer || '',
          user_answer: selectedOption,
          acceptable_answers: currentQuestion.acceptable_answers || [],
          subject: config.subject,
          knowledge_point: mappedNode,
          ability: canonicalTags.ability,
          error_type: canonicalTags.errorType,
          duration_seconds: durationSeconds,
          source_node: mappedNode,
          ai_prompt_version: PRACTICE_AI_PROMPT_VERSION,
          is_final: isFinal,
        }).catch((error) => ({ error }));
        const rpcDuration = Date.now() - startTime;
        
        if (!(rpc as any).error) {
          isCorrect = Boolean((rpc as { is_correct: boolean }).is_correct);
          usedServerJudge = true;
          console.debug(`[PracticeObservability] Server RPC success. Duration: ${rpcDuration}ms`);
        } else {
          toast.error('服务端判题失败，已切换本地兜底');
          setJudgeSource('local');
          setJudgeFallbackNotice('已切换到本地稳定判题模式，后续结果会标记为本地兜底来源。');
          setStatus('fallback');
          console.warn(`[PracticeObservability] Server RPC fallback. Error: ${(rpc as any).error.message}, Duration: ${rpcDuration}ms`);
        }
      }
      if (!usedServerJudge) {
        const answer = normalizeAnswerText(selectedOption);
        const normalizedCorrect = normalizeAnswerText(currentQuestion.correct_answer || '');
        const acceptable = (currentQuestion.acceptable_answers || []).map((item) => normalizeAnswerText(item));
        isCorrect = questionType === 'choice'
          ? selectedOption === effectiveCorrectAnswer
          : (answer.length > 0 && (answer === normalizedCorrect || acceptable.includes(answer)));
        if (practiceSessionId) {
          await practiceApi.recordAttempt({
            session_id: practiceSessionId,
            question_index: currentIdx,
            question_text: currentQuestion.question_text,
            question_type: questionType,
            correct_answer: currentQuestion.correct_answer || '',
            user_answer: selectedOption,
            is_correct: isCorrect,
            knowledge_point: canonicalTags.knowledgePoint,
            duration_seconds: durationSeconds,
            source_node: mappedNode,
            ai_prompt_version: PRACTICE_AI_PROMPT_VERSION,
          }).catch(() => {
            toast.error('答题记录同步失败，将继续本地练习');
          });
        }
        if (!isCorrect) {
          const wrongKey = `${canonicalTags.subject}|${canonicalTags.knowledgePoint}|${currentQuestion.question_text.trim()}`;
          if (!savedWrongKeysRef.current.has(wrongKey)) {
            savedWrongKeysRef.current.add(wrongKey);
            await createQuestionMutation.mutateAsync({
              subject: canonicalTags.subject,
              question_text: formatQuestionTextForStorage(currentQuestion.question_text, normalizedOptions),
              question_type: questionType as any,
              correct_answer: currentQuestion.correct_answer || '',
              raw_ai_response: JSON.stringify(currentQuestion),
              knowledge_point: canonicalTags.knowledgePoint,
              ability: canonicalTags.ability,
              error_type: canonicalTags.errorType,
              note: currentQuestion.explanation || '专项练习自动回流',
            }).catch(() => {
              savedWrongKeysRef.current.delete(wrongKey);
              toast.error('错题回流失败，请稍后重试');
            });
          }
        }
      }
      setAttemptSummaries((prev) => [...prev, {
        node: mappedNode,
        isCorrect,
        judgeSource: usedServerJudge ? 'server' : 'local',
      }]);
      if (isCorrect) setCorrectCount(prev => prev + 1);
      setIsExplanationOpen(true);
      setIsSubmitting(false);
      return;
    }

    if (currentIdx >= questions.length - 1) {
      if (isGeneratingMore && questions.length < targetAmount) {
        toast.message('后续题目仍在生成中，请稍候');
        return;
      }
      setStatus('completed');
      setPracticeSessionId(null);
      return;
    }
    setCurrentIdx(prev => prev + 1);
    setQuestionStartedAt(Date.now());
    setSelectedOption('');
    setIsAnswerSubmitted(false);
    setIsExplanationOpen(false);
    setShowAiHint(false);
    setAiExplanation('');
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-8 animate-in fade-in duration-700 zoom-in-95">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl animate-pulse scale-150" />
            <div className="relative bg-background p-4 rounded-full border border-primary/20 shadow-lg shadow-primary/10">
              <RefreshCw className="h-12 w-12 text-primary animate-[spin_3s_linear_infinite]" />
              <span className="text-xl drop-shadow-sm absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse">🚀</span>
            </div>
          </div>
          <div className="space-y-2 text-center">
            <h3 className="text-lg font-bold text-foreground">AI 正在为您组卷</h3>
            <p className="text-sm text-muted-foreground font-medium tracking-wide">分析知识图谱，提取变式题中...</p>
          </div>
        </div>
      </div>
    );
  }

  const restartCurrentMission = () => {
    resetDrillState();
    void startGenerate();
  };

  const navigateToReview = () => {
    const reviewTarget = buildLearningSessionNavigation(createLearningSessionProposal({
      sessionKind: 'review',
      sourceSurface: 'review-stats',
      sourceReason: '用户从专项练习结果页进入复习巩固',
      objectiveCode: 'review_due',
      explanationSummary: weakPatternSummary.length > 0
        ? `优先复习 ${weakPatternSummary.map(([node]) => node).join('、')} 等薄弱点`
        : '根据本轮专项练习结果进入复习巩固',
      successCriteria: `完成 ${Math.max(8, Math.min(15, questions.length || config.amount))} 题复习并确认弱点是否稳住`,
      scope: {
        subject: config.subject,
        amount: Math.max(8, Math.min(15, questions.length || config.amount)),
        reviewScope: 'due',
        sortBy: 'nearestDue',
      },
      handoffContext: {
        sourceMode: 'practice-result',
        summary: weakPatternSummary.length > 0
          ? `重点复习 ${weakPatternSummary.map(([node]) => node).join('、')}`
          : '从专项练习结果进入复习巩固',
        activeNode: weakPatternSummary[0]?.[0] || selectedMission.nodes[0] || '',
        activeQuestionId: '',
      },
      returnPath: {
        pathname: '/practice',
        search: location.search,
        label: '回到专项练习',
      },
    }));
    navigate(`${reviewTarget.pathname}${reviewTarget.search}`, { state: reviewTarget.state });
  };

  const navigateToCopilot = () => {
    navigate('/draft-review');
  };

  const navigateToReturnPath = () => {
    navigate({
      pathname: proposal.returnPath.pathname || '/',
      search: proposal.returnPath.search || '',
    });
  };

  if ((status === 'active' || status === 'partial' || status === 'fallback') && currentQuestion) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 h-[calc(100vh-64px)] flex flex-col">
        <header className="flex items-center justify-between shrink-0 mb-6 rounded-3xl border border-white/70 dark:border-slate-700/50 bg-white/88 dark:bg-slate-900/88 p-4 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-300 bg-gradient-to-br from-violet-600/5 via-blue-600/5 to-cyan-500/5 dark:from-violet-900/10 dark:via-blue-900/10 dark:to-cyan-900/10">
          <div className="flex items-center gap-4">
            {confirmExit ? (
              <div className="flex items-center gap-2 bg-rose-50/50 dark:bg-rose-900/20 px-3 py-1.5 rounded-2xl border border-rose-100 dark:border-rose-800">
                <span className="text-xs font-bold text-rose-600 dark:text-rose-400">确定退出？</span>
                <button onClick={handleExit} className="rounded-xl bg-rose-500 px-3 py-1 text-xs font-bold text-white hover:bg-rose-600 transition-all shadow-sm active:scale-95">确认</button>
                <button onClick={() => setConfirmExit(false)} className="rounded-xl bg-white dark:bg-slate-800 px-3 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95">取消</button>
              </div>
            ) : (
              <button onClick={() => setConfirmExit(true)} className="p-2 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-2xl transition-all text-muted-foreground hover:text-rose-600 border border-transparent hover:border-rose-200">
                <X className="h-5 w-5" />
              </button>
            )}
            <div className="h-6 w-[1px] bg-border/60" />
            <div className="flex flex-col">
              <span className="text-sm font-black text-foreground flex items-center gap-1.5"><span className="text-base">🎯</span> {selectedMission.title}</span>
              <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">{practiceStageLabel}</span>
            </div>
          </div>
          
          <div className="hidden sm:flex items-center gap-4 bg-white dark:bg-slate-800/80 px-5 py-2.5 rounded-2xl border border-border/50 shadow-sm mx-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Progress</span>
            <div className="flex items-center gap-1.5 max-w-[200px] overflow-hidden">
              {Array.from({ length: targetAmount }).map((_, idx) => (
                <div 
                  key={idx} 
                  className={`h-1.5 shrink-0 rounded-full transition-all duration-500 ease-out ${
                    idx < currentIdx 
                      ? 'w-4 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' 
                      : idx === currentIdx 
                        ? 'w-6 bg-[#FF8C00] shadow-[0_0_8px_rgba(255,140,0,0.4)] animate-pulse' 
                        : 'w-2 bg-slate-200 dark:bg-slate-700'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-baseline gap-0.5 ml-1 shrink-0">
              <span className="text-base font-black text-foreground">{Math.min(currentIdx + 1, targetAmount)}</span>
              <span className="text-xs font-bold text-muted-foreground/50">/ {targetAmount}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm font-black text-foreground bg-white dark:bg-slate-800/80 border border-border/50 shadow-sm px-4 py-2.5 rounded-2xl">
            <span className="text-[#FF8C00] animate-pulse">⏳</span>
            <span className="w-12 tabular-nums tracking-wider text-center">{formatTime(timeElapsed)}</span>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto custom-scrollbar pb-24 relative z-10">
          <div className="space-y-8 mt-2 rounded-3xl border border-white/70 dark:border-slate-700/50 bg-white/88 dark:bg-slate-900/88 p-6 sm:p-8 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.22)] dark:shadow-[0_20px_50px_-28px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            {generationFallbackNotice ? (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                {generationFallbackNotice}
              </div>
            ) : null}
            {judgeFallbackNotice ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {judgeFallbackNotice}
              </div>
            ) : null}

            <p className="text-xl font-medium text-foreground leading-relaxed tracking-wide whitespace-pre-wrap">
              {currentQuestion.question_text}
            </p>
            
            {(currentQuestion.question_type === 'choice' || normalizedOptions.length > 1) ? (
              <div className="grid gap-3">
                {normalizedOptions.map((item, idx) => {
                const value = String.fromCharCode(65 + idx);
                const active = selectedOption === value;
                const isCorrectOption = value === effectiveCorrectAnswer;
                
                let btnClass = `group/opt relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-300 ease-out text-lg flex items-center justify-between group transform ${
                  !isAnswerSubmitted && 'hover:-translate-y-1 hover:shadow-sm'
                } ${active ? 'border-[#FF8C00] bg-[#FF8C00]/5 text-[#FF8C00] shadow-sm scale-[1.02]' : 'border-border/60 bg-white dark:bg-slate-900 hover:border-[#FF8C00]/30 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:shadow-sm shadow-[0_2px_10px_-4px_rgba(0,0,0,0.02)]'}`;
                
                if (isAnswerSubmitted) {
                  if (isCorrectOption) {
                    btnClass = 'relative overflow-hidden rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 p-5 text-left text-lg flex items-center justify-between shadow-sm scale-[1.02] transition-all duration-500';
                  } else if (active && !isCorrectOption) {
                    btnClass = 'relative overflow-hidden rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 p-5 text-left text-lg flex items-center justify-between shadow-sm scale-[1.02] transition-all duration-500';
                  } else {
                    btnClass = 'relative overflow-hidden rounded-2xl border border-border/40 bg-slate-50/50 dark:bg-slate-800/20 text-slate-400 dark:text-slate-500 p-5 text-left text-lg flex items-center justify-between opacity-50 transition-all duration-500';
                  }
                }

                return (
                  <button
                    key={`${idx}-${item}`}
                    type="button"
                    onClick={() => !isAnswerSubmitted && setSelectedOption(value)}
                    disabled={isAnswerSubmitted}
                    className={btnClass}
                  >
                    <span className="flex items-center gap-4">
                      <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-base font-bold transition-colors duration-300 ${
                        active && !isAnswerSubmitted 
                          ? 'bg-[#FF8C00] text-white shadow-inner scale-105' 
                          : 'bg-background border shadow-sm group-hover:border-[#FF8C00]/50 group-hover:bg-[#FF8C00]/5'
                      }`}>
                        {value}
                      </span>
                      <span className="leading-relaxed">{item.replace(/^[A-H]\.\s*/, '')}</span>
                    </span>
                    {isAnswerSubmitted && isCorrectOption && <span className="text-2xl drop-shadow-sm animate-in zoom-in spin-in-12 duration-500">✅</span>}
                    {isAnswerSubmitted && active && !isCorrectOption && <span className="text-2xl drop-shadow-sm animate-in zoom-in spin-in-12 duration-500">❌</span>}
                  </button>
                );
                })}
              </div>
            ) : (
              <div className="relative group">
                <textarea
                  value={selectedOption}
                  onChange={(event) => setSelectedOption(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !isAnswerSubmitted && selectedOption.trim()) {
                      event.preventDefault();
                      submitCurrent();
                    }
                  }}
                  disabled={isAnswerSubmitted}
                  placeholder="请输入你的答案"
                  className={`min-h-[160px] w-full rounded-2xl border bg-white dark:bg-slate-900 p-5 text-base leading-relaxed outline-none transition-all duration-300 resize-y shadow-[0_2px_10px_-4px_rgba(0,0,0,0.02)] focus:shadow-sm ${
                    !isAnswerSubmitted
                      ? 'border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:border-[#FF8C00] focus:ring-2 focus:ring-[#FF8C00]/20'
                      : (autoIsCorrect ? 'border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/20' : 'border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 bg-rose-50/30 dark:bg-rose-950/20')
                  }`}
                />
                {isAnswerSubmitted && (
                  <div className="mt-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 animate-in fade-in slide-in-from-top-2">
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-bold mb-1 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" />
                      标准答案
                    </p>
                    <p className="text-slate-800 dark:text-slate-200 font-medium">{effectiveCorrectAnswer || '无'}</p>
                  </div>
                )}
                {!isAnswerSubmitted && (
                  <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs font-medium text-muted-foreground opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 bg-background/80 backdrop-blur-sm px-2 py-1 rounded-md">
                    <span>按</span>
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-sans text-[10px]">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-sans text-[10px]">Enter</kbd>
                    <span>提交</span>
                  </div>
                )}
              </div>
            )}
            
            {isAnswerSubmitted && !isChoice && (
              <div className="mt-8 pt-8 border-t border-border/50 animate-in fade-in slide-in-from-bottom-8 duration-700">
                {(!autoIsCorrect || !effectiveCorrectAnswer) ? (
                  <div className="rounded-3xl border border-slate-100 dark:border-slate-800/50 bg-slate-50/80 dark:bg-slate-900/30 p-6 space-y-4 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)]">
                    <p className="text-sm font-black text-slate-800 dark:text-slate-300 flex items-center gap-2">
                      <span className="text-base drop-shadow-sm">✨</span>
                      AI 解析
                    </p>
                    {diagnosisLoading && !aiExplanation ? (
                      <div className="space-y-3 animate-pulse">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6"></div>
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                        <p className="text-xs text-slate-500 dark:text-slate-400/60 mt-2 italic flex items-center gap-1">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          AI 管家正在为您生成专属解析...
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 animate-in fade-in duration-500">
                        <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed font-medium">{aiExplanation || currentQuestion.explanation || '暂无解析'}</div>
                        {diagnosisLoading && (
                          <span className="inline-block w-2 h-4 ml-1 bg-slate-400 animate-pulse" />
                        )}
                        {diagnosisFallbackNotice ? (
                          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            {diagnosisFallbackNotice}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <details className="group [&_summary::-webkit-details-marker]:hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
                    <summary className="flex cursor-pointer items-center justify-between p-5 font-semibold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <span className="flex items-center gap-2">
                        <span className="text-base drop-shadow-sm">✨</span>
                        查看 AI 解析
                      </span>
                      <ChevronRight className="h-5 w-5 transition-transform duration-300 group-open:rotate-90 text-slate-400" />
                    </summary>
                    <div className="p-6 pt-2 border-t border-slate-100 dark:border-slate-800/50 space-y-6">
                      <div className="space-y-2">
                        <div className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">{aiExplanation || currentQuestion.explanation || '暂无解析'}</div>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </section>

        <footer className="fixed bottom-0 left-0 right-0 bg-background/60 backdrop-blur-xl border-t border-border/50 p-4 sm:px-8 flex items-center justify-between lg:left-[var(--sidebar-width,0px)] shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.05)] z-50">
          <div className="max-w-3xl mx-auto w-full flex items-center justify-between">
            {!isAnswerSubmitted ? (
              <button 
                onClick={() => setShowAiHint(true)}
                disabled={showAiHint}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#FF8C00] font-medium hover:bg-[#FF8C00]/10 transition-colors disabled:opacity-50"
              >
                <span className="text-lg drop-shadow-sm">✨</span>
                召唤AI提示
              </button>
            ) : (
              <button 
                onClick={() => setIsExplanationOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-foreground font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-border bg-card shadow-sm"
              >
                <span className="text-lg drop-shadow-sm">📖</span>
                查看详细解析
              </button>
            )}
            
            <button
              type="button"
              onClick={submitCurrent}
              disabled={!selectedOption || isSubmitting || (isAnswerSubmitted && currentIdx >= questions.length - 1 && isGeneratingMore)}
              className="rounded-xl bg-gradient-to-r from-[#FF8C00] to-[#FFA500] px-8 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-all active:scale-95 flex items-center gap-2 shadow-[inset_0_2px_4px_rgba(255,255,255,0.3),0_4px_14px_rgba(255,140,0,0.3)]"
            >
              {!isAnswerSubmitted ? '提交答案' : (currentIdx >= questions.length - 1 ? (isGeneratingMore ? '生成中...' : '完成练习') : '下一题')}
              {!isAnswerSubmitted ? <span className="text-base drop-shadow-sm">✨</span> : <ChevronRight className="h-5 w-5" />}
            </button>
          </div>
        </footer>

        <Sheet open={isExplanationOpen} onOpenChange={setIsExplanationOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto custom-scrollbar">
            <SheetHeader className="mb-6 border-b border-border pb-4 text-left">
              <SheetTitle className="flex items-center gap-2 text-xl">
                <span className="text-xl drop-shadow-sm">✨</span>
                AI 详细解析
              </SheetTitle>
              <SheetDescription>
                彻底搞懂这道题的考点和陷阱
              </SheetDescription>
            </SheetHeader>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">考点提取</h3>
                <div className="flex gap-2">
                  <span className="px-3 py-1 bg-primary/10 text-primary rounded-md text-sm font-medium">核心考点</span>
                  <span className="px-3 py-1 bg-secondary/20 text-foreground rounded-md text-sm font-medium">易错题型</span>
                </div>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">AI 核心解析</h3>
                <div className="p-4 rounded-xl bg-secondary/10 text-sm leading-relaxed text-foreground space-y-2">
                  <p>1. {currentQuestion.explanation || '分析题干提取关键信息。'}</p>
                  <p>2. 对比各个选项的差异点。</p>
                  <p>3. 得出最终结论为 {effectiveCorrectAnswer || currentQuestion.correct_answer}。</p>
                </div>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">易错点提示</h3>
                <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-sm text-destructive leading-relaxed">
                  ⚠️ 很多同学容易在这一步忽略隐含条件，导致误选。下次一定要仔细审题！
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </main>
    );
  }

  if (status === 'completed') {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-12 sm:px-6 animate-in zoom-in-95 fade-in duration-700 ease-out">
        <div className="rounded-full bg-slate-50 dark:bg-slate-800/50 p-6 w-28 h-28 mx-auto mb-8 flex items-center justify-center shadow-lg shadow-primary/5 border-4 border-background relative overflow-hidden">
          <div className="absolute inset-0 bg-primary/5 animate-pulse"></div>
          <span className="text-[60px] drop-shadow-md animate-in zoom-in spin-in-12 duration-700 delay-150">🎉</span>
        </div>
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-extrabold text-foreground tracking-tight">训练完成！</h1>
          <p className="text-lg text-muted-foreground">{resultHeadline}</p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">{sourceLabel}</span>
            <span className="rounded-full bg-secondary/20 px-2.5 py-1 text-muted-foreground">结果来源：{judgeSource === 'server' ? '服务端判题' : '含本地兜底判题'}</span>
            <span className="rounded-full bg-secondary/20 px-2.5 py-1 text-muted-foreground">{selectedMission.title}</span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="space-y-6">
            <div className="bg-card border border-border/60 rounded-3xl p-8 shadow-xl shadow-primary/5">
              <p className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-widest">本次练习正确率</p>
              <div className="flex items-baseline justify-center gap-2 mb-6">
                <p className="text-6xl font-black text-primary tracking-tighter">
                  {questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0}
                </p>
                <span className="text-3xl font-bold text-primary/70">%</span>
              </div>
              <div className="w-full bg-secondary/30 rounded-full h-3 mb-4 overflow-hidden shadow-inner">
                <div
                  className="bg-gradient-to-r from-primary to-primary/80 h-full rounded-full transition-all duration-1000 ease-out relative"
                  style={{ width: `${questions.length > 0 ? (correctCount / questions.length) * 100 : 0}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 w-full h-full transform -skew-x-12 -translate-x-full animate-[shimmer_2s_infinite]"></div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-secondary/20 p-4 text-left">
                  <p className="text-xs text-muted-foreground">完成题数</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{questions.length}</p>
                </div>
                <div className="rounded-2xl bg-secondary/20 p-4 text-left">
                  <p className="text-xs text-muted-foreground">答对题数</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-600">{correctCount}</p>
                </div>
                <div className="rounded-2xl bg-secondary/20 p-4 text-left">
                  <p className="text-xs text-muted-foreground">本地兜底题数</p>
                  <p className="mt-2 text-2xl font-bold text-amber-600">{localJudgeCount}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-border bg-card p-5 text-left shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">表现摘要</p>
                <p className="mt-3 text-sm leading-6 text-foreground">{resultHeadline}</p>
              </div>
              <div className="rounded-3xl border border-border bg-card p-5 text-left shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">推荐下一步</p>
                <p className="mt-3 text-sm leading-6 text-foreground">{resultNextStepLabel}</p>
              </div>
              <div className="rounded-3xl border border-border bg-card p-5 text-left shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">返回来源入口</p>
                <p className="mt-3 text-sm leading-6 text-foreground">{returnPathLabel}</p>
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-3xl border border-border bg-card p-6 text-left shadow-sm">
              <p className="text-sm font-semibold text-foreground">薄弱模式</p>
              <div className="mt-4 space-y-3">
                {weakPatternSummary.length > 0 ? weakPatternSummary.map(([node, count]) => (
                  <div key={node} className="rounded-2xl bg-secondary/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{node}</span>
                      <span className="text-xs font-medium text-destructive">失分 {count} 次</span>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-2xl bg-secondary/20 p-4 text-sm text-muted-foreground">
                    本轮没有明显集中弱点，可以直接去复习巩固或再练一轮提升稳定性。
                  </div>
                )}
              </div>
              {judgeFallbackNotice ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {judgeFallbackNotice}
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <button type="button" onClick={navigateToReview} className="w-full rounded-2xl border border-border/60 bg-card px-6 py-4 text-left font-semibold text-foreground hover:bg-secondary/30 transition-all duration-300 shadow-sm">
                去复习
              </button>
              <button type="button" onClick={restartCurrentMission} className="w-full rounded-2xl bg-primary px-6 py-4 text-left font-semibold text-primary-foreground hover:bg-primary/90 transition-all duration-300 shadow-sm">
                再练一轮
              </button>
              <button type="button" onClick={navigateToCopilot} className="w-full rounded-2xl border border-border/60 bg-card px-6 py-4 text-left font-semibold text-foreground hover:bg-secondary/30 transition-all duration-300 shadow-sm">
                回 AI 管家继续追问
              </button>
              <button type="button" onClick={navigateToReturnPath} className="w-full rounded-2xl border border-dashed border-border px-6 py-4 text-left font-medium text-muted-foreground hover:bg-secondary/20 transition-all duration-300">
                {returnPathLabel}
              </button>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/70 dark:border-slate-700/50 bg-white/88 dark:bg-slate-900/88 p-6 sm:p-8 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.22)] dark:shadow-[0_20px_50px_-28px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 hover:shadow-[0_30px_65px_-28px_rgba(15,23,42,0.32)] dark:hover:shadow-[0_30px_65px_-28px_rgba(0,0,0,0.6)] bg-gradient-to-br from-slate-50/80 via-white to-slate-100/50 dark:from-slate-800/80 dark:via-slate-900 dark:to-slate-800/50">
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center flex-shrink-0">
              <span className="text-[40px] drop-shadow-md">🎯</span>
            </div>
            <div>
              <h1 className="text-2xl font-black text-foreground tracking-tight">专项练习</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-[#F0F2F6] dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-300">{sourceLabel}</span>
                <span className="rounded-full bg-[#F0F2F6] dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-300">当前：{selectedMission.title}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isReviewFollowUp ? (
              <button type="button" onClick={navigateToReturnPath} className="rounded-2xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                {returnPathLabel}
              </button>
            ) : null}
            <button
              type="button"
              onClick={startGenerate}
              disabled={!canGenerate}
              className="rounded-2xl bg-gradient-to-r from-[#FF8C00] to-[#FFA500] px-5 py-3 text-sm font-bold text-white shadow-[inset_0_2px_4px_rgba(255,255,255,0.3),0_4px_14px_rgba(255,140,0,0.3)] hover:opacity-90 disabled:opacity-50 flex items-center gap-2 transition-all active:scale-95"
            >
              <span className="text-base drop-shadow-sm">🚀</span> 开始练习
            </button>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_380px]">
        <section className="space-y-6">
          <div className="rounded-[28px] border border-border/50 bg-card p-6 shadow-sm bg-gradient-to-b from-slate-50/50 to-transparent dark:from-slate-900/50">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-foreground">推荐任务区</h2>
                <p className="mt-1 text-sm font-medium text-muted-foreground">基于您的学习数据自动生成的专属练习计划。</p>
              </div>
              <span className="rounded-full bg-gradient-to-r from-[#FFD700] to-[#FF8C00] px-3 py-1 text-xs font-bold text-white shadow-[0_2px_8px_rgba(255,140,0,0.3)] border border-[#FF8C00]/20 relative overflow-hidden"><div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[shimmer_2s_infinite]"></div>智能推荐</span>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {recommendedMissionCards.map((mission) => {
                const active = selectedMissionId === mission.id;
                let icon = '🎯';
                let lightBg = 'bg-orange-50 dark:bg-orange-900/20';
                let gradientBg = 'bg-gradient-to-br from-orange-500/5 to-transparent dark:from-orange-900/10 dark:to-transparent';
                
                if (mission.id === 'recent') {
                  icon = '🕒';
                  lightBg = 'bg-amber-50 dark:bg-amber-900/20';
                  gradientBg = 'bg-gradient-to-br from-amber-500/5 to-transparent dark:from-amber-900/10 dark:to-transparent';
                }
                if (mission.id === 'sprint') {
                  icon = '⚡';
                  lightBg = 'bg-emerald-50 dark:bg-emerald-900/20';
                  gradientBg = 'bg-gradient-to-br from-emerald-500/5 to-transparent dark:from-emerald-900/10 dark:to-transparent';
                }
                
                const premiumCardClass = 'group relative overflow-hidden rounded-3xl border border-white/70 dark:border-slate-700/50 bg-white/88 dark:bg-slate-900/88 p-5 text-left shadow-[0_20px_50px_-28px_rgba(15,23,42,0.22)] dark:shadow-[0_20px_50px_-28px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_65px_-28px_rgba(15,23,42,0.32)] dark:hover:shadow-[0_30px_65px_-28px_rgba(0,0,0,0.6)]';

                return (
                  <button
                    key={mission.id}
                    type="button"
                    onClick={() => applyMission(mission)}
                    className={`${premiumCardClass} ${gradientBg} ${
                      active ? 'ring-[1.5px] ring-[#FF8C00] scale-[1.02] z-10' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 relative z-10">
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-3xl flex items-center justify-center text-2xl transition-all duration-300 ${active ? `${lightBg} scale-105` : `${lightBg} group-hover:scale-105`}`}>
                          <span className="drop-shadow-sm">{icon}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className={`text-lg font-black transition-colors ${active ? 'text-[#FF8C00]' : 'text-slate-700 dark:text-slate-200'}`}>{mission.title}</span>
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider mt-0.5">{mission.badge}</span>
                        </div>
                      </div>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${active ? 'bg-[#FF8C00]/10 text-[#FF8C00]' : 'bg-slate-100 dark:bg-slate-800 text-muted-foreground group-hover:bg-[#FF8C00]/5 group-hover:text-[#FF8C00]'}`}>
                        <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                    {mission.nodes.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-1.5 relative z-10">
                        {mission.nodes.slice(0, 3).map(node => (
                          <span key={node} className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${active ? 'bg-[#FF8C00]/10 dark:bg-[#FF8C00]/20 text-[#FF8C00] border-[#FF8C00]/20' : 'bg-[#F5F6F8] dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
                            {node}
                          </span>
                        ))}
                        {mission.nodes.length > 3 && (
                          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${active ? 'bg-[#FF8C00]/10 dark:bg-[#FF8C00]/20 text-[#FF8C00] border-[#FF8C00]/20' : 'bg-[#F5F6F8] dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
                            +{mission.nodes.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[28px] border border-border/50 bg-card p-6 shadow-sm bg-gradient-to-b from-slate-50/50 to-transparent dark:from-slate-900/50">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-foreground">自定义任务区</h2>
                <p className="mt-1 text-sm font-medium text-muted-foreground">精确控制练习的知识点、题量和策略。</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                applyMission(missionCards.find((mission) => mission.id === 'custom') || selectedMission);
                enterCustomMode();
                setShowAdvanced(true);
              }}
              className={`group mt-5 w-full relative overflow-hidden rounded-3xl border border-white/70 dark:border-slate-700/50 bg-white/88 dark:bg-slate-900/88 p-5 text-left shadow-[0_20px_50px_-28px_rgba(15,23,42,0.22)] dark:shadow-[0_20px_50px_-28px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_65px_-28px_rgba(15,23,42,0.32)] dark:hover:shadow-[0_30px_65px_-28px_rgba(0,0,0,0.6)] bg-gradient-to-br from-slate-50 to-white/50 dark:from-slate-800/20 dark:to-slate-900/50 ${
                selectedMissionId === 'custom' ? 'ring-[1.5px] ring-[#FF8C00] scale-[1.02] z-10' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-3 relative z-10">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-3xl flex items-center justify-center text-2xl transition-all duration-300 ${selectedMissionId === 'custom' ? 'bg-[#FF8C00]/10 scale-105' : 'bg-slate-100 dark:bg-slate-800/50 group-hover:scale-105'}`}>
                    <span className="drop-shadow-sm">⚙️</span>
                  </div>
                  <div className="flex flex-col">
                    <span className={`text-lg font-black transition-colors ${selectedMissionId === 'custom' ? 'text-[#FF8C00]' : 'text-slate-700 dark:text-slate-200'}`}>自定义任务</span>
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider mt-0.5">Custom</span>
                  </div>
                </div>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${selectedMissionId === 'custom' ? 'bg-[#FF8C00]/10 text-[#FF8C00]' : 'bg-slate-100 dark:bg-slate-800 text-muted-foreground group-hover:bg-[#FF8C00]/5 group-hover:text-[#FF8C00]'}`}>
                  <ChevronRight className="h-4 w-4" />
                </div>
              </div>
            </button>

            {showAdvanced ? (
              <div className="mt-6 space-y-6 rounded-3xl border border-dashed border-border/80 bg-secondary/10 p-5">
                <Tabs value={config.subject} onValueChange={(val) => updateCustomConfig(prev => ({ ...prev, subject: val as Subject, nodes: [] }))}>
                  <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
                    <TabsTrigger value="英语" className="flex gap-2"><BookOpen className="h-4 w-4"/>英语</TabsTrigger>
                    <TabsTrigger value="C语言" className="flex gap-2"><Calculator className="h-4 w-4"/>C语言</TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-[#FF8C00]" />
                      知识点掌握度
                    </h3>
                    <button
                      onClick={autoSelectWeakest}
                      disabled={allNodes.length === 0}
                      className="text-sm flex items-center gap-1 text-[#FF8C00] hover:text-[#FF8C00]/80 bg-[#FF8C00]/10 px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4" />
                      AI帮你挑
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-secondary/20 px-2.5 py-1">加载耗时 {Math.round(nodeLoadMs)}ms</span>
                    <span className="rounded-full bg-secondary/20 px-2.5 py-1">服务端分页 {nodeLoadedPages} 页</span>
                    <span className="rounded-full bg-secondary/20 px-2.5 py-1">当前展示 {nodeUiPage}/{totalNodePages} 页</span>
                  </div>

                  {allNodes.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无可选知识点</div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      <div className="flex flex-wrap gap-3">
                        {visibleNodes.map(({name, mastery}) => {
                          const active = config.nodes.includes(name);
                          return (
                            <button
                              type="button"
                              key={name}
                              onClick={() => toggleNode(name)}
                              className={`relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all duration-200 ${
                                active ? 'border-[#FF8C00] bg-[#FF8C00]/5 ring-1 ring-[#FF8C00]/20 shadow-sm' : 'border-border bg-background hover:border-[#FF8C00]/50 hover:shadow-sm'
                              }`}
                            >
                              <span className={`text-sm font-medium ${active ? 'text-[#FF8C00]' : 'text-foreground'}`}>
                                {name}
                              </span>
                              <div className="mt-1 flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary/30">
                                  <div
                                    className={`h-full rounded-full ${mastery < 50 ? 'bg-destructive' : mastery < 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${mastery}%` }}
                                  />
                                </div>
                                <span className="text-xs font-semibold text-muted-foreground">{mastery}%</span>
                              </div>
                              {active ? <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#FF8C00]" /> : null}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setNodeUiPage((prev) => Math.max(1, prev - 1))}
                          disabled={nodeUiPage <= 1}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/50 disabled:opacity-40"
                        >
                          上一页
                        </button>
                        <button
                          type="button"
                          onClick={() => setNodeUiPage((prev) => Math.min(totalNodePages, prev + 1))}
                          disabled={nodeUiPage >= totalNodePages}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/50 disabled:opacity-40"
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-4 rounded-3xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-foreground">题目数量</label>
                      <span className="text-lg font-bold text-[#FF8C00]">{config.amount} 题</span>
                    </div>
                    <Slider
                      value={[config.amount]}
                      onValueChange={(vals) => updateCustomConfig(prev => ({ ...prev, amount: vals[0] }))}
                      max={30}
                      min={5}
                      step={5}
                      className="my-4"
                    />
                    <div className="flex gap-2">
                      {[10, 20, 30].map(num => (
                        <button
                          key={num}
                          onClick={() => updateCustomConfig(prev => ({ ...prev, amount: num }))}
                          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${config.amount === num ? 'bg-[#FF8C00] text-white' : 'bg-secondary/20 text-foreground hover:bg-secondary/40'}`}
                        >
                          {num} 题
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-3xl border border-border bg-card p-5 shadow-sm">
                    <label className="text-sm font-semibold text-foreground">难度策略</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => updateCustomConfig(prev => ({ ...prev, strategy: '递进' }))}
                        className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '递进' ? 'border-[#FF8C00] bg-[#FF8C00]/5 text-[#FF8C00] shadow-sm scale-[1.02]' : 'border-border hover:bg-slate-50/50 dark:hover:bg-slate-800/50 text-muted-foreground hover:-translate-y-0.5'}`}
                      >
                        <span className="text-xl drop-shadow-sm">📈</span>
                        <span className="text-xs font-bold">递进</span>
                      </button>
                      <button
                        onClick={() => updateCustomConfig(prev => ({ ...prev, strategy: '随机' }))}
                        className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '随机' ? 'border-[#FF8C00] bg-[#FF8C00]/5 text-[#FF8C00] shadow-sm scale-[1.02]' : 'border-border hover:bg-slate-50/50 dark:hover:bg-slate-800/50 text-muted-foreground hover:-translate-y-0.5'}`}
                      >
                        <span className="text-xl drop-shadow-sm">🎲</span>
                        <span className="text-xs font-bold">随机</span>
                      </button>
                      <button
                        onClick={() => updateCustomConfig(prev => ({ ...prev, strategy: '攻坚' }))}
                        className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '攻坚' ? 'border-destructive bg-destructive/5 text-destructive shadow-sm scale-[1.02]' : 'border-border hover:bg-slate-50/50 dark:hover:bg-slate-800/50 text-muted-foreground hover:-translate-y-0.5'}`}
                      >
                        <span className="text-xl drop-shadow-sm">🔥</span>
                        <span className="text-xs font-bold">攻坚</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(false)}
                    className="flex items-center gap-2 rounded-full bg-white dark:bg-slate-800 px-6 py-2.5 text-sm font-bold text-muted-foreground hover:text-foreground shadow-sm border border-border/50 hover:bg-slate-50 transition-all active:scale-95"
                  >
                    <ChevronUp className="h-4 w-4" />
                    收起高级设置
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="sticky top-6 space-y-6 rounded-[28px] border border-border bg-card p-6 shadow-sm">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-[#FF8C00] mb-2">
                <span className="text-base drop-shadow-sm">📌</span>
                当前选定
              </div>
              <h2 className="text-2xl font-black text-foreground">{selectedMission.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{selectedMission.description}</p>
            </div>

            <div className="grid gap-3">
              <div className="rounded-2xl bg-[#F5F6F8] dark:bg-slate-800/50 p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5"><span className="text-sm">🎯</span> 练习范围</p>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">{missionSummary}</p>
              </div>
              <div className="rounded-2xl bg-[#F5F6F8] dark:bg-slate-800/50 p-4 flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><span className="text-sm">⚙️</span> 计划配置</p>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{config.amount} 题 · {config.strategy}</p>
              </div>
              <div className="rounded-2xl bg-[#F5F6F8] dark:bg-slate-800/50 p-4 flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><span className="text-sm">⏳</span> 预计耗时</p>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">约 {Math.ceil(config.amount * 1.5)} 分钟</p>
              </div>
            </div>

            {isCopilotEntry ? (
              <div className="rounded-2xl border border-slate-200/50 bg-slate-50/50 px-4 py-3 text-sm text-slate-700">
                来自 AI 管家的本次建议会在做题过程中持续保留提示。
              </div>
            ) : null}
            {isReviewFollowUp ? (
              <div className="rounded-2xl border border-amber-200/50 bg-amber-50/50 px-4 py-3 text-sm text-amber-700">
                本轮任务来自复习补弱，完成后仍可回到复习中心继续。
              </div>
            ) : null}

            <button
              type="button"
              onClick={startGenerate}
              disabled={!canGenerate}
              className="w-full rounded-2xl bg-gradient-to-r from-[#FF8C00] to-[#FFA500] px-6 py-4 text-lg font-bold text-white shadow-[inset_0_2px_4px_rgba(255,255,255,0.3),0_8px_20px_rgba(255,140,0,0.3)] hover:opacity-90 hover:shadow-[inset_0_2px_4px_rgba(255,255,255,0.3),0_12px_24px_rgba(255,140,0,0.4)] disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <span className="text-xl drop-shadow-sm">🚀</span>
              开始专属练习
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

function RocketIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}
