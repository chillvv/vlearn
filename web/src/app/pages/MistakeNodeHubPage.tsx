import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Compass, Edit2, PenSquare, Rocket, Send, Sparkles, TriangleAlert, X, Plus, BrainCircuit, BookMarked, XCircle, CheckCircle2, RefreshCw, Loader2, ImagePlus, Square, Hash, FileText, GraduationCap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BlockMath } from 'react-katex';
import { buildCopilotLearningProfile, chatApi, nodeDossierApi, questionsApi } from '../lib/api';
import type { CopilotExecutionReceipt, Question, Subject } from '../lib/types';
import { buildCopilotActionRequest, collectMissingTagExtensions, getCanonicalTagDictionary, getCopilotRefreshHints, hydrateTagExtensionsFromCloud, inferMiniCopilotMode, isOutOfScopeLearningRequest, normalizeMistakeDraft, parseCopilotAction, requiresCopilotPreview, stripActionBlock, stripActionForStreaming, summarizeCopilotReceipt, validateCopilotActionRequest, type CopilotActionProposal, type KnowledgeUpdateDraft } from '../lib/copilot';
import { toast } from 'sonner';
import { MistakeQuestionPreview } from '../components/business/MistakeQuestionPreview';
import { KnowledgeUpdatePreview } from '../components/business/KnowledgeUpdatePreview';
import { CopilotHandoffDialog } from '../components/business/CopilotHandoffDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { parseQuestionPreview } from '../lib/questionPreview';
import { useConfirm } from '../components/business/ConfirmProvider';
import { buildTipsFromKeywordCards, getMergedKnowledgeContent, hydrateLearningContentStateFromCloud, mergeLearningDrawerContent, normalizeKnowledgeMarkdown, readLearningContentState, runLearningContentCleanup, writeLearningContentState, type LearningContentState } from '../lib/knowledgeContent';
import { getKnowledgePointsBySubjectFromTaxonomy, inferKnowledgeNodeMetaForNewTag, registerCustomKnowledgeTaxonomy } from '../lib/knowledgeTaxonomy';
import 'katex/dist/katex.min.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { buildCopilotModePrompt, getCopilotCapabilityMeta, getCopilotModeMeta, getMiniCopilotBoundaryHint, getMiniCopilotModeSwitchRules, getModeSwitchToast, inferCopilotCapability, inferCopilotMode, isActionAllowedForMode, normalizeDrillPreset, normalizeReviewPreset, type CopilotCapability, type CopilotMode } from '../lib/copilotMode';
import { runUnifiedDuplicateGuard } from '../lib/mistakeIngestion';
import { matchesQuestionIdentifier, resolveCanonicalMistakeId, resolveCanonicalNodeId, resolveCanonicalTagId } from '../lib/entityIds';
import { buildLearningSessionNavigation, createLearningSessionProposal } from '../lib/learningSession';

type NodeHubState = {
  subject?: Subject;
  category?: string;
  node?: string;
  archiveView?: 'active' | 'archived';
  aiInitialAsk?: string;
  activeQuestionId?: string | null;
  activeQuestionIds?: string[];
};

type NodeHandoffState =
  | {
    kind: 'review';
    capability: CopilotCapability;
    activeMode: CopilotMode;
    sourceLabel: string;
    reason: string;
    expectedBenefit: string;
    preset: ReturnType<typeof normalizeReviewPreset>;
  }
  | {
    kind: 'practice';
    capability: CopilotCapability;
    activeMode: CopilotMode;
    sourceLabel: string;
    reason: string;
    expectedBenefit: string;
    preset: ReturnType<typeof normalizeDrillPreset>;
  };

