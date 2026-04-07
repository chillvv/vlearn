import type { MiniCopilotWorkMode, Subject } from './types';
import type { CopilotActionType } from './copilot';

export type CopilotMode = MiniCopilotWorkMode;
export type CopilotSurface = 'draft' | 'node';
export type CopilotCapability = 'organize' | 'explain' | 'recommend' | 'launch';

type CopilotModeMeta = {
  mode: CopilotMode;
  label: string;
  summary: string;
  defaultAction: string;
  allowedActions: CopilotActionType[];
  forbiddenBehaviors: string[];
};

type InferCopilotModeInput = {
  ask: string;
  surface: CopilotSurface;
  hasImage?: boolean;
};

type CopilotCapabilityMeta = {
  capability: CopilotCapability;
  label: string;
  summary: string;
  defaultAction: string;
  switchHint: string;
};

type MiniCopilotModeSwitchRule = {
  capability: CopilotCapability;
  label: string;
  trigger: string;
};

export type ReviewPresetLike = {
  subject?: Subject;
  scope?: 'all' | 'due' | 'unmastered' | 'stubborn';
  amount?: number;
  sortBy?: 'latestWrong' | 'lowestMastery' | 'nearestDue';
  strategy?: 'due_rescue' | 'stubborn_focus' | 'unmastered_boost' | 'custom';
};

export type DrillPresetLike = {
  subject?: Subject;
  nodes?: string[];
  amount?: number;
  strategy?: '递进' | '随机' | '攻坚';
};

const ROUTE_KEYWORDS = [
  '复习',
  '练习',
  '刷题',
  '专项',
  '刷几题',
  '来几道',
  '做题',
  '训练',
  'review',
  'practice',
];

const INGEST_KEYWORDS = [
  '录题',
  '入库',
  '上传',
  '拍照',
  '识别',
  '整理错题',
  '存错题',
  '草稿',
  '归类',
  '录入',
  '新错题',
];

const STUDY_KEYWORDS = [
  '讲解',
  '解析',
  '为什么',
  '怎么',
  '总结',
  '知识点',
  '笔记',
  '规律',
  '易错',
  '区别',
  '解释',
  '分析',
];

const COMPARE_KEYWORDS = [
  '比较',
  '对比',
  '差异',
  '共性',
  '重复',
  '相似',
];

const EDIT_KEYWORDS = [
  '修改',
  '改写',
  '移动',
  '迁移',
  '删除',
  '批量',
  '重排',
  '重写',
  '修订',
];

const CAPABILITY_META: Record<CopilotCapability, CopilotCapabilityMeta> = {
  organize: {
    capability: 'organize',
    label: '录入整理',
    summary: '只做错题入库、结构整理、标签修订与知识点归并',
    defaultAction: '优先生成或修正可确认的结构化草稿',
    switchHint: '当你要补录题目、整理材料、修订错题或维护笔记时进入',
  },
  explain: {
    capability: 'explain',
    label: '讲解追问',
    summary: '围绕当前题目、节点或规律做讲解、比较与追问',
    defaultAction: '优先解释证据、规则、错因与差异',
    switchHint: '当你要问为什么错、怎么想、知识点差异或继续深挖时进入',
  },
  recommend: {
    capability: 'recommend',
    label: '计划推荐',
    summary: '先给学习建议、范围判断与下一步安排，不直接创建正式会话',
    defaultAction: '优先总结该练什么、该复习什么、为什么值得做',
    switchHint: '当你想先拿建议、先看方案、先判断优先级时进入',
  },
  launch: {
    capability: 'launch',
    label: '跳转启动',
    summary: '生成可见 handoff card，确认后跳到正式练习页或复习页',
    defaultAction: '优先展示去向、原因、范围、预期收益与开始入口',
    switchHint: '当目标已经明确，准备正式开始练习或复习时进入',
  },
};

const LAUNCH_KEYWORDS = [
  '开始',
  '现在就',
  '直接去',
  '立刻',
  '马上',
  '启动',
  '跳转',
  '进入',
  '开练',
  '开刷',
];

