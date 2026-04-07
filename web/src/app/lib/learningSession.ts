import { normalizeDrillPreset, normalizeReviewPreset, type DrillPresetLike, type ReviewPresetLike } from './copilotMode';
import type { Subject } from './types';

export type LearningSessionKind = 'practice' | 'review' | 'guided';
export type LearningSessionSourceSurface =
  | 'dashboard'
  | 'sidebar'
  | 'copilot-draft'
  | 'copilot-node'
  | 'mistake-book'
  | 'mistake-node-hub'
  | 'review-stats'
  | 'manual';
export type LearningSessionObjectiveCode =
  | 'weakness_reinforce'
  | 'review_due'
  | 'sprint_drill'
  | 'custom_scope'
  | 'guided_explain';
export type LearningSessionRouteSource =
  | 'state.proposal'
  | 'query.canonical'
  | 'state.preset'
  | 'query.legacy'
  | 'fallback.default';
export type LearningSessionIssueCode =
  | 'invalid-state-proposal'
  | 'ignored-query-proposal'
  | 'missing-subject'
  | 'invalid-amount'
  | 'legacy-scope-conflict'
  | 'kind-mismatch';

export type LearningSessionReturnPath = {
  pathname: string;
  search: string;
  label: string;
};

export type LearningSessionNextStepHint = {
  kind: 'practice' | 'review' | 'copilot' | 'dashboard' | 'guided';
  label: string;
  pathname: string;
  search: string;
};

export type LearningSessionHandoffContext = {
  sourceMode: string;
  summary: string;
  activeNode: string;
  activeQuestionId: string;
};

export type LearningSessionGenerationPolicy = {
  allowAiGenerate: boolean;
  allowCache: boolean;
  allowRuleFallback: boolean;
};

export type LearningSessionProposalScope = {
  subject: Subject;
  nodes: string[];
  amount: number;
  strategy: '递进' | '随机' | '攻坚' | 'due_rescue' | 'stubborn_focus' | 'unmastered_boost' | 'custom';
  reviewScope: 'all' | 'due' | 'unmastered' | 'stubborn';
  sortBy: 'latestWrong' | 'lowestMastery' | 'nearestDue';
};

export type LearningSessionProposal = {
  version: 'learning-session.v1';
  proposalId: string;
  sessionKind: LearningSessionKind;
  sourceSurface: LearningSessionSourceSurface;
  sourceReason: string;
  objectiveCode: LearningSessionObjectiveCode;
  explanationSummary: string;
  successCriteria: string;
  scope: LearningSessionProposalScope;
  generationPolicy: LearningSessionGenerationPolicy;
  nextStepHint: LearningSessionNextStepHint;
  handoffContext: LearningSessionHandoffContext;
  returnPath: LearningSessionReturnPath;
};

export type LearningSessionIssue = {
  code: LearningSessionIssueCode;
  message: string;
};

export type LearningSessionRouteState = {
  proposal?: LearningSessionProposal;
  autoStart?: boolean;
  sourceMode?: string;
};

export type LearningSessionResolution = {
  proposal: LearningSessionProposal;
  issues: LearningSessionIssue[];
  source: LearningSessionRouteSource;
  notice: string;
};

export const LEARNING_SESSION_READ_PRIORITY: LearningSessionRouteSource[] = [
  'state.proposal',
  'query.canonical',
  'state.preset',
  'query.legacy',
  'fallback.default',
];

export const LEGACY_LEARNING_SESSION_QUERY_PARAM_MAP = {
  subject: 'scope.subject',
  amount: 'scope.amount',
  nodes: 'scope.nodes',
  strategy: 'scope.strategy',
  scope: 'scope.reviewScope',
  sortBy: 'scope.sortBy',
  onlyDue: 'scope.reviewScope=due',
  onlyUnmastered: 'scope.reviewScope=unmastered',
  onlyStubborn: 'scope.reviewScope=stubborn',
} as const;

type LearningSessionPartialProposal = Omit<Partial<LearningSessionProposal>, 'scope' | 'generationPolicy' | 'nextStepHint' | 'handoffContext' | 'returnPath'> & {
  scope?: Partial<LearningSessionProposalScope>;
  generationPolicy?: Partial<LearningSessionGenerationPolicy>;
  nextStepHint?: Partial<LearningSessionNextStepHint>;
  handoffContext?: Partial<LearningSessionHandoffContext>;
  returnPath?: Partial<LearningSessionReturnPath>;
};

