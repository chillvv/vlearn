import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { practiceApi, questionsApi } from '../lib/api';
import type { Subject, VariantQuestion } from '../lib/types';
import { Dice5, Flame, Target, Sparkles, Clock, BookOpen, Calculator, BarChart3, X, Lightbulb, CheckCircle2, ChevronRight, TrendingUp, RefreshCw, Rocket } from 'lucide-react';
import { Slider } from '../components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';
import { toast } from 'sonner';
import { normalizeCorrectAnswer } from '../lib/questionPayload';
import { formatQuestionTextForStorage } from '../lib/questionPreview';
import { normalizeQuestionTags } from '../lib/questionTagEngine';
import { useKnowledgeNodeMasteryQuery } from '../queries/questions';
import { useCreateQuestionMutation } from '../mutations/questions';

type DrillStatus = 'configuring' | 'ready' | 'loading' | 'active' | 'completed';

type DrillConfig = {
  subject: Subject;
  nodes: string[];
  amount: number;
  strategy: '递进' | '随机' | '攻坚';
};

type PresetState = {
  preset?: Partial<DrillConfig>;
  autoStart?: boolean;
};

const defaultConfig: DrillConfig = {
  subject: '英语',
  nodes: [],
  amount: 10,
  strategy: '递进',
};
const NODE_UI_PAGE_SIZE = 18;
const PRACTICE_AI_PROMPT_VERSION = 'targeted_drill_v3';

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