const MODE_META: Record<CopilotMode, CopilotModeMeta> = {
  single_question: {
    mode: 'single_question',
    label: '单题答疑态',
    summary: '只围绕当前错题解释题眼、规则、答案与错因',
    defaultAction: '优先解释当前题并保持 `mistake_id` 锚点稳定',
    allowedActions: ['explain_mistake', 'get_node_dossier', 'update_mistake', 'update_tags', 'delete_mistake'],
    forbiddenBehaviors: ['擅自扩展到全局复习路由', '忽略当前错题范围改动其他节点'],
  },
  node_summary: {
    mode: 'node_summary',
    label: '节点归纳态',
    summary: '围绕当前 node 聚合错题索引、排序与知识点笔记',
    defaultAction: '优先读取 dossier、排序结果与节点笔记',
    allowedActions: ['get_node_dossier', 'list_node_mistakes', 'rank_node_mistakes', 'rewrite_node_notebook', 'update_learning_content'],
    forbiddenBehaviors: ['脱离当前节点谈全局规划', '未读取节点范围就做批量修改'],
  },
  precise_edit: {
    mode: 'precise_edit',
    label: '精确修订态',
    summary: '只做按稳定 ID 定位的创建、修改、迁移、删除与笔记修订',
    defaultAction: '优先返回结构化 patch 与执行回执',
    allowedActions: ['create_mistake', 'update_mistake', 'move_mistake_to_node', 'delete_mistake', 'batch_update_mistakes', 'create_node_note_section', 'rewrite_node_notebook', 'reorder_node_notebook', 'update_learning_content', 'update_tags'],
    forbiddenBehaviors: ['只给模糊自然语言不指向 ID', '跳过预览直接执行高风险动作'],
  },
  multi_compare: {
    mode: 'multi_compare',
    label: '多题比较态',
    summary: '围绕多个 mistake_id 比较差异、共性与优先级',
    defaultAction: '优先锁定比较集合并说明排序与差异',
    allowedActions: ['compare_mistakes', 'list_node_mistakes', 'rank_node_mistakes', 'get_node_dossier'],
    forbiddenBehaviors: ['混入无关节点题目', '把比较问题变成全局路由建议'],
  },
  ingest: {
    mode: 'ingest',
    label: '录题模式',
    summary: '只处理错题草稿、入库、标签修正与知识点整理',
    defaultAction: '优先生成或修正待确认错题草稿',
    allowedActions: ['create_mistake', 'update_tags', 'update_learning_content'],
    forbiddenBehaviors: ['主动展开完整复习正文', '主动展开完整专项练习正文', '把未知标签静默当成正式标签写入'],
  },
  study: {
    mode: 'study',
    label: '学习模式',
    summary: '只处理知识点讲解、错因分析、知识点改写与谨慎编辑',
    defaultAction: '优先回答当前知识点或当前错题的学习问题',
    allowedActions: ['update_tags', 'update_learning_content', 'delete_mistake'],
    forbiddenBehaviors: ['未确认前直接执行高风险写操作', '把聊天区当作正式复习页或练习页'],
  },
  route: {
    mode: 'route',
    label: '路由模式',
    summary: '只负责生成复习/练习入口与跳转预设',
    defaultAction: '优先生成 preset 并引导进入正式页面',
    allowedActions: ['start_review', 'start_drill'],
    forbiddenBehaviors: ['在聊天区直接输出完整复习流程', '在聊天区直接承载完整专项练习流程'],
  },
};

const MINI_COPILOT_MODE_SWITCH_RULES: MiniCopilotModeSwitchRule[] = [
  {
    capability: 'organize',
    label: '录入整理',
    trigger: '补录题目、整理草稿、修订错题、维护标签或知识点内容',
  },
  {
    capability: 'explain',
    label: '讲解追问',
    trigger: '围绕当前题目、当前知识点或多题差异继续追问',
  },
  {
    capability: 'recommend',
    label: '计划推荐',
    trigger: '先问该学什么、怎么排优先级、先看建议再决定是否开始',
  },
  {
    capability: 'launch',
    label: '跳转启动',
    trigger: '目标明确后生成 handoff card，再进入正式练习或正式复习',
  },
];

export function getCopilotModeMeta(mode: CopilotMode) {
  return MODE_META[mode];
}

export function getCopilotCapabilityMeta(capability: CopilotCapability) {
  return CAPABILITY_META[capability];
}

export function getCopilotCapabilityFromMode(mode: CopilotMode, ask?: string): CopilotCapability {
  if (mode === 'route') {
    const normalized = String(ask || '').trim().toLowerCase();
    return LAUNCH_KEYWORDS.some((keyword) => normalized.includes(keyword)) ? 'launch' : 'recommend';
  }
  if (mode === 'ingest' || mode === 'precise_edit') return 'organize';
  return 'explain';
}

export function inferCopilotCapability(input: InferCopilotModeInput): CopilotCapability {
  const mode = inferCopilotMode(input);
  return getCopilotCapabilityFromMode(mode, input.ask);
}

export function getMiniCopilotModeSwitchRules() {
  return MINI_COPILOT_MODE_SWITCH_RULES;
}

export function getMiniCopilotBoundaryHint() {
  return 'AI 管家只负责录入整理、讲解追问、计划推荐与跳转启动；正式练习和正式复习必须通过 handoff card 转入专门页面。';
}