type ResolveLearningSessionProposalInput = {
  sessionKind: LearningSessionKind;
  search: string;
  state?: {
    proposal?: unknown;
    preset?: unknown;
    sourceMode?: unknown;
  } | null;
  fallbackSourceSurface?: LearningSessionSourceSurface;
};

type CreateLearningSessionProposalInput = LearningSessionPartialProposal & {
  sessionKind: LearningSessionKind;
};

type LearningSessionNavigationOptions = {
  autoStart?: boolean;
  sourceMode?: string;
};

const PROPOSAL_VERSION = 'learning-session.v1';
const DEFAULT_SUBJECT: Subject = '英语';

const SOURCE_SURFACE_SET = new Set<LearningSessionSourceSurface>([
  'dashboard',
  'sidebar',
  'copilot-draft',
  'copilot-node',
  'mistake-book',
  'mistake-node-hub',
  'review-stats',
  'manual',
]);

const OBJECTIVE_SET = new Set<LearningSessionObjectiveCode>([
  'weakness_reinforce',
  'review_due',
  'sprint_drill',
  'custom_scope',
  'guided_explain',
]);

const KIND_SET = new Set<LearningSessionKind>(['practice', 'review', 'guided']);

const isSubject = (value: unknown): value is Subject => value === '英语' || value === 'C语言';

const toTrimmedString = (value: unknown) => String(value ?? '').trim();

const toPositiveInt = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
};

const normalizeNodes = (value: unknown) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => toTrimmedString(item)).filter(Boolean)));
  }
  if (typeof value === 'string') {
    return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));
  }
  return [] as string[];
};

const createProposalId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const createEmptyHandoffContext = (): LearningSessionHandoffContext => ({
  sourceMode: '',
  summary: '',
  activeNode: '',
  activeQuestionId: '',
});

const createDefaultReturnPath = (kind: LearningSessionKind): LearningSessionReturnPath => {
  if (kind === 'review') {
    return { pathname: '/review', search: '', label: '回到复习中心' };
  }
  if (kind === 'practice') {
    return { pathname: '/practice', search: '', label: '回到专项练习' };
  }
  return { pathname: '/draft-review', search: '', label: '回到 AI 管家' };
};

const createDefaultNextStepHint = (kind: LearningSessionKind): LearningSessionNextStepHint => {
  if (kind === 'review') {
    return { kind: 'practice', label: '完成后去专项补弱', pathname: '/practice', search: '' };
  }
  if (kind === 'practice') {
    return { kind: 'review', label: '完成后去复习巩固', pathname: '/review', search: '' };
  }
  return { kind: 'dashboard', label: '回首页查看推荐任务', pathname: '/', search: '' };
};

const createDefaultScope = (kind: LearningSessionKind): LearningSessionProposalScope => ({
  subject: DEFAULT_SUBJECT,
  nodes: [],
  amount: 10,
  strategy: '递进',
  reviewScope: kind === 'review' ? 'due' : 'all',
  sortBy: 'nearestDue',
});

const createDefaultGenerationPolicy = (kind: LearningSessionKind): LearningSessionGenerationPolicy => ({
  allowAiGenerate: kind === 'practice',
  allowCache: true,
  allowRuleFallback: true,
});

const createDefaultObjective = (kind: LearningSessionKind): LearningSessionObjectiveCode => {
  if (kind === 'review') return 'review_due';
  if (kind === 'practice') return 'weakness_reinforce';
  return 'guided_explain';
};

const createDefaultReason = (kind: LearningSessionKind) => {
  if (kind === 'review') return '用户进入正式复习流程';
  if (kind === 'practice') return '用户进入正式专项练习流程';
  return '用户进入 AI 引导流程';
};

const createDefaultExplanation = (kind: LearningSessionKind, objectiveCode: LearningSessionObjectiveCode) => {
  if (kind === 'review') {
    return objectiveCode === 'review_due' ? '开始处理本轮待复习任务' : '开始本轮复习任务';
  }
  if (kind === 'practice') {
    if (objectiveCode === 'sprint_drill') return '开始一轮冲刺训练';
    if (objectiveCode === 'custom_scope') return '开始一轮自定义专项练习';
    return '开始一轮薄弱点专项练习';
  }
  return '开始 AI 引导学习任务';
};

