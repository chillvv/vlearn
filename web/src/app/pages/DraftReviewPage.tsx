import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Sparkles, X, CheckCircle, BrainCircuit, ChevronDown, ChevronRight, RefreshCw, Loader2, Edit2, Hash, ImagePlus, Square } from 'lucide-react';
import { useNavigate } from 'react-router';
import { buildCopilotLearningProfile, chatApi, questionsApi } from '../lib/api';
import {
  type CopilotActionProposal,
  type KnowledgeUpdateDraft,
  extractKnowledgeUpdatesFromAction,
  getCanonicalTagDictionary,
  hydrateTagExtensionsFromCloud,
  normalizeMistakeDraft,
  parseCopilotAction,
  stripActionBlock,
  stripActionForStreaming,
} from '../lib/copilot';
import type { Question, Subject } from '../lib/types';
import { formatQuestionTextForStorage, parseQuestionPreview } from '../lib/questionPreview';
import { normalizeDraftForImportPolicy, validateDraftsBeforeImportPolicy } from '../lib/draftImportPolicy';
import { buildKnowledgeUpdatePreviewModel, mergeLearningDrawerContent, readLearningContentState, resolveLearningDrawerContentByTag, resolveLearningDrawerReferenceForUpdate, sanitizeKnowledgeMarkdownForStorage, writeLearningContentState } from '../lib/knowledgeContent';
import { toast } from 'sonner';
import { useConfirm } from '../components/business/ConfirmProvider';
import { CopilotHandoffDialog } from '../components/business/CopilotHandoffDialog';
import type { ReviewPreset, DrillPreset } from '../components/business/CopilotHandoffDialog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { MistakeQuestionPreview } from '../components/business/MistakeQuestionPreview';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { KnowledgeUpdatePreview } from '../components/business/KnowledgeUpdatePreview';
import { InlineQuizCard } from '../components/business/InlineQuizCard';
import { getSubjectColor } from '../lib/subjects';
import { getKnowledgePointsBySubjectFromTaxonomy, inferKnowledgeNodeMetaForNewTag, registerCustomKnowledgeTaxonomy } from '../lib/knowledgeTaxonomy';
import { buildCopilotModePrompt, getCopilotCapabilityMeta, getCopilotModeMeta, inferCopilotCapability, isActionAllowedForMode, normalizeDrillPreset, normalizeReviewPreset, type CopilotCapability, type CopilotMode } from '../lib/copilotMode';
import { buildDraftIngestionBuckets, loadDraftIngestionBucketContext, runUnifiedDuplicateGuard, type DraftIngestionBucket, type DraftIngestionBucketContext, type DuplicateGuardResult } from '../lib/mistakeIngestion';
import { matchesQuestionIdentifier } from '../lib/entityIds';
import { buildLearningSessionNavigation, createLearningSessionProposal } from '../lib/learningSession';
import 'katex/dist/katex.min.css';

type DraftChatMessage = {
  role: 'assistant' | 'user';
  content: string;
  image?: string;
  mode?: CopilotMode;
  action?: CopilotActionProposal;
  drafts?: DraftQuestion[];
  knowledgeUpdates?: KnowledgeUpdateDraft[];
  isError?: boolean;
  originalAsk?: string;
  reasoningContent?: string;
};

type DraftQuestion = Partial<Question> & {
  options?: string[];
};

type DraftExecutionResult = {
  insertedCount: number;
  duplicateCount: number;
  aiDuplicateCount: number;
  insertedItems: Question[];
  skippedAllAsDuplicate?: boolean;
};

type BatchExecutionPreview = {
  candidateCount: number;
  insertedCount: number;
  duplicateCount: number;
  aiDuplicateCount: number;
  duplicateReasons: string[];
  createdTags: string[];
  knowledgeSuggestions: string[];
  duplicateGuard: DuplicateGuardResult;
};

type DraftHandoffState =
  | {
    kind: 'review';
    capability: CopilotCapability;
    activeMode: CopilotMode;
    sourceLabel: string;
    reason: string;
    expectedBenefit: string;
    preset: ReviewPreset;
  }
  | {
    kind: 'practice';
    capability: CopilotCapability;
    activeMode: CopilotMode;
    sourceLabel: string;
    reason: string;
    expectedBenefit: string;
    preset: DrillPreset;
  };

const SUGGESTIONS = [
  { icon: <span className="text-3xl drop-shadow-sm">📸</span>, text: '上传错题图片并解析' },
  { icon: <span className="text-2xl drop-shadow-sm">💡</span>, text: '帮我归纳常见错因' },
  { icon: <span className="text-2xl drop-shadow-sm">📅</span>, text: '帮我生成今天的复习计划' },
  { icon: <span className="text-2xl drop-shadow-sm">🎯</span>, text: '给我 10 道同类练习' },
];

const DRAFT_CHAT_STORAGE_KEY = 'vlearn_ai_manager_temp_chat';
const DRAFT_SESSION_UI_STORAGE_KEY = 'vlearn_ai_manager_temp_ui_state';
const DRAFT_DEEP_THINKING_KEY = 'vlearn_ai_manager_deep_thinking';
const SELECT_EMPTY_VALUE = '__empty__';
const SUBJECT_OPTIONS = ['英语', 'C语言'] as const;
const toSafeString = (value: unknown) => (typeof value === 'string' ? value : String(value ?? ''));
const toNodeList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(item => toSafeString(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
};
const parseLearningContentActionFromText = (raw: string): CopilotActionProposal | null => {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return null;
  const headingMatch = text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m);
  const inferredTag = String(headingMatch?.[1] || '').trim();
  if (!inferredTag) return null;
  const markdown = sanitizeKnowledgeMarkdownForStorage(text.match(/(#{1,6}\s+[\s\S]*)$/)?.[1]?.trim() || text, inferredTag);
  if (!markdown) return null;
  return {
    type: 'update_learning_content',
    risk: 'low',
    title: '知识点修订',
    description: '根据当前整理结果自动生成入库卡片',
    payload: {
      tag: inferredTag,
      node: inferredTag,
      markdown,
    },
  };
};

const COPILOT_MODES: CopilotCapability[] = ['organize', 'explain', 'recommend', 'launch'];

type DraftReviewPersistedUiState = {
  executedActions?: Record<string, boolean>;
  draftEdits?: Record<string, DraftQuestion>;
  batchDisplayMode?: Record<number, 'paged' | 'all'>;
  activeBatchByMessage?: Record<number, number>;
  collapsedCompletedByMessage?: Record<number, boolean>;
  createdTagsByMessage?: Record<number, string[]>;
}

function normalizePersistedDraftMessages(raw: unknown): DraftChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item): DraftChatMessage | null => {
      const role = (item as any).role === 'assistant' ? 'assistant' : (item as any).role === 'user' ? 'user' : null;
      if (!role) return null;
      const rawContent = (item as any).content;
      const normalizedContent = typeof rawContent === 'string'
        ? rawContent
        : (rawContent && typeof rawContent === 'object' ? '' : toSafeString(rawContent));
      return {
        role,
        content: normalizedContent,
        image: typeof (item as any).image === 'string' ? (item as any).image : undefined,
        mode: (item as any).mode,
        action: (item as any).action,
        drafts: Array.isArray((item as any).drafts) ? (item as any).drafts : undefined,
        knowledgeUpdates: Array.isArray((item as any).knowledgeUpdates) ? (item as any).knowledgeUpdates : undefined,
        isError: Boolean((item as any).isError),
        originalAsk: typeof (item as any).originalAsk === 'string' ? (item as any).originalAsk : undefined,
        reasoningContent: typeof (item as any).reasoningContent === 'string' ? (item as any).reasoningContent : undefined,
      };
    })
    .filter((item): item is DraftChatMessage => Boolean(item))
    .filter((item) => (
      String(item.content || '').trim().length > 0
      || String(item.reasoningContent || '').trim().length > 0
      || Boolean(item.image)
    ));
}