export function inferCopilotMode(input: InferCopilotModeInput): CopilotMode {
  const normalized = String(input.ask || '').trim().toLowerCase();
  const hasRouteKeyword = ROUTE_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasIngestKeyword = input.hasImage || INGEST_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasStudyKeyword = STUDY_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasCompareKeyword = COMPARE_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasEditKeyword = EDIT_KEYWORDS.some((keyword) => normalized.includes(keyword));

  if (input.surface === 'node') {
    if (hasRouteKeyword) return 'route';
    if (hasCompareKeyword) return 'multi_compare';
    if (hasEditKeyword) return 'precise_edit';
    if (hasStudyKeyword && /这题|题目|答案|错因|为什么|解释|解析/.test(normalized)) return 'single_question';
    if (hasStudyKeyword) return 'node_summary';
    return 'node_summary';
  }
  if (hasIngestKeyword) return 'ingest';
  if (hasRouteKeyword) return 'route';
  if (hasStudyKeyword) return 'study';
  return 'ingest';
}

export function isActionAllowedForMode(mode: CopilotMode, actionType: CopilotActionType) {
  return MODE_META[mode].allowedActions.includes(actionType);
}

export function buildCopilotModePrompt(mode: CopilotMode, capabilityOverride?: CopilotCapability) {
  const meta = MODE_META[mode];
  const capability = CAPABILITY_META[capabilityOverride || getCopilotCapabilityFromMode(mode)];
  return `【本轮运行模式】
- 对用户展示的能力：${capability.label}
- 能力说明：${capability.summary}
- 当前内部模式：${meta.label}
- 当前目标：${meta.summary}
- 默认动作：${meta.defaultAction}
- 允许动作：${meta.allowedActions.join('、')}
- 禁止行为：${meta.forbiddenBehaviors.join('；')}
- 切换提示：${capability.switchHint}
- 若用户只想先拿建议，请停留在“计划推荐”；只有用户明确要开始正式练习或正式复习时，才进入“跳转启动”并生成 handoff card。
- 当动作为 start_review 时，必须指定单一学科；优先生成 10-20 题的小任务包，并用“分包任务/专项任务包”措辞描述。`;
}

export function getModeSwitchToast(mode: CopilotMode) {
  const capability = CAPABILITY_META[getCopilotCapabilityFromMode(mode)];
  return `${capability.label}：${capability.summary}`;
}

export function normalizeReviewPreset(preset?: ReviewPresetLike) {
  const strategy = preset?.strategy === 'due_rescue'
    || preset?.strategy === 'stubborn_focus'
    || preset?.strategy === 'unmastered_boost'
    || preset?.strategy === 'custom'
    ? preset.strategy
    : 'custom';
  const scope = preset?.scope === 'all' || preset?.scope === 'due' || preset?.scope === 'unmastered' || preset?.scope === 'stubborn'
    ? preset.scope
    : strategy === 'due_rescue'
      ? 'due'
      : strategy === 'stubborn_focus'
        ? 'stubborn'
        : strategy === 'unmastered_boost'
          ? 'unmastered'
          : 'due';
  const sortBy = preset?.sortBy === 'latestWrong' || preset?.sortBy === 'lowestMastery' || preset?.sortBy === 'nearestDue'
    ? preset.sortBy
    : strategy === 'stubborn_focus'
      ? 'lowestMastery'
      : strategy === 'unmastered_boost'
        ? 'latestWrong'
        : 'nearestDue';
  return {
    subject: preset?.subject === 'C语言' ? 'C语言' : '英语',
    scope,
    amount: Math.max(1, Math.min(20, Number(preset?.amount || 10))),
    sortBy,
    strategy,
  };
}

export function normalizeDrillPreset(preset?: DrillPresetLike) {
  return {
    subject: preset?.subject === 'C语言' ? 'C语言' : '英语',
    nodes: Array.from(new Set((preset?.nodes || []).map((item) => String(item || '').trim()).filter(Boolean))),
    amount: Math.max(1, Number(preset?.amount || 10)),
    strategy: preset?.strategy === '随机' || preset?.strategy === '攻坚' ? preset.strategy : '递进',
  };
}

export function buildReviewRouteSearch(preset?: ReviewPresetLike) {
  const normalized = normalizeReviewPreset(preset);
  const search = new URLSearchParams();
  search.set('subject', normalized.subject);
  search.set('scope', normalized.scope);
  search.set('amount', String(normalized.amount));
  search.set('sortBy', normalized.sortBy);
  return search.toString();
}

export function buildDrillRouteSearch(preset?: DrillPresetLike) {
  const normalized = normalizeDrillPreset(preset);
  const search = new URLSearchParams();
  search.set('subject', normalized.subject);
  search.set('amount', String(normalized.amount));
  search.set('strategy', normalized.strategy);
  if (normalized.nodes.length > 0) {
    search.set('nodes', normalized.nodes.join(','));
  }
  return search.toString();
}