const createDefaultSuccessCriteria = (kind: LearningSessionKind, amount: number) => {
  if (kind === 'review') return `完成 ${amount} 题复习并获得下一次调度建议`;
  if (kind === 'practice') return `完成 ${amount} 题专项训练并获得下一步建议`;
  return '完成本轮引导任务';
};

const parseSourceSurface = (value: unknown, fallback: LearningSessionSourceSurface) => {
  const candidate = toTrimmedString(value) as LearningSessionSourceSurface;
  return SOURCE_SURFACE_SET.has(candidate) ? candidate : fallback;
};

const parseObjectiveCode = (value: unknown, fallback: LearningSessionObjectiveCode) => {
  const candidate = toTrimmedString(value) as LearningSessionObjectiveCode;
  return OBJECTIVE_SET.has(candidate) ? candidate : fallback;
};

const parseSessionKind = (value: unknown, fallback: LearningSessionKind) => {
  const candidate = toTrimmedString(value) as LearningSessionKind;
  return KIND_SET.has(candidate) ? candidate : fallback;
};

const parseReviewScope = (value: unknown, fallback: LearningSessionProposalScope['reviewScope']) => {
  const candidate = toTrimmedString(value);
  return candidate === 'all' || candidate === 'unmastered' || candidate === 'stubborn' || candidate === 'due' ? candidate : fallback;
};

const parseSortBy = (value: unknown, fallback: LearningSessionProposalScope['sortBy']) => {
  const candidate = toTrimmedString(value);
  return candidate === 'latestWrong' || candidate === 'lowestMastery' || candidate === 'nearestDue' ? candidate : fallback;
};

const parseStrategy = (value: unknown, fallback: LearningSessionProposalScope['strategy']) => {
  const candidate = toTrimmedString(value);
  return candidate === '随机'
    || candidate === '攻坚'
    || candidate === '递进'
    || candidate === 'due_rescue'
    || candidate === 'stubborn_focus'
    || candidate === 'unmastered_boost'
    || candidate === 'custom'
    ? candidate
    : fallback;
};

const normalizeReturnPath = (value: LearningSessionPartialProposal['returnPath'] | undefined, fallback: LearningSessionReturnPath) => ({
  pathname: toTrimmedString(value?.pathname) || fallback.pathname,
  search: toTrimmedString(value?.search) || fallback.search,
  label: toTrimmedString(value?.label) || fallback.label,
});

const normalizeNextStepHint = (value: LearningSessionPartialProposal['nextStepHint'] | undefined, fallback: LearningSessionNextStepHint): LearningSessionNextStepHint => ({
  kind: value?.kind === 'practice' || value?.kind === 'review' || value?.kind === 'copilot' || value?.kind === 'dashboard' || value?.kind === 'guided'
    ? value.kind
    : fallback.kind,
  label: toTrimmedString(value?.label) || fallback.label,
  pathname: toTrimmedString(value?.pathname) || fallback.pathname,
  search: toTrimmedString(value?.search) || fallback.search,
});

const normalizeHandoffContext = (value: LearningSessionPartialProposal['handoffContext'] | undefined, fallbackSourceMode = ''): LearningSessionHandoffContext => ({
  sourceMode: toTrimmedString(value?.sourceMode) || fallbackSourceMode,
  summary: toTrimmedString(value?.summary),
  activeNode: toTrimmedString(value?.activeNode),
  activeQuestionId: toTrimmedString(value?.activeQuestionId),
});