const CONTEXT_AI_DEEP_THINKING_KEY = 'vlearn_context_ai_deep_thinking';
const CONTEXT_AI_CHAT_TTL_MS = 1000 * 60 * 60 * 12;
const SELECT_EMPTY_VALUE = '__empty__';
const CAPABILITY_ORDER: CopilotCapability[] = ['organize', 'explain', 'recommend', 'launch'];
const toSelectValue = (value: string | null | undefined) => (value ? value : SELECT_EMPTY_VALUE);
const fromSelectValue = (value: string | null | undefined) => (value === SELECT_EMPTY_VALUE ? '' : (value || ''));
const toSafeString = (value: unknown) => (typeof value === 'string' ? value : String(value ?? ''));
const toNodeList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(item => toSafeString(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
};
const getArchiveQueryOptions = (archiveView: 'active' | 'archived') => (
  archiveView === 'archived'
    ? { onlyArchived: true as const }
    : {}
);
const QUESTION_MUTATION_FIELDS = new Set([
  'subject',
  'question_text',
  'category',
  'node',
  'image_url',
  'knowledge_point',
  'ability',
  'error_type',
  'question_type',
  'correct_answer',
  'note',
  'summary',
  'raw_ai_response',
  'normalized_payload',
  'payload_version',
  'validation_status',
  'render_mode',
  'mastery_level',
  'confidence',
  'next_review_date',
  'stability',
  'difficulty',
  'last_interval_days',
  'lapse_count',
  'predicted_recall',
  'priority_score',
  'plan_source',
  'stubborn_flag',
  'mastery_state',
  'mastered_at',
  'is_archived',
  'archived_at',
  'review_count',
]);

const pickQuestionMutationPatch = (input: Record<string, unknown>) => Object.entries(input || {}).reduce<Record<string, unknown>>((result, [key, value]) => {
  if (QUESTION_MUTATION_FIELDS.has(key) && value !== undefined) {
    result[key] = value;
  }
  return result;
}, {});

type ContextAIMessage = {
  role: 'assistant' | 'user';
  content: string;
  image?: string;
  mode?: CopilotMode;
  action?: CopilotActionProposal;
  draft?: Partial<Question>;
  knowledgeUpdates?: KnowledgeUpdateDraft[];
  reasoningContent?: string;
  isError?: boolean;
  originalAsk?: string;
  executionReceipt?: CopilotExecutionReceipt;
};

function buildContextAIChatKey(subject: Subject, category: string, node: string) {
  return `vlearn_context_ai_chat_${subject}__${category}__${node}`;
}

function parseLearningContentActionFromText(raw: string, targetNode: string): CopilotActionProposal | null {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const markdownFromBody = text.match(/(###\s*[\s\S]*)$/)?.[1]?.trim() || text.trim() || '';
  if (!markdownFromBody) return null;
  return {
    type: 'update_learning_content',
    risk: 'low',
    title: '同步知识点沉淀',
    description: '从对话内容自动提取并归并',
    payload: {
      node: targetNode,
      tag: targetNode,
      markdown: markdownFromBody,
    },
  };
}

export function MistakeNodeHubPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || {}) as NodeHubState;

  const subject = (searchParams.get('subject') as Subject | null) || state.subject || '英语';
  const category = searchParams.get('category') || state.category || '未分类';
  const node = searchParams.get('node') || state.node || '其他';
  const hasScopedCategory = searchParams.has('category') || Boolean(state.category);
  const useScopedFilter = hasScopedCategory;

  const [items, setItems] = useState<Question[]>([]);
  const [listPage, setListPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 20;

  const [activeTab, setActiveTab] = useState<'mistakes' | 'knowledge'>('mistakes');
  const [aiPanelOpen, setAiPanelOpen] = useState(Boolean(state.aiInitialAsk || state.activeQuestionId));
  const [aiInitialAsk, setAiInitialAsk] = useState(state.aiInitialAsk || '');
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(state.activeQuestionId || null);
  // const [chatInput, setChatInput] = useState('');
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);
  const [sortBy, setSortBy] = useState<'lowestMastery' | 'latestWrong'>('lowestMastery');
  const [archiveView, setArchiveView] = useState<'active' | 'archived'>(state.archiveView === 'archived' ? 'archived' : 'active');
  const [currentMode, setCurrentMode] = useState<CopilotMode>(state.activeQuestionIds && state.activeQuestionIds.length > 1 ? 'multi_compare' : state.activeQuestionId ? 'single_question' : 'node_summary');
  const [currentCapability, setCurrentCapability] = useState<CopilotCapability>(
    state.activeQuestionIds && state.activeQuestionIds.length > 1 ? 'explain' : state.activeQuestionId ? 'explain' : 'explain',
  );
  const [modeSelectionSource, setModeSelectionSource] = useState<'auto' | 'manual'>('auto');

  // Batch mode state
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [learningContentUpdating, setLearningContentUpdating] = useState(false);
  const [learningContentUpdatedAt, setLearningContentUpdatedAt] = useState<number | null>(null);
  const [handoffState, setHandoffState] = useState<NodeHandoffState | null>(null);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [learningContentVersion, setLearningContentVersion] = useState(0);
  const learningContentState = useMemo(() => readLearningContentState(), [learningContentVersion]);
  const currentModeMeta = getCopilotModeMeta(currentMode);
  const currentCapabilityMeta = getCopilotCapabilityMeta(currentCapability);
  const miniCopilotBoundaryHint = getMiniCopilotBoundaryHint();
  const modeSwitchRules = getMiniCopilotModeSwitchRules();
  const activeQuestionIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeQuestionId) ids.add(activeQuestionId);
    (state.activeQuestionIds || []).forEach((id) => {
      if (id) ids.add(id);
    });
    return Array.from(ids);
  }, [activeQuestionId, state.activeQuestionIds]);
  const handoffResolverRef = useRef<((result: { status: 'start'; preset: NodeHandoffState['preset'] } | { status: 'cancel' }) => void) | null>(null);

  const resolveExplainMode = useCallback((): CopilotMode => {
    if (activeQuestionIds.length > 1) return 'multi_compare';
    if (activeQuestionId) return 'single_question';
    return 'node_summary';
  }, [activeQuestionId, activeQuestionIds.length]);

  const resolveModeByCapability = useCallback((capability: CopilotCapability): CopilotMode => {
    if (capability === 'organize') return 'precise_edit';
    if (capability === 'explain') return resolveExplainMode();
    return 'route';
  }, [resolveExplainMode]);

  const openHandoffDialog = useCallback((nextState: NodeHandoffState) => {
    if (handoffResolverRef.current) {
      handoffResolverRef.current({ status: 'cancel' });
      handoffResolverRef.current = null;
    }
    setHandoffState(nextState);
    return new Promise<{ status: 'start'; preset: NodeHandoffState['preset'] } | { status: 'cancel' }>((resolve) => {
      handoffResolverRef.current = resolve;
    });
  }, []);

  const settleHandoffDialog = useCallback((result: { status: 'start'; preset: NodeHandoffState['preset'] } | { status: 'cancel' }) => {
    setHandoffState(null);
    const resolver = handoffResolverRef.current;
    handoffResolverRef.current = null;
    resolver?.(result);
  }, []);

  const handleCapabilitySelect = useCallback((capability: CopilotCapability) => {
    const nextMode = resolveModeByCapability(capability);
    if (nextMode !== currentMode || capability !== currentCapability) {
      toast.info(`${getCopilotCapabilityMeta(capability).label}：${getCopilotCapabilityMeta(capability).summary}`);
    }
    setCurrentMode(nextMode);
    setCurrentCapability(capability);
    setModeSelectionSource('manual');
  }, [currentCapability, currentMode, resolveModeByCapability]);

  const handleAutoCapability = useCallback((ask: string, hasImage?: boolean) => {
    const inferredMode = inferCopilotMode({ ask, surface: 'node', hasImage });
    const inferredCapability = inferCopilotCapability({ ask, surface: 'node', hasImage });
    if (inferredMode !== currentMode || inferredCapability !== currentCapability) {
      toast.info(getModeSwitchToast(inferredMode));
    }
    setCurrentMode(inferredMode);
    setCurrentCapability(inferredCapability);
    setModeSelectionSource('auto');
    return { inferredMode, inferredCapability };
  }, [currentCapability, currentMode]);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        hydrateLearningContentStateFromCloud(),
        hydrateTagExtensionsFromCloud(),
      ]);
      await runLearningContentCleanup();
      setLearningContentVersion(prev => prev + 1);
    })();
  }, []);

  useEffect(() => {
    if (state.aiInitialAsk) {
      setAiInitialAsk(state.aiInitialAsk);
      setAiPanelOpen(true);
    }
    if (state.activeQuestionId) {
      setActiveQuestionId(state.activeQuestionId);
    }
  }, [state.aiInitialAsk, state.activeQuestionId]);

  useEffect(() => {
    setListPage(1);
  }, [subject, category, node, sortBy, archiveView]);

  const listQuery = useQuery({
    queryKey: [
      ...queryKeys.questionsList({
        subject,
        category,
        nodes: [node],
        sortBy,
        limit: PAGE_SIZE,
        offset: (listPage - 1) * PAGE_SIZE,
      }),
      useScopedFilter ? 'scoped' : 'unscoped',
      archiveView,
    ],
    queryFn: async () => {
      const offset = (listPage - 1) * PAGE_SIZE;
      const withScope = useScopedFilter;
      const fetchTotalCount = async (withCategory: boolean) => {
        return questionsApi.count({
          subject,
          ...(withCategory ? { category } : {}),
          nodes: [node],
          ...getArchiveQueryOptions(archiveView),
        });
      };
      const [primaryList, primaryTotal] = await Promise.all([
        questionsApi.getAll({
          subject,
          ...(withScope ? { category } : {}),
          nodes: [node],
          sortBy,
          limit: PAGE_SIZE,
          offset,
          ...getArchiveQueryOptions(archiveView),
        }),
        fetchTotalCount(withScope),
      ]);
      let result = primaryList;
      let total = primaryTotal;
      if (withScope && total === 0) {
        const [fallbackList, fallbackTotal] = await Promise.all([
          questionsApi.getAll({
            subject,
            nodes: [node],
            sortBy,
            limit: PAGE_SIZE,
            offset,
            ...getArchiveQueryOptions(archiveView),
          }),
          fetchTotalCount(false),
        ]);
        result = fallbackList;
        total = fallbackTotal;
      }
      return { result, total, offset };
    },
    placeholderData: (previous) => previous,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!listQuery.data) return;
    const { result, total, offset } = listQuery.data;
    setTotalCount(total);
    setItems(result);
    setHasNextPage(offset + result.length < total);
  }, [listQuery.data]);

  useEffect(() => {
    if (!listQuery.error) return;
    const err = listQuery.error as Error;
    toast.error(err.message || '加载节点错题失败');
  }, [listQuery.error]);
  const loading = listQuery.isLoading;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)), [totalCount]);

  useEffect(() => {
    if (listPage > totalPages) {
      setListPage(totalPages);
    }
  }, [listPage, totalPages]);

  const handleToggleBatchMode = () => {
    setIsBatchMode(prev => !prev);
    setSelectedIds(new Set());
  };

  const confirm = useConfirm();
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({
      title: '删除题目',
      description: `确定要删除选定的 ${selectedIds.size} 道题目吗？`,
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      const idsArray = Array.from(selectedIds);
      await Promise.all(idsArray.map(id => questionsApi.delete(id)));
      
      setItems(prev => prev.filter(row => !selectedIds.has(row.id)));
      setTotalCount(prev => Math.max(0, prev - idsArray.length));
      
      if (listQuery.data) {
        queryClient.setQueryData(
          [
            ...queryKeys.questionsList({
              subject,
              category,
              nodes: [node],
              sortBy,
              limit: PAGE_SIZE,
              offset: (listPage - 1) * PAGE_SIZE,
            }),
            useScopedFilter ? 'scoped' : 'unscoped',
          ],
          (oldData: any) => {
            if (!oldData) return oldData;
            return {
              ...oldData,
              result: oldData.result.filter((row: any) => !selectedIds.has(row.id)),
              total: Math.max(0, oldData.total - idsArray.length)
            };
          }
        );
      }
      
      toast.success(`成功删除 ${idsArray.length} 道题目`);
      setSelectedIds(new Set());
      setIsBatchMode(false);
    } catch (err: any) {
      toast.error(`批量删除失败: ${err.message}`);
    }
  };

  const handleSelectQuestion = (id: string, selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const unresolvedCount = items.filter(item => (item.mastery_level ?? 0) < 80).length;
  const avgMastery = items.length > 0 ? Math.round(items.reduce((sum, item) => sum + (item.mastery_level ?? 0), 0) / items.length) : 0;

  // const handleChatSubmit = (e: React.FormEvent) => {
  //   e.preventDefault();
  //   if (!chatInput.trim()) return;
  //   setAiInitialAsk(chatInput);
  //   setActiveQuestionId(null);
  //   setChatInput('');
  //   setAiPanelOpen(true);
  // };

  const LeftPaneContent = (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 flex flex-col p-6 lg:p-8 gap-6 pb-12 overflow-hidden">
        {/* Header */}
        <div className="shrink-0">
          <button 
            type="button"
            onClick={() => navigate(`/questions?subject=${encodeURIComponent(subject)}`)} 
            className="group flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            返回错题资产
          </button>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2 font-medium">
            <span>{subject}</span><span>›</span><span>{category}</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">{node}</h1>
        </div>

        {/* Status Card */}
        <div className="shrink-0 flex items-center gap-5 rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
          <div className="relative flex items-center justify-center h-16 w-16">
            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-gray-100" />
              <circle 
                cx="50" cy="50" r="40" 
                stroke="currentColor" strokeWidth="8" fill="transparent" 
                strokeDasharray="251.2" 
                strokeDashoffset={251.2 - (251.2 * avgMastery) / 100} 
                className="text-indigo-600 transition-all duration-1000 ease-out" 
                strokeLinecap="round" 
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center">
              <span className="text-sm font-bold text-gray-900">{avgMastery}%</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-sm font-semibold text-gray-900">当前掌握度</div>
            <div className="text-xs text-gray-500 flex items-center gap-2 font-medium">
              <span>错题 <strong className="text-gray-900">{items.length}</strong> 道</span>
              <span className="w-1 h-1 rounded-full bg-gray-300"></span>
              <span>待攻克 <strong className="text-indigo-600">{unresolvedCount}</strong> 道</span>
            </div>
          </div>
        </div>

        {/* Knowledge Base Card */}
        <div className="flex-1 min-h-0">
          <KnowledgeBaseCard
            tag={node}
            drawerOverrides={learningContentState.drawerByTag}
            isUpdating={learningContentUpdating}
            updatedAt={learningContentUpdatedAt}
            onContentUpdated={() => {
              setLearningContentVersion(prev => prev + 1);
              setLearningContentUpdatedAt(Date.now());
            }}
            items={items}
          />
        </div>
      </div>
    </div>
  );

  const RightPaneContent = (
    <div className="flex flex-col h-full relative bg-[#F5F7FA]">
      <div className="flex-1 overflow-y-auto p-6 lg:p-8 pb-32">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-900">当前标签下的错题 ({items.length} / 共 {totalCount} 道)</h2>
            {isBatchMode ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-indigo-600 font-medium ml-2">
                  已选 {selectedIds.size} 项
                </span>
                <button
                  onClick={() => {
                    if (selectedIds.size === items.length) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(items.map(i => i.id)));
                    }
                  }}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                >
                  全选
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-1 text-xs text-white bg-rose-500 hover:bg-rose-600 disabled:bg-rose-300 px-2.5 py-1.5 rounded-lg transition-colors font-medium shadow-sm"
                >
                  批量删除
                </button>
                <button
                  onClick={handleToggleBatchMode}
                  className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={handleToggleBatchMode}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
              >
                批量管理
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setListPage(prev => Math.max(1, prev - 1))}
              disabled={listPage <= 1 || loading}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              上一页
            </button>
            <span className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs font-semibold text-gray-600">
              第 {listPage}/{totalPages} 页
            </span>
            <button
              type="button"
              onClick={() => setListPage(prev => prev + 1)}
              disabled={!hasNextPage || loading || listPage >= totalPages}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              下一页
            </button>
            <Select value={sortBy} onValueChange={(val: any) => setSortBy(val)}>
              <SelectTrigger className="w-[120px] h-8 rounded-lg border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm cursor-pointer focus:ring-indigo-400/30 hover:bg-gray-50">
                <SelectValue placeholder="排序方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lowestMastery">错误率最高</SelectItem>
                <SelectItem value="latestWrong">最新添加</SelectItem>
              </SelectContent>
            </Select>
            <Select value={archiveView} onValueChange={(val: 'active' | 'archived') => setArchiveView(val)}>
              <SelectTrigger className="w-[100px] h-8 rounded-lg border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm cursor-pointer focus:ring-indigo-400/30 hover:bg-gray-50">
                <SelectValue placeholder="状态过滤" />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value="active">当前</SelectItem>
                <SelectItem value="archived">已归档</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-gray-100 bg-gray-50 p-12 text-center text-gray-500">正在加载错题...</div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-gray-100 bg-gray-50 p-12 text-center text-gray-500">当前节点暂无错题</div>
        ) : (
          <div className="space-y-6">
            {items.map((item) => (
              <MistakeCard
                key={item.id}
                item={item}
                onUpdated={(updated) => setItems(prev => prev.map(row => row.id === updated.id ? updated : row))}
                onDeleted={(id) => {
                  setItems(prev => prev.filter(row => row.id !== id));
                  setTotalCount(prev => Math.max(0, prev - 1));
                  if (listQuery.data) {
                    queryClient.setQueryData(
                      [
                        ...queryKeys.questionsList({
                          subject,
                          category,
                          nodes: [node],
                          sortBy,
                          limit: PAGE_SIZE,
                          offset: (listPage - 1) * PAGE_SIZE,
                        }),
                        useScopedFilter ? 'scoped' : 'unscoped',
                      ],
                      (oldData: any) => {
                        if (!oldData) return oldData;
                        return {
                          ...oldData,
                          result: oldData.result.filter((row: any) => row.id !== id),
                          total: Math.max(0, oldData.total - 1)
                        };
                      }
                    );
                  }
                }}
                onAskAI={(step) => {
                  setAiInitialAsk(`关于【${step}】这部分，我有点没看懂。`);
                  setActiveQuestionId(item.id);
                  setAiPanelOpen(true);
                }}
                selectable={isBatchMode}
                selected={selectedIds.has(item.id)}
                onSelect={(selected) => handleSelectQuestion(item.id, selected)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating CTA */}
      <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
        <div className="pointer-events-auto">
          <button 
            type="button"
            onClick={() => {
              const target = buildLearningSessionNavigation(createLearningSessionProposal({
                sessionKind: 'practice',
                sourceSurface: 'mistake-node-hub',
                sourceReason: '用户从节点页发起专项练习',
                objectiveCode: 'weakness_reinforce',
                explanationSummary: `围绕当前节点「${node || '当前弱点'}」生成专项训练`,
                scope: {
                  subject,
                  nodes: node ? [node] : [],
                  amount: 3,
                  strategy: '攻坚',
                },
                returnPath: {
                  pathname: location.pathname,
                  search: location.search,
                  label: '回到节点页',
                },
                nextStepHint: {
                  kind: 'copilot',
                  label: '完成后回到节点 AI 继续追问',
                  pathname: location.pathname,
                  search: location.search,
                },
              }));
              navigate({
                pathname: target.pathname,
                search: target.search,
              }, {
                state: target.state,
              });
            }}
            className="px-8 py-3.5 rounded-full bg-slate-900 text-white font-bold text-[15px] shadow-lg shadow-slate-900/20 hover:shadow-xl hover:shadow-slate-900/30 hover:-translate-y-1 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 group"
          >
            <Rocket className="w-4 h-4 group-hover:animate-bounce" />
            <span>生成 3 道变式题 (巩固当前弱点)</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen w-full overflow-hidden bg-[#F9FAFB]">
      {/* Mobile/Tablet Tabs */}
      <div className="md:hidden flex flex-col h-full">
        <div className="flex bg-white border-b border-gray-200 shrink-0">
          <button
            className={`flex-1 py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'mistakes' ? 'border-slate-800 text-slate-800' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('mistakes')}
          >
            错题列表
          </button>
          <button
            className={`flex-1 py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'knowledge' ? 'border-slate-800 text-slate-800' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('knowledge')}
          >
            知识点与 AI
          </button>
        </div>
        <div className="flex-1 overflow-hidden relative">
          {activeTab === 'mistakes' ? RightPaneContent : LeftPaneContent}
          {!isDesktop && (
            <ContextualAIPanel
              key={`${subject}-${category}-${node}`}
              open={aiPanelOpen}
              onClose={() => setAiPanelOpen(false)}
              items={items}
              subject={subject}
              category={category}
              node={node}
              activeQuestionId={activeQuestionId}
              activeQuestionIds={activeQuestionIds}
              stepTitle={aiInitialAsk ? undefined : '整题'}
              initialAsk={aiInitialAsk}
              onInitialAskProcessed={() => setAiInitialAsk('')}
              learningContentData={learningContentState.drawerByTag[node] || {}}
              onLearningContentUpdated={() => {
                setLearningContentVersion(prev => prev + 1);
                setLearningContentUpdatedAt(Date.now());
              }}
              onLearningContentUpdatingChange={setLearningContentUpdating}
              onQuestionsUpdated={(updated: Question) => setItems(prev => prev.map(row => row.id === updated.id ? updated : row))}
              onQuestionsDeleted={(id: string) => {
                setItems(prev => prev.filter(row => row.id !== id));
                setTotalCount(prev => Math.max(0, prev - 1));
              }}
              onQuestionsCreated={(created: Question) => {
                setItems(prev => [created, ...prev]);
                setTotalCount(prev => prev + 1);
              }}
              className="absolute inset-0 z-50 flex flex-col bg-white shadow-[20px_0_40px_-15px_rgba(0,0,0,0.05)] animate-in slide-in-from-bottom-8 duration-300"
            />
          )}
        </div>
    </div>

      {/* Desktop Split Workspace */}
      <div className="hidden md:flex h-full w-full relative">
        <div className="w-[55%] min-w-[400px] max-w-[700px] h-full border-r border-gray-200 bg-[#F9FAFB] shrink-0 relative">
          {LeftPaneContent}
        </div>
        
        <div className="flex-1 h-full bg-white min-w-0 relative">
          {RightPaneContent}
          
          {/* Global AI Button */}
          {!aiPanelOpen && isDesktop && (
            <button
              onClick={() => setAiPanelOpen(true)}
              className="absolute bottom-8 right-8 w-14 h-14 bg-indigo-600 rounded-full shadow-lg flex items-center justify-center text-white hover:bg-indigo-700 hover:scale-105 hover:shadow-xl transition-all z-40 animate-in fade-in zoom-in"
              title="唤起 AI 错题管家"
            >
              <Sparkles className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Right sliding AI drawer */}
        {aiPanelOpen && isDesktop && (
          <div className="absolute inset-y-0 right-0 w-[500px] max-w-[45vw] bg-white shadow-[-20px_0_40px_rgba(0,0,0,0.08)] border-l border-gray-200 z-50 flex flex-col animate-in slide-in-from-right duration-300">
            <ContextualAIPanel
              key={`${subject}-${category}-${node}-desktop`}
              open={aiPanelOpen}
              onClose={() => setAiPanelOpen(false)}
              items={items}
              subject={subject}
              category={category}
              node={node}
              activeQuestionId={activeQuestionId}
              activeQuestionIds={activeQuestionIds}
              stepTitle={aiInitialAsk ? undefined : '整题'}
              initialAsk={aiInitialAsk}
              onInitialAskProcessed={() => setAiInitialAsk('')}
              learningContentData={learningContentState.drawerByTag[node] || {}}
              onLearningContentUpdated={() => {
                setLearningContentVersion(prev => prev + 1);
                setLearningContentUpdatedAt(Date.now());
              }}
              onLearningContentUpdatingChange={setLearningContentUpdating}
              onQuestionsUpdated={(updated: Question) => setItems(prev => prev.map(row => row.id === updated.id ? updated : row))}
              onQuestionsDeleted={(id: string) => {
                setItems(prev => prev.filter(row => row.id !== id));
                setTotalCount(prev => Math.max(0, prev - 1));
              }}
              onQuestionsCreated={(created: Question) => {
                setItems(prev => [created, ...prev]);
                setTotalCount(prev => prev + 1);
              }}
              className="flex-1 flex flex-col w-full h-full relative"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeBaseCard({
  tag,
  drawerOverrides,
  isUpdating,
  updatedAt,
  onContentUpdated,
  items,
}: {
  tag: string;
  drawerOverrides: LearningContentState['drawerByTag'];
  isUpdating: boolean;
  updatedAt: number | null;
  onContentUpdated: () => void;
  items: Question[];
}) {
  const [editing, setEditing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const data = useMemo(() => getMergedKnowledgeContent(tag, drawerOverrides), [tag, drawerOverrides]);
  const latestSyncReport = drawerOverrides[tag]?.last_sync_report;
  const [markdownDraft, setMarkdownDraft] = useState(data.markdown || '');

  useEffect(() => {
    setMarkdownDraft(data.markdown || '');
  }, [data.markdown, tag]);

  const handleSave = () => {
    const current = readLearningContentState();
    current.drawerByTag[tag] = {
      ...(current.drawerByTag[tag] || {}),
      title: current.drawerByTag[tag]?.title || tag,
      markdown: normalizeKnowledgeMarkdown(markdownDraft),
      last_sync_report: undefined,
    };
    writeLearningContentState(current);
    onContentUpdated();
    setEditing(false);
    toast.success('知识点内容已保存');
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] flex flex-col relative transition-all duration-300 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.08)] hover:border-indigo-100/80 h-full">
      <div className="shrink-0 p-6 border-b border-gray-50 flex items-center justify-between bg-gradient-to-r from-indigo-50/50 to-transparent rounded-t-3xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white shadow-sm border border-indigo-100 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">AI 专属提分锦囊</h2>
            <p className="text-xs text-gray-500 mt-0.5">围绕当前主知识点持续沉淀高频错题规律</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isUpdating ? (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              同步更新中
            </div>
          ) : updatedAt ? (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              已更新 {new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </div>
          ) : null}
          {latestSyncReport && (
            <button
              type="button"
              onClick={() => setReportOpen(prev => !prev)}
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
            >
              <BookMarked className="h-3 w-3" />
              最近沉淀报告
              <ChevronDown className={`h-3 w-3 transition-transform ${reportOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
            >
              <PenSquare className="h-3.5 w-3.5" />
              编辑知识点
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setMarkdownDraft(data.markdown || '');
                  setEditing(false);
                }}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 active:scale-95 transition-transform"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 active:scale-95 transition-transform shadow-sm"
              >
                <Check className="h-3.5 w-3.5" />
                保存
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5 rounded-b-3xl">
        {reportOpen && latestSyncReport && (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">最近沉淀报告</p>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                latestSyncReport.decision === 'create'
                  ? 'bg-emerald-100 text-emerald-700'
                  : latestSyncReport.decision === 'rewrite'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-200 text-gray-700'
              }`}>
                {latestSyncReport.decision === 'create' ? '已新增' : latestSyncReport.decision === 'rewrite' ? '已改写' : '无需更新'}
              </span>
            </div>
            <p className="text-xs text-gray-600">
              时间：{new Date(latestSyncReport.synced_at).toLocaleString('zh-CN', { hour12: false })}
              {' · '}
              题量：{latestSyncReport.question_count} 题
            </p>
            <p className="text-sm text-gray-700">{latestSyncReport.reason || '无'}</p>
            {latestSyncReport.next_markdown && latestSyncReport.decision !== 'skip' && (
              <div className="rounded-xl border border-indigo-100 bg-white p-3">
                <p className="mb-1 text-xs font-medium text-indigo-700">本次写入后的知识点预览</p>
                <div className="obsidian-markdown prose prose-sm prose-indigo max-w-none text-gray-700">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {latestSyncReport.next_markdown}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
        {!editing ? (
          <>
            {data.markdown && (
              <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">知识点</p>
                <div className="obsidian-markdown prose prose-sm prose-indigo max-w-none text-gray-700 leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {data.markdown}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium">知识点 (支持 Markdown + LaTeX)</p>
              <textarea
                rows={12}
                value={markdownDraft}
                onChange={e => setMarkdownDraft(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all shadow-sm"
                placeholder="输入知识点解析..."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MistakeCard({
  item,
  onUpdated,
  onDeleted,
  onAskAI,
  selectable = false,
  selected = false,
  onSelect,
}: {
  item: Question;
  onUpdated: (next: Question) => void;
  onDeleted: (id: string) => void;
  onAskAI: (step: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleting, setConfirmDeleting] = useState(false);
  const detail = useMemo(() => parseStructuredDetail(item), [item]);
  const dictionary = useMemo(() => getCanonicalTagDictionary(), []);
  const cardKnowledgeOptions = useMemo(
    () => getKnowledgePointsBySubjectFromTaxonomy(item.subject === 'C语言' ? 'C语言' : '英语'),
    [item.subject],
  );
  
  const [draft, setDraft] = useState({
    stem: '',
    options: [] as { label: string; text: string }[],
    correct_answer: '',
    knowledge_point: '',
    note: '',
  });

  useEffect(() => {
    if (editOpen) {
      const parsed = parseQuestionPreview(item.question_text || '');
      setDraft({
        stem: parsed.stem,
        options: parsed.options,
        correct_answer: item.correct_answer || '',
        knowledge_point: item.knowledge_point || '',
        note: item.note || '',
      });
    }
  }, [editOpen, item]);

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const question_text = [
        draft.stem.trim(),
        ...draft.options.map(o => `${o.label}. ${o.text.trim()}`)
      ].filter(Boolean).join('\n');

      const updated = await questionsApi.update(item.id, {
        question_text,
        correct_answer: draft.correct_answer.trim(),
        knowledge_point: draft.knowledge_point.trim(),
        note: draft.note,
      });
      onUpdated(updated);
      setEditOpen(false);
      toast.success('错题内容已更新');
    } catch (error: any) {
      toast.error(error?.message || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleArchive = async () => {
    try {
      const archived = Boolean(item.is_archived || item.mastery_state === 'archived');
      const updated = archived
        ? await questionsApi.unarchive(item.id)
        : await questionsApi.archive(item.id);
      onUpdated(updated);
      toast.success(archived ? '已取消归档' : '已归档');
    } catch (error: any) {
      toast.error(error?.message || '归档操作失败');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await questionsApi.delete(item.id);
      onDeleted(item.id);
      toast.success('错题已删除');
    } catch (error: any) {
      toast.error(error?.message || '删除失败');
      setDeleting(false);
    }
  };
  
  return (
    <article id={`mistake-${item.id}`} className={`group bg-white rounded-2xl p-4 border shadow-sm transition-all duration-300 ${editOpen ? 'border-indigo-400 ring-2 ring-indigo-100 shadow-md' : 'hover:shadow-md hover:border-indigo-300 hover:shadow-indigo-100/50 cursor-pointer'} relative overflow-hidden ${selected ? 'border-indigo-400 bg-indigo-50/20' : 'border-gray-200'}`} onClick={() => {
      if (selectable && onSelect) {
        onSelect(!selected);
      } else {
        !editOpen && setExpanded(!expanded);
      }
    }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 text-xs font-medium">
          {selectable && (
            <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected}
                onChange={e => onSelect?.(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 transition-colors cursor-pointer"
              />
            </div>
          )}
          <span className="text-gray-400">
            {new Date(item.created_at).toLocaleDateString() === new Date().toLocaleDateString() 
              ? '今天' 
              : '昨天'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium text-gray-500">
           <div className="flex items-center gap-2">
             <span>掌握度</span>
             <div className="w-12 h-1.5 rounded-full bg-gray-100 overflow-hidden">
               <div 
                 className="h-full bg-indigo-500 rounded-full transition-all duration-1000" 
                 style={{ width: `${item.mastery_level || 0}%` }}
               ></div>
             </div>
           </div>
           <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
             <button
               type="button"
               onClick={handleToggleArchive}
               className={`rounded-lg border px-3 py-1.5 text-xs font-bold active:scale-95 transition-all shadow-sm ${
                 Boolean(item.is_archived || item.mastery_state === 'archived')
                   ? 'bg-amber-500 border-amber-500 text-white hover:bg-amber-600'
                   : 'bg-white border-amber-200 text-amber-600 hover:bg-amber-50'
               }`}
             >
               {Boolean(item.is_archived || item.mastery_state === 'archived') ? '取消归档' : '归档'}
             </button>
             <button
               type="button"
               onClick={() => {
                 setEditOpen(!editOpen);
                 if (!editOpen) setExpanded(true); // Auto-expand when editing
               }}
               className={`rounded-lg border px-3 py-1.5 text-xs font-bold active:scale-95 transition-all shadow-sm ${editOpen ? 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50' : 'border-indigo-500 bg-indigo-500 text-white hover:bg-indigo-600'}`}
             >
               {editOpen ? '取消编辑' : '编辑'}
             </button>
             {confirmDeleting ? (
               <button
                 type="button"
                 onClick={handleDelete}
                 onMouseLeave={() => setConfirmDeleting(false)}
                 disabled={deleting}
                 className="rounded-lg border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60 active:scale-95 transition-transform shadow-sm"
               >
                 {deleting ? '删除中...' : '确认删除?'}
               </button>
             ) : (
               <button
                 type="button"
                 onClick={() => setConfirmDeleting(true)}
                 className="rounded-lg border border-red-500 bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600 active:scale-95 transition-transform shadow-sm"
               >
                 删除
               </button>
             )}
           </div>
        </div>
      </div>
      
      <div className="mb-2 group/preview relative">
        {editOpen ? (
          <div className="space-y-3 p-3 rounded-xl bg-indigo-50/30 border border-indigo-100/50 transition-all">
            <textarea
              value={draft.stem}
              onChange={e => setDraft(prev => ({ ...prev, stem: e.target.value }))}
              className="w-full bg-transparent resize-none outline-none text-gray-800 text-[15px] leading-relaxed font-serif tracking-wide border-b border-dashed border-indigo-200 focus:border-indigo-400 pb-2 transition-colors"
              rows={Math.max(2, draft.stem.split('\n').length)}
              placeholder="点击编辑题干..."
            />
            {draft.options.length > 0 && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {draft.options.map((opt, i) => (
                  <div key={i} className="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-indigo-100 bg-white px-3 py-1.5 text-xs text-indigo-900 focus-within:ring-2 focus-within:ring-indigo-400 transition-all shadow-sm">
                    <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold bg-slate-100 text-slate-600">
                      {opt.label}
                    </span>
                    <input
                      value={opt.text}
                      onChange={e => {
                        const newOptions = [...draft.options];
                        newOptions[i].text = e.target.value;
                        setDraft(prev => ({ ...prev, options: newOptions }));
                      }}
                      className="min-w-0 flex-1 bg-transparent outline-none font-medium"
                      placeholder={`选项 ${opt.label} 内容`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <MistakeQuestionPreview
            questionText={item.question_text}
            normalizedPayload={item.normalized_payload}
            validationStatus={expanded ? item.validation_status : item.validation_status ? { ...(item.validation_status as any), correct: undefined } : undefined}
            stemClassName="text-gray-800 text-[15px] leading-relaxed font-serif tracking-wide"
            optionClassName="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-1.5 text-xs text-indigo-900"
            maxOptions={expanded ? 8 : 4}
            showKindBadge
            userAnswer={detail.userAnswer || undefined}
            correctAnswer={detail.correctAnswer || undefined}
            showResultComparison={expanded && Boolean(detail.userAnswer) && Boolean(detail.correctAnswer)}
          />
        )}
        {!editOpen && (
          <div className="mt-2 flex justify-center opacity-30 group-hover:opacity-100 transition-opacity duration-300">
            <div className="bg-gray-50 hover:bg-indigo-50 text-gray-400 hover:text-indigo-500 p-1 rounded-full transition-colors cursor-pointer">
              <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
        )}
      </div>
      
      <div className={`grid transition-all duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0'}`} onClick={e => e.stopPropagation()}>
        <div className="overflow-hidden">
          <div className="space-y-4">
            {detail.originalImageUrl && (
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-3 flex justify-center items-center min-h-[120px]">
                <img src={detail.originalImageUrl} alt="source-question" className="max-h-80 w-full rounded-xl object-contain" loading="lazy" decoding="async" />
              </div>
            )}

            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">AI 详细解析</p>
              </div>

              {/* Header 条 */}
              {editOpen ? (
                <div className="flex flex-wrap items-center gap-4 bg-white/80 border border-indigo-200 px-4 py-3 rounded-xl mb-5 text-[13px] font-medium shadow-sm">
                  <label className="flex items-center gap-2 text-gray-700 whitespace-nowrap">
                    正确答案: 
                    <input 
                      value={draft.correct_answer} 
                      onChange={e => setDraft(prev => ({...prev, correct_answer: e.target.value}))}
                      className="w-16 px-2 py-1 rounded-md border border-gray-300 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-gray-700 whitespace-nowrap">
                    考点: 
                    <Select 
                      value={toSelectValue(draft.knowledge_point)} 
                      onValueChange={(val: any) => setDraft(prev => ({...prev, knowledge_point: fromSelectValue(val)}))}
                    >
                      <SelectTrigger className="w-[120px] h-8 bg-white border-gray-300 rounded-md focus:ring-indigo-400 focus:border-indigo-400 px-2 text-xs">
                        <SelectValue placeholder="无" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SELECT_EMPTY_VALUE}>无</SelectItem>
                        {cardKnowledgeOptions.map(tag => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-white/60 border border-indigo-100/50 px-4 py-3 rounded-xl mb-5 text-[13px] font-medium shadow-sm">
                  <span className="text-gray-600 flex items-center">
                    你的作答：
                    <span className="text-rose-600 font-bold ml-1">{detail.userAnswer || '未记录'}</span>
                    {detail.userAnswer && detail.correctAnswer && detail.userAnswer !== detail.correctAnswer && <XCircle className="w-3.5 h-3.5 text-rose-500 ml-1.5" />}
                  </span>
                  <span className="text-gray-600 flex items-center">正确答案：<span className="text-emerald-600 font-bold ml-1">{detail.correctAnswer || '未记录'}</span>{detail.correctAnswer && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-1.5" />}</span>
                </div>
              )}
              {!editOpen && (
                <button
                  onClick={() => onAskAI('整题')}
                  className="mb-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors active:scale-95"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  对这个题有疑问
                </button>
              )}
              
              {editOpen ? (
                <div className="mt-2">
                  <textarea
                    rows={8}
                    value={draft.note}
                    onChange={e => setDraft(prev => ({ ...prev, note: e.target.value }))}
                    className="w-full rounded-xl border border-indigo-200 bg-white/80 p-4 text-[13px] leading-relaxed text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm transition-all resize-y"
                    placeholder="在此编辑解析与笔记内容..."
                  />
                  <div className="mt-4 flex items-center justify-end gap-3 pt-4 border-t border-indigo-100/50">
                    <button
                      type="button"
                      onClick={() => setEditOpen(false)}
                      className="rounded-xl px-5 py-2 text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-all"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className="rounded-xl bg-indigo-600 px-6 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-sm transition-all"
                    >
                      {saving ? '保存中...' : '保存修改'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {detail.steps.map(step => (
                    <div key={`${item.id}-${step.step}`} className="bg-white rounded-xl p-4 border border-indigo-100/50 border-l-4 border-l-indigo-500 shadow-sm transition-all duration-300 hover:shadow-md hover:border-indigo-200">
                      <p className="text-sm font-bold text-gray-900">{step.title}</p>
                      <p className="mt-2 text-sm leading-relaxed text-gray-700">{step.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {detail.formula && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">核心公式</p>
                <div className="mt-2 overflow-x-auto rounded-xl bg-white p-3">
                  <BlockMath math={stripMathWrapper(detail.formula)} />
                </div>
              </div>
            )}

            {detail.prerequisite && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-900 flex items-center gap-1.5">
                  <BookMarked className="w-4 h-4" /> 
                  {detail.prerequisite.title}
                </p>
                <div className="prose prose-sm mt-2 max-w-none text-blue-900">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.prerequisite.content}</ReactMarkdown>
                </div>
              </div>
            )}

            <UserNoteEditor item={item} initialValue={detail.userNote} />

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => toast.success('已记录本条解析问题，稍后将用于模型优化')}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 active:scale-95 transition-transform"
              >
                <TriangleAlert className="h-3.5 w-3.5" />
                报告解析错误
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

type StructuredDetail = {
  coreReason: string;
  steps: Array<{ step: number; title: string; content: string }>;
  formula: string | null;
  prerequisite: { title: string; content: string } | null;
  warningTags: string[];
  originalImageUrl: string | null;
  userNote: string;
  userAnswer: string;
  correctAnswer: string;
};

function extractAnalysisStem(questionText: string) {
  const lines = String(questionText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(我的作答|我的答案|用户作答|用户答案|作答|答案|正确答案|参考答案)[:：]/.test(line));
  return (lines[0] || '').replace(/\s+/g, ' ').trim();
}

function inferTenseDetail(item: Question) {
  const stem = extractAnalysisStem(item.question_text || '');
  const lower = stem.toLowerCase();
  const answer = String(item.correct_answer || item.normalized_payload?.answerSchema?.correctAnswer || '').trim();
  const hasByTheTime = /\bby the time\b/.test(lower);
  const hasPresentInClause = /\bby the time\b[\s\S]{0,80}\b(start|starts|begin|begins|arrive|arrives|come|comes|finish|finishes)\b/.test(lower);
  const hasFuturePerfectAnswer = /\bwill\s+have\s+[a-z]+ed\b/i.test(answer);
  if (hasByTheTime && hasPresentInClause) {
    const steps = [
      { step: 1, title: '锁定时间从句', content: '题干有 by the time，且从句出现 starts 这类一般现在时，说明从句指向将来时间点。' },
      { step: 2, title: '确定主句时态', content: '主句动作发生在该将来时间点之前并已完成，主句应使用将来完成时：will have done。' },
      { step: 3, title: '回扣选项', content: answer ? `正确答案为 ${answer}，符合“到某时之前已经完成”的将来完成时语义。` : '应选包含 will have + 过去分词 的选项。' },
    ];
    return {
      coreReason: 'by the time + 一般现在时从句，主句要用将来完成时',
      steps,
    };
  }
  if (hasByTheTime) {
    const steps = [
      { step: 1, title: '识别题眼', content: '题眼是 by the time，先判断其引导的时间关系。' },
      { step: 2, title: '判断先后', content: '若主句动作在该时间点前完成，主句优先考虑完成时；再根据参照时间是过去/将来决定过去完成或将来完成。' },
      { step: 3, title: '核对答案', content: answer ? `本题答案为 ${answer}，需与“先于时间点完成”的语义一致。` : '最后核对选项是否体现完成体含义。' },
    ];
    return {
      coreReason: hasFuturePerfectAnswer ? '时间点前完成的动作，使用将来完成时' : 'by the time 触发“先后关系”判断，优先考虑完成时',
      steps,
    };
  }
  const tenseRules: Array<{ test: RegExp; reason: string; detail: string }> = [
    { test: /\b(yesterday|last\s+\w+|\d+\s+ago)\b/i, reason: '过去时间状语限定，主句应使用一般过去时', detail: '出现明确过去时间标记，先锁定一般过去时，再匹配动词过去式。' },
    { test: /\b(now|right now|at the moment|look!|listen!)\b/i, reason: '当前正在发生，主句应使用现在进行时', detail: '看到 now/at the moment 等即时信号，优先 be doing 结构。' },
    { test: /\b(since|for)\b/i, reason: '与持续时间相关，优先考虑现在完成时', detail: 'since/for 常与“从过去持续到现在”搭配，优先 have/has done。' },
    { test: /\b(tomorrow|next\s+\w+|in\s+\d+\s+\w+)\b/i, reason: '将来时间信号出现，优先考虑一般将来时', detail: '先识别将来时间状语，再判断是否需要 will do 或其他将来表达。' },
  ];
  const matched = tenseRules.find((rule) => rule.test.test(stem));
  if (matched) {
    return {
      coreReason: matched.reason,
      steps: [
        { step: 1, title: '定位时间信号', content: matched.detail },
        { step: 2, title: '匹配时态结构', content: '根据时间关系选择对应时态，再检查主谓一致与动词形式。' },
        { step: 3, title: '回扣答案', content: answer ? `正确答案为 ${answer}，与题干时间逻辑一致。` : '最终以“时间标记 + 动词形式”双重核对选项。' },
      ],
    };
  }
  return null;
}

function buildProfessionalFallback(item: Question, fallbackAnalysis: string) {
  if (String(item.knowledge_point || '').trim() === '时态') {
    const inferred = inferTenseDetail(item);
    if (inferred) return inferred;
  }
  const answer = String(item.correct_answer || item.normalized_payload?.answerSchema?.correctAnswer || '').trim();
  const stem = extractAnalysisStem(item.question_text || '');
  return {
    coreReason: `${item.knowledge_point || '当前考点'}需要用“题眼→规则→答案”链路判定`,
    steps: [
      { step: 1, title: '定位题眼', content: stem ? `先抓题干中的关键信号词：${stem.slice(0, 48)}${stem.length > 48 ? '...' : ''}` : '先定位题干中的时间词、逻辑词、语法结构等关键信号。' },
      { step: 2, title: '套用规则', content: `回到 ${item.knowledge_point || '该知识点'} 的判定规则，先确定语法关系，再决定词形或句式。` },
      { step: 3, title: '核对选项', content: answer ? `本题答案为 ${answer}，按规则可唯一落在该项。` : (fallbackAnalysis || '逐项排除与规则冲突的选项，保留唯一满足条件的一项。') },
    ],
  };
}

function parseStructuredDetail(item: Question): StructuredDetail {
  const lines = (item.note || '').split('\n').map(line => line.trim()).filter(Boolean);
  const coreLine = lines.find(line => line.startsWith('核心错因：') || line.startsWith('【错因分析】'));
  const formulaLine = lines.find(line => line.startsWith('公式：'));
  const noteLine = lines.find(line => line.startsWith('我的笔记：'));
  const correctAnswerLine = lines.find(line => /^(正确答案|参考答案)[:：]/.test(line));
  
  let steps: Array<{ step: number; title: string; content: string }> = [];
  let currentSection: { step: number; title: string; content: string } | null = null;
  let stepCounter = 1;

  for (const line of lines) {
    if (line.startsWith('我的笔记：') || line.startsWith('公式：') || /^(正确答案|参考答案)[:：]/.test(line) || /^(我的作答|我的答案|用户作答|用户答案|作答|答案)[:：]/.test(line)) {
      continue;
    }
    const headingMatch = line.match(/^【(.+?)】(.*)$/);
    const oldStepMatch = line.match(/^步骤\d+\s*(?:-|:)?\s*(.+?)[:：]\s*(.*)$/) || line.match(/^步骤\d+\s*(?:-|:)?\s*(.+?)\s*$/);
    
    if (headingMatch) {
      if (currentSection) steps.push(currentSection);
      currentSection = {
        step: stepCounter++,
        title: headingMatch[1],
        content: headingMatch[2].trim()
      };
    } else if (oldStepMatch) {
      if (currentSection) steps.push(currentSection);
      currentSection = {
        step: stepCounter++,
        title: oldStepMatch[1].trim(),
        content: (oldStepMatch[2] || '').trim()
      };
    } else {
      if (currentSection) {
        currentSection.content += (currentSection.content ? '\n' : '') + line;
      } else {
        if (!line.startsWith('核心错因：')) {
          currentSection = {
            step: stepCounter++,
            title: '解析详情',
            content: line
          };
        }
      }
    }
  }
  if (currentSection) steps.push(currentSection);
  
  const noteAnswerLine = lines.find(line => /^(我的作答|我的答案|用户作答|用户答案|作答|答案)[:：]/.test(line));
  const noteAnswer = noteAnswerLine?.replace(/^(我的作答|我的答案|用户作答|用户答案|作答|答案)[:：]\s*/, '').trim() || '';
  const textAnswerMatch = item.question_text.match(/(?:我的作答|我的答案|用户作答|用户答案|作答|答案)\s*[:：]?\s*([A-H])/i);
  const extractedUserAnswer = noteAnswer || (textAnswerMatch?.[1]?.toUpperCase() || '');
  const parsedCorrectAnswer = correctAnswerLine?.replace(/^(正确答案|参考答案)[:：]\s*/, '').trim() || '';
  const correctAnswer = item.correct_answer || item.normalized_payload?.answerSchema?.correctAnswer || parsedCorrectAnswer;
  const pureCoreReason = coreLine?.replace(/^(核心错因[:：]|【错因分析】)\s*/, '').trim() || '';
  const analysisOnlyLines = lines.filter(line => !/^(我的笔记|我的作答|我的答案|用户作答|用户答案|作答|答案|正确答案|参考答案)[:：]/.test(line) && !line.startsWith('【'));
  const fallbackAnalysis = pureCoreReason || analysisOnlyLines.join('\n') || item.knowledge_point || '请先定位题干核心信息，再逐项验证。';
  const professionalFallback = buildProfessionalFallback(item, fallbackAnalysis);

  return {
    coreReason: pureCoreReason || professionalFallback.coreReason || item.knowledge_point || '',
    steps: steps.length > 0 ? steps : professionalFallback.steps,
    formula: formulaLine?.replace('公式：', '') || null,
    prerequisite: item.summary
      ? { title: '必备前置知识', content: item.summary }
      : null,
    warningTags: Array.from(new Set([item.knowledge_point].filter(Boolean))) as string[],
    originalImageUrl: item.image_url || null,
    userNote: noteLine?.replace('我的笔记：', '') || '',
    userAnswer: extractedUserAnswer,
    correctAnswer: correctAnswer,
  };
}

function stripMathWrapper(input: string) {
  return input.replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\\\(([\s\S]*)\\\)$/, '$1').trim();
}

function UserNoteEditor({ item, initialValue }: { item: Question; initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const lines = (item.note || '').split('\n').filter(line => line && !line.startsWith('我的笔记：'));
      const merged = [...lines, value ? `我的笔记：${value}` : ''].filter(Boolean).join('\n');
      await questionsApi.update(item.id, { note: merged });
      toast.success('个人笔记已置顶保存');
      setIsEditing(false);
    } catch (error: any) {
      toast.error(error?.message || '笔记保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!value && !isEditing) {
    return (
      <button
        onClick={() => setIsEditing(true)}
        className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-3 text-sm font-medium text-gray-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50"
      >
        <Plus className="h-4 w-4" />
        添加专属笔记
      </button>
    );
  }

  if (value && !isEditing) {
    return (
      <div className="relative mt-2 rounded-2xl bg-[#FEF3C7] p-5 shadow-sm border border-amber-200/50 group">
        <button
          onClick={() => setIsEditing(true)}
          className="absolute top-3 right-3 p-1.5 text-amber-600/50 opacity-0 transition-all hover:bg-amber-200/50 hover:text-amber-700 rounded-lg group-hover:opacity-100"
          title="编辑笔记"
        >
          <Edit2 className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-amber-800 tracking-wider">我的笔记</span>
        </div>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-amber-900 font-medium opacity-90" style={{ fontFamily: 'var(--font-handwriting, sans-serif)' }}>
          {value}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-2xl border border-indigo-200 bg-indigo-50/30 p-4 shadow-inner">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">编辑专属笔记</p>
        <button onClick={() => setIsEditing(false)} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={3}
        className="w-full rounded-xl border border-white bg-white/80 px-4 py-3 text-[14px] leading-relaxed outline-none shadow-sm transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        placeholder="例如：先划关系词，再找先行词，最后核对时态"
        autoFocus
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => {
            setValue(initialValue);
            setIsEditing(false);
          }}
          className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors active:scale-95"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-all disabled:bg-indigo-400 active:scale-95"
        >
          <Check className="h-4 w-4" />
          {saving ? '保存中...' : '保存笔记'}
        </button>
      </div>
    </div>
  );
}

function ContextualAIPanel({ 
  open, 
  onClose, 
  items,
  subject,
  category,
  node,
  activeQuestionId,
  activeQuestionIds,
  stepTitle,
  initialAsk,
  onInitialAskProcessed,
  className,
  learningContentData,
  onLearningContentUpdated,
  onLearningContentUpdatingChange,
  onQuestionsUpdated,
  onQuestionsDeleted,
  onQuestionsCreated,
}: { 
  open: boolean; 
  onClose: () => void; 
  items: Question[];
  subject: Subject;
  category: string;
  node: string;
  activeQuestionId: string | null;
  activeQuestionIds: string[];
  stepTitle?: string;
  initialAsk?: string;
  onInitialAskProcessed?: () => void;
  className?: string;
  learningContentData: any;
  onLearningContentUpdated: () => void;
  onLearningContentUpdatingChange?: (updating: boolean) => void;
  onQuestionsUpdated: (updated: Question) => void;
  onQuestionsDeleted?: (id: string) => void;
  onQuestionsCreated?: (created: Question) => void;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [dictionary, setDictionary] = useState(getCanonicalTagDictionary());
  const chatStorageKey = useMemo(() => buildContextAIChatKey(subject, category, node), [subject, category, node]);
  const defaultAssistantMessage = useMemo<ContextAIMessage>(() => ({
    role: 'assistant',
    content: `我是你的「${node}」专属管家。你可以让我帮你分析错题、修改当前标签的提分锦囊，或是梳理该知识点下的弱项。`,
  }), [node]);
  const [messages, setMessages] = useState<ContextAIMessage[]>(() => {
    try {
      const savedChat = sessionStorage.getItem(chatStorageKey);
      if (savedChat) {
        const parsed = JSON.parse(savedChat);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (Array.isArray(parsed?.messages)) {
          const updatedAt = Number(parsed.updatedAt || 0);
          if (updatedAt > 0 && Date.now() - updatedAt > CONTEXT_AI_CHAT_TTL_MS) {
            sessionStorage.removeItem(chatStorageKey);
          } else {
            return parsed.messages;
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse chat history', error);
    }
    return [defaultAssistantMessage];
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [draftEdits, setDraftEdits] = useState<Record<number, Partial<Question>>>({});
  const [deepThinking, setDeepThinking] = useState(() => {
    try {
      return window.localStorage.getItem(CONTEXT_AI_DEEP_THINKING_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const activeQuestion = useMemo(() => activeQuestionId ? items.find(i => matchesQuestionIdentifier(i, activeQuestionId)) || null : null, [activeQuestionId, items]);
  const activeQuestions = useMemo(() => {
    const ids = new Set(activeQuestionIds);
    if (activeQuestionId) ids.add(activeQuestionId);
    return items.filter((item) => ids.has(item.id) || ids.has(resolveCanonicalMistakeId(item)));
  }, [activeQuestionId, activeQuestionIds, items]);
  const scopeTagId = useMemo(() => resolveCanonicalTagId(activeQuestion || items[0] || { subject, category, node }), [activeQuestion, items, subject, category, node]);
  const scopeNodeId = useMemo(() => resolveCanonicalNodeId(activeQuestion || items[0] || { subject, node }), [activeQuestion, items, subject, node]);
  const activeMistakeId = activeQuestion ? resolveCanonicalMistakeId(activeQuestion) : '';

  const handleUpload = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      toast.success('图片已附加，请输入你的问题或直接发送');
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find(item => item.type.startsWith('image/'));
    if (!imageItem) return;
    const imageFile = imageItem.getAsFile();
    if (!imageFile) return;
    e.preventDefault();
    handleUpload(imageFile);
  };

  useEffect(() => {
    if (open && initialAsk) {
      handleSend(initialAsk);
      if (onInitialAskProcessed) {
        onInitialAskProcessed();
      }
    }
  }, [open, initialAsk]);

  useEffect(() => {
    try {
      const messagesToSave = messages.slice(-50);
      sessionStorage.setItem(chatStorageKey, JSON.stringify({ updatedAt: Date.now(), messages: messagesToSave }));
    } catch (error) {
      console.warn('Session storage is full or unavailable', error);
    }
  }, [messages, chatStorageKey]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await hydrateTagExtensionsFromCloud();
      setDictionary(getCanonicalTagDictionary());
    })();
  }, [open]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONTEXT_AI_DEEP_THINKING_KEY, deepThinking ? '1' : '0');
    } catch {
    }
  }, [deepThinking]);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const buildContextPrompt = async (ask: string, learningProfile: string, hasImage: boolean, mode: CopilotMode, capability: CopilotCapability) => {
    const resolvedWorkMode = inferMiniCopilotMode({
      ask,
      activeMistakeId,
      activeMistakeIds: activeQuestions.map((item) => resolveCanonicalMistakeId(item)),
    });
    const dossier = await nodeDossierApi.getNodeDossier({
      tagId: scopeTagId,
      nodeId: scopeNodeId,
      activeMistakeId: activeMistakeId || undefined,
      activeMistakeIds: activeQuestions.map((item) => resolveCanonicalMistakeId(item)),
      surface: 'mistake_node_hub',
      limit: 10,
      sortBy: 'recent_error_desc',
    }).catch(() => null);
    const itemsSummary = (dossier?.mistake_index || []).map((entry) => `[mistake_id: ${entry.mistake_id}] 排序位 ${entry.sort_position} · ${entry.title_excerpt}`).join('\n');
    const imageHint = hasImage ? '用户已上传题目图片（在前端会话中可见），请结合用户描述完成分析并可以使用 create_mistake 将其录入。' : '用户暂未上传图片。';
    
    return `${learningProfile}
${buildCopilotModePrompt(mode, capability)}

【当前节点上下文】
- 科目：${subject}
- tag_id：${dossier?.scope.tag_id || scopeTagId || '未解析'}
- node_id：${dossier?.scope.node_id || scopeNodeId || '未解析'}
- 知识点：${dossier?.scope.node_name || node}
- 当前用户能力：${getCopilotCapabilityMeta(capability).label}
- 当前工作态：${getCopilotModeMeta(resolvedWorkMode).label}
- snapshot_version：${dossier?.snapshot_version || '未生成'}
- 当前节点错题数：${dossier?.summary.mistake_count ?? items.length}
- 当前排序策略：${dossier?.summary.sort_strategy || 'recent_error_desc'}
- 错题索引摘要：
${itemsSummary || '暂无错题'}

${imageHint}

【该知识点的当前解析内容】
- 完整内容：${dossier?.node_notebook.content_markdown || learningContentData?.markdown || '暂无'}

${activeQuestion ? `
【用户当前正在查看的具体错题】
- mistake_id：${resolveCanonicalMistakeId(activeQuestion)}
- 完整题目：${activeQuestion.question_text}
- 正确答案：${activeQuestion.correct_answer || '未记录'}
- 当前提问环节：${stepTitle || '整题'}
` : '【用户当前在看整个知识点页面，没有针对特定的一道题提问】'}

${activeQuestions.length > 1 ? `
【当前比较集合】
- active_mistake_ids：${activeQuestions.map((item) => resolveCanonicalMistakeId(item)).join('、')}
` : ''}

用户请求：${ask}

作为标签内的专属 AI 小管家，你可以：
1. 优先解答用户在这个知识点下的疑惑。如果是上传了图片，请识别并分析，使用 create_mistake 动作。
2. 你可以主动建议或执行修改这个知识点的“完整内容”(使用 update_learning_content 动作)。注意：你可以读取上面的【该知识点的当前解析内容】，然后在其基础上重写并提供新的 markdown 内容。务必遵循“知识浓缩”原则，把零散规律归并成高可读性的结构化内容。
3. 你可以帮助修改错题内容，优先使用 update_mistake、move_mistake_to_node、delete_mistake、batch_update_mistakes、rewrite_node_notebook、compare_mistakes 等按 ID 定位动作；旧动作 update_tags 仅用于兼容。
4. 如果用户询问全局弱点，你也可以根据学习档案快照回答。
5. 只给证据驱动的解析，不写空话；必须使用“题眼→规则→答案回扣”。
6. 当你建议 create_mistake、update_mistake 或 update_tags 时，可以额外产出可用于 update_learning_content 的 node 和 markdown，但不要因此替代原本的结构化动作。
7. 当你输出 update_learning_content 时，必须遵守以下格式契约：
   - 摒弃过去“每题一个新增错题沉淀”的追加模式。把零散规律合并为结构化的高质量 Markdown。
   - Markdown 必须像人们日常做学习笔记或复习教材那样，根据知识点的具体子模块（如“运算符优先级”、“常见输出格式符”等）划分为不同的 \`###\` 标题归类；当知识点体量较大（如 C 语言-结构体）时，在组内继续使用 \`####\` 拆分子点。每个标题下用短横线 bullet(-) 罗列要点。禁止添加任何“这是知识点总结”之类冗余大标题。不再强制使用“解题方法/判断线索”，而是根据内容自然分类。
   - 直接用你最好的总结重写并覆盖已有内容，保持 Markdown 简洁、结构化。
   - 如果你能判断更新性质，请额外输出 \`decision\`（skip / rewrite / create）和 \`reason\`，帮助前端展示“无需更新 / 建议改写 / 建议新增”的说明。
8. 若执行写动作，请在 payload 中尽量携带 \`mistake_id\`、\`node_id\`、\`tag_id\`、\`snapshot_version\`、修改原因、风险等级与影响范围。`;
  };

  const syncKnowledgeFromMistake = (input: Partial<Question>) => {
    const targetNode = String(input.knowledge_point || input.node || node || '').trim();
    if (!targetNode) return;
    const current = readLearningContentState();
    const merged = mergeLearningDrawerContent(current.drawerByTag[targetNode], {
      targetNode,
      note: input.note,
      source: 'mistake_sync',
    });
    current.drawerByTag[targetNode] = merged.drawer;
    writeLearningContentState(current);
    onLearningContentUpdated();
  };

  const applyKnowledgeUpdates = (updates: KnowledgeUpdateDraft[], options?: { toastOnSuccess?: boolean; toastOnEmpty?: boolean }) => {
    onLearningContentUpdatingChange?.(true);
    try {
      const current = readLearningContentState();
      let updatedCount = 0;
      let skippedCount = 0;
      for (const update of updates) {
        if (!update || typeof update !== 'object') continue;
        const targetTag = String(update.tag || '').trim();
        if (!targetTag) continue;
        const merged = mergeLearningDrawerContent(current.drawerByTag[targetTag], {
          targetNode: targetTag,
          note: update.note,
          markdown: update.markdown,
          reason: update.reason,
          decision: update.decision,
          source: 'ai_update',
        });
        current.drawerByTag[targetTag] = {
          ...merged.drawer,
          ...(update.title ? { title: String(update.title) } : {}),
        };
        if (merged.decision === 'skip') {
          skippedCount++;
        } else {
          updatedCount++;
        }
      }
      if (updatedCount > 0 || skippedCount > 0) {
        writeLearningContentState(current);
        onLearningContentUpdated();
        if (options?.toastOnSuccess !== false) {
          if (updatedCount > 0 && skippedCount > 0) {
            toast.success(`AI 已改写 ${updatedCount} 个知识点，另有 ${skippedCount} 个无需更新`);
          } else if (updatedCount > 0) {
            toast.success(`AI 内容已归并到 ${updatedCount} 个知识点`);
          } else {
            toast.success(`本次 ${skippedCount} 个知识点均无需更新`);
          }
        }
      } else if (options?.toastOnEmpty !== false) {
        toast.error('缺少知识点标签，无法更新知识点内容');
      }
      return updatedCount;
    } finally {
      onLearningContentUpdatingChange?.(false);
    }
  };

  const executeAction = async (action: CopilotActionProposal, draft?: Partial<Question>, options?: { mode?: CopilotMode; stage?: 'preview' | 'confirm' | 'execute' }) => {
    const activeMode = options?.mode || currentMode;
    if (!isActionAllowedForMode(activeMode, action.type)) {
      throw new Error(`${getCopilotModeMeta(activeMode).label}不允许直接执行「${action.type}」动作，请先切换到匹配模式后再继续。`);
    }
    const uniqueIds = (values: Array<string | null | undefined>) => Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
    const mergeFollowUpUpdates = (...groups: Array<Array<string | null | undefined> | undefined>) => uniqueIds(groups.flatMap((group) => group || []));
    const getNodeSnapshot = async (input?: { tagId?: string; nodeId?: string; activeMistakeId?: string | null; activeMistakeIds?: string[] }) => {
      const tagId = String(input?.tagId || scopeTagId || '').trim();
      const nodeId = String(input?.nodeId || scopeNodeId || '').trim();
      if (!tagId && !nodeId) return null;
      return nodeDossierApi.getNodeDossier({
        tagId: tagId || undefined,
        nodeId: nodeId || undefined,
        activeMistakeId: input?.activeMistakeId || undefined,
        activeMistakeIds: input?.activeMistakeIds,
        surface: 'mistake_node_hub',
        limit: 10,
        sortBy: 'recent_error_desc',
      }).catch(() => null);
    };
    const buildReceipt = (input: {
      request: ReturnType<typeof buildCopilotActionRequest>;
      success: boolean;
      executedStage?: CopilotExecutionReceipt['executed_stage'];
      appliedFields?: string[];
      skippedFields?: string[];
      validationWarnings?: string[];
      failureReason?: string;
      latestSnapshotVersion?: string;
      affectedTagIds?: string[];
      affectedNodeIds?: string[];
      affectedMistakeIds?: string[];
      followUpUpdates?: string[];
      preview?: CopilotExecutionReceipt['preview'];
    }): CopilotExecutionReceipt => ({
      action_type: input.request.action_type,
      requested_stage: input.request.stage,
      executed_stage: input.executedStage || input.request.stage,
      success: input.success,
      target_ids: input.request.target_ids,
      applied_fields: input.appliedFields || [],
      skipped_fields: input.skippedFields || [],
      validation_warnings: input.validationWarnings || [],
      failure_reason: input.failureReason,
      latest_snapshot_version: input.latestSnapshotVersion,
      affected_objects: {
        tag_ids: uniqueIds(input.affectedTagIds || []),
        node_ids: uniqueIds(input.affectedNodeIds || []),
        mistake_ids: uniqueIds(input.affectedMistakeIds || []),
      },
      follow_up_updates: input.followUpUpdates || [],
      preview: input.preview,
    });
    const normalizeSectionKey = (value: unknown) => String(value || '').replace(/\s+/g, '').toLowerCase();
    const buildPreviewReceipt = (
      request: ReturnType<typeof buildCopilotActionRequest>,
      input: {
        title: string;
        summary: string;
        affectedIds: string[];
        followUpUpdates?: string[];
        affectedTagIds?: string[];
        affectedNodeIds?: string[];
        affectedMistakeIds?: string[];
      },
    ) => buildReceipt({
      request,
      success: true,
      executedStage: 'preview',
      preview: {
        title: input.title,
        summary: input.summary,
        affected_count: input.affectedIds.length,
        affected_ids: input.affectedIds,
      },
      followUpUpdates: input.followUpUpdates || [],
      affectedTagIds: input.affectedTagIds,
      affectedNodeIds: input.affectedNodeIds,
      affectedMistakeIds: input.affectedMistakeIds,
    });
    const getNotebookSourceKey = (snapshot: Awaited<ReturnType<typeof getNodeSnapshot>> | null) => String(
      snapshot?.node_notebook.source_key
      || snapshot?.scope.node_id
      || snapshot?.scope.node_name
      || node
      || ''
    ).trim();
    const writeNotebookContent = async (input: {
      snapshot: Awaited<ReturnType<typeof getNodeSnapshot>> | null;
      markdown: string;
      decision?: 'create' | 'rewrite' | 'skip';
      reason?: string;
    }) => {
      const sourceKey = getNotebookSourceKey(input.snapshot);
      if (!sourceKey) {
        throw new Error('当前节点缺少可写入的笔记容器');
      }
      const current = readLearningContentState();
      const existingDrawer = current.drawerByTag[sourceKey];
      const merged = mergeLearningDrawerContent(existingDrawer, {
        targetNode: sourceKey,
        markdown: input.markdown,
        decision: input.decision,
        reason: input.reason,
        source: 'ai_update',
      });
      current.drawerByTag[sourceKey] = {
        ...merged.drawer,
        ...(input.snapshot?.node_notebook.title ? { title: input.snapshot.node_notebook.title } : {}),
      };
      writeLearningContentState(current);
      onLearningContentUpdated();
      return { sourceKey, merged };
    };
    const syncUpdatedQuestion = (previous: Question, updated: Question) => {
      const stayedInCurrentNode = resolveCanonicalNodeId(updated) === scopeNodeId || String(updated.knowledge_point || '').trim() === node;
      if (stayedInCurrentNode) {
        onQuestionsUpdated(updated);
        return;
      }
      onQuestionsDeleted?.(previous.id);
    };
    const doExecute = async () => {
      const activeQuestion = activeQuestionId ? items.find(i => matchesQuestionIdentifier(i, activeQuestionId)) : items[0];
      const currentSnapshot = await getNodeSnapshot({
        tagId: scopeTagId,
        nodeId: scopeNodeId,
        activeMistakeId: activeMistakeId || undefined,
        activeMistakeIds: activeQuestions.map((item) => resolveCanonicalMistakeId(item)),
      });
      const request = buildCopilotActionRequest({
        action,
        scope: {
          tag_id: currentSnapshot?.scope.tag_id || scopeTagId,
          node_id: currentSnapshot?.scope.node_id || scopeNodeId,
          mistake_id: activeMistakeId || undefined,
          mistake_ids: activeQuestions.map((item) => resolveCanonicalMistakeId(item)),
          surface: 'mistake_node_hub',
          work_mode: inferMiniCopilotMode({
            ask: '',
            activeMistakeId: activeMistakeId || undefined,
            activeMistakeIds: activeQuestions.map((item) => resolveCanonicalMistakeId(item)),
            explicitActionType: action.type,
          }),
        },
        snapshot_version: currentSnapshot?.snapshot_version,
        draft,
        stage: options?.stage || (requiresCopilotPreview(action.type) ? 'preview' : 'execute'),
      });
      const requestValidation = validateCopilotActionRequest(request, {
        currentTagId: currentSnapshot?.scope.tag_id || scopeTagId,
        currentNodeId: currentSnapshot?.scope.node_id || scopeNodeId,
        availableMistakeIds: items.map((item) => resolveCanonicalMistakeId(item)),
        allowCrossNodeTarget: action.type === 'move_mistake_to_node',
      });
      if (!requestValidation.ok) {
        return buildReceipt({
          request,
          success: false,
          validationWarnings: requestValidation.warnings,
          failureReason: requestValidation.errors.join('；'),
          affectedTagIds: requestValidation.refresh_targets.tag_ids,
          affectedNodeIds: requestValidation.refresh_targets.node_ids,
          affectedMistakeIds: requestValidation.refresh_targets.mistake_ids,
          followUpUpdates: getCopilotRefreshHints(action.type),
        });
      }
      const payloadSnapshot = String(action.payload?.snapshot_version || '').trim();
      if (payloadSnapshot && currentSnapshot?.snapshot_version && payloadSnapshot !== currentSnapshot.snapshot_version) {
        return buildReceipt({
          request,
          success: false,
          validationWarnings: ['当前动作引用的 snapshot_version 已过期', ...requestValidation.warnings],
          failureReason: '请先刷新当前节点 dossier 后再重试',
          affectedTagIds: [currentSnapshot.scope.tag_id],
          affectedNodeIds: [currentSnapshot.scope.node_id],
        });
      }
      const targetQuestionId = action.payload?.mistake_id || action.payload?.question_id || request.target_ids.mistake_id || activeQuestion?.id;
      const targetQuestion = items.find(i => matchesQuestionIdentifier(i, targetQuestionId)) || activeQuestion || { subject, knowledge_point: node, question_text: '' } as unknown as Question;
      const requestedMistakeIds = uniqueIds([
        ...(request.target_ids.mistake_ids || []),
        request.target_ids.mistake_id || '',
      ]);
      if (request.stage === 'confirm' && action.risk === 'high') {
        const approved = await confirm({
          title: '确认执行高风险动作',
          confirmText: '继续执行',
          cancelText: '取消',
          tone: 'danger',
          description: '预览已生成，请确认当前作用范围、对象数量与修改内容后再正式执行。',
        });
        if (!approved) return null;
      }

      const registerTagExtensions = async (input?: Partial<Question>) => {
        const additions = collectMissingTagExtensions(input, dictionary);
        const hasNewTags = additions.knowledge_point.length;
        if (!hasNewTags) return true;
        const sections = [
          additions.knowledge_point.length ? `知识点：${additions.knowledge_point.join('、')}` : '',
        ].filter(Boolean);
        const approved = await confirm({
          title: '发现新标签，是否创建？',
          confirmText: '创建并继续',
          cancelText: '取消',
          description: (
            <div className="space-y-2 text-sm text-gray-700">
              <p>以下标签不在当前标签库中：</p>
              <div className="rounded-xl bg-gray-50 px-3 py-2 leading-relaxed">{sections.join('\n')}</div>
            </div>
          ),
        });
        if (!approved) {
          toast.info('已取消创建新标签');
          return false;
        }
        const normalizedSubject = (input?.subject === 'C语言' ? 'C语言' : input?.subject === '英语' ? '英语' : subject) as Subject;
        for (const tag of additions.knowledge_point) {
          const inferredMeta = inferKnowledgeNodeMetaForNewTag(normalizedSubject, tag);
          await registerCustomKnowledgeTaxonomy(tag, inferredMeta.category, inferredMeta.branch, normalizedSubject);
        }
        setDictionary(getCanonicalTagDictionary());
        return true;
      };
      
      if (action.type === 'create_mistake') {
        const patch = pickQuestionMutationPatch((request.field_patch || {}) as Record<string, unknown>);
        const canCreateTags = await registerTagExtensions(patch as Partial<Question>);
        if (!canCreateTags) return null;
        const normalized = normalizeMistakeDraft({
          subject: subject as any,
          question_text: targetQuestion.question_text || '',
          knowledge_point: targetQuestion.knowledge_point || node,
          ...patch,
        });
        const duplicateGuard = await runUnifiedDuplicateGuard([normalized]);
        if (duplicateGuard.duplicateCount > 0) {
          if (duplicateGuard.finalInsertList.length === 0) {
            return buildReceipt({
              request,
              success: false,
              validationWarnings: [duplicateGuard.duplicateReasons[0] || '命中统一去重护栏'],
              failureReason: '重复保护已阻止创建新错题',
              affectedTagIds: [request.target_ids.tag_id || currentSnapshot?.scope.tag_id || scopeTagId],
              affectedNodeIds: [request.target_ids.node_id || currentSnapshot?.scope.node_id || scopeNodeId],
            });
          }
        }
        const created = await questionsApi.create(duplicateGuard.finalInsertList[0] || normalized);
        syncKnowledgeFromMistake(created);
        const syncedCount = applyKnowledgeUpdates(extractKnowledgeUpdatesFromAction(action) || [], { toastOnSuccess: false, toastOnEmpty: false });
        if (onQuestionsCreated) onQuestionsCreated(created);
        toast.success(syncedCount > 0 ? `已确认并存入错题库，并同步 ${syncedCount} 个知识点` : '已确认并存入错题库');
        const latestSnapshot = await getNodeSnapshot({
          tagId: resolveCanonicalTagId(created),
          nodeId: resolveCanonicalNodeId(created),
          activeMistakeId: resolveCanonicalMistakeId(created),
        });
        return buildReceipt({
          request,
          success: true,
          appliedFields: Object.keys(patch),
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [resolveCanonicalTagId(created)],
          affectedNodeIds: [resolveCanonicalNodeId(created)],
          affectedMistakeIds: [resolveCanonicalMistakeId(created)],
          followUpUpdates: mergeFollowUpUpdates(
            syncedCount > 0 ? [`已同步 ${syncedCount} 个知识点笔记块`] : ['已生成新错题对象'],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'update_tags') {
        if (!targetQuestion.id) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '找不到要更新的错题',
            affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
            affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
          });
        }
        const patch = pickQuestionMutationPatch((request.field_patch || {}) as Record<string, unknown>);
        const normalized = normalizeMistakeDraft({
          ...targetQuestion,
          subject: targetQuestion.subject as any,
          ...patch,
        });
        const canCreateTags = await registerTagExtensions(normalized);
        if (!canCreateTags) return null;
        const updates = {
          knowledge_point: normalized.knowledge_point,
          note: normalized.note,
          summary: normalized.summary,
        };
        const updated = await questionsApi.update(request.target_ids.mistake_id || targetQuestion.id, updates);
        syncKnowledgeFromMistake(updated);
        const syncedCount = applyKnowledgeUpdates(extractKnowledgeUpdatesFromAction(action) || [], { toastOnSuccess: false, toastOnEmpty: false });
        syncUpdatedQuestion(targetQuestion, updated);
        toast.success(syncedCount > 0 ? `错题标签已更新，并同步 ${syncedCount} 个知识点` : '错题标签已更新');
        const latestSnapshot = await getNodeSnapshot({
          tagId: resolveCanonicalTagId(updated),
          nodeId: resolveCanonicalNodeId(updated),
          activeMistakeId: resolveCanonicalMistakeId(updated),
        });
        return buildReceipt({
          request,
          success: true,
          appliedFields: Object.keys(updates).filter((key) => (updates as Record<string, unknown>)[key] !== undefined),
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [resolveCanonicalTagId(targetQuestion), resolveCanonicalTagId(updated)],
          affectedNodeIds: [resolveCanonicalNodeId(targetQuestion), resolveCanonicalNodeId(updated)],
          affectedMistakeIds: [resolveCanonicalMistakeId(updated)],
          followUpUpdates: mergeFollowUpUpdates(
            syncedCount > 0 ? [`已同步 ${syncedCount} 个知识点笔记块`] : ['已刷新当前错题所属节点'],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'update_mistake') {
        if (!targetQuestion.id) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '找不到要更新的错题',
            affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
            affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
          });
        }
        const patch = pickQuestionMutationPatch((request.field_patch || {}) as Record<string, unknown>);
        if (Object.keys(patch).length === 0) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '缺少可执行的字段 patch',
            affectedTagIds: [resolveCanonicalTagId(targetQuestion)],
            affectedNodeIds: [resolveCanonicalNodeId(targetQuestion)],
            affectedMistakeIds: [resolveCanonicalMistakeId(targetQuestion)],
          });
        }
        const canCreateTags = await registerTagExtensions(patch as Partial<Question>);
        if (!canCreateTags) return null;
        const updated = await questionsApi.update(request.target_ids.mistake_id || targetQuestion.id, patch as Partial<Question>);
        syncKnowledgeFromMistake(updated);
        const syncedCount = applyKnowledgeUpdates(extractKnowledgeUpdatesFromAction(action) || [], { toastOnSuccess: false, toastOnEmpty: false });
        syncUpdatedQuestion(targetQuestion, updated);
        toast.success(syncedCount > 0 ? `错题内容已更新，并同步 ${syncedCount} 个知识点` : '错题内容已更新');
        const latestSnapshot = await getNodeSnapshot({
          tagId: resolveCanonicalTagId(updated),
          nodeId: resolveCanonicalNodeId(updated),
          activeMistakeId: resolveCanonicalMistakeId(updated),
        });
        return buildReceipt({
          request,
          success: true,
          appliedFields: Object.keys(patch),
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [resolveCanonicalTagId(targetQuestion), resolveCanonicalTagId(updated)],
          affectedNodeIds: [resolveCanonicalNodeId(targetQuestion), resolveCanonicalNodeId(updated)],
          affectedMistakeIds: [resolveCanonicalMistakeId(updated)],
          followUpUpdates: mergeFollowUpUpdates(
            syncedCount > 0 ? [`已同步 ${syncedCount} 个知识点笔记块`] : ['已刷新当前错题详情'],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'move_mistake_to_node') {
        if (!targetQuestion.id) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '找不到要迁移的错题',
            affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
            affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
          });
        }
        const targetKnowledgePoint = String(
          action.payload?.target_knowledge_point
          || action.payload?.target_node_name
          || action.payload?.target_node
          || action.payload?.knowledge_point
          || action.payload?.node
          || ''
        ).trim();
        if (!targetKnowledgePoint) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '迁移动作缺少目标知识点',
            affectedTagIds: [resolveCanonicalTagId(targetQuestion)],
            affectedNodeIds: [resolveCanonicalNodeId(targetQuestion)],
            affectedMistakeIds: [resolveCanonicalMistakeId(targetQuestion)],
          });
        }
        if (request.stage === 'preview') {
          return buildPreviewReceipt(request, {
            title: '迁移错题预览',
            summary: `将把 1 道错题迁移到「${targetKnowledgePoint}」并刷新原节点与目标节点。`,
            affectedIds: [resolveCanonicalMistakeId(targetQuestion)],
            followUpUpdates: mergeFollowUpUpdates(
              ['确认后将更新知识点归属、节点统计与 dossier 快照'],
              getCopilotRefreshHints(action.type),
            ),
            affectedTagIds: [resolveCanonicalTagId(targetQuestion)],
            affectedNodeIds: [resolveCanonicalNodeId(targetQuestion)],
            affectedMistakeIds: [resolveCanonicalMistakeId(targetQuestion)],
          });
        }
        const targetSubject = (targetQuestion.subject === 'C语言' ? 'C语言' : '英语') as Subject;
        const inferredMeta = inferKnowledgeNodeMetaForNewTag(targetSubject, targetKnowledgePoint);
        const canCreateTags = await registerTagExtensions({
          subject: targetSubject,
          knowledge_point: targetKnowledgePoint,
        });
        if (!canCreateTags) return null;
        const updated = await questionsApi.update(request.target_ids.mistake_id || targetQuestion.id, {
          knowledge_point: targetKnowledgePoint,
          node: targetKnowledgePoint,
          category: inferredMeta.category,
        });
        syncUpdatedQuestion(targetQuestion, updated);
        toast.success(`错题已迁移到 ${targetKnowledgePoint}`);
        const latestSnapshot = await getNodeSnapshot({
          tagId: resolveCanonicalTagId(updated),
          nodeId: resolveCanonicalNodeId(updated),
          activeMistakeId: resolveCanonicalMistakeId(updated),
        });
        return buildReceipt({
          request,
          success: true,
          executedStage: request.stage === 'confirm' ? 'execute' : request.stage,
          appliedFields: ['knowledge_point', 'node', 'category'],
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [resolveCanonicalTagId(targetQuestion), resolveCanonicalTagId(updated)],
          affectedNodeIds: [resolveCanonicalNodeId(targetQuestion), resolveCanonicalNodeId(updated)],
          affectedMistakeIds: [resolveCanonicalMistakeId(updated)],
          followUpUpdates: mergeFollowUpUpdates(
            ['原节点与目标节点需要同步刷新 dossier 与排序结果'],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'delete_mistake') {
        if (!targetQuestion.id) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '找不到要删除的错题',
            affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
            affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
          });
        }
        if (request.stage === 'preview') {
          return buildPreviewReceipt(request, {
            title: '删除错题预览',
            summary: `将删除 1 道错题，并刷新所属节点的统计、排序与 dossier。`,
            affectedIds: [resolveCanonicalMistakeId(targetQuestion)],
            followUpUpdates: mergeFollowUpUpdates(
              ['确认后该错题会从当前节点对象集合中移除'],
              getCopilotRefreshHints(action.type),
            ),
            affectedTagIds: [resolveCanonicalTagId(targetQuestion)],
            affectedNodeIds: [resolveCanonicalNodeId(targetQuestion)],
            affectedMistakeIds: [resolveCanonicalMistakeId(targetQuestion)],
          });
        }
        await questionsApi.delete(request.target_ids.mistake_id || targetQuestion.id);
        if (onQuestionsDeleted) onQuestionsDeleted(targetQuestion.id);
        toast.success('错题已删除');
        const latestSnapshot = await getNodeSnapshot({
          tagId: resolveCanonicalTagId(targetQuestion),
          nodeId: resolveCanonicalNodeId(targetQuestion),
        });
        return buildReceipt({
          request,
          success: true,
          executedStage: request.stage === 'confirm' ? 'execute' : request.stage,
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [resolveCanonicalTagId(targetQuestion)],
          affectedNodeIds: [resolveCanonicalNodeId(targetQuestion)],
          affectedMistakeIds: [resolveCanonicalMistakeId(targetQuestion)],
          followUpUpdates: mergeFollowUpUpdates(
            ['当前节点统计、排序与 dossier 已进入刷新链路'],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'compare_mistakes') {
        const compareIds = uniqueIds([
          ...(request.target_ids.mistake_ids || []),
          request.target_ids.mistake_id || '',
          ...activeQuestions.map((item) => resolveCanonicalMistakeId(item)),
        ]);
        if (compareIds.length < 2) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '多题比较至少需要两道题',
            affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
            affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
          });
        }
        const compared = await nodeDossierApi.compareMistakes({
          tagId: currentSnapshot?.scope.tag_id || scopeTagId,
          nodeId: currentSnapshot?.scope.node_id || scopeNodeId,
          mistakeIds: compareIds,
          surface: 'mistake_node_hub',
          sortBy: 'recent_error_desc',
        });
        toast.success(`已载入 ${compared.details.length} 道题的比较上下文`);
        return buildReceipt({
          request,
          success: true,
          latestSnapshotVersion: compared.snapshot_version,
          affectedTagIds: [compared.scope.tag_id],
          affectedNodeIds: [compared.scope.node_id],
          affectedMistakeIds: compared.entries.map((entry) => entry.mistake_id),
          followUpUpdates: compared.entries.map((entry) => `排序第 ${entry.sort_position} 位：${entry.title_excerpt}`),
        });
      }
      if (action.type === 'batch_update_mistakes') {
        const patch = pickQuestionMutationPatch((request.field_patch || {}) as Record<string, unknown>);
        const batchTargetIds = requestedMistakeIds.length > 0
          ? requestedMistakeIds
          : activeQuestions.map((item) => resolveCanonicalMistakeId(item));
        if (batchTargetIds.length === 0) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '批量修改至少需要一个目标题目',
            affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
            affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
          });
        }
        if (Object.keys(patch).length === 0) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '批量修改缺少字段 patch',
            affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
            affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
            affectedMistakeIds: batchTargetIds,
          });
        }
        if (request.stage === 'preview') {
          return buildPreviewReceipt(request, {
            title: '批量修改预览',
            summary: `将批量修改 ${batchTargetIds.length} 道错题，变更字段：${Object.keys(patch).join('、')}。`,
            affectedIds: batchTargetIds,
            followUpUpdates: mergeFollowUpUpdates(
              ['确认后会重新生成当前节点的排序、统计与 dossier 快照'],
              getCopilotRefreshHints(action.type),
            ),
            affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
            affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
            affectedMistakeIds: batchTargetIds,
          });
        }
        const canCreateTags = await registerTagExtensions(patch as Partial<Question>);
        if (!canCreateTags) return null;
        const previousById = new Map(items.map((item) => [resolveCanonicalMistakeId(item), item] as const));
        const updatedQuestions = await Promise.all(batchTargetIds.map((mistakeId) => questionsApi.update(mistakeId, patch as Partial<Question>)));
        updatedQuestions.forEach((updated) => {
          const previous = previousById.get(resolveCanonicalMistakeId(updated)) || updated;
          syncKnowledgeFromMistake(updated);
          syncUpdatedQuestion(previous, updated);
        });
        const latestSnapshot = await getNodeSnapshot({
          tagId: currentSnapshot?.scope.tag_id || scopeTagId,
          nodeId: currentSnapshot?.scope.node_id || scopeNodeId,
        });
        return buildReceipt({
          request,
          success: true,
          executedStage: request.stage === 'confirm' ? 'execute' : request.stage,
          appliedFields: Object.keys(patch),
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: uniqueIds(updatedQuestions.map((item) => resolveCanonicalTagId(item))),
          affectedNodeIds: uniqueIds([
            currentSnapshot?.scope.node_id || scopeNodeId,
            ...updatedQuestions.map((item) => resolveCanonicalNodeId(item)),
          ]),
          affectedMistakeIds: updatedQuestions.map((item) => resolveCanonicalMistakeId(item)),
          followUpUpdates: mergeFollowUpUpdates(
            [`已批量更新 ${updatedQuestions.length} 道错题`, '当前节点统计、排序与 dossier 已同步刷新'],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'create_node_note_section') {
        if (!currentSnapshot) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '当前节点 dossier 未就绪，无法新增笔记章节',
          });
        }
        const sectionTitle = String(action.payload?.title || (request.field_patch as Record<string, unknown>)?.title || '新增章节').trim();
        const sectionBody = String(
          action.payload?.content_markdown
          || (request.field_patch as Record<string, unknown>)?.content_markdown
          || action.payload?.markdown
          || (request.field_patch as Record<string, unknown>)?.markdown
          || ''
        ).trim();
        if (!sectionBody) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '新增章节缺少内容',
            affectedTagIds: [currentSnapshot.scope.tag_id],
            affectedNodeIds: [currentSnapshot.scope.node_id],
          });
        }
        const duplicatedSection = currentSnapshot.node_notebook.sections.find((section) => normalizeSectionKey(section.title) === normalizeSectionKey(sectionTitle));
        if (duplicatedSection) {
          return buildReceipt({
            request,
            success: false,
            validationWarnings: ['当前章节标题已存在'],
            failureReason: '请改用 rewrite_node_notebook 或 reorder_node_notebook',
            affectedTagIds: [currentSnapshot.scope.tag_id],
            affectedNodeIds: [currentSnapshot.scope.node_id],
          });
        }
        const nextMarkdown = [currentSnapshot.node_notebook.content_markdown, `### ${sectionTitle}`, sectionBody].filter(Boolean).join('\n\n');
        await writeNotebookContent({
          snapshot: currentSnapshot,
          markdown: nextMarkdown,
          decision: currentSnapshot.node_notebook.content_markdown ? 'rewrite' : 'create',
          reason: String(request.reason || `新增章节：${sectionTitle}`).trim(),
        });
        const latestSnapshot = await getNodeSnapshot({
          tagId: currentSnapshot.scope.tag_id,
          nodeId: currentSnapshot.scope.node_id,
        });
        return buildReceipt({
          request,
          success: true,
          appliedFields: ['node_notebook.sections'],
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [currentSnapshot.scope.tag_id],
          affectedNodeIds: [currentSnapshot.scope.node_id],
          followUpUpdates: mergeFollowUpUpdates(
            [`已新增章节「${sectionTitle}」`, '节点笔记与 dossier 已同步刷新'],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'rewrite_node_notebook') {
        if (!currentSnapshot) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '当前节点 dossier 未就绪，无法重写笔记',
          });
        }
        const markdown = String(
          action.payload?.markdown
          || (request.field_patch as Record<string, unknown>)?.markdown
          || action.payload?.content_markdown
          || (request.field_patch as Record<string, unknown>)?.content_markdown
          || ''
        ).trim();
        if (!markdown) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '重写笔记缺少 markdown 内容',
            affectedTagIds: [currentSnapshot.scope.tag_id],
            affectedNodeIds: [currentSnapshot.scope.node_id],
          });
        }
        if (request.stage === 'preview') {
          return buildPreviewReceipt(request, {
            title: '重写节点笔记预览',
            summary: `将重写当前节点笔记，原有章节 ${currentSnapshot.node_notebook.sections.length} 个。`,
            affectedIds: [currentSnapshot.scope.node_id],
            followUpUpdates: mergeFollowUpUpdates(
              ['确认后将覆盖当前节点笔记正文并刷新 dossier'],
              getCopilotRefreshHints(action.type),
            ),
            affectedTagIds: [currentSnapshot.scope.tag_id],
            affectedNodeIds: [currentSnapshot.scope.node_id],
          });
        }
        await writeNotebookContent({
          snapshot: currentSnapshot,
          markdown,
          decision: currentSnapshot.node_notebook.content_markdown ? 'rewrite' : 'create',
          reason: String(request.reason || '重写当前节点笔记').trim(),
        });
        const latestSnapshot = await getNodeSnapshot({
          tagId: currentSnapshot.scope.tag_id,
          nodeId: currentSnapshot.scope.node_id,
        });
        return buildReceipt({
          request,
          success: true,
          executedStage: request.stage === 'confirm' ? 'execute' : request.stage,
          appliedFields: ['node_notebook'],
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [currentSnapshot.scope.tag_id],
          affectedNodeIds: [currentSnapshot.scope.node_id],
          followUpUpdates: mergeFollowUpUpdates(
            ['节点笔记正文已重写', '章节结构与 dossier 已同步刷新'],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'reorder_node_notebook') {
        if (!currentSnapshot) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '当前节点 dossier 未就绪，无法重排章节',
          });
        }
        const currentSections = currentSnapshot.node_notebook.sections || [];
        if (currentSections.length < 2) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '当前节点章节不足两段，无法执行重排',
            affectedTagIds: [currentSnapshot.scope.tag_id],
            affectedNodeIds: [currentSnapshot.scope.node_id],
          });
        }
        const orderedKeys = uniqueIds([
          action.payload?.section_ids,
          action.payload?.ordered_section_ids,
          action.payload?.section_titles,
          action.payload?.ordered_titles,
          (request.field_patch as Record<string, unknown>)?.section_ids,
          (request.field_patch as Record<string, unknown>)?.ordered_section_ids,
          (request.field_patch as Record<string, unknown>)?.section_titles,
          (request.field_patch as Record<string, unknown>)?.ordered_titles,
        ]);
        if (orderedKeys.length === 0) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '章节重排缺少 section_ids 或 ordered_titles',
            affectedTagIds: [currentSnapshot.scope.tag_id],
            affectedNodeIds: [currentSnapshot.scope.node_id],
          });
        }
        const sectionByKey = new Map(currentSections.flatMap((section) => ([
          [normalizeSectionKey(section.section_id), section] as const,
          [normalizeSectionKey(section.title), section] as const,
        ])));
        const orderedSections = orderedKeys
          .map((key) => sectionByKey.get(normalizeSectionKey(key)))
          .filter((section, index, array): section is NonNullable<typeof section> => Boolean(section) && array.indexOf(section) === index);
        if (orderedSections.length === 0) {
          return buildReceipt({
            request,
            success: false,
            failureReason: '未匹配到可重排的目标章节',
            affectedTagIds: [currentSnapshot.scope.tag_id],
            affectedNodeIds: [currentSnapshot.scope.node_id],
          });
        }
        const remainingSections = currentSections.filter((section) => !orderedSections.includes(section));
        const nextSections = [...orderedSections, ...remainingSections];
        if (request.stage === 'preview') {
          return buildPreviewReceipt(request, {
            title: '章节重排预览',
            summary: `将重排 ${orderedSections.length} 个章节，新的首章节为「${nextSections[0]?.title || '未命名章节'}」。`,
            affectedIds: [currentSnapshot.scope.node_id],
            followUpUpdates: mergeFollowUpUpdates(
              nextSections.slice(0, 4).map((section, index) => `第 ${index + 1} 节：${section.title}`),
              getCopilotRefreshHints(action.type),
            ),
            affectedTagIds: [currentSnapshot.scope.tag_id],
            affectedNodeIds: [currentSnapshot.scope.node_id],
          });
        }
        const nextMarkdown = nextSections.map((section) => section.content_markdown.trim()).filter(Boolean).join('\n\n');
        await writeNotebookContent({
          snapshot: currentSnapshot,
          markdown: nextMarkdown,
          decision: 'rewrite',
          reason: String(request.reason || '重排节点笔记章节').trim(),
        });
        const latestSnapshot = await getNodeSnapshot({
          tagId: currentSnapshot.scope.tag_id,
          nodeId: currentSnapshot.scope.node_id,
        });
        return buildReceipt({
          request,
          success: true,
          executedStage: request.stage === 'confirm' ? 'execute' : request.stage,
          appliedFields: ['node_notebook.sections.order'],
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [currentSnapshot.scope.tag_id],
          affectedNodeIds: [currentSnapshot.scope.node_id],
          followUpUpdates: mergeFollowUpUpdates(
            nextSections.slice(0, 4).map((section, index) => `第 ${index + 1} 节：${section.title}`),
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      if (action.type === 'start_review') {
        const payload = normalizeReviewPreset(action.payload?.preset || { subject: targetQuestion.subject as any, scope: 'due', sortBy: 'nearestDue' });
        const handoffResult = await openHandoffDialog({
          kind: 'review',
          capability: currentCapability,
          activeMode,
          sourceLabel: '来自错题 AI 管家建议',
          reason: targetQuestion.knowledge_point
            ? `当前错题集中在 ${targetQuestion.knowledge_point}，适合直接进入正式复习稳定记忆。`
            : '当前错题已经满足进入正式复习的条件，建议在复习中心继续完成任务。',
          expectedBenefit: '把当前错题放进正式复习队列，获得可持续的调度与下一步建议。',
          preset: payload,
        });
        if (handoffResult.status !== 'start') return;
        const approvedPreset = handoffResult.preset;
        const proposal = createLearningSessionProposal({
          sessionKind: 'review',
          sourceSurface: 'copilot-node',
          sourceReason: '节点 AI 建议开始正式复习',
          objectiveCode: approvedPreset.scope === 'due' ? 'review_due' : 'custom_scope',
          explanationSummary: '节点 AI 已根据当前题目和知识点整理好复习任务，建议进入正式复习页继续执行',
          scope: {
            subject: approvedPreset.subject as Subject,
            amount: approvedPreset.amount,
            strategy: (approvedPreset.strategy || 'custom') as 'due_rescue' | 'stubborn_focus' | 'unmastered_boost' | 'custom',
            reviewScope: approvedPreset.scope as 'all' | 'due' | 'unmastered' | 'stubborn',
            sortBy: approvedPreset.sortBy as 'latestWrong' | 'lowestMastery' | 'nearestDue',
          },
          handoffContext: {
            sourceMode: activeMode,
            summary: `节点 AI 建议开始 ${approvedPreset.amount} 题分包复习任务`,
            activeNode: node,
            activeQuestionId: targetQuestion.id,
          },
          returnPath: {
            pathname: location.pathname,
            search: location.search,
            label: '回到节点页',
          },
          nextStepHint: {
            kind: 'practice',
            label: '完成后去专项补弱',
            pathname: '/practice',
            search: '',
          },
        });
        const target = buildLearningSessionNavigation(proposal, {
          autoStart: true,
          sourceMode: activeMode,
        });
        navigate({
          pathname: target.pathname,
          search: target.search,
        }, {
          state: target.state,
        });
        return buildReceipt({
          request,
          success: true,
          followUpUpdates: ['已跳转到正式复习页继续执行'],
          affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
          affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
        });
      }
      if (action.type === 'start_drill') {
        const payload = normalizeDrillPreset(action.payload?.preset || { subject: targetQuestion.subject as any, nodes: [targetQuestion.node || targetQuestion.knowledge_point], amount: 10, strategy: '递进' });
        const nodes = toNodeList((payload as any)?.nodes);
        const handoffResult = await openHandoffDialog({
          kind: 'practice',
          capability: currentCapability,
          activeMode,
          sourceLabel: '来自错题 AI 管家建议',
          reason: nodes.length > 0
            ? `当前错题已经锁定 ${nodes.join('、')} 等薄弱点，适合直接做一轮专项训练。`
            : '当前错题已经满足进入正式专项练习的条件，建议用任务式训练继续补强。',
          expectedBenefit: '把当前错题转成正式专项任务，在可追踪的练习流程里继续补强。',
          preset: payload,
        });
        if (handoffResult.status !== 'start') return;
        const approvedPreset = handoffResult.preset;
        const proposal = createLearningSessionProposal({
          sessionKind: 'practice',
          sourceSurface: 'copilot-node',
          sourceReason: '节点 AI 建议开始正式专项练习',
          objectiveCode: approvedPreset.strategy === '攻坚' ? 'weakness_reinforce' : approvedPreset.strategy === '递进' ? 'custom_scope' : 'sprint_drill',
          explanationSummary: '节点 AI 已根据当前知识点整理好专项训练范围，建议进入正式练习页继续执行',
          scope: {
            subject: approvedPreset.subject as Subject,
            amount: approvedPreset.amount,
            nodes: approvedPreset.nodes,
            strategy: approvedPreset.strategy as '递进' | '随机' | '攻坚',
          },
          handoffContext: {
            sourceMode: activeMode,
            summary: approvedPreset.nodes.length > 0 ? `节点 AI 建议围绕 ${approvedPreset.nodes.join('、')} 开始专项训练` : '节点 AI 建议开始一轮专项训练',
            activeNode: node,
            activeQuestionId: targetQuestion.id,
          },
          returnPath: {
            pathname: location.pathname,
            search: location.search,
            label: '回到节点页',
          },
          nextStepHint: {
            kind: 'copilot',
            label: '完成后回到节点 AI 继续追问',
            pathname: location.pathname,
            search: location.search,
          },
        });
        const target = buildLearningSessionNavigation(proposal, {
          autoStart: true,
          sourceMode: activeMode,
        });
        navigate({
          pathname: target.pathname,
          search: target.search,
        }, {
          state: target.state,
        });
        return buildReceipt({
          request,
          success: true,
          followUpUpdates: ['已跳转到正式练习页继续执行'],
          affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
          affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
        });
      }
      if (action.type === 'update_learning_content') {
        const updates = extractKnowledgeUpdatesFromAction(action) || [];
        const syncedCount = applyKnowledgeUpdates(updates);
        const latestSnapshot = await getNodeSnapshot({
          tagId: currentSnapshot?.scope.tag_id || scopeTagId,
          nodeId: currentSnapshot?.scope.node_id || scopeNodeId,
          activeMistakeId: activeMistakeId || undefined,
        });
        return buildReceipt({
          request,
          success: syncedCount > 0,
          appliedFields: syncedCount > 0 ? ['node_notebook'] : [],
          skippedFields: syncedCount > 0 ? [] : ['node_notebook'],
          validationWarnings: syncedCount > 0 ? [] : ['当前动作未产生可落库的知识点更新'],
          failureReason: syncedCount > 0 ? undefined : '缺少可执行的知识点更新内容',
          latestSnapshotVersion: latestSnapshot?.snapshot_version,
          affectedTagIds: [currentSnapshot?.scope.tag_id || scopeTagId],
          affectedNodeIds: [currentSnapshot?.scope.node_id || scopeNodeId],
          affectedMistakeIds: activeMistakeId ? [activeMistakeId] : [],
          followUpUpdates: mergeFollowUpUpdates(
            syncedCount > 0 ? [`已归并 ${syncedCount} 个知识点内容块`] : [],
            getCopilotRefreshHints(action.type),
          ),
        });
      }
      throw new Error(`当前尚未支持执行「${action.type}」动作`);
    };
    return doExecute();
  };

  const stopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setSending(false);
    }
  };

  const handleSend = async (quickInput?: string) => {
    const ask = (quickInput || input).trim() || (imagePreview ? '请根据我上传的题图帮我分析并给出下一步建议。' : '');
    if (!ask || sending) return;
    setSending(true);

    // 智能识别：如果是简单的打招呼，强制跳过深度思考，避免浪费 token 和时间
    const isSimpleGreeting = /^(你好|在吗|嗨|hello|hi|喂|早上好|下午好|晚上好|哈喽|哈罗|hello啊|hi啊)$/i.test(ask);
    const effectiveDeepThinking = deepThinking && !isSimpleGreeting;

    const currentImage = imagePreview;
    const inferredMode = inferCopilotMode({ ask, surface: 'node', hasImage: Boolean(currentImage) });
    const inferredCapability = inferCopilotCapability({ ask, surface: 'node', hasImage: Boolean(currentImage) });
    const resolvedMode = modeSelectionSource === 'manual' ? currentMode : inferredMode;
    const resolvedCapability = modeSelectionSource === 'manual' ? currentCapability : inferredCapability;
    if (modeSelectionSource === 'manual') {
      if (resolvedMode !== currentMode || resolvedCapability !== currentCapability) {
        toast.info(getModeSwitchToast(resolvedMode));
      }
    } else {
      handleAutoCapability(ask, Boolean(currentImage));
    }
    setCurrentMode(resolvedMode);
    setCurrentCapability(resolvedCapability);
    setImagePreview(null);
    const baseMessages = [...messages, { role: 'user' as const, content: ask, image: currentImage || undefined, mode: resolvedMode }];
    setMessages(baseMessages);
    setInput('');
    if (isOutOfScopeLearningRequest(ask)) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '我是你的错题学习管家，不能闲聊哦。你今天还有待复习题目，要我现在帮你开始吗？',
          mode: 'route',
          action: {
            type: 'start_review',
            risk: 'low',
            title: '开始今日复习',
            description: '聚焦待复习错题',
            payload: {
              preset: { subject: subject, scope: 'due', amount: 10, sortBy: 'nearestDue' },
            },
          },
        },
      ]);
      setSending(false);
      return;
    }
    const placeholderIndex = baseMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: effectiveDeepThinking ? '' : '正在分析中...', reasoningContent: effectiveDeepThinking ? '正在深度思考中...' : undefined, mode: resolvedMode }]);
    if (effectiveDeepThinking) {
      setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: true }));
    }
    const learningProfile = await buildCopilotLearningProfile();

    abortControllerRef.current = new AbortController();

    await new Promise<void>((resolve) => {
      const requestMessages: Array<{ role: string; content: any }> = [];
      const contextPrompt = buildContextPrompt(ask, learningProfile, Boolean(currentImage), resolvedMode, resolvedCapability);
      
      baseMessages.forEach((item, idx) => {
        if (idx === baseMessages.length - 1) {
          if (item.image) {
            requestMessages.push({
              role: 'user',
              content: [
                { type: 'text', text: contextPrompt },
                { type: 'image_url', image_url: { url: item.image } }
              ]
            });
          } else {
            requestMessages.push({ role: 'user', content: contextPrompt });
          }
        } else {
          requestMessages.push({ role: item.role, content: item.content });
        }
      });

      chatApi.streamCopilot(
        requestMessages,
        (chunk, isReasoning) => {
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            if (!current) return prev;
            if (isReasoning) {
              next[placeholderIndex] = { ...current, reasoningContent: (current.reasoningContent === '正在深度思考中...' ? '' : current.reasoningContent || '') + chunk };
            } else {
              const merged = (current.content === '正在分析中...' ? '' : current.content) + chunk;
              next[placeholderIndex] = { ...current, content: stripActionForStreaming(merged) };
            }
            return next;
          });
        },
        (full) => {
          const action = parseCopilotAction(full);
          const cleaned = stripActionBlock(full) || '我已完成分析，请查看下方建议。';
          const parsedFallbackAction = action ? null : parseLearningContentActionFromText(cleaned, node);
          const resolvedAction = action || parsedFallbackAction;
          
          const activeQuestion = activeQuestionId ? items.find(i => matchesQuestionIdentifier(i, activeQuestionId)) : items[0];
          const targetQuestionId = action?.payload?.question_id || activeQuestion?.id;
          const targetQuestion = items.find(i => matchesQuestionIdentifier(i, targetQuestionId)) || activeQuestion || { subject, knowledge_point: node, question_text: '' } as unknown as Question;

          const rawDraft = resolvedAction?.type === 'create_mistake' || resolvedAction?.type === 'update_tags' || resolvedAction?.type === 'update_mistake'
            ? normalizeMistakeDraft({ ...targetQuestion, subject: targetQuestion.subject as any, ...(resolvedAction?.payload || {}) })
            : undefined;
          const rawUpdates = extractKnowledgeUpdatesFromAction(resolvedAction);
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            next[placeholderIndex] = {
              ...current,
              role: 'assistant',
              content: cleaned,
              mode: resolvedMode,
              action: resolvedAction || undefined,
              draft: rawDraft,
              knowledgeUpdates: rawUpdates,
            };
            return next;
          });
          setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
          resolve();
        },
        (error) => {
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            next[placeholderIndex] = { ...current, role: 'assistant', content: `请求失败/已停止：${error}`, mode: resolvedMode };
            return next;
          });
          setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
          resolve();
        },
        { injectLearningProfile: true, enableThinking: effectiveDeepThinking, signal: abortControllerRef.current?.signal }
      );
    });
    setSending(false);
    abortControllerRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) return null;
  const activeQuestionContextText = activeQuestionId ? toSafeString(items.find(i => i.id === activeQuestionId)?.question_text) : '';

  return (
    <div className={className || "absolute inset-0 z-50 flex flex-col bg-white shadow-[20px_0_40px_-15px_rgba(0,0,0,0.05)] animate-in slide-in-from-bottom-8 duration-300"}>
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-gray-900">AI 错题管家</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">{currentCapabilityMeta.label}</span>
                <p className="text-[11px] font-medium text-gray-500">
                  {activeQuestionId ? `错题 - ${activeQuestionContextText.slice(0, 10)}...` : `标签 - ${node}`} · {currentCapabilityMeta.summary}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                const confirmed = await confirm({
                  title: '开启新对话',
                  description: '确定要清除当前对话并开启新对话吗？',
                  tone: 'danger',
                });
                if (confirmed) {
                  setMessages([defaultAssistantMessage]);
                  sessionStorage.removeItem(chatStorageKey);
                }
              }}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 hover:bg-gray-100 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              新对话
            </button>
            <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-indigo-100 px-2.5 py-1 font-semibold text-indigo-700">{currentCapabilityMeta.label}</span>
              <span className="text-gray-600">{currentCapabilityMeta.defaultAction}</span>
            </div>
            <div className="mt-3 grid gap-2 text-[12px] text-gray-700 sm:grid-cols-2">
              <div className="rounded-xl bg-white/80 px-3 py-2">
                <span className="font-medium text-gray-500">tag_id：</span>
                <span className="break-all">{scopeTagId || '未解析'}</span>
              </div>
              <div className="rounded-xl bg-white/80 px-3 py-2">
                <span className="font-medium text-gray-500">node_id：</span>
                <span className="break-all">{scopeNodeId || '未解析'}</span>
              </div>
              <div className="rounded-xl bg-white/80 px-3 py-2">
                <span className="font-medium text-gray-500">mistake_id：</span>
                <span className="break-all">{activeMistakeId || (activeQuestions.length > 1 ? '当前处于多题比较集合' : '未锁定单题')}</span>
              </div>
              <div className="rounded-xl bg-white/80 px-3 py-2">
                <span className="font-medium text-gray-500">当前能力：</span>
                <span>{currentCapabilityMeta.label}</span>
              </div>
              <div className="rounded-xl bg-white/80 px-3 py-2">
                <span className="font-medium text-gray-500">内部工作态：</span>
                <span>{currentModeMeta.label}</span>
              </div>
            </div>
            {activeQuestions.length > 1 && (
              <div className="mt-2 rounded-xl bg-white/80 px-3 py-2 text-[12px] text-gray-700">
                <span className="font-medium text-gray-500">比较集合：</span>
                <span className="break-all">{activeQuestions.map((item) => resolveCanonicalMistakeId(item)).join('、')}</span>
              </div>
            )}
            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
              {miniCopilotBoundaryHint}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {modeSwitchRules.map((rule) => (
                <span
                  key={rule.capability}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${
                    rule.capability === currentCapability ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600'
                  }`}
                >
                  {`${rule.label}：${rule.trigger}`}
                </span>
              ))}
            </div>
          </div>
          <div className="mb-6 flex flex-wrap gap-2">
            {['帮我总结这个知识点', '分析当前节点下的错题', '比较这几题的差异', '请只在当前知识点范围内回答'].map(chip => (
              <button
                key={chip}
                onClick={() => handleSend(chip)}
                className="rounded-full bg-gray-100 px-3.5 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 active:scale-95"
              >
                {chip}
              </button>
            ))}
          </div>
          
          <div className="space-y-6 pb-4">
            {messages.map((msg, idx) => (
              <div key={`${msg.role}-${idx}`} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gray-100 px-4 py-3 text-gray-900 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{msg.content}</p>
                  </div>
                ) : (
                  <div className="flex w-full gap-3 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 space-y-3 min-w-0">
                      {msg.reasoningContent && (
                        <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50/50 overflow-hidden">
                          <button
                            onClick={() => setExpandedThinking(prev => ({ ...prev, [idx]: !prev[idx] }))}
                            className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100/50 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              {sending && idx === messages.length - 1 && (!msg.content || msg.content === '正在思考...' || msg.content === '正在分析中...') ? (
                                <>
                                  <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" />
                                  <span>正在深度思考...</span>
                                </>
                              ) : (
                                <>
                                  <BrainCircuit className="h-4 w-4 text-indigo-500" />
                                  <span>{expandedThinking[idx] ? '深度思考过程' : '已完成深度思考'}</span>
                                </>
                              )}
                            </div>
                            {expandedThinking[idx] ? (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}
                          </button>
                          {expandedThinking[idx] && (
                            <div className="px-4 pb-3 pt-1 border-t border-gray-100">
                              <div className="prose prose-sm prose-gray max-w-none text-gray-500 text-[13px] leading-relaxed opacity-80">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {msg.reasoningContent}
                                </ReactMarkdown>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {(msg.content === '正在思考...' || msg.content === '正在分析中...' || (sending && idx === messages.length - 1 && !String(msg.content || '').trim())) ? (
                          <div className="flex items-center gap-2 text-indigo-500 font-medium text-[15px] py-1">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {(sending && idx === messages.length - 1 && !String(msg.content || '').trim()) ? '正在整理卡片与执行建议...' : msg.content}
                          </div>
                        ) : (
                          <div className="prose prose-sm prose-gray max-w-none leading-relaxed text-gray-800 break-words">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      
                      {msg.action && (msg.action.type !== 'update_learning_content' || !msg.knowledgeUpdates) && (
                        <div className="mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ring-1 ring-black/5 transition-all">
                          <div className="border-b border-gray-50 bg-gray-50/50 px-4 py-2.5">
                            <p className="text-[13px] font-semibold text-gray-900">{msg.action.title || '执行建议'}</p>
                            <p className="mt-0.5 text-[11px] text-gray-500">{msg.action.description || '请确认后执行'}</p>
                          </div>
                          <div className="p-4">
                            {msg.draft && (
                              <div className="mb-4 grid grid-cols-1 gap-3">
                                <label className="flex flex-col gap-1">
                                  <span className="text-[11px] font-medium text-gray-500">科目</span>
                                  <Select
                                    value={toSelectValue((draftEdits[idx]?.subject as string) ?? (msg.draft.subject || subject))}
                                    onValueChange={val => {
                                      const nextSubject = fromSelectValue(val) || subject;
                                      setDraftEdits(prev => ({
                                        ...prev,
                                        [idx]: {
                                          ...prev[idx],
                                          subject: nextSubject as Subject,
                                          knowledge_point: '',
                                        },
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 h-auto w-full">
                                      <SelectValue placeholder="请选择科目" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="英语">英语</SelectItem>
                                      <SelectItem value="C语言">C语言</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-[11px] font-medium text-gray-500">知识点</span>
                                  {(() => {
                                    const draftSubject = (((draftEdits[idx]?.subject as string) ?? (msg.draft.subject || subject)) === 'C语言' ? 'C语言' : '英语') as Subject;
                                    const knowledgeOptions = getKnowledgePointsBySubjectFromTaxonomy(draftSubject);
                                    const selectedKnowledge = (draftEdits[idx]?.knowledge_point as string) ?? (msg.draft.knowledge_point || '');
                                    return (
                                  <Select
                                    value={toSelectValue(selectedKnowledge)}
                                    onValueChange={val => setDraftEdits(prev => ({ ...prev, [idx]: { ...prev[idx], knowledge_point: fromSelectValue(val) } }))}
                                  >
                                    <SelectTrigger className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 h-auto w-full">
                                      <SelectValue placeholder="请选择标签" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={SELECT_EMPTY_VALUE}>请选择标签</SelectItem>
                                      {knowledgeOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                    );
                                  })()}
                                </label>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={async () => {
                                  try {
                                    const nextDraft = draftEdits[idx] || msg.draft;
                                    const receipt = await executeAction(msg.action!, nextDraft, { mode: msg.mode });
                                    if (!receipt) return;
                                    setMessages(prev => [...prev, { role: 'assistant', content: summarizeCopilotReceipt(receipt), executionReceipt: receipt, action: msg.action, draft: nextDraft, mode: msg.mode }]);
                                  } catch (error: any) {
                                    toast.error(error?.message || '执行失败');
                                  }
                                }}
                                className="rounded-xl bg-gray-900 px-3.5 py-1.5 text-[13px] font-medium text-white transition-all hover:bg-gray-800 hover:shadow-md active:scale-95"
                              >
                                {msg.action.risk === 'high' ? '先预览影响' : '确认执行'}
                              </button>
                              <span className="text-[10px] text-gray-400">
                                {msg.action.risk === 'high' ? '⚠️ 高风险动作' : '建议先确认再执行'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {msg.executionReceipt && (
                        <div className={`mt-3 rounded-2xl border px-4 py-3 ${msg.executionReceipt.success ? 'border-emerald-100 bg-emerald-50/70' : 'border-amber-100 bg-amber-50/70'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <p className={`text-[13px] font-semibold ${msg.executionReceipt.success ? 'text-emerald-800' : 'text-amber-800'}`}>执行回执</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${msg.executionReceipt.success ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {msg.executionReceipt.action_type}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-gray-700">
                            <p>{summarizeCopilotReceipt(msg.executionReceipt)}</p>
                            {msg.executionReceipt.preview && (
                              <>
                                <p>预估影响数量：{msg.executionReceipt.preview.affected_count}</p>
                                {msg.executionReceipt.preview.affected_ids.length > 0 && <p>影响对象：{msg.executionReceipt.preview.affected_ids.join('、')}</p>}
                              </>
                            )}
                            {msg.executionReceipt.applied_fields.length > 0 && <p>已应用字段：{msg.executionReceipt.applied_fields.join('、')}</p>}
                            {msg.executionReceipt.validation_warnings.length > 0 && <p>校验提示：{msg.executionReceipt.validation_warnings.join('；')}</p>}
                            {msg.executionReceipt.latest_snapshot_version && <p>最新快照：{msg.executionReceipt.latest_snapshot_version}</p>}
                            {msg.executionReceipt.follow_up_updates.length > 0 && <p>后续刷新：{msg.executionReceipt.follow_up_updates.join('；')}</p>}
                          </div>
                          {msg.executionReceipt.preview && msg.action && msg.action.risk === 'high' && (
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                onClick={async () => {
                                  try {
                                    const receipt = await executeAction(msg.action!, msg.draft, { mode: msg.mode, stage: 'confirm' });
                                    if (!receipt) return;
                                    setMessages(prev => [...prev, { role: 'assistant', content: summarizeCopilotReceipt(receipt), executionReceipt: receipt, action: msg.action, draft: msg.draft, mode: msg.mode }]);
                                  } catch (error: any) {
                                    toast.error(error?.message || '执行失败');
                                  }
                                }}
                                className="rounded-xl bg-amber-600 px-3.5 py-1.5 text-[13px] font-medium text-white transition-all hover:bg-amber-700 hover:shadow-md active:scale-95"
                              >
                                确认正式执行
                              </button>
                              <span className="text-[10px] text-amber-700">预览通过后再正式落库</span>
                            </div>
                          )}
                        </div>
                      )}

                      {msg.knowledgeUpdates && msg.knowledgeUpdates.length > 0 && (
                        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/20 p-3">
                          {msg.knowledgeUpdates.map((update, localIdx) => {
                            const existingMarkdown = readLearningContentState().drawerByTag[update.tag]?.markdown || '';
                            const preview = mergeLearningDrawerContent(readLearningContentState().drawerByTag[update.tag], {
                              targetNode: update.tag,
                              note: update.note,
                              markdown: update.markdown,
                              reason: update.reason,
                              decision: update.decision,
                              source: 'ai_update',
                            });
                            const previewLabel = preview.decision === 'create' ? '建议新增' : preview.decision === 'rewrite' ? '建议改写' : '无需更新';
                            return (
                              <div key={`${idx}-${localIdx}`} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm transition-all hover:border-emerald-300">
                                <div className="border-b border-emerald-50 bg-emerald-50/50 px-4 py-2.5 flex items-center justify-between">
                                  <span className="text-[13px] font-semibold text-emerald-800 flex items-center gap-1.5">
                                    <Hash className="w-4 h-4 text-emerald-500" />
                                    {update.tag}
                                  </span>
                                  <span className="text-[11px] text-emerald-600 bg-emerald-100/50 px-2 py-0.5 rounded-md font-medium">{previewLabel}</span>
                                </div>
                                <div className="p-4 space-y-3">
                                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs leading-relaxed text-emerald-800">
                                    {preview.reason}
                                  </div>
                                  <KnowledgeUpdatePreview
                                    existingMarkdown={existingMarkdown}
                                    suggestedMarkdown={String(preview.drawer.markdown || update.markdown || '')}
                                    decision={preview.decision}
                                  />
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex items-center gap-3 pt-1">
                            <button
                              onClick={async () => {
                                try {
                                  const receipt = await executeAction(msg.action!, undefined, { mode: msg.mode });
                                  if (!receipt) return;
                                  setMessages(prev => [...prev, { role: 'assistant', content: summarizeCopilotReceipt(receipt), executionReceipt: receipt, action: msg.action, mode: msg.mode }]);
                                } catch (error: any) {
                                  toast.error(error?.message || '执行失败');
                                }
                              }}
                              className="rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95 flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              确认归并这 {msg.knowledgeUpdates.length} 个知识点
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        </div>
        
        <div className="shrink-0 bg-gradient-to-t from-white via-white/95 to-white/80 px-5 pb-6 pt-3 backdrop-blur-md">
          {imagePreview && (
            <div className="mb-3 flex w-fit items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2">
              <ImagePlus className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-medium text-gray-700">已附加题图</span>
              <button onClick={() => setImagePreview(null)} className="ml-1 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
            <div className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-900/5">
              {CAPABILITY_ORDER.map((capability) => {
                const meta = getCopilotCapabilityMeta(capability);
                const active = capability === currentCapability && modeSelectionSource === 'manual';
                const CapabilityIcon = capability === 'organize'
                  ? ImagePlus
                  : capability === 'explain'
                    ? GraduationCap
                    : capability === 'recommend'
                      ? FileText
                      : Compass;
                return (
                  <button
                    key={capability}
                    type="button"
                    onClick={() => handleCapabilitySelect(capability)}
                    className={`relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-all duration-300 ${
                      active
                        ? 'bg-orange-50 text-orange-600 border border-orange-500/50 shadow-orange-200/30'
                        : 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <CapabilityIcon className="h-3.5 w-3.5" />
                    {meta.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => handleAutoCapability(input, Boolean(imagePreview))}
                className={`relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-all duration-300 ${
                  modeSelectionSource === 'auto'
                    ? 'bg-indigo-50 text-indigo-600 border border-indigo-500/50 shadow-indigo-200/30'
                    : 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                自动识别
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-slate-900/5">
              <span className="flex items-center gap-1.5 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
                <div className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                {currentCapabilityMeta.label}
              </span>
              <span className="text-[11px] font-medium text-slate-500">
                {modeSelectionSource === 'manual' ? '当前按你的手动选择执行' : currentCapabilityMeta.defaultAction}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between mb-2 px-1">
             <button
                onClick={() => setDeepThinking(!deepThinking)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  deepThinking
                    ? 'text-indigo-600 bg-indigo-50 border border-indigo-100'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 border border-transparent'
                }`}
              >
                <BrainCircuit className="h-3.5 w-3.5" />
                深度思考
              </button>
          </div>
          <div className="relative flex items-end gap-2 rounded-3xl border border-gray-200 bg-white p-1.5 shadow-sm transition-all duration-200 focus-within:border-indigo-400 focus-within:shadow-md focus-within:ring-4 focus-within:ring-indigo-50">
            <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
              <ImagePlus className="h-5 w-5" />
              <input type="file" accept="image/*" className="hidden" onChange={e => handleUpload(e.target.files?.[0] || null)} />
            </label>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-3 py-1.5 text-[14px] text-gray-900 outline-none placeholder:text-gray-400"
              placeholder={currentCapability === 'launch'
                ? '描述你准备开始的练习或复习范围...'
                : currentCapability === 'recommend'
                  ? '先说说你想拿到什么学习建议...'
                  : currentCapability === 'explain'
                    ? '输入你想追问的题目、知识点或规律...'
                    : '输入题目、错因，或上传图片...'}
            />
            {sending ? (
              <button
                onClick={stopGenerating}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 transition-all hover:bg-red-200 hover:text-red-700 shadow-sm group mb-0.5 mr-0.5"
                title="停止生成"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() && !imagePreview}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition-all hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none shadow-sm mb-0.5 mr-0.5 active:scale-95"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[10px] text-gray-400">AI 可能会犯错，请结合实际情况参考。</p>
        </div>
        {handoffState?.kind === 'review' ? (
          <CopilotHandoffDialog
            open
            kind="review"
            capabilityLabel={getCopilotCapabilityMeta(handoffState.capability).label}
            sourceLabel={handoffState.sourceLabel}
            reason={handoffState.reason}
            expectedBenefit={handoffState.expectedBenefit}
            initialPreset={handoffState.preset}
            onOpenChange={(openState) => {
              if (!openState) {
                settleHandoffDialog({ status: 'cancel' });
              }
            }}
            onCancel={() => settleHandoffDialog({ status: 'cancel' })}
            onStart={(preset) => settleHandoffDialog({ status: 'start', preset })}
          />
        ) : null}
        {handoffState?.kind === 'practice' ? (
          <CopilotHandoffDialog
            open
            kind="practice"
            capabilityLabel={getCopilotCapabilityMeta(handoffState.capability).label}
            sourceLabel={handoffState.sourceLabel}
            reason={handoffState.reason}
            expectedBenefit={handoffState.expectedBenefit}
            initialPreset={handoffState.preset}
            onOpenChange={(openState) => {
              if (!openState) {
                settleHandoffDialog({ status: 'cancel' });
              }
            }}
            onCancel={() => settleHandoffDialog({ status: 'cancel' })}
            onStart={(preset) => settleHandoffDialog({ status: 'start', preset })}
          />
        ) : null}
      </div>
  );
}