function readDraftReviewPersistedUiState(): DraftReviewPersistedUiState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(DRAFT_SESSION_UI_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function buildPostImportRouteMessages(drafts: DraftQuestion[], insertedCount: number): DraftChatMessage[] {
  const subject = drafts.find((draft) => draft?.subject === '英语' || draft?.subject === 'C语言')?.subject || '英语';
  const nodes = Array.from(new Set(
    drafts
      .map((draft) => toSafeString(draft?.node || draft?.knowledge_point).trim())
      .filter(Boolean),
  )).slice(0, 3);
  const amount = Math.max(3, Math.min(10, insertedCount > 0 ? insertedCount : drafts.length || 5));
  const messages: DraftChatMessage[] = [
    {
      role: 'assistant',
      content: '✅ 入库已完成。若你想继续，我只保留两个轻量入口：去正式复习，或去做同类专项练习。',
      mode: 'route',
    },
    {
      role: 'assistant',
      content: '要继续巩固的话，可以直接跳到正式复习页。',
      mode: 'route',
      action: {
        type: 'start_review',
        risk: 'low',
        title: '去正式复习',
        description: '仅跳转到正式复习页，不在当前录题链路展开复习正文',
        payload: {
          preset: normalizeReviewPreset({
            subject: subject as any,
            scope: 'due',
            amount,
            sortBy: 'nearestDue',
          }),
        },
      },
    },
  ];
  if (nodes.length > 0) {
    messages.push({
      role: 'assistant',
      content: `也可以趁热打铁，直接围绕「${nodes.join('、')}」做专项练习。`,
      mode: 'route',
      action: {
        type: 'start_drill',
        risk: 'low',
        title: '去同类练习',
        description: '仅跳转到正式练习页，不在当前录题链路展开做题流程',
        payload: {
          preset: normalizeDrillPreset({
            subject: subject as any,
            nodes,
            amount,
            strategy: '递进',
          }),
        },
      },
    });
  }
  return messages;
}

function resolveDraftCorrectAnswer(raw: any) {
  const candidate = [
    raw?.correct_answer,
    raw?.correctAnswer,
    raw?.answer,
    raw?.final_answer,
    raw?.normalized_payload?.answerSchema?.correctAnswer,
  ].find((item) => typeof item === 'string' && String(item).trim().length > 0);
  if (typeof candidate === 'string') return candidate.trim();
  const explanationText = [raw?.note, raw?.explanation, raw?.analysis, raw?.summary]
    .filter((item) => typeof item === 'string')
    .join('\n');
  const explicitMatch = explanationText.match(/(?:正确答案|答案)\s*[：:]\s*([^\n，。；;]+)/i);
  if (explicitMatch?.[1]) return explicitMatch[1].trim();
  return '';
}

function ensureDraftNote(raw: any) {
  const candidate = [raw?.note, raw?.analysis, raw?.explanation]
    .find((item) => typeof item === 'string' && String(item).trim().length > 0);
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  return '待补充解析';
}

function ensureDraftSummary(raw: any) {
  const candidate = [raw?.summary, raw?.error_type]
    .find((item) => typeof item === 'string' && String(item).trim().length > 0);
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  return '';
}

function ensureDraftCompleteness(raw: DraftQuestion): DraftQuestion {
  return {
    ...raw,
    note: ensureDraftNote(raw),
    summary: ensureDraftSummary(raw),
  };
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function DraftReviewPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const persistedUiState = useMemo(() => readDraftReviewPersistedUiState(), []);
  const [dictionary, setDictionary] = useState(getCanonicalTagDictionary());
  const [messages, setMessages] = useState<DraftChatMessage[]>(() => {
    try {
      const savedChat = sessionStorage.getItem(DRAFT_CHAT_STORAGE_KEY);
      if (!savedChat) return [];
      const parsed = JSON.parse(savedChat);
      if (Array.isArray(parsed)) {
        return normalizePersistedDraftMessages(parsed);
      }
      if (Array.isArray(parsed?.messages)) {
        return normalizePersistedDraftMessages(parsed.messages);
      }
      return [];
    } catch (error) {
      console.error('Failed to parse chat history', error);
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<CopilotMode>('study');
  const [currentCapability, setCurrentCapability] = useState<CopilotCapability>('explain');
  const [modeSelectionSource, setModeSelectionSource] = useState<'auto' | 'manual'>('auto');
  const [sending, setSending] = useState(false);
  const [executingKey, setExecutingKey] = useState<string | null>(null);
  const [, setSemanticCheckingKey] = useState<string | null>(null);
  const [reanalyzingKey, setReanalyzingKey] = useState<string | null>(null);
  const [executedActions, setExecutedActions] = useState<Record<string, boolean>>(() => persistedUiState.executedActions || {});
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftQuestion>>(() => persistedUiState.draftEdits || {});
  const [deepThinking, setDeepThinking] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DRAFT_DEEP_THINKING_KEY) === '1';
  });
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});
  const [batchDisplayMode, setBatchDisplayMode] = useState<Record<number, 'paged' | 'all'>>(() => persistedUiState.batchDisplayMode || {});
  const [activeBatchByMessage, setActiveBatchByMessage] = useState<Record<number, number>>(() => persistedUiState.activeBatchByMessage || {});
  const [collapsedCompletedByMessage, setCollapsedCompletedByMessage] = useState<Record<number, boolean>>(() => persistedUiState.collapsedCompletedByMessage || {});
  const [highlightedBatchKey, setHighlightedBatchKey] = useState<string | null>(null);
  const [bucketContexts, setBucketContexts] = useState<Record<string, DraftIngestionBucketContext>>({});
  const [createdTagsByMessage, setCreatedTagsByMessage] = useState<Record<number, string[]>>(() => persistedUiState.createdTagsByMessage || {});
  const [batchExecutionPreviewByMessage, setBatchExecutionPreviewByMessage] = useState<Record<number, BatchExecutionPreview>>({});
  const [preflightingBatchKey, setPreflightingBatchKey] = useState<string | null>(null);
  const [handoffState, setHandoffState] = useState<DraftHandoffState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const requestSeqRef = useRef(0);
  const handoffResolverRef = useRef<((result: { status: 'start'; preset: DraftHandoffState['preset'] } | { status: 'cancel' }) => void) | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const batchCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimerRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentCapabilityMeta = getCopilotCapabilityMeta(currentCapability);
  const capabilityStatusLabel = currentCapabilityMeta.label;
  const capabilityStatusHint = currentCapabilityMeta.summary;
  const shouldHideRouteEntrances = currentCapability === 'organize';
  const visibleMessages = useMemo(
    () => normalizePersistedDraftMessages(messages),
    [messages],
  );

  const resolveModeByCapability = useCallback((capability: CopilotCapability): CopilotMode => {
    if (capability === 'organize') return 'ingest';
    if (capability === 'explain') return 'study';
    return 'route';
  }, []);

  const openHandoffDialog = useCallback((nextState: DraftHandoffState) => {
    if (handoffResolverRef.current) {
      handoffResolverRef.current({ status: 'cancel' });
      handoffResolverRef.current = null;
    }
    setHandoffState(nextState);
    return new Promise<{ status: 'start'; preset: DraftHandoffState['preset'] } | { status: 'cancel' }>((resolve) => {
      handoffResolverRef.current = resolve;
    });
  }, []);

  const settleHandoffDialog = useCallback((result: { status: 'start'; preset: DraftHandoffState['preset'] } | { status: 'cancel' }) => {
    setHandoffState(null);
    const resolver = handoffResolverRef.current;
    handoffResolverRef.current = null;
    resolver?.(result);
  }, []);

  const handleModeSelect = (capability: CopilotCapability) => {
    const nextMode = resolveModeByCapability(capability);
    if (nextMode !== currentMode || capability !== currentCapability) {
      toast.info(`${getCopilotCapabilityMeta(capability).label}：${getCopilotCapabilityMeta(capability).summary}`);
    }
    setModeSelectionSource('manual');
    setCurrentMode(nextMode);
    setCurrentCapability(capability);
  };

  const sanitizeVisibleAction = useCallback((
    action: CopilotActionProposal | null,
    mode: CopilotMode,
    capability: CopilotCapability,
  ) => {
    if (!action) return undefined;
    if (capability === 'organize' && (action.type === 'start_review' || action.type === 'start_drill')) {
      return undefined;
    }
    if (!isActionAllowedForMode(mode, action.type)) {
      return undefined;
    }
    return action;
  }, []);

  useEffect(() => {
    try {
      const messagesToSave = visibleMessages.slice(-50);
      sessionStorage.setItem(DRAFT_CHAT_STORAGE_KEY, JSON.stringify(messagesToSave));
    } catch (error) {
      console.warn('Session storage is full or unavailable', error);
      try {
        const withoutImages = visibleMessages.slice(-50).map(m => ({ ...m, image: undefined }));
        sessionStorage.setItem(DRAFT_CHAT_STORAGE_KEY, JSON.stringify(withoutImages));
      } catch (e2) {
        console.warn('Still failed to save chat to session storage', e2);
      }
    }
  }, [visibleMessages]);

  useEffect(() => {
    try {
      const nextState: DraftReviewPersistedUiState = {
        executedActions,
        draftEdits,
        batchDisplayMode,
        activeBatchByMessage,
        collapsedCompletedByMessage,
        createdTagsByMessage,
      };
      const hasContent = Object.values(nextState).some((value) => (
        Array.isArray(value) ? value.length > 0 : Boolean(value && Object.keys(value).length > 0)
      ));
      if (!hasContent) {
        sessionStorage.removeItem(DRAFT_SESSION_UI_STORAGE_KEY);
        return;
      }
      sessionStorage.setItem(DRAFT_SESSION_UI_STORAGE_KEY, JSON.stringify(nextState));
    } catch (error) {
      console.warn('Failed to persist AI 管家页面状态', error);
    }
  }, [activeBatchByMessage, batchDisplayMode, collapsedCompletedByMessage, createdTagsByMessage, draftEdits, executedActions]);

  useEffect(() => {
    void (async () => {
      await hydrateTagExtensionsFromCloud();
      setDictionary(getCanonicalTagDictionary());
    })();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DRAFT_DEEP_THINKING_KEY, deepThinking ? '1' : '0');
  }, [deepThinking]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 160;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);

  const handleChatScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom < 80;
  };

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const pendingKeys = new Set<string>();
    const loadContexts = async () => {
      for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
        const message = messages[messageIndex];
        if (!message?.drafts?.length) continue;
        const groups = buildDraftGroups(messageIndex, message.drafts);
        for (let batchIndex = 0; batchIndex < groups.length; batchIndex += 1) {
          const group = groups[batchIndex];
          const bucketKey = getActionKey(messageIndex, batchIndex);
          pendingKeys.add(bucketKey);
          if (bucketContexts[bucketKey]) continue;
          try {
            const context = await loadDraftIngestionBucketContext(group);
            if (cancelled) return;
            setBucketContexts((prev) => prev[bucketKey] ? prev : { ...prev, [bucketKey]: context });
          } catch {
          }
        }
      }
      if (cancelled) return;
      setBucketContexts((prev) => {
        const nextEntries = Object.entries(prev).filter(([key]) => pendingKeys.has(key));
        if (nextEntries.length === Object.keys(prev).length) return prev;
        return Object.fromEntries(nextEntries);
      });
    };
    void loadContexts();
    return () => {
      cancelled = true;
    };
  }, [messages, draftEdits, dictionary]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

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

  const buildContextPrompt = (ask: string, learningProfile: string, hasImage: boolean, mode: CopilotMode, capability: CopilotCapability) => {
    const imageHint = hasImage
      ? '用户已上传题目图片（在前端会话中可见），请结合用户描述完成分析。'
      : '用户暂未上传图片。';
    const capabilityInstruction = capability === 'organize'
      ? '当前是录入整理模式：可以输出 create_mistake / update_mistake / update_tags / update_learning_content 来生成或更新入库内容。此模式下不要反问“是否需要入库”，直接给可执行卡片。若输出 update_learning_content，markdown 只保留知识内容本体，不要出现“好的我来帮你补充”这类对话语句；若首行标题与知识点标签同名，请省略该标题。'
      : capability === 'explain'
        ? '当前是讲解模式：只做讲解、追问、比较与学习建议，禁止输出 create_mistake、update_mistake、update_tags、delete_mistake。若用户明确要入库或修改，请先建议切换到“录入整理”模式。'
        : capability === 'recommend'
          ? '当前是计划推荐模式：只给建议与理由，禁止写入动作。若用户要真正入库或修改，请建议切换到“录入整理”模式。'
          : '当前是跳转启动模式：仅允许 start_review 或 start_drill，用于进入正式页面。';
    return `${learningProfile}
当前页面：AI 管家
${imageHint}
${buildCopilotModePrompt(mode, capability)}
${capabilityInstruction}
用户请求：${ask}`;
  };

  const getActionKey = (messageIndex: number, batchIndex?: number) => batchIndex === undefined ? `action-${messageIndex}` : `action-${messageIndex}-batch-${batchIndex}`;
  const getBatchBulkKey = (messageIndex: number) => `action-${messageIndex}-batch-all`;
  const getBatchMode = (messageIndex: number, totalBatches: number) => {
    if (totalBatches <= 1) return 'all' as const;
    return batchDisplayMode[messageIndex] || 'paged';
  };
  const getActiveBatch = (messageIndex: number, totalBatches: number) => {
    const current = activeBatchByMessage[messageIndex] ?? 0;
    const max = Math.max(totalBatches - 1, 0);
    return Math.min(Math.max(current, 0), max);
  };
  const focusBatch = (messageIndex: number, batchIndex: number) => {
    const batchKey = getActionKey(messageIndex, batchIndex);
    setActiveBatchByMessage(prev => ({ ...prev, [messageIndex]: batchIndex }));
    setHighlightedBatchKey(batchKey);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedBatchKey((current) => current === batchKey ? null : current);
      highlightTimerRef.current = null;
    }, 1200);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        batchCardRefs.current[batchKey]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  const getLatestPendingDraftMessageIndex = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg?.drafts || msg.drafts.length === 0 || msg.action?.type !== 'create_mistake') continue;
      const groups = buildDraftGroups(i, msg.drafts);
      const hasPending = groups.some((_, batchIdx) => !executedActions[getActionKey(i, batchIdx)]);
      if (hasPending) return i;
    }
    return -1;
  };

  const isDraftRefinementIntent = (text: string) => {
    const normalized = text.trim();
    if (!normalized) return false;
    if (/^(谢谢|好的|知道了|ok|收到)$/i.test(normalized)) return false;
    return /(不满意|重写|重生成|重新生成|重新整理|补充|完善|优化|改一下|改成|解析|笔记|总结|错因|标签|知识点|待入库|草稿)/.test(normalized);
  };

  const buildKnowledgeContextForDrafts = (drafts: DraftQuestion[]) => {
    const content = readLearningContentState();
    const points = Array.from(new Set(drafts.map((draft) => String(draft.knowledge_point || '').trim()).filter(Boolean)));
    if (points.length === 0) return '暂无知识点总结上下文';
    return points.slice(0, 12).map((point) => {
      const drawer = resolveLearningDrawerContentByTag(point, content.drawerByTag);
      const summary = String(drawer?.summary || '').trim().slice(0, 220);
      const markdown = String(drawer?.markdown || '').trim().slice(0, 220);
      return `- ${point}\n  - 现有总结：${summary || '暂无'}\n  - 现有补充：${markdown || '暂无'}`;
    }).join('\n');
  };

  const getDraftOptionLines = (draft: DraftQuestion) => {
    if (Array.isArray(draft.options) && draft.options.length > 0) {
      return draft.options.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (Array.isArray(draft.normalized_payload?.options) && draft.normalized_payload.options.length > 0) {
      return draft.normalized_payload.options.map((item) => `${item.label}. ${item.text}`);
    }
    const parsed = parseQuestionPreview(String(draft.question_text || ''));
    return parsed.options.map((item) => `${item.label}. ${item.text}`);
  };

  const buildDraftPreviewText = (draft: DraftQuestion) => {
    const stem = String(draft.question_text || '').trim();
    const optionLines = getDraftOptionLines(draft);
    if (optionLines.length === 0) return stem;
    return formatQuestionTextForStorage(stem, optionLines);
  };

  const buildDraftQuestion = (raw: any, imageUrl?: string): DraftQuestion => {
    const questionText = String(raw?.question_text || '来自 AI 管家会话');
    const parsed = parseQuestionPreview(questionText);
    const options = Array.isArray(raw?.options)
      ? raw.options.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : parsed.options.map((item) => `${item.label}. ${item.text}`);
    return ensureDraftCompleteness({
      subject: raw?.subject === 'C语言' ? 'C语言' : '英语',
      question_text: questionText,
      image_url: imageUrl || undefined,
      knowledge_point: '',
      note: ensureDraftNote(raw),
      summary: ensureDraftSummary(raw),
      options: options.length > 0 ? options : undefined,
      ...raw,
      correct_answer: resolveDraftCorrectAnswer(raw),
    });
  };

  const extractDraftsFromAction = (action: CopilotActionProposal | null, imageUrl?: string) => {
    if (!action || (action.type !== 'create_mistake' && action.type !== 'update_tags')) return undefined;
    const rawItems = Array.isArray(action.payload?.questions) ? action.payload.questions : [action.payload];
    return rawItems.map((item: any) => buildDraftQuestion(item, imageUrl));
  };

  const clearBatchExecutionPreview = (messageIndex: number) => {
    setBatchExecutionPreviewByMessage((prev) => {
      if (!(messageIndex in prev)) return prev;
      const next = { ...prev };
      delete next[messageIndex];
      return next;
    });
  };

  const updateDraftEdits = (editKey: string, patch: Partial<DraftQuestion>) => {
    const [messageIndexText] = editKey.split('-');
    const messageIndex = Number(messageIndexText);
    setDraftEdits(prev => ({
      ...prev,
      [editKey]: {
        ...prev[editKey],
        ...patch,
      },
    }));
    if (Number.isFinite(messageIndex)) {
      clearBatchExecutionPreview(messageIndex);
    }
  };

  const getMergedDraft = (draft: DraftQuestion, editKey: string): DraftQuestion => {
    const baseOptions = getDraftOptionLines(draft);
    const edited = draftEdits[editKey] || {};
    const mergedSubject = (edited.subject || draft.subject || '英语') === 'C语言' ? 'C语言' : '英语';
    const resolvedKnowledgePoint = String(edited.knowledge_point ?? draft.knowledge_point ?? '').trim();
    return {
      ...draft,
      ...edited,
      subject: mergedSubject,
      knowledge_point: resolvedKnowledgePoint,
      options: edited.options ?? (draft.options ?? (baseOptions.length > 0 ? baseOptions : undefined)),
    };
  };

  const getSelectableValue = (value: string | undefined, options: string[]) => {
    if (!value) return '';
    return options.includes(value) ? value : '';
  };

  const toSelectValue = (value: string) => value || SELECT_EMPTY_VALUE;
  const fromSelectValue = (value: string) => (value === SELECT_EMPTY_VALUE ? '' : value);
  const buildDraftGroups = (messageIndex: number, drafts: DraftQuestion[]) => (
    buildDraftIngestionBuckets(drafts, (draft, absoluteIdx) => getMergedDraft(draft, `${messageIndex}-${absoluteIdx}`))
  );

  const prepareDraftForImport = (draft: DraftQuestion) => {
    const completedDraft = ensureDraftCompleteness(draft);
    return normalizeDraftForImportPolicy(completedDraft);
  };

  const buildKnowledgeSuggestions = (
    messageIndex: number,
    draftGroups: DraftIngestionBucket[],
    readyGroups: DraftIngestionBucket[],
  ) => (
    readyGroups.map((group) => {
      const groupIndex = draftGroups.findIndex((item) => item.bucketKey === group.bucketKey);
      const context = bucketContexts[getActionKey(messageIndex, groupIndex)];
      if (context?.existingKnowledgeMarkdown) {
        return `${group.label}：建议检查并更新已有知识点内容`;
      }
      return `${group.label}：建议新增首份知识点内容`;
    })
  );

  const buildBatchExecutionPreview = async (
    messageIndex: number,
    draftGroups: DraftIngestionBucket[],
    messageDrafts: DraftQuestion[],
  ): Promise<BatchExecutionPreview> => {
    const readyGroups = draftGroups.filter((group) => group.status === 'ready');
    const readyDrafts = readyGroups.flatMap((group) => (
      group.absoluteIndexes.map((absoluteIdx) => getMergedDraft(messageDrafts[absoluteIdx] as DraftQuestion, `${messageIndex}-${absoluteIdx}`))
    ));
    const validationIssues = validateDraftsBeforeImportPolicy(readyDrafts);
    if (validationIssues.length > 0) {
      throw new Error(validationIssues[0]);
    }
    const duplicatePreview = await runUnifiedDuplicateGuard(readyDrafts.map((draft) => prepareDraftForImport(draft)));
    return {
      candidateCount: readyDrafts.length,
      insertedCount: duplicatePreview.finalInsertList.length,
      duplicateCount: duplicatePreview.duplicateCount,
      aiDuplicateCount: duplicatePreview.aiDuplicateCount,
      duplicateReasons: duplicatePreview.duplicateReasons,
      createdTags: createdTagsByMessage[messageIndex] || [],
      knowledgeSuggestions: buildKnowledgeSuggestions(messageIndex, draftGroups, readyGroups),
      duplicateGuard: duplicatePreview,
    };
  };

  const normalizeQuestionIdentityText = (value: unknown) => String(value || '').replace(/[\s\p{P}]/gu, '').toLowerCase();
  const resolveQuestionIdFromActionPayload = async (action: CopilotActionProposal, drafts?: DraftQuestion[]) => {
    const payload = action.payload || {};
    const directCandidates = [
      payload?.question_id,
      payload?.questionId,
      payload?.id,
      payload?.mistake_id,
      payload?.mistakeId,
      Array.isArray(payload?.questions) ? payload.questions[0]?.question_id : undefined,
      Array.isArray(payload?.questions) ? payload.questions[0]?.id : undefined,
    ].map((item) => String(item || '').trim()).filter(Boolean);
    if (directCandidates.length > 0) {
      const target = directCandidates.find((item) => isUuidLike(item));
      if (target) return target;
      return directCandidates[0];
    }
    const allQuestions = await questionsApi.getAll();
    const textCandidates = [
      payload?.question_text,
      payload?.questionText,
      Array.isArray(payload?.questions) ? payload.questions[0]?.question_text : undefined,
      Array.isArray(payload?.questions) ? payload.questions[0]?.questionText : undefined,
      drafts?.[0]?.question_text,
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    for (const candidate of textCandidates) {
      const normalized = normalizeQuestionIdentityText(candidate);
      if (normalized.length < 6) continue;
      const matches = allQuestions.filter((question) => {
        if (directCandidates.some((candidate) => matchesQuestionIdentifier(question, candidate))) {
          return true;
        }
        const target = normalizeQuestionIdentityText(question.question_text);
        if (!target) return false;
        return target.includes(normalized) || normalized.includes(target);
      });
      if (matches.length === 1) return matches[0].id;
    }
    return '';
  };

  const executeAction = async (
    action: CopilotActionProposal,
    drafts?: DraftQuestion[],
    options?: {
      actionKey?: string;
      mode?: CopilotMode;
      skipDuplicateConfirm?: boolean;
      allowAllDuplicateSkip?: boolean;
      precomputedDuplicateGuard?: DuplicateGuardResult;
    },
  ): Promise<DraftExecutionResult | { updatedId: string } | { deletedId: string } | void> => {
    const activeMode = options?.mode || currentMode;
    const activeCapability: CopilotCapability = action.type === 'start_review' || action.type === 'start_drill'
      ? 'launch'
      : currentCapability;
    if (!isActionAllowedForMode(activeMode, action.type)) {
      throw new Error(`${getCopilotModeMeta(activeMode).label}不允许直接执行「${action.type}」动作，请先切换到匹配模式后再继续。`);
    }
    if (action.type === 'create_mistake') {
      const itemsToCreate = drafts && drafts.length > 0 ? drafts : [action.payload];
      const validationIssues = validateDraftsBeforeImportPolicy(itemsToCreate);
      if (validationIssues.length > 0) {
        throw new Error(validationIssues[0]);
      }
      const preparedItems = itemsToCreate.map((draft) => prepareDraftForImport(draft))
      if (options?.actionKey) setSemanticCheckingKey(options.actionKey)
      let duplicateGuard: DuplicateGuardResult
      try {
        duplicateGuard = options?.precomputedDuplicateGuard || await runUnifiedDuplicateGuard(preparedItems)
      } finally {
        setSemanticCheckingKey((current) => (current === options?.actionKey ? null : current))
      }

      const { finalInsertList, duplicateCount, duplicateReasons, aiDuplicateCount } = duplicateGuard
      if (duplicateCount > 0) {
        if (finalInsertList.length === 0) {
          if (options?.allowAllDuplicateSkip) {
            return {
              insertedCount: 0,
              duplicateCount,
              aiDuplicateCount,
              insertedItems: [],
              skippedAllAsDuplicate: true,
            };
          }
          throw new Error('本批题目均为相似错题，已全部跳过');
        }
        if (!options?.skipDuplicateConfirm) {
          const aiReasons = duplicateReasons.slice(0, 3);
          const confirmDuplicate = await confirm({
            title: '发现相似错题',
            description: (
              <div className="space-y-2">
                <p>{`检测到 ${duplicateCount} 道相似题。是否跳过这些题，仅入库其余 ${finalInsertList.length} 道？`}</p>
                {aiReasons.length > 0 ? (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {`AI 判定依据：${aiReasons.map((reason, index) => `${index + 1}. ${reason}`).join('；')}`}
                  </div>
                ) : null}
              </div>
            ),
            confirmText: '跳过相似并继续',
            cancelText: '取消',
          });
          if (!confirmDuplicate) throw new Error('用户取消操作');
        }
      }

      const insertedItems = await Promise.all(finalInsertList.map(item => questionsApi.create(item)));
      return {
        insertedCount: finalInsertList.length,
        duplicateCount,
        aiDuplicateCount,
        insertedItems,
      };
    }
    if (action.type === 'start_review') {
      const payload = normalizeReviewPreset(action.payload?.preset) as ReviewPreset;
      const handoffResult = await openHandoffDialog({
        kind: 'review',
        capability: activeCapability,
        activeMode,
        sourceLabel: `${getCopilotCapabilityMeta(activeCapability).label}：正式复习会切换到专门页面执行，聊天区只负责说明与 handoff。`,
        reason: action.description || 'AI 管家根据当前学习状态，建议先完成一轮正式复习。',
        expectedBenefit: payload.scope === 'due' ? '先清理最该复习的内容，减少遗忘堆积。' : '统一回看当前范围里的错题，快速补齐薄弱点。',
        preset: payload,
      });
      if (handoffResult.status !== 'start') return;
      const nextPayload = handoffResult.preset as ReturnType<typeof normalizeReviewPreset>;
      const proposal = createLearningSessionProposal({
        sessionKind: 'review',
        sourceSurface: 'copilot-draft',
        sourceReason: 'AI 管家建议开始正式复习',
        objectiveCode: nextPayload.scope === 'due' ? 'review_due' : 'custom_scope',
        explanationSummary: 'AI 管家已整理好本轮复习任务，建议转入正式复习页继续执行',
        scope: {
          subject: nextPayload.subject as Subject,
          amount: nextPayload.amount,
          strategy: (nextPayload.strategy || 'custom') as 'due_rescue' | 'stubborn_focus' | 'unmastered_boost' | 'custom',
          reviewScope: nextPayload.scope as 'all' | 'due' | 'unmastered' | 'stubborn',
          sortBy: nextPayload.sortBy as 'latestWrong' | 'lowestMastery' | 'nearestDue',
        },
        handoffContext: {
          sourceMode: activeMode,
          summary: `AI 管家建议开始 ${nextPayload.amount} 题分包复习任务`,
        },
        returnPath: {
          pathname: '/draft-review',
          search: '',
          label: '回到 AI 管家',
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
      return;
    }
    if (action.type === 'start_drill') {
      const payload = normalizeDrillPreset(action.payload?.preset) as DrillPreset;
      const nodes = toNodeList((payload as any)?.nodes);
      const handoffResult = await openHandoffDialog({
        kind: 'practice',
        capability: activeCapability,
        activeMode,
        sourceLabel: `${getCopilotCapabilityMeta(activeCapability).label}：正式练习会切换到专门页面执行，聊天区只负责说明与 handoff。`,
        reason: action.description || (nodes.length > 0 ? `AI 管家建议围绕「${nodes.join('、')}」做一轮集中训练。` : 'AI 管家建议先做一轮专项训练。'),
        expectedBenefit: payload.strategy === '攻坚' ? '集中补强高频失分点，尽快拉回薄弱项。' : '把建议范围转成正式练习，边做边保留推荐原因与目标。',
        preset: payload,
      });
      if (handoffResult.status !== 'start') return;
      const nextPayload = handoffResult.preset as ReturnType<typeof normalizeDrillPreset>;
      const nextNodes = toNodeList((nextPayload as any)?.nodes);
      const proposal = createLearningSessionProposal({
        sessionKind: 'practice',
        sourceSurface: 'copilot-draft',
        sourceReason: 'AI 管家建议开始正式专项练习',
        objectiveCode: nextPayload.strategy === '攻坚' ? 'weakness_reinforce' : nextPayload.strategy === '递进' ? 'custom_scope' : 'sprint_drill',
        explanationSummary: 'AI 管家已整理好本轮专项训练范围，建议转入正式练习页继续执行',
        scope: {
          subject: nextPayload.subject as Subject,
          amount: nextPayload.amount,
          nodes: nextPayload.nodes,
          strategy: nextPayload.strategy as '递进' | '随机' | '攻坚',
        },
        handoffContext: {
          sourceMode: activeMode,
          summary: nextNodes.length > 0 ? `AI 管家建议围绕 ${nextNodes.join('、')} 开始专项训练` : 'AI 管家建议开始一轮专项训练',
        },
        returnPath: {
          pathname: '/draft-review',
          search: '',
          label: '回到 AI 管家',
        },
        nextStepHint: {
          kind: 'review',
          label: '完成后去复习巩固',
          pathname: '/review',
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
      return;
    }
    if (action.type === 'update_tags') {
      const targetQuestionId = await resolveQuestionIdFromActionPayload(action, drafts);
      if (!targetQuestionId) {
        throw new Error('缺少可识别的 question_id，无法更新错题。请让 AI 在动作中携带 question_id。');
      }
      const allQuestions = await questionsApi.getAll();
      const targetQuestion = allQuestions.find((item) => matchesQuestionIdentifier(item, targetQuestionId));
      if (!targetQuestion) {
        throw new Error(`未找到 question_id=${targetQuestionId} 对应的错题`);
      }
      const source = Array.isArray(action.payload?.questions) ? action.payload.questions[0] : action.payload;
      const normalized = normalizeMistakeDraft({
        ...targetQuestion,
        ...(source || {}),
        ...(drafts?.[0] || {}),
        subject: targetQuestion.subject as any,
      });
      await questionsApi.update(targetQuestionId, {
        question_text: normalized.question_text,
        knowledge_point: normalized.knowledge_point,
        question_type: normalized.question_type,
        correct_answer: normalized.correct_answer,
        note: normalized.note,
        summary: normalized.summary,
      });
      return { updatedId: targetQuestionId };
    }
    if (action.type === 'update_learning_content') {
      const payload = action.payload || {};
      const updates = Array.isArray(payload.updates) ? payload.updates : [payload];
      const current = readLearningContentState();
      let updatedCount = 0;
      let skippedCount = 0;
      
      for (const update of updates) {
        if (!update || typeof update !== 'object') continue;
        const normalizedUpdate = update as Record<string, unknown>;
        const targetTag = String(normalizedUpdate.tag || normalizedUpdate.node || normalizedUpdate.knowledge_point || '').trim();
        if (!targetTag) continue;
        
        const existingDrawer = resolveLearningDrawerContentByTag(targetTag, current.drawerByTag);
        const merged = mergeLearningDrawerContent(existingDrawer, {
          targetNode: targetTag,
          note: normalizedUpdate.note,
          markdown: normalizedUpdate.markdown,
          reason: normalizedUpdate.reason,
          decision: normalizedUpdate.decision === 'skip' || normalizedUpdate.decision === 'rewrite' || normalizedUpdate.decision === 'create'
            ? normalizedUpdate.decision
            : undefined,
          source: 'ai_update',
        });
        current.drawerByTag[targetTag] = {
          ...merged.drawer,
          ...(normalizedUpdate.title ? { title: String(normalizedUpdate.title) } : {}),
        };
        if (merged.decision === 'skip') {
          skippedCount++;
        } else {
          updatedCount++;
        }
      }
      
      if (updatedCount > 0 || skippedCount > 0) {
        writeLearningContentState(current);
        if (updatedCount > 0 && skippedCount > 0) {
          toast.success(`已更新 ${updatedCount} 个知识点，另有 ${skippedCount} 个无需改写`);
        } else if (updatedCount > 0) {
          toast.success(`已更新 ${updatedCount} 个知识点内容`);
        } else {
          toast.success(`本次 ${skippedCount} 个知识点均无需更新`);
        }
      } else {
        toast.error('缺少知识点标签，无法更新知识点内容');
      }
      return;
    }
    if (action.type === 'delete_mistake') {
      const targetQuestionId = await resolveQuestionIdFromActionPayload(action, drafts);
      if (!targetQuestionId) {
        throw new Error('缺少可识别的 question_id，无法删除错题。请让 AI 在动作中携带 question_id。');
      }
      await questionsApi.delete(targetQuestionId);
      return { deletedId: targetQuestionId };
    }
  };



  const normalizeKnowledgeUpdateSubject = (value: unknown, fallback: Subject = '英语'): Subject => (
    value === 'C语言' ? 'C语言' : value === '英语' ? '英语' : fallback
  );

  const inferKnowledgeUpdateSubjectByTag = (tag: string, fallback: Subject = '英语'): Subject => {
    const normalizedTag = String(tag || '').trim();
    if (!normalizedTag) return fallback;
    const inEnglish = getKnowledgePointsBySubjectFromTaxonomy('英语').includes(normalizedTag);
    const inC = getKnowledgePointsBySubjectFromTaxonomy('C语言').includes(normalizedTag);
    if (inC && !inEnglish) return 'C语言';
    if (inEnglish && !inC) return '英语';
    return fallback;
  };

  const ensureKnowledgeUpdateTagsReady = async (updates: KnowledgeUpdateDraft[]) => {
    const missingBySubject: Record<Subject, string[]> = { 英语: [], C语言: [] };
    updates.forEach((update) => {
      const tag = String(update.tag || '').trim();
      if (!tag) return;
      const subject = normalizeKnowledgeUpdateSubject(update.subject, '英语');
      const known = getKnowledgePointsBySubjectFromTaxonomy(subject);
      if (!known.includes(tag)) {
        missingBySubject[subject].push(tag);
      }
    });
    const uniqueMissing: Record<Subject, string[]> = {
      英语: Array.from(new Set(missingBySubject.英语)),
      C语言: Array.from(new Set(missingBySubject.C语言)),
    };
    if (uniqueMissing.英语.length === 0 && uniqueMissing.C语言.length === 0) {
      return [] as Array<{ tag: string; subject: Subject }>;
    }
    const sections = [
      uniqueMissing.英语.length > 0 ? `英语：${uniqueMissing.英语.join('、')}` : '',
      uniqueMissing.C语言.length > 0 ? `C语言：${uniqueMissing.C语言.join('、')}` : '',
    ].filter(Boolean);
    const approved = await confirm({
      title: '检测到缺失标签',
      confirmText: '创建并继续',
      cancelText: '取消',
      description: (
        <div className="space-y-2 text-sm text-gray-700">
          <p>以下知识点标签尚未存在，是否先创建后再导入？</p>
          <div className="rounded-xl bg-gray-50 px-3 py-2 leading-relaxed">{sections.join('\n')}</div>
        </div>
      ),
    });
    if (!approved) {
      throw new Error('用户取消操作');
    }
    const created: Array<{ tag: string; subject: Subject }> = [];
    for (const subject of ['英语', 'C语言'] as Subject[]) {
      for (const tag of uniqueMissing[subject]) {
        const meta = inferKnowledgeNodeMetaForNewTag(subject, tag);
        await registerCustomKnowledgeTaxonomy(tag, meta.category, meta.branch, subject);
        created.push({ tag, subject });
      }
    }
    setDictionary(getCanonicalTagDictionary());
    return created;
  };

  const resolveKnowledgeReferenceDrawer = (
    update: KnowledgeUpdateDraft,
    state: ReturnType<typeof readLearningContentState>,
    fallbackSubject: Subject = '英语',
  ) => {
    const subject = normalizeKnowledgeUpdateSubject(
      update.subject,
      inferKnowledgeUpdateSubjectByTag(update.tag, fallbackSubject),
    );
    return resolveLearningDrawerReferenceForUpdate(update.tag, state.drawerByTag, subject);
  };

  const applyKnowledgeUpdates = async (updates: KnowledgeUpdateDraft[] | undefined) => {
    const normalizedUpdates = Array.isArray(updates)
      ? updates.filter((update) => Boolean(update?.tag))
      : [];
    if (normalizedUpdates.length === 0) {
      return { updatedCount: 0, skippedCount: 0, createdTags: [] as Array<{ tag: string; subject: Subject }> };
    }
    const createdTags = await ensureKnowledgeUpdateTagsReady(normalizedUpdates);
    const current = readLearningContentState();
    let updatedCount = 0;
    let skippedCount = 0;

    for (const update of normalizedUpdates) {
      const reference = resolveKnowledgeReferenceDrawer(update, current);
      const merged = mergeLearningDrawerContent(current.drawerByTag[update.tag] || reference.drawer, {
        targetNode: update.tag,
        note: update.note,
        markdown: update.markdown,
        reason: update.reason,
        decision: update.decision,
        source: 'ai_update',
      });
      current.drawerByTag[update.tag] = {
        ...merged.drawer,
        ...(update.title ? { title: String(update.title) } : {}),
      };
      if (merged.decision === 'skip') {
        skippedCount += 1;
      } else {
        updatedCount += 1;
      }
    }

    if (updatedCount > 0 || skippedCount > 0) {
      writeLearningContentState(current);
    }

    return { updatedCount, skippedCount, createdTags };
  };

  const getKnowledgeUpdatesForTag = (updates: KnowledgeUpdateDraft[] | undefined, tag: string) => (
    (updates || []).filter((update) => String(update.tag || '').trim() === String(tag || '').trim())
  );

  const getKnowledgeUpdateActionKey = (messageIndex: number, tag: string) => `knowledge-${messageIndex}-${tag}`;

  const buildKnowledgeUpdateSummary = (updates: KnowledgeUpdateDraft[] | undefined) => {
    const normalized = (updates || []).map((update) => String(update.tag || '').trim()).filter(Boolean);
    return Array.from(new Set(normalized));
  };

  const reanalyzeDraftBatch = async (
    messageIndex: number,
    batchIndex: number,
    batchAbsoluteIndexes: number[],
    batchDrafts: DraftQuestion[],
    groupLabel: string,
  ) => {
    const batchKey = getActionKey(messageIndex, batchIndex);
    if (executedActions[batchKey] || executingKey === batchKey || reanalyzingKey === batchKey) return;
    const previousUserMessage = [...messages.slice(0, messageIndex)].reverse().find((item) => item.role === 'user');
    if (!previousUserMessage) {
      toast.error('找不到原始提问，暂时无法重新分析这一批');
      return;
    }
    setReanalyzingKey(batchKey);
    try {
      const learningProfile = await buildCopilotLearningProfile();
      const indexedLabel = batchAbsoluteIndexes.map((value) => value + 1).join('、');
      const draftSnapshot = batchDrafts.map((draft, index) => ({
        index: batchAbsoluteIndexes[index] + 1,
        question_text: buildDraftPreviewText(draft),
        knowledge_point: draft.knowledge_point || '',
        subject: draft.subject || '英语',
        correct_answer: draft.correct_answer || '',
        note: draft.note || '',
      }));
      const reanalyzePrompt = `${buildContextPrompt(previousUserMessage.content, learningProfile, Boolean(previousUserMessage.image), currentMode, currentCapability)}
请只重新分析当前这一个待确认批次，不要输出与这批无关的内容。
目标分组：${groupLabel}（题号：${indexedLabel}，共 ${batchDrafts.length} 题）。
要求：
1. 必须返回 create_mistake 动作。
2. payload.questions 的题数必须与当前批次一致。
3. 每题只能保留 1 个最终主知识点。
4. 重新检查科目、主知识点、解析和总结。
5. 如果是选择题，请保留完整选项。
当前批次草稿：
${JSON.stringify(draftSnapshot, null, 2)}`;
      const requestMessages: Array<{ role: string; content: any }> = [];
      if (previousUserMessage.image) {
        requestMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: reanalyzePrompt },
            { type: 'image_url', image_url: { url: previousUserMessage.image } },
          ],
        });
      } else {
        requestMessages.push({ role: 'user', content: reanalyzePrompt });
      }
      const full = await new Promise<string>((resolve, reject) => {
        chatApi.streamCopilot(
          requestMessages,
          () => {},
          (content) => resolve(content),
          (error) => reject(new Error(error)),
          { injectLearningProfile: false, enableThinking: false }
        );
      });
      const action = parseCopilotAction(full);
      const nextDrafts = extractDraftsFromAction(action, previousUserMessage.image || undefined)?.map((draft) => ensureDraftCompleteness(draft));
      if (!action || action.type !== 'create_mistake' || !nextDrafts || nextDrafts.length !== batchDrafts.length) {
        throw new Error('重新分析结果不完整，请稍后重试');
      }
      setMessages(prev => {
        const next = [...prev];
        const target = next[messageIndex];
        if (!target?.drafts) return prev;
        const replacedDrafts = [...target.drafts];
        nextDrafts.forEach((draft, localIdx) => {
          const absoluteIdx = batchAbsoluteIndexes[localIdx];
          replacedDrafts[absoluteIdx] = draft;
        });
        next[messageIndex] = {
          ...target,
          action,
          drafts: replacedDrafts,
        };
        return next;
      });
      setDraftEdits(prev => {
        const next = { ...prev };
        batchAbsoluteIndexes.forEach((absoluteIdx) => {
          delete next[`${messageIndex}-${absoluteIdx}`];
        });
        return next;
      });
      setExecutedActions(prev => {
        const next = { ...prev };
        delete next[batchKey];
        return next;
      });
      clearBatchExecutionPreview(messageIndex);
      toast.success(`第 ${batchIndex + 1} 批已重新分析，请重新核对后再入库`);
    } catch (error: any) {
      toast.error(error?.message || '重新分析失败');
    } finally {
      setReanalyzingKey(null);
    }
  };

  const executeAllDraftGroups = async (
    messageIndex: number,
    action: CopilotActionProposal,
    mode: CopilotMode | undefined,
    draftGroups: DraftIngestionBucket[],
    messageDrafts: DraftQuestion[],
    knowledgeUpdates?: KnowledgeUpdateDraft[],
  ) => {
    const bulkActionKey = getBatchBulkKey(messageIndex);
    const readyGroups = draftGroups.filter((group) => group.status === 'ready');
    const pendingTagGroups = draftGroups.filter((group) => group.status === 'pending_tag');
    const unassignedGroups = draftGroups.filter((group) => group.status === 'unassigned');
    if (readyGroups.length === 0 || pendingTagGroups.length > 0 || unassignedGroups.length > 0) {
      toast.error('请先处理待创建标签或待确认知识点分桶，再统一执行本批入库');
      return;
    }
    setPreflightingBatchKey(bulkActionKey);
    let preview: BatchExecutionPreview;
    try {
      preview = await buildBatchExecutionPreview(messageIndex, draftGroups, messageDrafts);
      setBatchExecutionPreviewByMessage((prev) => ({ ...prev, [messageIndex]: preview }));
    } catch (error: any) {
      toast.error(error?.message || '生成本批摘要失败');
      return;
    } finally {
      setPreflightingBatchKey(null);
    }
    const approved = await confirm({
      title: '确认执行本批变更',
      confirmText: '确认本批执行',
      cancelText: '继续检查',
      description: (
        <div className="space-y-3 text-sm text-gray-700">
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-blue-700">
            本次将按标签桶统一执行入库，并在执行阶段复用统一去重护栏后正式写入。
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-2 leading-relaxed">
            <p>{`新增错题候选：${preview.candidateCount} 道`}</p>
            <p>{`预计正式新增：${preview.insertedCount} 道`}</p>
            <p>{`预计跳过重复：${preview.duplicateCount} 道${preview.aiDuplicateCount > 0 ? `（其中 AI 语义判重 ${preview.aiDuplicateCount} 道）` : ''}`}</p>
            <p>{`待执行标签桶：${readyGroups.length} 组`}</p>
            <p>{`新建标签：${preview.createdTags.length > 0 ? preview.createdTags.join('、') : '无'}`}</p>
          </div>
          {preview.duplicateReasons.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-3 py-2 leading-relaxed text-amber-800">
              <p className="font-medium">重复跳过依据</p>
              <p>{preview.duplicateReasons.slice(0, 3).join('；')}</p>
            </div>
          )}
          {preview.knowledgeSuggestions.length > 0 && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 leading-relaxed text-emerald-800">
              <p className="font-medium">知识点更新建议</p>
              <p>{preview.knowledgeSuggestions.join('；')}</p>
            </div>
          )}
        </div>
      ),
    });
    if (!approved) return;
    setExecutingKey(bulkActionKey);
    try {
      let totalInserted = 0;
      let totalDuplicate = 0;
      const readyDrafts = readyGroups.flatMap((group) => (
        group.absoluteIndexes.map((absoluteIdx) => getMergedDraft(messageDrafts[absoluteIdx] as DraftQuestion, `${messageIndex}-${absoluteIdx}`))
      ));
      const result = await executeAction(action, readyDrafts, {
        actionKey: bulkActionKey,
        mode,
        skipDuplicateConfirm: true,
        allowAllDuplicateSkip: true,
        precomputedDuplicateGuard: preview.duplicateGuard,
      });
      if (action.type === 'create_mistake' && result && 'insertedCount' in result) {
        totalInserted += result.insertedCount;
        totalDuplicate += result.duplicateCount;
      }
      for (let importBatchIndex = 0; importBatchIndex < draftGroups.length; importBatchIndex += 1) {
        const importBatchKey = getActionKey(messageIndex, importBatchIndex);
        if (executedActions[importBatchKey]) continue;
        const importGroup = draftGroups[importBatchIndex];
        if (!importGroup || importGroup.status !== 'ready') continue;
        setExecutedActions((prev) => ({ ...prev, [importBatchKey]: true }));
      }
      if (action.type === 'create_mistake') {
        if (totalDuplicate > 0) {
          toast.success(`本批执行完成：已存入 ${totalInserted} 道错题，跳过 ${totalDuplicate} 道相似题`);
        } else {
          toast.success(`本批执行完成：已存入 ${totalInserted} 道错题`);
        }
      }
      const pendingKnowledgeTags = buildKnowledgeUpdateSummary(knowledgeUpdates);
      if (pendingKnowledgeTags.length === 0) {
        setCollapsedCompletedByMessage((prev) => ({ ...prev, [messageIndex]: true }));
      }
      const knowledgeSummary = pendingKnowledgeTags.length > 0
        ? `对应知识点还有 ${pendingKnowledgeTags.length} 项待你逐个审核确认。`
        : '本批未生成待审核的知识点改写。';
      const routeDrafts = (messageDrafts || []).map((draft, absoluteIdx) => getMergedDraft(draft as DraftQuestion, `${messageIndex}-${absoluteIdx}`));
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `✅ 本批已统一执行：共处理 ${readyGroups.length} 个分桶，新增 ${totalInserted} 道，跳过 ${totalDuplicate} 道相似题。${knowledgeSummary}` },
        ...(action.type === 'create_mistake' && !shouldHideRouteEntrances ? buildPostImportRouteMessages(routeDrafts, totalInserted || routeDrafts.length) : []),
      ]);
    } catch (error: any) {
      if (error?.message === '用户取消操作') return;
      toast.error(error?.message || '执行失败');
    } finally {
      setExecutingKey(null);
    }
  };

  const handleSend = async (quickInput?: string) => {
    const ask = (quickInput || input).trim() || (imagePreview ? '请根据我上传的题图帮我分析并给出下一步建议。' : '');
    if (!ask || sending) return;
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    const isCurrentRequest = () => requestSeqRef.current === requestId;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort('superseded');
      abortControllerRef.current = null;
    }
    stopRequestedRef.current = false;
    setSending(true);

    // 智能识别：如果是简单的打招呼，强制跳过深度思考，避免浪费 token 和时间
    const isSimpleGreeting = /^(你好|在吗|嗨|hello|hi|喂|早上好|下午好|晚上好|哈喽|哈罗|hello啊|hi啊)$/i.test(ask);
    const effectiveDeepThinking = deepThinking && !isSimpleGreeting;
    
    const currentImage = imagePreview;
    const pendingDraftMessageIndex = currentImage ? -1 : getLatestPendingDraftMessageIndex();
    const shouldRefinePendingDraft = currentCapability === 'organize' && pendingDraftMessageIndex >= 0 && isDraftRefinementIntent(ask);
    const inferredCapability = inferCopilotCapability({ ask, surface: 'draft', hasImage: Boolean(currentImage) });
    const inferredMode = resolveModeByCapability(inferredCapability);
    const resolvedMode = modeSelectionSource === 'manual' && !shouldRefinePendingDraft ? currentMode : inferredMode;
    const resolvedCapability = modeSelectionSource === 'manual' && !shouldRefinePendingDraft ? currentCapability : inferredCapability;
    if (shouldRefinePendingDraft && resolvedMode !== currentMode) {
      setCurrentMode(resolvedMode);
    }
    if (shouldRefinePendingDraft && resolvedCapability !== currentCapability) {
      setCurrentCapability(resolvedCapability);
    }
    shouldAutoScrollRef.current = true;
    setImagePreview(null);
    
    const baseMessages = [...messages, { role: 'user' as const, content: ask, image: currentImage || undefined, mode: resolvedMode }];
    setMessages(baseMessages);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (isSimpleGreeting) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '你好，我在。你可以直接说“帮我讲第5题”或“帮我上传一道错题”。',
          mode: resolvedMode,
        },
      ]);
      setSending(false);
      return;
    }

    const placeholderIndex = baseMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: effectiveDeepThinking ? '' : '正在思考...', reasoningContent: effectiveDeepThinking ? '正在深度思考中...' : undefined, mode: resolvedMode }]);
    if (effectiveDeepThinking) {
      setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: true }));
    }
    if (stopRequestedRef.current || !isCurrentRequest()) {
      setSending(false);
      abortControllerRef.current = null;
      return;
    }
    const learningProfile = await buildCopilotLearningProfile();
    if (stopRequestedRef.current || !isCurrentRequest()) {
      setSending(false);
      abortControllerRef.current = null;
      return;
    }

    await new Promise<void>((resolve) => {
      const requestMessages: Array<{ role: string; content: any }> = [];
      if (shouldRefinePendingDraft) {
        const target = messages[pendingDraftMessageIndex];
        const sourceUserMessage = [...messages.slice(0, pendingDraftMessageIndex)].reverse().find((item) => item.role === 'user');
        const sourceImage = sourceUserMessage?.image;
        const mergedDrafts = (target?.drafts || []).map((draft, draftIdx) => ensureDraftCompleteness(getMergedDraft(draft, `${pendingDraftMessageIndex}-${draftIdx}`)));
        const knowledgeContext = buildKnowledgeContextForDrafts(mergedDrafts);
        const refinePrompt = `${buildContextPrompt(ask, learningProfile, Boolean(sourceImage), 'ingest', 'organize')}
用户这次不是要新增输出，而是要你“重写上方待入库草稿”，并覆盖原草稿。
要求：
1. 必须返回 create_mistake。
2. payload.questions 题数必须与当前草稿一致（${mergedDrafts.length}题）。
3. 每题必须有非空 note，直接写清题眼、错因和结论，不要套固定模板。
4. 不要给每题预置 summary，summary 可以留空。
5. 如果用户要求“补解析/补总结”，优先把方法论写进 note，并用 update_learning_content 单独产出知识点总结。
6. 保留已有题干与选项语义，除非用户明确要求改题。
7. 若用户要求补充/归并知识点总结，可额外输出 update_learning_content 或 learning_updates。
知识点总结快照：
${knowledgeContext}
当前待重写草稿：
${JSON.stringify(mergedDrafts, null, 2)}`;
        if (sourceImage) {
          requestMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: refinePrompt },
              { type: 'image_url', image_url: { url: sourceImage } },
            ],
          });
        } else {
          requestMessages.push({ role: 'user', content: refinePrompt });
        }
      } else {
      const contextPrompt = buildContextPrompt(ask, learningProfile, Boolean(currentImage), resolvedMode, resolvedCapability);
        requestMessages.push(...baseMessages.map(item => ({ role: item.role, content: item.content })));
        if (currentImage) {
          requestMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: contextPrompt },
              { type: 'image_url', image_url: { url: currentImage } },
            ],
          });
        } else {
          requestMessages.push({ role: 'user', content: contextPrompt });
        }
      }

      abortControllerRef.current = new AbortController();

      chatApi.streamCopilot(
        requestMessages,
        (chunk, isReasoning) => {
          if (!isCurrentRequest()) return;
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            if (!current) return prev;
            if (isReasoning) {
              next[placeholderIndex] = { ...current, reasoningContent: (current.reasoningContent === '正在深度思考中...' ? '' : current.reasoningContent || '') + chunk };
            } else {
              const merged = (current.content === '正在思考...' ? '' : current.content) + chunk;
              next[placeholderIndex] = { ...current, content: stripActionForStreaming(merged) };
            }
            return next;
          });
        },
        (full) => {
          if (!isCurrentRequest()) {
            resolve();
            return;
          }
          abortControllerRef.current = null;
          const parsedAction = parseCopilotAction(full);
          let cleaned = stripActionBlock(full) || '我已经完成分析，请查看建议。';
          const allowKnowledgeUpdate = resolvedCapability === 'organize';
          const fallbackAction = parsedAction ? null : (allowKnowledgeUpdate ? parseLearningContentActionFromText(cleaned) : null);
          const action = sanitizeVisibleAction(parsedAction || fallbackAction, resolvedMode, resolvedCapability);
          
          const hasActionBlock = /<ACTION>[\s\S]*?<\/ACTION>/i.test(full) || /```(?:json)?\s*(\{[\s\S]*?(?:"type"|"payload")[\s\S]*?\})\s*```/i.test(full);
          const isParseError = hasActionBlock && !action;
          if (isParseError) {
            cleaned += '\n\n*(注意：AI 生成的入库数据格式存在错误，无法渲染卡片。你可以点击下方“重新发送”要求它重试。)*';
          }

          if (shouldRefinePendingDraft) {
            const sourceUserMessage = [...messages.slice(0, pendingDraftMessageIndex)].reverse().find((item) => item.role === 'user');
            const sourceImage = sourceUserMessage?.image;
            const nextDrafts = extractDraftsFromAction(action ?? null, sourceImage || undefined)?.map((draft) => ensureDraftCompleteness(draft));
            const expectedCount = messages[pendingDraftMessageIndex]?.drafts?.length || 0;
            if (!action || action.type !== 'create_mistake' || !nextDrafts || nextDrafts.length !== expectedCount) {
              setMessages(prev => {
                const next = [...prev];
                const current = next[placeholderIndex];
                next[placeholderIndex] = { ...current, role: 'assistant', content: '我已收到你的反馈，但这次重写结果不完整。请再说一次你想补哪些字段（如解析/总结/标签），我会继续覆盖上方草稿。', mode: 'ingest', isError: isParseError, originalAsk: ask };
                return next;
              });
              setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
              resolve();
              return;
            }
            setMessages(prev => {
              const next = [...prev];
              const target = next[pendingDraftMessageIndex];
              if (target) {
                next[pendingDraftMessageIndex] = {
                  ...target,
                  action,
                  drafts: nextDrafts,
                };
              }
              const current = next[placeholderIndex];
              next[placeholderIndex] = {
                ...current,
                role: 'assistant',
                content: '已根据你的反馈重写上方待入库草稿，并补齐解析/总结。请直接在原卡片继续确认入库。',
                mode: 'ingest',
              };
              return next;
            });
            setDraftEdits(prev => {
              const next = { ...prev };
              for (let draftIdx = 0; draftIdx < expectedCount; draftIdx++) {
                delete next[`${pendingDraftMessageIndex}-${draftIdx}`];
              }
              return next;
            });
            setExecutedActions(prev => {
              const next = { ...prev };
              Object.keys(next).forEach((key) => {
                if (key === getActionKey(pendingDraftMessageIndex) || key.startsWith(`action-${pendingDraftMessageIndex}-batch-`)) {
                  delete next[key];
                }
              });
              return next;
            });
            clearBatchExecutionPreview(pendingDraftMessageIndex);
          } else {
            const rawDrafts = extractDraftsFromAction(action ?? null, currentImage || undefined)?.map((draft) => ensureDraftCompleteness(draft));
            const extractedUpdates = extractKnowledgeUpdatesFromAction(action ?? null);
            const fallbackUpdateAction = action?.type === 'update_learning_content' && (!extractedUpdates || extractedUpdates.length === 0)
              ? parseLearningContentActionFromText(cleaned)
              : null;
            const rawUpdates = extractedUpdates && extractedUpdates.length > 0
              ? extractedUpdates
              : extractKnowledgeUpdatesFromAction(fallbackUpdateAction);
            setMessages(prev => {
              const next = [...prev];
              const current = next[placeholderIndex];
              next[placeholderIndex] = { ...current, role: 'assistant', content: cleaned, action: action || undefined, drafts: rawDrafts, knowledgeUpdates: rawUpdates, mode: resolvedMode, isError: isParseError, originalAsk: ask };
              return next;
            });
          }
          setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
          resolve();
        },
        (error) => {
          if (!isCurrentRequest()) {
            resolve();
            return;
          }
          abortControllerRef.current = null;
          const isUserCanceled = error === '已取消本次生成';
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            next[placeholderIndex] = {
              ...current,
              role: 'assistant',
              content: isUserCanceled ? '已停止生成。' : `请求失败/已停止：${error}`,
              isError: isUserCanceled ? false : true,
              originalAsk: ask,
              mode: resolvedMode,
            };
            return next;
          });
          setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
          resolve();
        },
        { injectLearningProfile: false, enableThinking: effectiveDeepThinking, signal: abortControllerRef.current.signal }
      );
    });
    if (!isCurrentRequest()) return;
    setSending(false);
    stopRequestedRef.current = false;
  };

  const stopGenerating = () => {
    requestSeqRef.current += 1;
    stopRequestedRef.current = true;
    const activeController = abortControllerRef.current;
    if (activeController) {
      activeController.abort('user_cancel');
      abortControllerRef.current = null;
    }
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const lastIndex = next.length - 1;
      const lastMessage = next[lastIndex];
      if (!lastMessage || lastMessage.role !== 'assistant') return prev;
      const lastContent = String(lastMessage.content || '').trim();
      if (!lastContent || lastContent === '正在思考...' || lastContent === '正在分析中...') {
        next[lastIndex] = {
          ...lastMessage,
          content: '已停止生成。',
          reasoningContent: undefined,
        };
      }
      return next;
    });
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find(item => item.type.startsWith('image/'));
    if (!imageItem) return;
    const imageFile = imageItem.getAsFile();
    if (!imageFile) return;
    e.preventDefault();
    handleUpload(imageFile);
  };

  return (
    <div className="relative flex flex-1 flex-col bg-[#F6F8FB]">
      <div className="flex shrink-0 items-center justify-between bg-white/80 px-6 py-4 backdrop-blur-md sticky top-0 z-20 border-b border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center shrink-0">
            <span className="text-[24px] drop-shadow-md">✨</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">AI 错题管家</h1>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-700 uppercase">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {currentCapabilityMeta.label}
              </span>
              <p className="text-xs font-medium text-slate-500">{currentCapabilityMeta.summary}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              onClick={async () => {
                const confirmed = await confirm({
                  title: '开启新对话',
                  description: '确定要清除当前对话并开启新对话吗？',
                  tone: 'danger',
                });
                if (confirmed) {
                  setMessages([]);
                  setExecutedActions({});
                  setDraftEdits({});
                  setBatchDisplayMode({});
                  setActiveBatchByMessage({});
                  setCollapsedCompletedByMessage({});
                  setCreatedTagsByMessage({});
                  setBatchExecutionPreviewByMessage({});
                  sessionStorage.removeItem(DRAFT_CHAT_STORAGE_KEY);
                  sessionStorage.removeItem(DRAFT_SESSION_UI_STORAGE_KEY);
                }
              }}
              className="group flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-600 border border-slate-200 shadow-sm hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800 transition-all duration-200"
            >
              <RefreshCw className="h-3.5 w-3.5 group-hover:rotate-180 transition-transform duration-500" />
              新对话
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Chat Area */}
      <div ref={scrollContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-4 pb-48 pt-8 sm:px-6">
        <div className="mx-auto max-w-4xl">
          {messages.length === 0 ? (
            // Empty State
            <div className="flex flex-col items-center justify-center pt-8 md:pt-16 transition-all duration-500 animate-in fade-in slide-in-from-bottom-8">
              {/* Header Title */}
              <div className="relative mb-10 flex w-full items-center gap-5 rounded-[24px] bg-white/88 p-6 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] border border-white/70 backdrop-blur-xl overflow-hidden">
                <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-slate-300/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-10 left-1/4 h-24 w-24 rounded-full bg-blue-300/10 blur-3xl" />
                <div className="relative z-10 flex items-center justify-center shrink-0 pl-2">
                  <span className="text-[36px] drop-shadow-md">✨</span>
                </div>
                <div className="relative z-10 flex flex-col items-start">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                    今天想解决哪道错题？
                  </h1>
                  <p className="mt-1.5 text-[15px] font-medium text-[#8A93A6]">
                    上传错题图片，或直接输入题目，AI 为你深度解析
                  </p>
                </div>
              </div>
              
              {/* Bento Grid */}
              <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-2">
                {/* Left Large Card */}
                <button
                  onClick={() => handleSend(SUGGESTIONS[0].text)}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-[24px] bg-white/88 p-8 text-left shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] border border-white/70 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_-4px_rgba(0,0,0,0.08)] min-h-[280px]"
                >
                  <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-slate-400/10 blur-3xl transition-opacity group-hover:opacity-100" />
                  <div className="pointer-events-none absolute -bottom-10 left-1/4 h-32 w-32 rounded-full bg-blue-300/10 blur-3xl" />
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-50/70 to-slate-100/60 opacity-60 transition-opacity group-hover:opacity-100" />
                  <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 transition-transform group-hover:scale-105">
                    {SUGGESTIONS[0].icon}
                  </div>
                  <div className="relative z-10 mt-auto pt-12">
                    <span className="text-xl font-bold text-slate-800 transition-colors group-hover:text-slate-900">
                      {SUGGESTIONS[0].text}
                    </span>
                    <p className="mt-2 text-[15px] font-medium text-[#8A93A6]">
                      支持图片或文本，自动提取知识点并解析
                    </p>
                  </div>
                </button>

                {/* Right 3 Stacked Cards */}
                <div className="flex flex-col gap-4">
                  {SUGGESTIONS.slice(1).map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(item.text)}
                      className="group relative flex flex-1 items-center justify-between overflow-hidden rounded-[20px] bg-white/88 px-6 py-5 text-left shadow-[0_8px_30px_-12px_rgba(15,23,42,0.08)] border border-white/70 backdrop-blur-xl transition-all duration-300 hover:-translate-x-1 hover:shadow-[0_12px_40px_-4px_rgba(0,0,0,0.08)]"
                    >
                      <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-slate-400/10 blur-2xl transition-opacity group-hover:opacity-100" />
                      <div className="flex items-center gap-4 relative z-10">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 text-slate-600 transition-colors group-hover:bg-slate-100 group-hover:text-slate-800">
                          {item.icon}
                        </div>
                        <span className="text-[16px] font-bold text-slate-700 transition-colors group-hover:text-slate-900">
                          {item.text}
                        </span>
                      </div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 transition-colors group-hover:bg-slate-100 relative z-10">
                        <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            // Chat Stream
            <div className="space-y-8">
              {visibleMessages.map((msg, idx) => (
                <div key={`${msg.role}-${idx}`} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] rounded-[20px] rounded-br-sm border border-slate-200 bg-slate-100 px-5 py-3.5 text-slate-900 shadow-sm transition-all duration-300 animate-in fade-in slide-in-from-bottom-2">
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</p>
                      {msg.image && (
                        <img src={msg.image} alt="upload" className="mt-4 max-h-64 rounded-xl border border-slate-200 object-contain shadow-sm bg-white" />
                      )}
                    </div>
                  ) : (
                    <div className="flex w-full gap-5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm border border-slate-200 ring-1 ring-slate-900/5">
                        <span className="text-xl drop-shadow-sm">✨</span>
                      </div>
                      <div className="flex-1 space-y-5 pt-1 min-w-0">
                        {msg.reasoningContent && (
                          <div className="mb-4 rounded-[20px] border border-slate-200 bg-white/60 overflow-hidden shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:shadow-md">
                            <button
                              onClick={() => setExpandedThinking(prev => ({ ...prev, [idx]: !prev[idx] }))}
                              className="group flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-slate-600 transition-colors"
                            >
                              <div className="flex items-center gap-2.5">
                                {sending && idx === visibleMessages.length - 1 && (!msg.content || msg.content === '正在思考...' || msg.content === '正在分析中...') ? (
                                  <>
                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    </div>
                                    <span className="text-slate-700">正在深度思考...</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700 transition-colors">
                                      <BrainCircuit className="h-3.5 w-3.5" />
                                    </div>
                                    <span className="group-hover:text-slate-700 transition-colors">{expandedThinking[idx] ? '深度思考过程' : '已完成深度思考'}</span>
                                  </>
                                )}
                              </div>
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 group-hover:bg-slate-100 transition-colors">
                                {expandedThinking[idx] ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600" />
                                )}
                              </div>
                            </button>
                            {expandedThinking[idx] && (
                              <div className="px-5 pb-4 pt-1 border-t border-slate-100/60 bg-white/40">
                                <div className="prose prose-sm prose-slate max-w-none text-slate-500 text-[13.5px] leading-relaxed">
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                    {msg.reasoningContent}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {(msg.content === '正在思考...' || msg.content === '正在分析中...' || (sending && idx === visibleMessages.length - 1 && !String(msg.content || '').trim())) ? (
                          <div className="flex items-center gap-3 text-slate-700 font-semibold text-[15px] py-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                              <Loader2 className="w-4 h-4 animate-spin" />
                            </div>
                            {(sending && idx === visibleMessages.length - 1 && !String(msg.content || '').trim()) ? '正在整理入库卡片...' : msg.content}
                          </div>
                        ) : (
                          <div className="prose prose-sm md:prose-base prose-slate max-w-none leading-relaxed text-slate-800 break-words">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}

                        {msg.action?.type === 'render_inline_quiz' && msg.action.payload && (
                          <InlineQuizCard payload={msg.action.payload as any} />
                        )}
                        
                        {msg.isError && (
                          <div className="mt-2">
                            <button
                              onClick={() => {
                                // Remove the error message and the previous user message
                                setMessages(prev => prev.slice(0, -2));
                                handleSend(msg.originalAsk);
                              }}
                              className="text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline flex items-center gap-1"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              重新发送
                            </button>
                          </div>
                        )}

                        {msg.action && msg.action.type !== 'render_inline_quiz' && !(shouldHideRouteEntrances && (msg.action.type === 'start_review' || msg.action.type === 'start_drill')) && (
                          <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm transition-all hover:border-slate-300 hover:shadow-md">
                            <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-4 flex items-center justify-between">
                              <div>
                                <p className="text-[15px] font-bold text-slate-900">{msg.action.title || 'AI 解析结果'}</p>
                                <p className="mt-1 text-xs font-medium text-slate-500">{msg.action.description || '请先检查标签和内容，再按分组确认入库'}</p>
                              </div>
                            </div>
                            
                            {msg.drafts && msg.drafts.length > 0 && (
                              <div className="flex flex-col gap-6 p-4">
                                {(() => {
                                  const draftGroups = buildDraftGroups(idx, msg.drafts);
                                  const totalBatches = draftGroups.length;
                                  const batchMode = getBatchMode(idx, totalBatches);
                                  const activeBatch = getActiveBatch(idx, totalBatches);
                                  const bulkActionKey = getBatchBulkKey(idx);
                                  const bulkExecuting = executingKey === bulkActionKey;
                                  const completedBatches = draftGroups.reduce((count, _group, batchIdx) => count + (executedActions[getActionKey(idx, batchIdx)] ? 1 : 0), 0);
                                  const allCompleted = totalBatches > 0 && completedBatches === totalBatches;
                                  const readyGroups = draftGroups.filter((group) => group.status === 'ready');
                                  const pendingTagGroups = draftGroups.filter((group) => group.status === 'pending_tag');
                                  const unassignedGroups = draftGroups.filter((group) => group.status === 'unassigned');
                                  const unresolvedGroups = [...pendingTagGroups, ...unassignedGroups];
                                  const batchPreview = batchExecutionPreviewByMessage[idx];
                                  const createdTags = createdTagsByMessage[idx] || [];
                                  const isPreflightingBatch = preflightingBatchKey === bulkActionKey;
                                  const pendingKnowledgeTags = buildKnowledgeUpdateSummary(msg.knowledgeUpdates);
                                  const completedKnowledgeGroups = pendingKnowledgeTags.reduce((count, tag) => count + (executedActions[getKnowledgeUpdateActionKey(idx, tag)] ? 1 : 0), 0);
                                  const allKnowledgeCompleted = pendingKnowledgeTags.length === 0 || completedKnowledgeGroups === pendingKnowledgeTags.length;
                                  const visibleBatches = batchMode === 'all'
                                    ? draftGroups.map((group, batchIdx) => ({ group, batchIdx }))
                                    : [{ group: draftGroups[activeBatch], batchIdx: activeBatch }];
                                  const allWorkflowsCompleted = allCompleted && allKnowledgeCompleted;
                                  const shouldCollapseCompleted = allWorkflowsCompleted && Boolean(collapsedCompletedByMessage[idx]);
                                  return (
                                    <>
                                      {totalBatches > 1 && (
                                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white px-3 py-2">
                                          <p className="text-xs font-medium text-blue-700">
                                            共 {msg.drafts.length} 题，已按知识点分组，共 {totalBatches} 组
                                          </p>
                                          <div className="flex items-center gap-2">
                                            <span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
                                              已入库 {completedBatches}/{totalBatches} 批
                                            </span>
                                            {allCompleted && (
                                              <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                                错题分组已完成
                                              </span>
                                            )}
                                            {pendingKnowledgeTags.length > 0 && (
                                              <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${allKnowledgeCompleted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                                知识点 {completedKnowledgeGroups}/{pendingKnowledgeTags.length}
                                              </span>
                                            )}
                                            <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setBatchDisplayMode(prev => ({ ...prev, [idx]: 'paged' }));
                                                  focusBatch(idx, activeBatch);
                                                }}
                                                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${batchMode === 'paged' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                                              >
                                                分页查看（按知识点）
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setBatchDisplayMode(prev => ({ ...prev, [idx]: 'all' }))}
                                                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${batchMode === 'all' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                                              >
                                                一次性展示全部
                                              </button>
                                            </div>
                                            {allWorkflowsCompleted && (
                                              <button
                                                type="button"
                                                onClick={() => setCollapsedCompletedByMessage(prev => ({ ...prev, [idx]: !shouldCollapseCompleted }))}
                                                className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                                              >
                                                {shouldCollapseCompleted ? '展开已完成分组' : '收起已完成分组'}
                                              </button>
                                            )}
                                            {batchMode === 'paged' && (
                                              <div className="flex items-center gap-1">
                                                <button
                                                  type="button"
                                                  disabled={activeBatch <= 0}
                                                  onClick={() => focusBatch(idx, Math.max(activeBatch - 1, 0))}
                                                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${activeBatch <= 0 ? 'border-gray-100 bg-gray-50 text-gray-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                                                >
                                                  上一组
                                                </button>
                                                <span className="px-1 text-xs text-gray-500">第 {activeBatch + 1}/{totalBatches} 组</span>
                                                <button
                                                  type="button"
                                                  disabled={activeBatch >= totalBatches - 1}
                                                  onClick={() => focusBatch(idx, Math.min(activeBatch + 1, totalBatches - 1))}
                                                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${activeBatch >= totalBatches - 1 ? 'border-gray-100 bg-gray-50 text-gray-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                                                >
                                                  下一组
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                      {totalBatches <= 1 && (
                                        <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white px-3 py-2">
                                          <p className="text-xs font-medium text-blue-700">共 {msg.drafts.length} 题，可直接在上方统一执行</p>
                                          <span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
                                            待确认 {msg.drafts.length} 题
                                          </span>
                                        </div>
                                      )}
                                      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
                                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">
                                            已命中标签 {readyGroups.length} 组
                                          </span>
                                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">
                                            待创建标签 {pendingTagGroups.length} 组
                                          </span>
                                          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">
                                            待确认知识点 {unassignedGroups.length} 组
                                          </span>
                                        </div>
                                        <p className="mt-2 text-xs leading-relaxed text-slate-600">
                                          本批会先按标签桶处理。命中现有标签的分桶会显示标签上下文；待创建标签和待确认知识点分桶需要先处理后才能正式写入。
                                        </p>
                                      </div>
                                      <div className="rounded-2xl border border-blue-200 bg-white px-4 py-4 shadow-sm">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                          <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
                                              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700">
                                                候选新增错题 {msg.drafts.length} 道
                                              </span>
                                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">
                                                待执行分桶 {readyGroups.length} 组
                                              </span>
                                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                                                执行时统一查重
                                              </span>
                                            </div>
                                            <p className="text-sm font-semibold text-gray-900">错题批次统一执行卡</p>
                                            <p className="text-xs leading-relaxed text-gray-500">
                                              本卡只负责统一把错题写入错题库；知识点总结仍按下方每个标签单独审核，不会混在一起一键提交。
                                            </p>
                                            {unresolvedGroups.length > 0 ? (
                                              <p className="text-xs leading-relaxed text-amber-700">
                                                尚有 {unresolvedGroups.length} 个异常分桶未处理：{unresolvedGroups.map((group) => group.knowledgePoint || group.label).join('、')}
                                              </p>
                                            ) : (
                                              <>
                                                <p className="text-xs leading-relaxed text-emerald-700">
                                                  知识点更新建议：{buildKnowledgeSuggestions(idx, draftGroups, readyGroups).map((item) => (
                                                    item.replace('：建议检查并更新已有知识点内容', '（建议更新）').replace('：建议新增首份知识点内容', '（建议新增）')
                                                  )).join('、') || '本批暂无'}
                                                </p>
                                                <p className="text-xs leading-relaxed text-slate-600">
                                                  {batchPreview
                                                    ? `批次摘要：预计新增 ${batchPreview.insertedCount} 道，预计跳过 ${batchPreview.duplicateCount} 道相似题${createdTags.length > 0 ? `，已新建标签 ${createdTags.join('、')}` : ''}。`
                                                    : `尚未生成本批重复题预判摘要${createdTags.length > 0 ? `，当前已新建标签：${createdTags.join('、')}` : ''}。`}
                                                </p>
                                              </>
                                            )}
                                          </div>
                                          <button
                                            type="button"
                                            disabled={bulkExecuting || isPreflightingBatch || completedBatches >= totalBatches || unresolvedGroups.length > 0 || readyGroups.length === 0}
                                            onClick={async () => {
                                              await executeAllDraftGroups(idx, msg.action!, msg.mode, draftGroups, msg.drafts!, msg.knowledgeUpdates);
                                            }}
                                            className={`rounded-2xl px-6 py-3 text-sm font-bold text-white transition-all duration-300 shadow-sm w-full sm:w-auto ${
                                              bulkExecuting || isPreflightingBatch
                                                ? 'bg-blue-400 cursor-wait'
                                                : completedBatches >= totalBatches
                                                ? 'bg-emerald-500 cursor-default'
                                                : unresolvedGroups.length > 0 || readyGroups.length === 0
                                                ? 'bg-slate-300 cursor-not-allowed'
                                                : 'bg-blue-600 hover:bg-blue-500 hover:shadow-md hover:shadow-blue-200 active:scale-95'
                                            }`}
                                          >
                                            {completedBatches >= totalBatches
                                              ? '本批已全部执行'
                                              : bulkExecuting
                                              ? '正在统一执行本批...'
                                              : isPreflightingBatch
                                              ? '正在生成批次摘要...'
                                              : unresolvedGroups.length > 0 || readyGroups.length === 0
                                              ? '请先处理异常分桶'
                                              : `全部执行（${msg.drafts.length} 题）`}
                                          </button>
                                        </div>
                                      </div>
                                      {shouldCollapseCompleted ? (
                                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-4 text-sm text-emerald-800">
                                          全部 {totalBatches} 个分组及相关知识点已确认完成，编辑区已自动收起。你可以展开查看历史分组内容。
                                        </div>
                                      ) : visibleBatches.map(({ group: draftGroup, batchIdx }) => {
                                  const batchKey = getActionKey(idx, batchIdx);
                                  const bucketContext = bucketContexts[batchKey];
                                  const groupKnowledgeUpdates = getKnowledgeUpdatesForTag(msg.knowledgeUpdates, draftGroup.label);
                                  const knowledgeActionKey = getKnowledgeUpdateActionKey(idx, draftGroup.label);
                                  const draftBatchRaw = draftGroup?.absoluteIndexes.map((absoluteIdx) => ({
                                    draft: msg.drafts?.[absoluteIdx],
                                    absoluteIdx,
                                  })).filter(item => Boolean(item.draft)) || [];
                                  const draftBatch = draftBatchRaw.map(item => item.draft as DraftQuestion);
                                  return (
                                    <div
                                      key={batchKey}
                                      ref={(node) => {
                                        batchCardRefs.current[batchKey] = node;
                                      }}
                                      className={`overflow-hidden rounded-2xl border bg-blue-50/20 transition-all animate-in fade-in duration-300 ${highlightedBatchKey === batchKey ? 'border-blue-400 shadow-lg shadow-blue-100' : 'border-blue-100'}`}
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 px-4 py-3">
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-semibold text-blue-900 truncate">{totalBatches > 1 ? `待确认分组 ${batchIdx + 1}` : '待确认入库清单'}</p>
                                          <p className="text-xs text-blue-600/80 truncate mt-0.5">{totalBatches > 1 ? `分桶：${draftGroup.label}，共 ${draftBatch.length} 题` : `共 ${draftBatch.length} 题，确认后将一次性全部入库`}</p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                                          <span className={`rounded-full px-3 py-1 text-[11px] font-medium shadow-sm ${
                                            draftGroup.status === 'ready'
                                              ? 'bg-emerald-100 text-emerald-700'
                                              : draftGroup.status === 'pending_tag'
                                              ? 'bg-amber-100 text-amber-700'
                                              : 'bg-rose-100 text-rose-700'
                                          }`}>
                                            {draftGroup.status === 'ready' ? '已命中标签桶' : draftGroup.status === 'pending_tag' ? '待创建标签桶' : '待确认分桶'}
                                          </span>
                                          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-blue-700 shadow-sm hidden sm:inline-flex">AI 先建议，你来定稿</span>
                                        </div>
                                      </div>
                                      <div className="flex flex-col gap-4 p-4">
                                        <div className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${
                                          draftGroup.status === 'ready'
                                            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
                                            : draftGroup.status === 'pending_tag'
                                            ? 'border-amber-200 bg-amber-50/70 text-amber-800'
                                            : 'border-rose-200 bg-rose-50/70 text-rose-800'
                                        }`}>
                                          <p className="font-semibold">{draftGroup.reason}</p>
                                          {draftGroup.status === 'ready' && bucketContext && (
                                            <div className="mt-2 space-y-1 text-[11px]">
                                              <p>{`标签 ID：${bucketContext.tagId || '暂无'} · 历史错题：${bucketContext.existingQuestionCount} 道 · 路径记录：${bucketContext.pathCount} 条`}</p>
                                              <p>{`分类：${bucketContext.category || '未记录'} / ${bucketContext.branch || '未记录'}`}</p>
                                              <p>{`已有知识点内容：${bucketContext.existingKnowledgeMarkdown ? '已存在' : '暂无'}`}</p>
                                              {bucketContext.existingQuestionSamples.length > 0 && (
                                                <p>{`历史样题：${bucketContext.existingQuestionSamples.join('；')}`}</p>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        {draftBatchRaw.map(({ draft, absoluteIdx }) => {
                                          const editKey = `${idx}-${absoluteIdx}`;
                                          const mergedDraft = getMergedDraft(draft as DraftQuestion, editKey);
                                          const parsedOriginalQuestion = parseQuestionPreview(String(mergedDraft.question_text || ''));
                                          const optionLines = getDraftOptionLines(mergedDraft);
                                          const previewQuestionText = buildDraftPreviewText(mergedDraft);
                                          const subject = String(mergedDraft.subject || '英语');
                                          const knowledgeOptions = getKnowledgePointsBySubjectFromTaxonomy(subject as '英语' | 'C语言');
                                          const knowledgePoint = getSelectableValue(typeof mergedDraft.knowledge_point === 'string' ? mergedDraft.knowledge_point : undefined, knowledgeOptions);
                                          const questionText = typeof draftEdits[editKey]?.question_text === 'string'
                                            ? String(draftEdits[editKey]?.question_text || '')
                                            : (parsedOriginalQuestion.options.length > 0 ? parsedOriginalQuestion.stem : String(mergedDraft.question_text || ''));
                                          const correctAnswer = String(mergedDraft.correct_answer || '');
                                          const note = String(mergedDraft.note || '');
                                          const aiKnowledgePoint = String(mergedDraft.knowledge_point || '');
                                          const sc = getSubjectColor(subject as any);

                                          return (
                                            <div key={editKey} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:border-blue-300">
                                              <div className="p-5">
                                                <div className="mb-4 flex items-center gap-1.5 flex-wrap">
                                                  <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${sc.bg} ${sc.text}`}>{subject}</span>
                                                  {knowledgePoint && <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-gray-100 text-gray-600">{knowledgePoint}</span>}
                                                </div>

                                                <MistakeQuestionPreview
                                                  questionText={previewQuestionText}
                                                  correctAnswer={correctAnswer}
                                                  stemClassName="text-sm text-gray-800 leading-relaxed font-serif"
                                                  optionClassName="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600"
                                                  maxOptions={8}
                                                  showKindBadge
                                                  showResultComparison={Boolean(correctAnswer)}
                                                />

                                                {mergedDraft.image_url && (
                                                  <div className="mt-4 rounded-xl overflow-hidden border border-gray-100 flex justify-center items-center min-h-[100px] bg-gray-50/50 p-2">
                                                    <img src={mergedDraft.image_url} alt="Question" className="max-h-64 object-contain rounded-lg" loading="lazy" />
                                                  </div>
                                                )}

                                                {mergedDraft.note && (
                                                  <div className="mt-5 rounded-xl border border-blue-100/50 bg-blue-50/50 p-4">
                                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-blue-600">AI 原始解析</p>
                                                    <p className="text-[13px] leading-relaxed text-blue-900 whitespace-pre-wrap">{mergedDraft.note}</p>
                                                  </div>
                                                )}

                                              </div>

                                              <div className="border-t border-gray-100 bg-gray-50/50 p-5">
                                                <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-gray-500"><Edit2 className="h-3.5 w-3.5" /> 你可以直接改标签，也可以手动改内容</p>
                                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                                  <label className="flex flex-col gap-1.5">
                                                    <span className="text-[11px] font-medium text-gray-500">科目</span>
                                                    <Select value={toSelectValue(subject)} onValueChange={val => updateDraftEdits(editKey, { subject: fromSelectValue(val), knowledge_point: '' })}>
                                                      <SelectTrigger className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 shadow-sm w-full h-auto">
                                                        <SelectValue placeholder="请选择科目" />
                                                      </SelectTrigger>
                                                      <SelectContent>
                                                        <SelectItem value={SELECT_EMPTY_VALUE}>请选择科目</SelectItem>
                                                        {SUBJECT_OPTIONS.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                                                      </SelectContent>
                                                    </Select>
                                                  </label>
                                                  <label className="flex flex-col gap-1.5">
                                                    <span className="text-[11px] font-medium text-gray-500">主知识点</span>
                                                    <Select value={toSelectValue(knowledgePoint)} onValueChange={val => updateDraftEdits(editKey, { knowledge_point: fromSelectValue(val) })}>
                                                      <SelectTrigger className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 shadow-sm w-full h-auto">
                                                        <SelectValue placeholder="请选择题库标签" />
                                                      </SelectTrigger>
                                                      <SelectContent>
                                                        <SelectItem value={SELECT_EMPTY_VALUE}>请选择题库标签</SelectItem>
                                                        {knowledgeOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                                                      </SelectContent>
                                                    </Select>
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-[11px] text-gray-400">AI 建议：{aiKnowledgePoint || '未给出，请你手动选择'}</span>
                                                      {aiKnowledgePoint && !knowledgeOptions.includes(aiKnowledgePoint) && (
                                                        <button
                                                          type="button"
                                                          onClick={async () => {
                                                            const normalizedSubject = subject === 'C语言' ? 'C语言' : '英语';
                                                            const inferredMeta = inferKnowledgeNodeMetaForNewTag(normalizedSubject, aiKnowledgePoint);
                                                            try {
                                                              await registerCustomKnowledgeTaxonomy(aiKnowledgePoint, inferredMeta.category, inferredMeta.branch, normalizedSubject);
                                                              updateDraftEdits(editKey, { knowledge_point: aiKnowledgePoint });
                                                              setCreatedTagsByMessage((prev) => ({
                                                                ...prev,
                                                                [idx]: Array.from(new Set([...(prev[idx] || []), aiKnowledgePoint])),
                                                              }));
                                                              setDictionary(getCanonicalTagDictionary());
                                                              toast.success(`已创建新标签：${aiKnowledgePoint}（${inferredMeta.category}）`);
                                                            } catch (error: any) {
                                                              toast.error(error?.message || '创建标签失败');
                                                            }
                                                          }}
                                                          className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
                                                        >
                                                          一键创建并选中
                                                        </button>
                                                      )}
                                                    </div>
                                                  </label>
                                                </div>

                                                <div className="mt-4 grid grid-cols-1 gap-3">
                                                  <label className="flex flex-col gap-1.5">
                                                    <span className="text-[11px] font-medium text-gray-500">{optionLines.length > 0 ? '题干' : '题目内容'}</span>
                                                    <textarea
                                                      value={questionText}
                                                      onChange={e => updateDraftEdits(editKey, { question_text: e.target.value })}
                                                      rows={4}
                                                      className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 shadow-sm resize-y"
                                                    />
                                                  </label>
                                                  {optionLines.length > 0 && (
                                                    <div className="rounded-2xl border border-gray-200 bg-white/80 p-4">
                                                      <div className="mb-3 flex items-center justify-between gap-3">
                                                        <div>
                                                          <p className="text-[11px] font-medium text-gray-500">选项编辑</p>
                                                          <p className="text-[11px] text-gray-400">可以逐项修改 A/B/C/D 选项内容</p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                          <button
                                                            type="button"
                                                            onClick={() => updateDraftEdits(editKey, { options: [...optionLines, `${String.fromCharCode(65 + optionLines.length)}. `] })}
                                                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50"
                                                          >
                                                            新增选项
                                                          </button>
                                                          <button
                                                            type="button"
                                                            disabled={optionLines.length <= 2}
                                                            onClick={() => updateDraftEdits(editKey, { options: optionLines.slice(0, -1) })}
                                                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${optionLines.length <= 2 ? 'border-gray-100 bg-gray-50 text-gray-300' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                                                          >
                                                            删除最后一个
                                                          </button>
                                                        </div>
                                                      </div>
                                                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                        {optionLines.map((optionLine, optionIdx) => {
                                                          const optionLabel = String.fromCharCode(65 + optionIdx);
                                                          const parsedOption = parseQuestionPreview(optionLine).options[0];
                                                          const optionText = parsedOption?.text || optionLine.replace(/^[A-H]\.\s*/i, '');
                                                          return (
                                                            <label key={`${editKey}-option-${optionIdx}`} className="flex flex-col gap-1.5">
                                                              <span className="text-[11px] font-medium text-gray-500">选项 {optionLabel}</span>
                                                              <input
                                                                value={optionText}
                                                                onChange={e => {
                                                                  const nextOptions = [...optionLines];
                                                                  nextOptions[optionIdx] = `${optionLabel}. ${e.target.value}`;
                                                                  updateDraftEdits(editKey, { options: nextOptions });
                                                                }}
                                                                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 shadow-sm"
                                                              />
                                                            </label>
                                                          );
                                                        })}
                                                      </div>
                                                    </div>
                                                  )}
                                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                    <label className="flex flex-col gap-1.5">
                                                      <span className="text-[11px] font-medium text-gray-500">正确答案</span>
                                                      <input
                                                        value={correctAnswer}
                                                        onChange={e => updateDraftEdits(editKey, { correct_answer: e.target.value })}
                                                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 shadow-sm"
                                                      />
                                                    </label>
                                                  </div>
                                                  <label className="flex flex-col gap-1.5">
                                                    <span className="text-[11px] font-medium text-gray-500">解析 / 笔记</span>
                                                    <textarea
                                                      value={note}
                                                      onChange={e => updateDraftEdits(editKey, { note: e.target.value })}
                                                      rows={4}
                                                      className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 shadow-sm resize-y"
                                                    />
                                                  </label>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}

                                        {groupKnowledgeUpdates.length > 0 && (
                                          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/30 p-4">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                              <div>
                                                <p className="text-sm font-semibold text-emerald-900">知识点总结待审核</p>
                                                <p className="text-xs leading-relaxed text-emerald-700">
                                                  这一组对应标签「{draftGroup.label}」，请确认它的知识点总结该如何补充。
                                                </p>
                                              </div>
                                              {executedActions[knowledgeActionKey] && (
                                                <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                                  该知识点已确认更新
                                                </span>
                                              )}
                                            </div>
                                            <div className="space-y-3">
                                              {groupKnowledgeUpdates.map((update, localIdx) => {
                                                const preview = buildKnowledgeUpdatePreviewModel(update, readLearningContentState().drawerByTag, String(draftBatch[0]?.subject || '英语') === 'C语言' ? 'C语言' : '英语');
                                                return (
                                                  <div key={`${knowledgeActionKey}-${localIdx}`} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
                                                    <div className="border-b border-emerald-50 bg-emerald-50/50 px-4 py-3 flex items-center justify-between">
                                                      <span className="text-[13px] font-semibold text-emerald-800 flex items-center gap-1.5">
                                                        <Hash className="w-4 h-4 text-emerald-500" />
                                                        {update.tag}
                                                      </span>
                                                      <span className="text-[11px] text-emerald-600 bg-emerald-100/50 px-2 py-0.5 rounded-md font-medium">{preview.previewLabel}</span>
                                                    </div>
                                                    <div className="p-5 space-y-3">
                                                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs leading-relaxed text-emerald-800">
                                                        {preview.reason}
                                                      </div>
                                                      <KnowledgeUpdatePreview
                                                        existingMarkdown={preview.existingMarkdown}
                                                        suggestedMarkdown={preview.suggestedMarkdown}
                                                        decision={preview.decision}
                                                      />
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                              <div className="flex items-center gap-3 pt-1">
                                                <button
                                                  disabled={executingKey === knowledgeActionKey || executedActions[knowledgeActionKey]}
                                                  onClick={async () => {
                                                    if (executingKey === knowledgeActionKey || executedActions[knowledgeActionKey]) return;
                                                    setExecutingKey(knowledgeActionKey);
                                                    try {
                                                      const { updatedCount, skippedCount, createdTags } = await applyKnowledgeUpdates(groupKnowledgeUpdates);
                                                      if (updatedCount > 0 && skippedCount > 0) {
                                                        toast.success(`知识点「${draftGroup.label}」已更新 ${updatedCount} 项，另有 ${skippedCount} 项无需更新${createdTags.length > 0 ? `，已创建 ${createdTags.length} 个新标签` : ''}`);
                                                      } else if (updatedCount > 0) {
                                                        toast.success(`知识点「${draftGroup.label}」已完成更新${createdTags.length > 0 ? `，并创建 ${createdTags.length} 个新标签` : ''}`);
                                                      } else {
                                                        toast.success(`知识点「${draftGroup.label}」当前无需更新`);
                                                      }
                                                      setExecutedActions((prev) => ({ ...prev, [knowledgeActionKey]: true }));
                                                    } catch (error: any) {
                                                      toast.error(error?.message || '知识点更新失败');
                                                    } finally {
                                                      setExecutingKey(null);
                                                    }
                                                  }}
                                                  className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all shadow-sm flex items-center gap-2 ${
                                                    executedActions[knowledgeActionKey]
                                                      ? 'bg-emerald-500 cursor-default'
                                                      : executingKey === knowledgeActionKey
                                                      ? 'bg-emerald-400 cursor-wait'
                                                      : 'bg-emerald-600 hover:bg-emerald-500 hover:shadow-md active:scale-95'
                                                  }`}
                                                >
                                                  {executedActions[knowledgeActionKey] ? (
                                                    <><CheckCircle className="h-4 w-4" /> 该知识点已更新</>
                                                  ) : executingKey === knowledgeActionKey ? (
                                                    <><RefreshCw className="h-4 w-4 animate-spin" /> 正在更新知识点...</>
                                                  ) : (
                                                    <>确认更新知识点「{draftGroup.label}」</>
                                                  )}
                                                </button>
                                                <span className="text-xs text-gray-400">
                                                  这里是按标签逐个审核，不会和其他分类一起提交
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                        <div className="flex items-center gap-3 pt-1">
                                          {executedActions[batchKey] ? (
                                            <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
                                              <CheckCircle className="h-4 w-4" />
                                              {totalBatches > 1 ? '本分组已入库，无需重复操作' : '已全部入库，无需重复操作'}
                                            </div>
                                          ) : (
                                            <>
                                              <button
                                                disabled={bulkExecuting || reanalyzingKey === batchKey || executingKey === batchKey}
                                                onClick={async () => {
                                                  await reanalyzeDraftBatch(
                                                    idx,
                                                    batchIdx,
                                                    draftGroup.absoluteIndexes,
                                                    draftBatchRaw.map(({ draft, absoluteIdx }) => {
                                                      return getMergedDraft(draft as DraftQuestion, `${idx}-${absoluteIdx}`);
                                                    }),
                                                    draftGroup.label,
                                                  );
                                                }}
                                                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all shadow-sm flex items-center gap-2 ${
                                                  reanalyzingKey === batchKey
                                                    ? 'bg-amber-100 text-amber-700 cursor-wait'
                                                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                                                }`}
                                              >
                                                {reanalyzingKey === batchKey ? (
                                                  <><RefreshCw className="h-4 w-4 animate-spin" /> 正在重分析...</>
                                                ) : (
                                                  <><RefreshCw className="h-4 w-4" /> 退回重分析</>
                                                )}
                                              </button>
                                              <span className="text-xs text-gray-400">
                                                {msg.action!.risk === 'high' ? '⚠️ 高风险动作将触发二次确认' : '先改标签和内容，再到顶部点击全部执行'}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                        {batchMode === 'paged' && totalBatches > 1 && (
                                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-white/80 px-4 py-3">
                                            <p className="text-xs font-medium text-blue-700">
                                              当前第 {batchIdx + 1}/{totalBatches} 组 · {draftGroup.label}
                                            </p>
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                disabled={batchIdx <= 0}
                                                onClick={() => focusBatch(idx, Math.max(batchIdx - 1, 0))}
                                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${batchIdx <= 0 ? 'border-gray-100 bg-gray-50 text-gray-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                                              >
                                                上一组
                                              </button>
                                              <button
                                                type="button"
                                                disabled={batchIdx >= totalBatches - 1}
                                                onClick={() => focusBatch(idx, Math.min(batchIdx + 1, totalBatches - 1))}
                                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${batchIdx >= totalBatches - 1 ? 'border-gray-100 bg-gray-50 text-gray-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                                              >
                                                下一组
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                      })}
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                            
                            {msg.knowledgeUpdates && msg.knowledgeUpdates.length > 0 && (!msg.drafts || msg.drafts.length === 0) && (
                              <div className="flex flex-col gap-4 p-4 bg-emerald-50/20">
                                {msg.knowledgeUpdates.map((update, localIdx) => {
                                  const preview = buildKnowledgeUpdatePreviewModel(update, readLearningContentState().drawerByTag);
                                  return (
                                    <div key={`${idx}-${localIdx}`} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm transition-all hover:border-emerald-300">
                                      <div className="border-b border-emerald-50 bg-emerald-50/50 px-4 py-3 flex items-center justify-between">
                                        <span className="text-[13px] font-semibold text-emerald-800 flex items-center gap-1.5">
                                          <Hash className="w-4 h-4 text-emerald-500" />
                                          {update.tag}
                                        </span>
                                        <span className="text-[11px] text-emerald-600 bg-emerald-100/50 px-2 py-0.5 rounded-md font-medium">{preview.previewLabel}</span>
                                      </div>
                                      <div className="p-5 space-y-3">
                                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs leading-relaxed text-emerald-800">
                                          {preview.reason}
                                        </div>
                                        <KnowledgeUpdatePreview
                                          existingMarkdown={preview.existingMarkdown}
                                          suggestedMarkdown={preview.suggestedMarkdown}
                                          decision={preview.decision}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                                <div className="flex items-center gap-3 pt-2">
                                  <button
                                    disabled={executingKey === getActionKey(idx) || executedActions[getActionKey(idx)]}
                                    onClick={async () => {
                                      const actionKey = getActionKey(idx);
                                      if (executingKey === actionKey || executedActions[actionKey]) return;

                                      setExecutingKey(actionKey);
                                      try {
                                        const { updatedCount, skippedCount, createdTags } = await applyKnowledgeUpdates(msg.knowledgeUpdates);
                                        if (updatedCount > 0 || skippedCount > 0) {
                                          if (updatedCount > 0 && skippedCount > 0) {
                                            toast.success(`已更新 ${updatedCount} 个知识点，另有 ${skippedCount} 个无需更新${createdTags.length > 0 ? `，并创建 ${createdTags.length} 个新标签` : ''}`);
                                          } else if (updatedCount > 0) {
                                            toast.success(`已更新 ${updatedCount} 个知识点内容${createdTags.length > 0 ? `，并创建 ${createdTags.length} 个新标签` : ''}`);
                                          } else {
                                            toast.success(`本次 ${skippedCount} 个知识点均无需更新`);
                                          }
                                        }
                                        
                                        setExecutedActions(prev => ({ ...prev, [actionKey]: true }));
                                        setMessages(prev => [...prev, { role: 'assistant', content: '✅ 知识点已全部更新入库，还需要我继续安排下一步吗？' }]);
                                      } catch (error: any) {
                                        toast.error(error?.message || '执行失败');
                                      } finally {
                                        setExecutingKey(null);
                                      }
                                    }}
                                    className={`rounded-2xl px-6 py-3 text-sm font-bold text-white transition-all duration-300 shadow-sm flex items-center justify-center gap-2 w-full sm:w-auto ${
                                      executedActions[getActionKey(idx)]
                                        ? 'bg-emerald-500 cursor-default'
                                        : executingKey === getActionKey(idx)
                                        ? 'bg-emerald-400 cursor-wait'
                                        : 'bg-emerald-600 hover:bg-emerald-500 hover:shadow-md hover:shadow-emerald-200 active:scale-95'
                                    }`}
                                  >
                                    {executedActions[getActionKey(idx)] ? (
                                      <><CheckCircle className="h-4 w-4" /> 已全部更新</>
                                    ) : executingKey === getActionKey(idx) ? (
                                      <><RefreshCw className="h-4 w-4 animate-spin" /> 正在更新...</>
                                    ) : (
                                      `确认归并这 ${msg.knowledgeUpdates.length} 个知识点`
                                    )}
                                  </button>
                                </div>
                              </div>
                            )}
                            
                            {msg.action && (!msg.drafts || msg.drafts.length === 0) && (!msg.knowledgeUpdates || msg.knowledgeUpdates.length === 0) && (
                              <div className="p-5">
                                <div className="flex items-center gap-3">
                                  <button
                                    disabled={executingKey === getActionKey(idx) || executedActions[getActionKey(idx)]}
                                    onClick={async () => {
                                      const actionKey = getActionKey(idx);
                                      if (executingKey === actionKey || executedActions[actionKey]) return;
                                      setExecutingKey(actionKey);
                                      try {
                                        const result = await executeAction(msg.action!, undefined, { mode: msg.mode });
                                        if (msg.action!.type === 'create_mistake' && result && 'insertedCount' in result) {
                                          if (result.duplicateCount > 0) {
                                            toast.success(`已存入 ${result.insertedCount} 道错题，跳过 ${result.duplicateCount} 道相似题`);
                                          } else {
                                            toast.success(`已存入 ${result.insertedCount} 道错题`);
                                          }
                                        }
                                        setExecutedActions(prev => ({ ...prev, [actionKey]: true }));
                                        setMessages(prev => [...prev, { role: 'assistant', content: '✅ 操作已完成，还需要我继续安排下一步吗？' }]);
                                      } catch (error: any) {
                                        if (error?.message === '用户取消操作') return;
                                        toast.error(error?.message || '执行失败');
                                      } finally {
                                        setExecutingKey(null);
                                      }
                                    }}
                                    className={`rounded-2xl px-6 py-3 text-sm font-bold text-white transition-all duration-300 shadow-sm flex items-center justify-center gap-2 w-full sm:w-auto ${
                                      executedActions[getActionKey(idx)]
                                        ? 'bg-emerald-500 cursor-default'
                                        : executingKey === getActionKey(idx)
                                        ? 'bg-blue-400 cursor-wait'
                                        : 'bg-slate-900 hover:bg-blue-600 hover:shadow-md hover:shadow-blue-200 active:scale-95'
                                    }`}
                                  >
                                    {executedActions[getActionKey(idx)] ? (
                                      <><CheckCircle className="h-4 w-4" /> 已执行</>
                                    ) : executingKey === getActionKey(idx) ? (
                                      <><RefreshCw className="h-4 w-4 animate-spin" /> 正在执行...</>
                                    ) : (
                                      '确认执行'
                                    )}
                                  </button>
                                  {!executedActions[getActionKey(idx)] && (
                                    <span className="text-xs text-gray-400">
                                      {msg.action!.risk === 'high' ? '⚠️ 高风险动作将触发二次确认' : '建议先确认再执行'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} className="h-1" />
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Input Area */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#F6F8FB] via-[#F6F8FB]/95 to-transparent pb-6 pt-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          {imagePreview && (
            <div className="mb-3 flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2">
              <span className="text-sm drop-shadow-sm">📸</span>
              <span className="text-xs font-medium text-slate-700">已附加题图</span>
              <button onClick={() => setImagePreview(null)} className="ml-1 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          
          <div className="relative mx-auto w-[92%] flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm transition-all duration-200 focus-within:border-blue-400 focus-within:shadow-sm focus-within:ring-2 focus-within:ring-blue-50">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              className="min-h-[32px] max-h-40 w-full resize-none bg-transparent px-1.5 py-1 text-[13px] leading-snug text-gray-900 outline-none placeholder:text-gray-400"
              placeholder={currentCapability === 'launch'
                ? '描述你准备开始的练习或复习范围...'
                : currentCapability === 'recommend'
                  ? '先说说你想拿到什么学习建议...'
                  : currentCapability === 'explain'
                    ? '输入你想追问的题目、知识点或规律...'
                    : '输入题目、错因，或上传图片...'}
            />
            
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-2">
                <label className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                  <ImagePlus className="h-4.5 w-4.5" />
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleUpload(e.target.files?.[0] || null)} />
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {COPILOT_MODES.map((mode) => {
                    const meta = getCopilotCapabilityMeta(mode);
                    const active = mode === currentCapability;
                    const modeEmoji = mode === 'organize'
                      ? '📸'
                      : mode === 'explain'
                        ? '💡'
                        : mode === 'recommend'
                          ? '📅'
                          : '🎯';
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => handleModeSelect(mode)}
                        className={`relative flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all duration-300 shadow-sm ${
                          active
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-500/40 shadow-emerald-200/30'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 border border-slate-200/50'
                        }`}
                      >
                        <span className="text-[12px] drop-shadow-sm">{modeEmoji}</span>
                        {meta.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setModeSelectionSource('auto');
                      toast.info('自动识别：将根据输入自动选择模式');
                    }}
                    className={`relative flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all duration-300 shadow-sm ${
                      modeSelectionSource === 'auto'
                        ? 'bg-blue-50 text-blue-700 border border-blue-400/40 shadow-blue-200/30'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 border border-slate-200/50'
                    }`}
                  >
                    自动识别
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDeepThinking(!deepThinking)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    deepThinking
                      ? 'text-blue-600 bg-blue-50 border border-blue-100'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <BrainCircuit className="h-3.5 w-3.5" />
                  深度思考
                </button>
                {sending ? (
                  <button
                    onClick={stopGenerating}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 transition-all hover:bg-red-200 hover:text-red-700 shadow-sm group"
                    title="停止生成"
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={(!input.trim() && !imagePreview)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition-all hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none shadow-sm active:scale-95"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-gray-400">
            AI 可能会犯错，请结合实际情况参考解析。
          </p>
        </div>
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
          onOpenChange={(open) => {
            if (!open) settleHandoffDialog({ status: 'cancel' });
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
          onOpenChange={(open) => {
            if (!open) settleHandoffDialog({ status: 'cancel' });
          }}
          onCancel={() => settleHandoffDialog({ status: 'cancel' })}
          onStart={(preset) => settleHandoffDialog({ status: 'start', preset })}
        />
      ) : null}
    </div>
  );
}