export function createLearningSessionProposal(input: CreateLearningSessionProposalInput): LearningSessionProposal {
  const sessionKind = parseSessionKind(input.sessionKind, 'practice');
  const defaultScope = createDefaultScope(sessionKind);
  const scope = {
    subject: isSubject(input.scope?.subject) ? input.scope.subject : defaultScope.subject,
    nodes: normalizeNodes(input.scope?.nodes),
    amount: toPositiveInt(input.scope?.amount, defaultScope.amount),
    strategy: parseStrategy(input.scope?.strategy, defaultScope.strategy),
    reviewScope: parseReviewScope(input.scope?.reviewScope, defaultScope.reviewScope),
    sortBy: parseSortBy(input.scope?.sortBy, defaultScope.sortBy),
  };
  const objectiveCode = parseObjectiveCode(input.objectiveCode, createDefaultObjective(sessionKind));
  return {
    version: PROPOSAL_VERSION,
    proposalId: toTrimmedString(input.proposalId) || createProposalId(),
    sessionKind,
    sourceSurface: parseSourceSurface(input.sourceSurface, 'manual'),
    sourceReason: toTrimmedString(input.sourceReason) || createDefaultReason(sessionKind),
    objectiveCode,
    explanationSummary: toTrimmedString(input.explanationSummary) || createDefaultExplanation(sessionKind, objectiveCode),
    successCriteria: toTrimmedString(input.successCriteria) || createDefaultSuccessCriteria(sessionKind, scope.amount),
    scope,
    generationPolicy: {
      allowAiGenerate: typeof input.generationPolicy?.allowAiGenerate === 'boolean'
        ? input.generationPolicy.allowAiGenerate
        : createDefaultGenerationPolicy(sessionKind).allowAiGenerate,
      allowCache: typeof input.generationPolicy?.allowCache === 'boolean'
        ? input.generationPolicy.allowCache
        : true,
      allowRuleFallback: typeof input.generationPolicy?.allowRuleFallback === 'boolean'
        ? input.generationPolicy.allowRuleFallback
        : true,
    },
    nextStepHint: normalizeNextStepHint(input.nextStepHint, createDefaultNextStepHint(sessionKind)),
    handoffContext: normalizeHandoffContext(input.handoffContext),
    returnPath: normalizeReturnPath(input.returnPath, createDefaultReturnPath(sessionKind)),
  };
}

export function buildLearningSessionRouteSearch(proposal: LearningSessionProposal) {
  const search = new URLSearchParams();
  search.set('proposal_id', proposal.proposalId);
  search.set('proposal_version', proposal.version);
  search.set('session_kind', proposal.sessionKind);
  search.set('proposal_source', proposal.sourceSurface);
  search.set('proposal_objective', proposal.objectiveCode);
  if (proposal.sourceReason) search.set('proposal_reason', proposal.sourceReason);
  if (proposal.explanationSummary) search.set('proposal_summary', proposal.explanationSummary);
  if (proposal.successCriteria) search.set('proposal_success', proposal.successCriteria);
  search.set('subject', proposal.scope.subject);
  search.set('amount', String(proposal.scope.amount));
  if (proposal.returnPath.pathname) search.set('return_path', proposal.returnPath.pathname);
  if (proposal.returnPath.search) search.set('return_search', proposal.returnPath.search);
  if (proposal.returnPath.label) search.set('return_label', proposal.returnPath.label);
  if (proposal.nextStepHint.kind) search.set('next_step_kind', proposal.nextStepHint.kind);
  if (proposal.nextStepHint.label) search.set('next_step_label', proposal.nextStepHint.label);
  if (proposal.nextStepHint.pathname) search.set('next_step_path', proposal.nextStepHint.pathname);
  if (proposal.nextStepHint.search) search.set('next_step_search', proposal.nextStepHint.search);
  if (proposal.sessionKind === 'practice') {
    search.set('strategy', proposal.scope.strategy);
    if (proposal.scope.nodes.length > 0) {
      search.set('nodes', proposal.scope.nodes.join(','));
    }
  }
  if (proposal.sessionKind === 'review') {
    search.set('strategy', proposal.scope.strategy);
    search.set('scope', proposal.scope.reviewScope);
    search.set('sortBy', proposal.scope.sortBy);
    if (proposal.scope.reviewScope === 'due') search.set('onlyDue', 'true');
    if (proposal.scope.reviewScope === 'unmastered') search.set('onlyUnmastered', 'true');
    if (proposal.scope.reviewScope === 'stubborn') search.set('onlyStubborn', 'true');
  }
  return search.toString();
}

export function buildLearningSessionRouteState(proposal: LearningSessionProposal, options?: LearningSessionNavigationOptions): LearningSessionRouteState & { preset: ReviewPresetLike | DrillPresetLike } {
  return {
    proposal,
    autoStart: options?.autoStart,
    sourceMode: options?.sourceMode || proposal.handoffContext.sourceMode || '',
    preset: proposal.sessionKind === 'review'
      ? {
          subject: proposal.scope.subject,
          strategy: proposal.scope.strategy as ReviewPresetLike['strategy'],
          scope: proposal.scope.reviewScope,
          amount: proposal.scope.amount,
          sortBy: proposal.scope.sortBy,
        }
      : {
          subject: proposal.scope.subject,
          nodes: proposal.scope.nodes,
          amount: proposal.scope.amount,
          strategy: proposal.scope.strategy,
        },
  };
}

