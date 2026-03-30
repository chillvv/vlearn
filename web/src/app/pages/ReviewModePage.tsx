import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { chatApi, questionsApi } from '../lib/api';
import type { Question, ReviewAttemptDiagnosis, ReviewAttemptRecord, Subject } from '../lib/types';
import { Zap, Settings, Trophy, CheckCircle2, AlertCircle, RefreshCw, BarChart3, BookOpen, Calculator, Play, PieChart } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { MistakeQuestionPreview } from '../components/business/MistakeQuestionPreview';
import { parseQuestionPreview } from '../lib/questionPreview';
import { normalizeChoiceAnswerLabel, normalizeCorrectAnswer } from '../lib/questionPayload';
import { toast } from 'sonner';
import { useQuestionsCountQuery, useQuestionsDueCountQuery, useRecentAttemptsQuery } from '../queries/questions';
import { useSubmitReviewAttemptMutation } from '../mutations/questions';

type ReviewStatus = 'configuring' | 'ready' | 'loading' | 'active' | 'completed';

type ReviewConfig = {
  subject: Subject;
  scope: 'all' | 'due' | 'unmastered' | 'stubborn';
  sortBy: 'latestWrong' | 'lowestMastery' | 'nearestDue';
};

type ReviewPresetState = {
  preset?: Partial<ReviewConfig>;
  autoStart?: boolean;
};

const REVIEW_PATTERN_LABELS: Record<string, string> = {
  repeat_same_option: '重复误选',
  keyword_missing: '关键词缺失',
  knowledge_gap: '知识断层',
  careless: '粗心失误',
  unknown: '待归类',
};

const defaultConfig: ReviewConfig = {
  subject: '英语',
  scope: 'due',
  sortBy: 'nearestDue',
};

// Mock chart data for last 7 days
const generateChartData = () => {
  const data = [];
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const todayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  
  for (let i = 6; i >= 0; i--) {
    const dIndex = (todayIndex - i + 7) % 7;
    data.push({
      name: days[dIndex],
      count: i === 0 ? 0 : Math.floor(Math.random() * 20) + 5, // Today is 0 initially
    });
  }
  return data;
};

function normalizeAnswerText(value: string) {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}