export function TargetedDrillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as PresetState;

  const [status, setStatus] = useState<DrillStatus>('configuring');
  const [allNodes, setAllNodes] = useState<{name: string, mastery: number}[]>([]);
  const [config, setConfig] = useState<DrillConfig>(defaultConfig);
  const [questions, setQuestions] = useState<VariantQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [correctCount, setCorrectCount] = useState(0);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  const [showAiHint, setShowAiHint] = useState(false);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [practiceSessionId, setPracticeSessionId] = useState<string | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState<number>(Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);
  const [targetAmount, setTargetAmount] = useState(defaultConfig.amount);
  const [nodeLoadMs, setNodeLoadMs] = useState(0);
  const [nodeLoadedPages, setNodeLoadedPages] = useState(0);
  const [nodeUiPage, setNodeUiPage] = useState(1);
  const savedWrongKeysRef = useRef<Set<string>>(new Set());
  const practiceSessionIdRef = useRef<string | null>(null);
  const generationRunRef = useRef(0);
  const nodeMasteryQuery = useKnowledgeNodeMasteryQuery(config.subject, true);
  const createQuestionMutation = useCreateQuestionMutation();

  const resetDrillState = () => {
    setQuestions([]);
    setCurrentIdx(0);
    setSelectedOption('');
    setCorrectCount(0);
    setTimeElapsed(0);
    setIsAnswerSubmitted(false);
    setIsExplanationOpen(false);
    setShowAiHint(false);
    setPracticeSessionId(null);
    setQuestionStartedAt(Date.now());
    setIsSubmitting(false);
    setIsGeneratingMore(false);
    setTargetAmount(defaultConfig.amount);
    setConfirmExit(false);
    savedWrongKeysRef.current.clear();
  };

  useEffect(() => {
    let timer: any;
    if (status === 'active') {
      timer = setInterval(() => setTimeElapsed(t => t + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    practiceSessionIdRef.current = practiceSessionId;
  }, [practiceSessionId]);

  useEffect(() => {
    return () => {
      const pendingSessionId = practiceSessionIdRef.current;
      if (pendingSessionId) {
        void practiceApi.abandonSession(pendingSessionId).catch(() => {});
      }
    };
  }, []);

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
    if (state.preset) {
      setConfig(prev => ({
        ...prev,
        ...state.preset,
      }));
    }
    setStatus('ready');
  }, [state.preset]);

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
    setConfig(prev => ({
      ...prev,
      nodes: prev.nodes.includes(node) ? prev.nodes.filter(item => item !== node) : [...prev.nodes, node],
    }));
  };

  const autoSelectWeakest = () => {
    const weakest = allNodes.slice(0, 3).map(n => n.name);
    setConfig(prev => ({ ...prev, nodes: weakest }));
  };

  const startGenerate = async () => {
    if (!canGenerate) return;
    const runId = Date.now();
    generationRunRef.current = runId;
    setStatus('loading');
    setPracticeSessionId(null);
    savedWrongKeysRef.current.clear();
    setTargetAmount(config.amount);
    setIsGeneratingMore(true);
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
          setIsGeneratingMore(generated < total);
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
            setStatus('active');
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
        setStatus('ready');
        return;
      }
      if (data.variants.length < config.amount) {
        toast.message(`已先生成 ${data.variants.length} 题，可直接开始作答`);
      }
    } catch (error: any) {
      if (generationRunRef.current !== runId) return;
      setIsGeneratingMore(false);
      toast.error(error?.message || '组卷失败，请稍后重试');
      setStatus('ready');
    }
  };

  useEffect(() => {
    if (!state.autoStart || autoStarted || status !== 'ready' || config.nodes.length === 0) return;
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
        ability: '规则应用',
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
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-8 animate-in fade-in duration-700 zoom-in-95">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl animate-pulse scale-150" />
            <div className="relative bg-background p-4 rounded-full border border-primary/20 shadow-lg shadow-primary/10">
              <RefreshCw className="h-12 w-12 text-primary animate-[spin_3s_linear_infinite]" />
              <Rocket className="h-5 w-5 text-indigo-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
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

  if (status === 'active' && currentQuestion) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 h-[calc(100vh-64px)] flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            {confirmExit ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-rose-500">确定退出？</span>
                <button onClick={handleExit} className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-600 transition-colors">确认</button>
                <button onClick={() => setConfirmExit(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">取消</button>
              </div>
            ) : (
              <button onClick={() => setConfirmExit(true)} className="p-2 hover:bg-secondary/20 rounded-full transition-colors text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            )}
            <div className="h-4 w-[1px] bg-border" />
            <span className="text-sm font-semibold text-foreground">专项练习</span>
          </div>
          
          <div className="flex-1 max-w-xs mx-8">
            <div className="flex justify-between text-xs font-medium text-muted-foreground mb-1.5">
              <span>进度</span>
              <span>{Math.min(currentIdx + 1, targetAmount)} / {targetAmount}</span>
            </div>
            <div className="h-1.5 w-full bg-secondary/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-300 rounded-full"
                style={{ width: `${(Math.min(currentIdx + 1, targetAmount) / Math.max(targetAmount, 1)) * 100}%` }}
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground bg-secondary/10 px-3 py-1.5 rounded-full">
            <Clock className="h-4 w-4" />
            <span className="w-10 tabular-nums">{formatTime(timeElapsed)}</span>
          </div>
        </header>

        {/* Core Content Area */}
        <section className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-24">
          <div className="space-y-8 mt-4">
            <p className="text-xl font-medium text-foreground leading-relaxed tracking-wide whitespace-pre-wrap">
              {currentQuestion.question_text}
            </p>
            
            {(currentQuestion.question_type === 'choice' || normalizedOptions.length > 1) ? (
              <div className="grid gap-3">
                {normalizedOptions.map((item, idx) => {
                const value = String.fromCharCode(65 + idx);
                const active = selectedOption === value;
                const isCorrectOption = value === effectiveCorrectAnswer;
                
                let btnClass = 'border-transparent bg-secondary/10 text-foreground hover:bg-secondary/20 hover:border-secondary/30';
                if (active) {
                  btnClass = 'border-primary bg-primary/5 text-primary shadow-sm';
                }
                
                if (isAnswerSubmitted) {
                  if (isCorrectOption) {
                    btnClass = 'border-emerald-500 bg-emerald-500/10 text-emerald-700 shadow-sm';
                  } else if (active && !isCorrectOption) {
                    btnClass = 'border-destructive bg-destructive/10 text-destructive shadow-sm';
                  } else {
                    btnClass = 'border-transparent bg-secondary/5 text-muted-foreground opacity-50';
                  }
                }

                return (
                  <button
                    key={`${idx}-${item}`}
                    type="button"
                    onClick={() => !isAnswerSubmitted && setSelectedOption(value)}
                    disabled={isAnswerSubmitted}
                    className={`rounded-2xl border-2 p-5 text-left transition-all duration-300 ease-out text-lg flex items-center justify-between group transform ${
                      !isAnswerSubmitted && 'hover:-translate-y-1 hover:shadow-md'
                    } ${btnClass}`}
                  >
                    <span className="flex items-center gap-4">
                      <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-base font-bold transition-colors duration-300 ${
                        active && !isAnswerSubmitted 
                          ? 'bg-primary text-primary-foreground shadow-inner scale-105' 
                          : 'bg-background border shadow-sm group-hover:border-primary/50 group-hover:bg-primary/5'
                      }`}>
                        {value}
                      </span>
                      <span className="leading-relaxed">{item.replace(/^[A-H]\.\s*/, '')}</span>
                    </span>
                    {isAnswerSubmitted && isCorrectOption && <CheckCircle2 className="h-7 w-7 text-emerald-500 animate-in zoom-in spin-in-12 duration-500" />}
                    {isAnswerSubmitted && active && !isCorrectOption && <X className="h-7 w-7 text-destructive animate-in zoom-in spin-in-12 duration-500" />}
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
                  className="min-h-[160px] w-full rounded-2xl border-2 border-secondary/30 bg-card p-5 text-base leading-relaxed text-foreground outline-none transition-all duration-300 focus:border-primary/50 focus:ring-4 focus:ring-primary/10 disabled:opacity-60 disabled:bg-secondary/5 resize-y"
                />
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
            
            {showAiHint && !isAnswerSubmitted && (
              <div className="mt-6 p-5 rounded-2xl bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100/60 flex gap-4 animate-in fade-in slide-in-from-top-4 duration-500 shadow-sm">
                <div className="h-10 w-10 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0 border border-indigo-50">
                  <Lightbulb className="h-5 w-5 text-indigo-500 animate-pulse" />
                </div>
                <div className="space-y-1.5 pt-0.5">
                  <p className="text-sm font-bold text-indigo-900 tracking-wide">AI 提示</p>
                  <p className="text-sm text-indigo-700/90 leading-relaxed">
                    {currentQuestion.explanation || '先抽取题干关键词，再对比选项差异，最后回到知识点规则逐一验证。'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Footer fixed at bottom */}
        <footer className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t border-border p-4 sm:px-8 flex items-center justify-between lg:left-[var(--sidebar-width,0px)]">
          <div className="max-w-3xl mx-auto w-full flex items-center justify-between">
            {!isAnswerSubmitted ? (
              <button 
                onClick={() => setShowAiHint(true)}
                disabled={showAiHint}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-primary font-medium hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                <Sparkles className="h-5 w-5" />
                召唤AI提示
              </button>
            ) : (
              <button 
                onClick={() => setIsExplanationOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-foreground font-medium hover:bg-secondary/20 transition-colors border border-border bg-card shadow-sm"
              >
                <BookOpen className="h-5 w-5" />
                查看详细解析
              </button>
            )}
            
            <button
              type="button"
              onClick={submitCurrent}
              disabled={!selectedOption || isSubmitting || (isAnswerSubmitted && currentIdx >= questions.length - 1 && isGeneratingMore)}
              className="rounded-xl bg-primary px-8 py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center gap-2 shadow-sm"
            >
              {!isAnswerSubmitted ? '提交答案' : (currentIdx >= questions.length - 1 ? (isGeneratingMore ? '生成中...' : '完成练习') : '下一题')}
              {!isAnswerSubmitted ? <CheckCircle2 className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            </button>
          </div>
        </footer>

        {/* Explanation Drawer */}
        <Sheet open={isExplanationOpen} onOpenChange={setIsExplanationOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto custom-scrollbar">
            <SheetHeader className="mb-6 border-b border-border pb-4 text-left">
              <SheetTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-primary" />
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
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">AI 步骤解析</h3>
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
      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-12 text-center sm:px-6 animate-in zoom-in-95 fade-in duration-700 ease-out">
        <div className="rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 p-6 w-28 h-28 mx-auto mb-8 flex items-center justify-center shadow-lg shadow-emerald-500/10 border-4 border-white relative overflow-hidden">
          <div className="absolute inset-0 bg-emerald-200/20 animate-pulse"></div>
          <Target className="h-14 w-14 text-emerald-600 animate-in zoom-in spin-in-12 duration-700 delay-150" />
        </div>
        <h1 className="text-4xl font-extrabold text-foreground tracking-tight mb-2">训练完成！</h1>
        <p className="text-muted-foreground mb-8 text-lg">你已完成本组专项训练，太棒了！</p>
        
        <div className="bg-card border border-border/60 rounded-3xl p-8 shadow-xl shadow-primary/5 max-w-md mx-auto transform transition-all hover:-translate-y-1 hover:shadow-2xl duration-300">
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
          <p className="text-base font-medium text-foreground/80 bg-secondary/20 py-2 px-4 rounded-xl inline-block">
            答对 <span className="text-emerald-600 font-bold">{correctCount}</span> / {questions.length} 题
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
          <button type="button" onClick={() => navigate('/questions')} className="rounded-2xl border-2 border-border/60 bg-card px-8 py-4 font-bold text-foreground hover:bg-secondary/30 hover:border-border transition-all duration-300 shadow-sm hover:shadow active:scale-95 flex-1 sm:flex-none">
            返回错题库
          </button>
          <button type="button" onClick={() => { setStatus('configuring'); resetDrillState(); }} className="rounded-2xl bg-primary px-8 py-4 font-bold text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 transition-all duration-300 active:scale-95 flex-1 sm:flex-none">
            再次练习
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">专项练习</h1>
        <p className="text-muted-foreground mt-2">针对薄弱知识点，进行高强度集中突破</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left Side: Knowledge Points Selection (60%) */}
        <section className="flex-1 space-y-6">
          <Tabs value={config.subject} onValueChange={(val) => setConfig(prev => ({ ...prev, subject: val as Subject, nodes: [] }))}>
            <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
              <TabsTrigger value="英语" className="flex gap-2"><BookOpen className="h-4 w-4"/>英语</TabsTrigger>
              <TabsTrigger value="C语言" className="flex gap-2"><Calculator className="h-4 w-4"/>C语言</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm min-h-[400px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                知识点掌握度
              </h2>
              <button 
                onClick={autoSelectWeakest}
                disabled={allNodes.length === 0}
                className="text-sm flex items-center gap-1 text-primary hover:text-primary/80 bg-primary/10 px-3 py-1.5 rounded-full font-medium transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                AI帮你挑
              </button>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-secondary/20 px-2.5 py-1">加载耗时 {Math.round(nodeLoadMs)}ms</span>
              <span className="rounded-full bg-secondary/20 px-2.5 py-1">服务端分页 {nodeLoadedPages} 页</span>
              <span className="rounded-full bg-secondary/20 px-2.5 py-1">当前展示 {nodeUiPage}/{totalNodePages} 页</span>
            </div>

            {allNodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <p>暂无错题知识点</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                {visibleNodes.map(({name, mastery}) => {
                  const active = config.nodes.includes(name);
                  
                  return (
                    <button
                      type="button"
                      key={name}
                      onClick={() => toggleNode(name)}
                      className={`relative group flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all duration-200 
                        ${active 
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm' 
                          : 'border-border bg-background hover:border-primary/50 hover:shadow-sm'
                        }`}
                    >
                      <span className={`text-sm font-medium ${active ? 'text-primary' : 'text-foreground'}`}>
                        {name}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-16 h-1.5 bg-secondary/30 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${mastery < 50 ? 'bg-destructive' : mastery < 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                            style={{ width: `${mastery}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">{mastery}%</span>
                      </div>
                      
                      {/* Selection Indicator */}
                      {active && (
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                      )}
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
        </section>

        {/* Right Side: Configuration & CTA (40%) */}
        <aside className="w-full lg:w-[400px] shrink-0">
          <div className="sticky top-6 space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-bold text-foreground mb-6">练习配置</h2>

            {/* Amount Slider */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-foreground">题目数量</label>
                <span className="text-lg font-bold text-primary">{config.amount} 题</span>
              </div>
              <Slider
                value={[config.amount]}
                onValueChange={(vals) => setConfig(prev => ({ ...prev, amount: vals[0] }))}
                max={30}
                min={5}
                step={5}
                className="my-4"
              />
              <div className="flex gap-2">
                {[10, 20, 30].map(num => (
                  <button
                    key={num}
                    onClick={() => setConfig(prev => ({ ...prev, amount: num }))}
                    className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${config.amount === num ? 'bg-primary text-primary-foreground' : 'bg-secondary/20 text-foreground hover:bg-secondary/40'}`}
                  >
                    {num} 题
                  </button>
                ))}
              </div>
            </div>

            <hr className="border-border" />

            {/* Strategy Selection */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">难度策略</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setConfig(prev => ({ ...prev, strategy: '递进' }))}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '递进' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-accent/50 text-muted-foreground'}`}
                >
                  <TrendingUp className="h-5 w-5" />
                  <span className="text-xs font-medium">递进</span>
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, strategy: '随机' }))}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '随机' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-accent/50 text-muted-foreground'}`}
                >
                  <Dice5 className="h-5 w-5" />
                  <span className="text-xs font-medium">随机</span>
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, strategy: '攻坚' }))}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '攻坚' ? 'border-destructive bg-destructive/5 text-destructive' : 'border-border hover:bg-accent/50 text-muted-foreground'}`}
                >
                  <Flame className="h-5 w-5" />
                  <span className="text-xs font-medium">攻坚</span>
                </button>
              </div>
            </div>

            {/* Estimated Time */}
            <div className="rounded-xl bg-secondary/20 p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">预计需要时间</p>
                <p className="text-sm font-semibold text-foreground">约 {Math.ceil(config.amount * 1.5)} 分钟</p>
              </div>
            </div>

            {/* CTA Button */}
            <button
              type="button"
              onClick={startGenerate}
              disabled={!canGenerate}
              className="w-full rounded-xl bg-gradient-to-r from-primary to-indigo-600 px-6 py-4 text-lg font-bold text-white shadow-md hover:opacity-90 hover:shadow-lg disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2"
            >
              <RocketIcon className="h-5 w-5" />
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