export function buildLearningSessionNavigation(proposal: LearningSessionProposal, options?: LearningSessionNavigationOptions) {
  return {
    pathname: proposal.sessionKind === 'review' ? '/review' : proposal.sessionKind === 'practice' ? '/practice' : '/draft-review',
    search: `?${buildLearningSessionRouteSearch(proposal)}`,
    state: buildLearningSessionRouteState(proposal, options),
  };
}

const readCanonicalProposalFromSearch = (sessionKind: LearningSessionKind, search: string) => {
  const params = new URLSearchParams(search);
  const hasCanonicalSignal = Boolean(
    params.get('proposal_id') ||
    params.get('proposal_version') ||
    params.get('proposal_source') ||
    params.get('proposal_objective') ||
    params.get('session_kind'),
  );
  if (!hasCanonicalSignal) return null;
  return createLearningSessionProposal({
    sessionKind: parseSessionKind(params.get('session_kind'), sessionKind),
    proposalId: params.get('proposal_id') || undefined,
    sourceSurface: params.get('proposal_source') as LearningSessionSourceSurface | undefined,
    sourceReason: params.get('proposal_reason') || undefined,
    objectiveCode: params.get('proposal_objective') as LearningSessionObjectiveCode | undefined,
    explanationSummary: params.get('proposal_summary') || undefined,
    successCriteria: params.get('proposal_success') || undefined,
    scope: {
      subject: params.get('subject') as Subject | undefined,
      amount: params.get('amount') || undefined,
      nodes: params.get('nodes') || undefined,
      strategy: params.get('strategy') || undefined,
      reviewScope: params.get('scope') || undefined,
      sortBy: params.get('sortBy') || undefined,
    },
    nextStepHint: {
      kind: params.get('next_step_kind') as LearningSessionNextStepHint['kind'] | undefined,
      label: params.get('next_step_label') || undefined,
      pathname: params.get('next_step_path') || undefined,
      search: params.get('next_step_search') || undefined,
    },
    returnPath: {
      pathname: params.get('return_path') || undefined,
      search: params.get('return_search') || undefined,
      label: params.get('return_label') || undefined,
    },
  });
};

const readLegacyProposalFromSearch = (sessionKind: LearningSessionKind, search: string) => {
  const params = new URLSearchParams(search);
  const hasLegacySignal = Boolean(
    params.get('subject') ||
    params.get('amount') ||
    params.get('strategy') ||
    params.get('nodes') ||
    params.get('scope') ||
    params.get('sortBy') ||
    params.get('onlyDue') ||
    params.get('onlyUnmastered') ||
    params.get('onlyStubborn'),
  );
  if (!hasLegacySignal) return { proposal: null, issues: [] as LearningSessionIssue[] };
  const issues: LearningSessionIssue[] = [];
  let reviewScope = params.get('scope') || '';
  const scopeFlags = [
    params.get('onlyDue') === 'true' ? 'due' : '',
    params.get('onlyUnmastered') === 'true' ? 'unmastered' : '',
    params.get('onlyStubborn') === 'true' ? 'stubborn' : '',
  ].filter(Boolean);
  if (!reviewScope && scopeFlags.length > 0) {
    reviewScope = scopeFlags[scopeFlags.length - 1];
  }
  if (scopeFlags.length > 1) {
    issues.push({
      code: 'legacy-scope-conflict',
      message: '检测到旧版复习范围参数冲突，已按兼容优先级恢复为最后一个有效范围。',
    });
  }
  const proposal = createLearningSessionProposal({
    sessionKind,
    sourceSurface: 'manual',
    sourceReason: '兼容旧版路由参数',
    objectiveCode: sessionKind === 'review' ? 'review_due' : 'custom_scope',
    scope: {
      subject: params.get('subject') as Subject | undefined,
      amount: params.get('amount') || undefined,
      nodes: params.get('nodes') || undefined,
      strategy: params.get('strategy') || undefined,
      reviewScope: reviewScope || undefined,
      sortBy: params.get('sortBy') || undefined,
    },
  });
  return { proposal, issues };
};