function normalizeOpenAnswer(value: string) {
  return normalizeAnswerText(value).replace(/[。．.,，!！?？;；:："'“”‘’()（）\[\]【】]/g, '');
}

function evaluateAnswerCorrectness(input: { isChoice: boolean; userAnswer: string; correctAnswer: string; acceptableAnswers?: string[] }) {
  if (input.isChoice) {
    const userLabel = normalizeChoiceAnswerLabel(input.userAnswer);
    const correctLabel = normalizeChoiceAnswerLabel(input.correctAnswer) || input.correctAnswer;
    return Boolean(userLabel) && userLabel === correctLabel;
  }
  const left = normalizeOpenAnswer(input.userAnswer);
  if (!left) return false;
  const candidates = [input.correctAnswer, ...(input.acceptableAnswers || [])]
    .map((item) => normalizeOpenAnswer(item || ''))
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

export function ReviewModePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as ReviewPresetState;

  const [status, setStatus] = useState<ReviewStatus>('ready');
  const [config, setConfig] = useState<ReviewConfig>({ ...defaultConfig, ...state.preset });
  const [cards, setCards] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [lastScheduleText, setLastScheduleText] = useState('');
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionPlanUpdated, setSessionPlanUpdated] = useState(0);
  const [sessionPatternCounts, setSessionPatternCounts] = useState<Record<string, number>>({});
  const [aiDiagnosis, setAiDiagnosis] = useState<ReviewAttemptDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  
  const [chartData] = useState(generateChartData());
  const [autoStarted, setAutoStarted] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  const configQuery = {
    subject: config.subject,
    onlyDue: config.scope === 'due',
    onlyUnmastered: config.scope === 'unmastered',
    onlyStubborn: config.scope === 'stubborn',
  };
  const totalCountQuery = useQuestionsCountQuery(configQuery, status !== 'active');
  const dueCountQuery = useQuestionsDueCountQuery();
  useEffect(() => {
    setTotalCount(totalCountQuery.data || 0);
  }, [totalCountQuery.data]);
  const dueCount = dueCountQuery.data || 0;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const onlyUnmastered = params.get('onlyUnmastered');
    const onlyDue = params.get('onlyDue');
    const onlyStubborn = params.get('onlyStubborn');
    const subject = params.get('subject');
    setConfig((prev) => {
      let scope = prev.scope;
      if (onlyUnmastered === 'true') scope = 'unmastered';
      if (onlyStubborn === 'true') scope = 'stubborn';
      if (onlyDue === 'true') scope = 'due';
      if (onlyUnmastered !== 'true' && onlyStubborn !== 'true' && onlyDue !== 'true' && params.get('scope')) {
        const nextScope = params.get('scope') as ReviewConfig['scope'];
        if (nextScope) scope = nextScope;
      }
      return {
        ...prev,
        subject: subject === 'C语言' || subject === '英语' ? (subject as Subject) : prev.subject,
        scope,
      };
    });
    setReviewPage(1);
  }, [location.search]);

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
  const submitAttemptMutation = useSubmitReviewAttemptMutation();

  useEffect(() => {
    if (!flipped || status !== 'active' || !current) {
      setAiDiagnosis(null);
      setDiagnosisLoading(false);
      return;
    }
    let alive = true;
    const run = async () => {
      setDiagnosisLoading(true);
      const attempts = recentAttempts.slice(0, 6).map((item, index) => ({
        index: index + 1,
        is_correct: item.is_correct,
        user_answer: item.user_answer || '',
        rating: item.rating,
        created_at: item.created_at,
      }));
      const prompt = `请根据复习记录输出严格JSON对象，不要输出其他文本。
{
  "subject": "${current.subject || '未知'}",
  "is_choice": ${isChoice},
  "question_text": ${JSON.stringify(current.question_text || '')},
  "correct_answer": ${JSON.stringify(correctAnswer || '')},
  "user_answer": ${JSON.stringify(userAnswer || '')},
  "selected_option_text": ${JSON.stringify(selectedOptionText || '')},
  "recent_attempts": ${JSON.stringify(attempts)},
  "fallback_diagnosis": ${JSON.stringify(ruleDiagnosis)}
}
输出字段：
{
  "why_wrong":"字符串",
  "evidence":"字符串",
  "fix_strategy":"字符串",
  "next_practice_type":"字符串",
  "error_pattern":"repeat_same_option|keyword_missing|knowledge_gap|careless|unknown",
  "confidence_score":0-1数字,
  "history_hint":"字符串"
}`;
      let fullContent = '';
      try {
        const startMs = Date.now();
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 12000);
          chatApi.streamChat(
            [{ role: 'user', content: prompt }],
            () => {},
            (content) => {
              clearTimeout(timer);
              fullContent = content;
              resolve();
            },
            (error) => {
              clearTimeout(timer);
              reject(new Error(error));
            },
            {
              systemPrompt: '你是复习错因诊断引擎。只输出合法JSON对象，不得输出markdown或解释。',
            },
          );
        });
        const latencyMs = Date.now() - startMs;
        const parsed = parseDiagnosisFromModel(fullContent);
        if (alive) {
          setAiDiagnosis(parsed);
          void questionsApi.submitAiDiagnosisTelemetry({
            questionId: current.id,
            status: 'success',
            latencyMs,
          });
        }
      } catch (err: any) {
        if (alive) {
          setAiDiagnosis(null);
          const isTimeout = err?.message === 'timeout';
          void questionsApi.submitAiDiagnosisTelemetry({
            questionId: current.id,
            status: isTimeout ? 'timeout' : 'fallback',
            latencyMs: 0,
            errorMessage: err?.message,
          });
        }
      } finally {
        if (alive) {
          setDiagnosisLoading(false);
        }
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [flipped, status, current?.id, current?.question_text, current?.subject, isChoice, correctAnswer, userAnswer, selectedOptionText, recentAttempts]);

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

  const startReview = async (targetPage = 1) => {
    setStatus('loading');
    try {
      const safePage = Math.max(1, targetPage);
      const PAGE_SIZE = 20;
      const offset = (safePage - 1) * PAGE_SIZE;
      const query = {
        subject: config.subject,
        onlyDue: config.scope === 'due',
        onlyUnmastered: config.scope === 'unmastered',
        onlyStubborn: config.scope === 'stubborn',
        sortBy: config.sortBy,
        limit: PAGE_SIZE,
        offset,
      };
      const [next, total] = await Promise.all([
        questionsApi.getAll(query),
        questionsApi.count(query),
      ]);
      
      if (safePage === 1) {
        setCards(next.length > 0 ? next : []);
        setCurrentIndex(0);
        setSessionReviewed(0);
        setSessionCorrect(0);
        setSessionPlanUpdated(0);
        setSessionPatternCounts({});
      } else {
        if (next.length === 0) {
          setHasNextPage(false);
          setStatus('completed');
          void requestPlanCacheRebuild(false);
          return;
        }
        const mergedLength = cards.length + next.length;
        setCards(prev => [...prev, ...next]);
        setCurrentIndex(Math.min(currentIndex + 1, mergedLength - 1));
      }
      
      setTotalCount(total);
      setHasNextPage(offset + next.length < total);
      setReviewPage(safePage);
      setFlipped(false);
      setShowDetails(false);
      setUserAnswer('');
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
      const diagnosisForSubmit = {
        ...liveDiagnosis,
        next_practice_type:
          action === 'forgot'
            ? '明日重做 + 同类基础题'
            : action === 'vague'
              ? '2天后复习 + 同类辨析'
              : '4天后复习 + 变式迁移',
      };
      const finalIsCorrect = !correctAnswer ? (action === 'mastered') : autoIsCorrect;

      const result = await submitAttemptMutation.mutateAsync({
        questionId: current.id,
        userAnswer,
        selectedOptionText,
        correctAnswer,
        isCorrect: finalIsCorrect,
        rating: action,
        diagnosis: diagnosisForSubmit,
      });
      const nextText = formatNextReviewText(result.nextReviewDate || result.question.next_review_date);
      setLastScheduleText(nextText ? `本题已记录，下次复习：${nextText}` : '本题已记录，复习计划已更新');
      setSessionReviewed((prev) => prev + 1);
      setSessionPlanUpdated((prev) => prev + 1);
      if (finalIsCorrect) {
        setSessionCorrect((prev) => prev + 1);
      } else {
        const patternKey = diagnosisForSubmit.error_pattern || 'unknown';
        setSessionPatternCounts((prev) => ({
          ...prev,
          [patternKey]: (prev[patternKey] || 0) + 1,
        }));
      }
      toast.success(nextText ? `已记录，下次复习 ${nextText}` : '已记录复习结果');
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

  if (status === 'loading') {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-8 animate-in fade-in duration-700 zoom-in-95">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl animate-pulse scale-150" />
            <div className="relative bg-background p-4 rounded-full border border-primary/20 shadow-lg shadow-primary/10">
              <RefreshCw className="h-12 w-12 text-primary animate-[spin_3s_linear_infinite]" />
              <Zap className="h-5 w-5 text-amber-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
            </div>
          </div>
          <div className="space-y-2 text-center">
            <h3 className="text-lg font-bold text-foreground">正在提取艾宾浩斯复习队列</h3>
            <p className="text-sm text-muted-foreground font-medium tracking-wide">AI 正在根据您的遗忘曲线智能组卷...</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'active' && current) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* We will refactor this Practice Interface in a later step. For now, keep it basic but styled better */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            智能复习
          </h1>
          <div className="flex items-center gap-3">
            <div className="w-32 h-2 bg-secondary/20 rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${((currentIndex) / cards.length) * 100}%` }} />
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{currentIndex + 1} / {cards.length}</span>
          </div>
        </div>
        
        <section className="rounded-2xl border border-border bg-card p-6 md:p-10 min-h-[400px] flex flex-col shadow-sm transition-all duration-500 ease-in-out relative overflow-hidden group">
          {/* Subtle background pattern */}
          <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-30 pointer-events-none transition-opacity duration-700 group-hover:opacity-50" />
          
          <div className="flex-1 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500 relative z-10" key={current.id}>
            {/* Question Section - Always visible */}
            <div className="space-y-6">
              <div className="flex gap-2">
                    <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{current.subject}</span>
                    <span className="inline-flex items-center rounded-md bg-secondary/30 px-2.5 py-1 text-xs font-medium text-secondary-foreground">{current.category || current.knowledge_point}</span>
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
                    
                    let btnClass = `group/opt relative overflow-hidden rounded-2xl border-2 px-4 py-3 text-left transition-all duration-300 ${active ? 'border-primary bg-primary/5 text-primary shadow-sm scale-[1.02]' : 'border-border bg-background hover:border-primary/30 hover:bg-accent/30 text-foreground hover:scale-[1.01]'}`;
                    
                    if (showCorrectness) {
                      if (isCorrect) {
                        btnClass = 'relative overflow-hidden rounded-2xl border-2 border-emerald-500 bg-emerald-50 text-emerald-700 px-4 py-3 text-left shadow-sm scale-[1.02] transition-all duration-500';
                      } else if (isWrong) {
                        btnClass = 'relative overflow-hidden rounded-2xl border-2 border-rose-500 bg-rose-50 text-rose-700 px-4 py-3 text-left shadow-sm scale-[1.02] transition-all duration-500';
                      } else if (active && !correctAnswer) {
                        // Keep active style but maybe add a neutral indicator
                        btnClass = 'relative overflow-hidden rounded-2xl border-2 border-amber-500 bg-amber-50 text-amber-700 px-4 py-3 text-left shadow-sm scale-[1.02] transition-all duration-500';
                      } else {
                        btnClass = 'relative overflow-hidden rounded-2xl border-2 border-border bg-background/50 text-muted-foreground px-4 py-3 text-left opacity-60 transition-all duration-500';
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
                        {/* Ripple effect background for active state */}
                        {!showCorrectness && active && (
                          <div className="absolute inset-0 bg-primary/10 animate-in fade-in zoom-in-50 duration-300 rounded-xl" />
                        )}
                        {/* Correctness background highlight */}
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
                  <label className="text-sm font-semibold text-foreground">你的答案</label>
                  <textarea
                    value={userAnswer}
                    disabled={flipped}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    placeholder="请输入你的答案（至少1个字符）"
                    className="min-h-[120px] w-full rounded-2xl border border-border bg-background p-4 text-sm leading-relaxed outline-none focus:ring-2 ring-primary/20 disabled:opacity-70 disabled:bg-muted/50 transition-all focus:shadow-sm"
                  />
                  {flipped && (
                    <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 animate-in fade-in slide-in-from-top-2">
                      <p className="text-sm text-emerald-800 font-bold mb-1 flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />
                        标准答案
                      </p>
                      <p className="text-emerald-700">{correctAnswer || '无'}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Explanation Section - Only visible when flipped */}
              {flipped && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className={`rounded-xl border p-5 shadow-sm transition-all duration-500 ${!correctAnswer ? 'border-amber-200 bg-amber-50/50 shadow-amber-100/50' : autoIsCorrect ? 'border-emerald-200 bg-emerald-50/50 shadow-emerald-100/50' : 'border-rose-200 bg-rose-50/50 shadow-rose-100/50'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      {!correctAnswer ? (
                        <Settings className="h-5 w-5 text-amber-600 animate-pulse" />
                      ) : autoIsCorrect ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 animate-in zoom-in spin-in-12 duration-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-rose-600 animate-in zoom-in duration-300" />
                      )}
                      <p className={`text-base font-bold ${!correctAnswer ? 'text-amber-700' : autoIsCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {!correctAnswer ? '无法自动判题：缺失标准答案' : autoIsCorrect ? '自动判题：回答正确' : '自动判题：回答错误'}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-white/60 rounded-lg p-3 border border-border/50">
                        <p className="text-xs text-muted-foreground mb-1">你的答案</p>
                        <p className="text-sm font-medium text-foreground">{userAnswer || '未填写'}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3 border border-border/50">
                        <p className="text-xs text-muted-foreground mb-1">标准答案</p>
                        <p className="text-sm font-medium text-foreground">{correctAnswer || '未设置'}</p>
                      </div>
                    </div>
                    {!correctAnswer && (
                      <p className="mt-3 text-xs text-amber-600 font-medium">提示：本题在数据库中未找到标准答案，请根据解析内容自行评估掌握情况。</p>
                    )}
                  </div>

                  {/* For correct answers, only show explanation if user opts in or if answer is missing */}
                  {(!autoIsCorrect || !correctAnswer || showDetails) ? (
                    <>
                      <div className="border-t border-border pt-6">
                        <p className="text-sm text-primary font-bold tracking-wide uppercase flex items-center gap-2 mb-3">
                          <BookOpen className="h-4 w-4" />
                          题目解析
                        </p>
                        <div className="rounded-xl bg-secondary/10 border border-border/50 p-5 text-foreground leading-relaxed shadow-sm">
                          {current.note || '请按知识点复盘'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border bg-background p-5 space-y-3 shadow-sm">
                        <p className="text-sm font-bold text-foreground flex items-center gap-2">
                          <Zap className="h-4 w-4 text-amber-500" />
                          为什么会这样
                        </p>
                        {diagnosisLoading ? (
                          <div className="space-y-3 animate-pulse">
                            <div className="h-4 bg-muted rounded w-3/4"></div>
                            <div className="h-4 bg-muted rounded w-5/6"></div>
                            <div className="h-4 bg-muted rounded w-1/2"></div>
                            <p className="text-xs text-muted-foreground mt-2 italic flex items-center gap-1">
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              AI 正在深度分析你的作答轨迹...当前先展示规则诊断
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2 animate-in fade-in duration-500">
                            <p className="text-sm text-muted-foreground">{liveDiagnosis.why_wrong}</p>
                            <p className="text-sm text-muted-foreground">{liveDiagnosis.evidence}</p>
                            {liveDiagnosis.history_hint && (
                              <div className="mt-3 pt-3 border-t border-border border-dashed">
                                <p className="text-xs font-medium text-foreground mb-1">历史行为分析</p>
                                <p className="text-sm text-muted-foreground">{liveDiagnosis.history_hint}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-border bg-background p-5 space-y-3 shadow-sm">
                        <p className="text-sm font-bold text-foreground flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          下一步建议
                        </p>
                        {diagnosisLoading ? (
                          <div className="space-y-3 animate-pulse">
                            <div className="h-4 bg-muted rounded w-full"></div>
                            <div className="h-4 bg-muted rounded w-2/3"></div>
                          </div>
                        ) : (
                          <div className="space-y-2 animate-in fade-in duration-500">
                            <p className="text-sm text-muted-foreground">{liveDiagnosis.fix_strategy}</p>
                            <div className="mt-2 inline-flex items-center rounded-md bg-secondary/20 px-2.5 py-1 text-xs font-medium text-foreground">
                              训练方式：{liveDiagnosis.next_practice_type}
                            </div>
                          </div>
                        )}
                      </div>
                      {current.summary && (
                        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 space-y-3 shadow-sm">
                          <p className="text-sm font-bold text-destructive flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" />
                            上次误区
                          </p>
                          <p className="text-sm text-destructive/80 leading-relaxed">{current.summary}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-center pt-2">
                      <button
                        type="button"
                        onClick={() => setShowDetails(true)}
                        className="text-sm text-primary font-medium hover:underline flex items-center gap-1"
                      >
                        <BookOpen className="h-4 w-4" />
                        查看详细解析与建议
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          
          <div className="mt-8 pt-6 border-t border-border animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            {lastScheduleText && (
              <p className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary animate-in fade-in">
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
                }}
                disabled={!canReveal}
                className="group relative overflow-hidden w-full rounded-xl bg-primary px-4 py-4 text-lg font-bold text-primary-foreground hover:bg-primary/90 transition-all shadow-sm disabled:opacity-40 hover:scale-[1.02] active:scale-95"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                <span className="relative z-10">查看解析</span>
              </button>
            ) : (
              <div className="space-y-3 animate-in fade-in slide-in-from-bottom-8 duration-700">
                <p className="text-center text-sm font-medium text-muted-foreground mb-4 relative before:absolute before:top-1/2 before:left-4 before:w-[30%] before:h-px before:bg-border after:absolute after:top-1/2 after:right-4 after:w-[30%] after:h-px after:bg-border">根据你的掌握情况评估</p>
                <div className="grid grid-cols-3 gap-3">
                  <button 
                    type="button" 
                    onClick={() => handleAction('forgot')} 
                    disabled={actionLoading}
                    className="group relative overflow-hidden flex flex-col items-center justify-center gap-1 rounded-xl border border-destructive/30 bg-destructive/5 py-4 text-destructive hover:bg-destructive/10 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
                  >
                    <div className="absolute inset-0 bg-destructive/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                    <span className="relative z-10 text-lg font-bold">忘记了</span>
                    <span className="relative z-10 text-xs opacity-80">1天后复习</span>
                  </button>
                  <button 
                    type="button" 
                    onClick={() => handleAction('vague')} 
                    disabled={actionLoading}
                    className="group relative overflow-hidden flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background py-4 text-foreground hover:bg-accent/50 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
                  >
                    <div className="absolute inset-0 bg-secondary/50 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                    <span className="relative z-10 text-lg font-bold">有点模糊</span>
                    <span className="relative z-10 text-xs text-muted-foreground">2天后复习</span>
                  </button>
                  <button 
                    type="button" 
                    onClick={() => handleAction('mastered')} 
                    disabled={actionLoading}
                    className="group relative overflow-hidden flex flex-col items-center justify-center gap-1 rounded-xl bg-emerald-500 py-4 text-white hover:bg-emerald-600 transition-all shadow-sm hover:shadow-emerald-500/25 hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
                  >
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                    <span className="relative z-10 text-lg font-bold flex items-center gap-1.5"><CheckCircle2 className="h-5 w-5" /> 完全掌握</span>
                    <span className="relative z-10 text-xs opacity-90">4天后复习</span>
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
      <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-12 text-center sm:px-6 animate-in fade-in zoom-in-95 duration-700">
        <div className="relative mx-auto w-32 h-32 mb-8">
          <div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150 animate-pulse" />
          <div className="relative w-full h-full rounded-full bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center shadow-xl shadow-amber-200/50 border-4 border-white">
            <Trophy className="h-14 w-14 text-amber-500 animate-[bounce_2s_infinite]" />
          </div>
        </div>
        <div className="space-y-3 animate-in slide-in-from-bottom-4 fade-in duration-500 delay-150">
          <h1 className="text-4xl font-black text-foreground tracking-tight">今日复习达标！</h1>
          <p className="text-lg text-muted-foreground">你已完成所有复习任务，记忆曲线已更新</p>
        </div>
        <div className="grid grid-cols-1 gap-4 rounded-3xl border border-border bg-card p-8 text-left sm:grid-cols-3 shadow-lg shadow-primary/5 hover:shadow-xl transition-shadow animate-in slide-in-from-bottom-8 fade-in duration-700 delay-300">
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
        {patternRows.length > 0 && (
          <section className="rounded-3xl border border-border bg-card p-8 text-left shadow-lg shadow-primary/5 hover:shadow-xl transition-shadow animate-in slide-in-from-bottom-8 fade-in duration-700 delay-500">
            <p className="text-lg font-bold text-foreground flex items-center gap-2 mb-6">
              <PieChart className="w-5 h-5 text-primary" />
              本次错因分布
            </p>
            <div className="space-y-5">
              {patternRows.map((item, i) => (
                <div key={`${item.key}-${item.count}`} className="animate-in slide-in-from-right-8 fade-in" style={{ animationDelay: `${500 + i * 150}ms`, animationFillMode: 'both' }}>
                  <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground font-medium">
                    <span className="text-foreground">{item.label}</span>
                    <span>{item.count}题 · <span className="opacity-70">{item.percent}%</span></span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-secondary/20">
                    <div className="h-full rounded-full bg-primary transition-all duration-1000 ease-out" style={{ width: `${item.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10 animate-in fade-in duration-700 delay-700">
          <button type="button" onClick={() => navigate('/questions')} className="rounded-xl border border-border bg-card px-8 py-4 font-semibold hover:bg-accent transition-all hover:scale-[1.02] active:scale-95 shadow-sm">
            返回错题库
          </button>
          <button type="button" onClick={() => navigate('/review/stats')} className="rounded-xl bg-primary text-primary-foreground px-8 py-4 font-semibold hover:opacity-90 transition-all hover:scale-[1.02] active:scale-95 shadow-md hover:shadow-lg flex items-center justify-center gap-2">
            <BarChart3 className="w-5 h-5" />
            查看全局错因分析
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-indigo-900 to-primary p-8 sm:p-12 text-center text-white shadow-xl shadow-primary/20 mb-8 group">
        <div className="absolute inset-0 opacity-20 mix-blend-overlay bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.28)_1px,transparent_0)] [background-size:18px_18px]"></div>
        <div className="absolute top-0 right-0 -translate-y-1/4 translate-x-1/4 opacity-10 group-hover:scale-110 transition-transform duration-1000 ease-out">
          <Zap className="w-64 h-64" />
        </div>
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-primary-foreground/10 rounded-full blur-3xl group-hover:bg-primary-foreground/20 transition-colors duration-1000"></div>
        
        <div className="relative z-10 max-w-2xl mx-auto space-y-6">
          <h1 className="text-3xl font-extrabold sm:text-4xl tracking-tight animate-in fade-in slide-in-from-bottom-4 duration-700">今日待复习</h1>
          <div className="flex items-baseline justify-center gap-2 animate-in fade-in zoom-in-95 duration-700 delay-150">
            <span className="text-8xl font-black tracking-tighter drop-shadow-lg">{dueCount}</span>
            <span className="text-2xl font-medium opacity-80">题</span>
          </div>
          <p className="text-base font-medium text-indigo-100 bg-black/20 inline-block px-5 py-2.5 rounded-full backdrop-blur-md border border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
            基于艾宾浩斯记忆曲线，AI 已为您提取今日待巩固错题
          </p>
          
          <div className="pt-8 border-t border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500">
            <button 
              onClick={() => { void startReview(); }}
              className="group/btn relative w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-full bg-white px-10 py-5 text-xl font-bold text-primary shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)] hover:scale-105 hover:shadow-[0_0_60px_-15px_rgba(255,255,255,0.8)] active:scale-95 transition-all duration-300 overflow-hidden"
            >
              <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 ease-out" />
              <Zap className="h-6 w-6 text-amber-500 group-hover/btn:animate-bounce relative z-10" />
              <span className="relative z-10">开始智能复习</span>
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Recharts BarChart */}
        <div className="flex flex-col gap-8">
          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                最近 7 天学习活跃度
              </h2>
            </div>
            
            <div className="h-[250px] w-full mt-auto">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#8C8C8C', fontSize: 12 }} 
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#8C8C8C', fontSize: 12 }} 
                  />
                  <Tooltip 
                    cursor={{ fill: 'transparent' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 6, 6]} barSize={32}>
                    {chartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={index === chartData.length - 1 ? '#4F46E5' : '#E0E7FF'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

            {/* Custom Review Section */}
            <section className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Settings className="h-5 w-5 text-muted-foreground" />
                  自定义复习
                </h2>
              </div>

          <div className="space-y-6 flex-1">
            {/* Subject Toggle */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">选择学科</label>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setConfig(prev => ({ ...prev, subject: '英语' }));
                    setReviewPage(1);
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all active:scale-95 ${config.subject === '英语' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary/20 text-foreground hover:bg-secondary/40'}`}
                >
                  <BookOpen className="h-4 w-4" />
                  英语
                </button>
                <button
                  onClick={() => {
                    setConfig(prev => ({ ...prev, subject: 'C语言' }));
                    setReviewPage(1);
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all active:scale-95 ${config.subject === 'C语言' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary/20 text-foreground hover:bg-secondary/40'}`}
                >
                  <Calculator className="h-4 w-4" />
                  C语言
                </button>
              </div>
            </div>

            {/* Scope Toggle */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">复习范围</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setConfig(prev => ({ ...prev, scope: 'due' }));
                    setReviewPage(1);
                  }}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${config.scope === 'due' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-background border border-border text-foreground hover:bg-accent/50'}`}
                >
                  到期优先 (推荐)
                </button>
                <button
                  onClick={() => {
                    setConfig(prev => ({ ...prev, scope: 'unmastered' }));
                    setReviewPage(1);
                  }}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${config.scope === 'unmastered' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-background border border-border text-foreground hover:bg-accent/50'}`}
                >
                  未掌握优先
                </button>
                <button
                  onClick={() => {
                    setConfig(prev => ({ ...prev, scope: 'stubborn' }));
                    setReviewPage(1);
                  }}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${config.scope === 'stubborn' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-background border border-border text-foreground hover:bg-accent/50'}`}
                >
                  顽固错题
                </button>
                <button
                  onClick={() => {
                    setConfig(prev => ({ ...prev, scope: 'all' }));
                    setReviewPage(1);
                  }}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${config.scope === 'all' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-background border border-border text-foreground hover:bg-accent/50'}`}
                >
                  全部错题
                </button>
              </div>
            </div>

            {/* Sort Toggle */}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-3">
                <label className="text-sm font-semibold text-foreground">排序方式</label>
                <select
                  value={config.sortBy}
                  onChange={(event) => {
                    setConfig(prev => ({ ...prev, sortBy: event.target.value as ReviewConfig['sortBy'] }));
                    setReviewPage(1);
                  }}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 focus:ring-2 ring-primary/20 outline-none transition-all h-10 text-sm"
                >
                  <option value="nearestDue">最近到期</option>
                  <option value="latestWrong">最近做错</option>
                  <option value="lowestMastery">最低掌握度</option>
                </select>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">翻页设置 <span className="text-muted-foreground font-normal ml-1">(共 {totalCount} 题)</span></label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={reviewPage <= 1}
                  onClick={() => setReviewPage((prev) => Math.max(1, prev - 1))}
                  className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/50 disabled:opacity-40 transition-all active:scale-95 disabled:active:scale-100"
                >
                  上一页
                </button>
                <span className="min-w-24 rounded-lg bg-secondary/20 px-3 py-2 text-center text-sm font-semibold text-foreground">
                  第 {reviewPage} 页
                </span>
                <button
                  type="button"
                  disabled={!hasNextPage}
                  onClick={() => setReviewPage((prev) => prev + 1)}
                  className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/50 disabled:opacity-40 transition-all active:scale-95 disabled:active:scale-100"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => startReview(reviewPage)}
            className="w-full mt-6 rounded-xl bg-primary/10 text-primary px-4 py-3.5 text-base font-bold hover:bg-primary hover:text-primary-foreground transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Play className="h-5 w-5" />
            开始自定义复习
          </button>
        </section>
      </div>
    </main>
  );
}