const readProposalFromPreset = (sessionKind: LearningSessionKind, preset: unknown, fallbackSourceSurface: LearningSessionSourceSurface) => {
  if (!preset || typeof preset !== 'object') return null;
  if (sessionKind === 'review') {
    const normalized = normalizeReviewPreset(preset as ReviewPresetLike);
    return createLearningSessionProposal({
      sessionKind,
      sourceSurface: fallbackSourceSurface,
      sourceReason: '兼容旧版复习 preset',
      objectiveCode: normalized.scope === 'due' ? 'review_due' : 'custom_scope',
      scope: {
        subject: normalized.subject,
        amount: normalized.amount,
        reviewScope: normalized.scope,
        sortBy: normalized.sortBy,
      },
    });
  }
  const normalized = normalizeDrillPreset(preset as DrillPresetLike);
  return createLearningSessionProposal({
    sessionKind,
    sourceSurface: fallbackSourceSurface,
    sourceReason: '兼容旧版专项练习 preset',
    objectiveCode: normalized.strategy === '攻坚' ? 'weakness_reinforce' : 'custom_scope',
    scope: {
      subject: normalized.subject,
      amount: normalized.amount,
      nodes: normalized.nodes,
      strategy: normalized.strategy,
    },
  });
};

const normalizeStateProposal = (sessionKind: LearningSessionKind, value: unknown, stateSourceMode = '') => {
  if (!value || typeof value !== 'object') return null;
  const record = value as LearningSessionPartialProposal;
  const proposal = createLearningSessionProposal({
    ...record,
    sessionKind: parseSessionKind(record.sessionKind, sessionKind),
    handoffContext: {
      ...createEmptyHandoffContext(),
      ...(record.handoffContext || {}),
      sourceMode: toTrimmedString(record.handoffContext?.sourceMode) || stateSourceMode,
    },
  });
  return proposal;
};

export function resolveLearningSessionProposal(input: ResolveLearningSessionProposalInput): LearningSessionResolution {
  const fallbackSourceSurface = input.fallbackSourceSurface || 'manual';
  const issues: LearningSessionIssue[] = [];
  const stateProposal = normalizeStateProposal(input.sessionKind, input.state?.proposal, toTrimmedString(input.state?.sourceMode));
  const queryProposal = readCanonicalProposalFromSearch(input.sessionKind, input.search);
  if (stateProposal && stateProposal.sessionKind !== input.sessionKind) {
    issues.push({
      code: 'kind-mismatch',
      message: '检测到会话类型与当前页面不一致，已自动回退到当前页面支持的类型。',
    });
  }
  if (stateProposal && stateProposal.sessionKind === input.sessionKind) {
    if (queryProposal && queryProposal.proposalId !== stateProposal.proposalId) {
      issues.push({
        code: 'ignored-query-proposal',
        message: '已优先使用 location state 中的学习任务提案，并忽略 URL 中较旧的提案参数。',
      });
    }
    return {
      proposal: createLearningSessionProposal({
        ...stateProposal,
        handoffContext: {
          ...stateProposal.handoffContext,
          sourceMode: stateProposal.handoffContext.sourceMode || toTrimmedString(input.state?.sourceMode),
        },
      }),
      issues,
      source: 'state.proposal',
      notice: issues.map((item) => item.message).join('；'),
    };
  }
  if (input.state?.proposal) {
    issues.push({
      code: 'invalid-state-proposal',
      message: '当前页面收到的学习任务提案不可用，已尝试从 URL 或兼容参数恢复。',
    });
  }
  if (queryProposal) {
    return {
      proposal: queryProposal,
      issues,
      source: 'query.canonical',
      notice: issues.map((item) => item.message).join('；'),
    };
  }
  const presetProposal = readProposalFromPreset(input.sessionKind, input.state?.preset, fallbackSourceSurface);
  if (presetProposal) {
    return {
      proposal: presetProposal,
      issues,
      source: 'state.preset',
      notice: issues.map((item) => item.message).join('；'),
    };
  }
  const legacyResult = readLegacyProposalFromSearch(input.sessionKind, input.search);
  if (legacyResult.proposal) {
    return {
      proposal: legacyResult.proposal,
      issues: [...issues, ...legacyResult.issues],
      source: 'query.legacy',
      notice: [...issues, ...legacyResult.issues].map((item) => item.message).join('；'),
    };
  }
  return {
    proposal: createLearningSessionProposal({
      sessionKind: input.sessionKind,
      sourceSurface: fallbackSourceSurface,
      sourceReason: '缺少任务提案，已按默认配置进入',
    }),
    issues: [...issues, {
      code: 'invalid-state-proposal',
      message: '未检测到可用的学习任务提案，已按默认配置进入当前页面。',
    }],
    source: 'fallback.default',
    notice: [...issues, '未检测到可用的学习任务提案，已按默认配置进入当前页面。'].join('；'),
  };
}
