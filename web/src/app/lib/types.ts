import type { QuestionNormalizedPayload, QuestionType, RenderMode, ValidationStatus } from './questionPayload';

export interface KnowledgePoint {
  id: string;
  kp_id?: string;
  node_id?: string;
  tag_id?: string;
  category_code?: string;
  subject: string;
  name: string;
  created_at: string;
}

export interface Question {
  id: string;
  question_id?: string;
  mistake_id?: string;
  tag_id?: string;
  knowledge_point_id?: string;
  node_id?: string;
  id_path?: string;
  user_id: string;
  subject: string;
  question_text: string;
  category?: string;
  node?: string;
  image_url?: string;
  knowledge_point: string;
  ability: string;
  error_type: string;
  question_type?: QuestionType;
  correct_answer?: string;
  note?: string;
  summary?: string;
  mastery_level?: number;
  confidence?: number;
  next_review_date?: string;
  stability?: number;
  difficulty?: number;
  last_interval_days?: number;
  lapse_count?: number;
  predicted_recall?: number;
  priority_score?: number;
  plan_source?: 'ai' | 'rule_fallback';
  stubborn_flag?: boolean;
  mastery_state?: 'active' | 'mastered' | 'archived';
  mastered_at?: string;
  is_archived?: boolean;
  archived_at?: string;
  created_at: string;
  review_count: number;
  raw_ai_response?: string;
  normalized_payload?: QuestionNormalizedPayload | null;
  payload_version?: string;
  validation_status?: ValidationStatus;
  render_mode?: RenderMode;
  review_state?: 'idle' | 'due' | 'scheduled' | 'completed' | 'fallback';
  practice_state?: 'idle' | 'active' | 'partial' | 'completed' | 'fallback';
  generation_state?: 'none' | 'ai' | 'cache' | 'rule_fallback' | 'partial';
}

export type NodeDossierSortStrategy =
  | 'recent_error_desc'
  | 'lowest_mastery'
  | 'recent_edited_desc'
  | 'custom_order'
  | 'due_review_priority';

export interface NodeDossierSortMetric {
  key: string;
  label: string;
  value: string | number | boolean | null;
}

export interface NodeMistakeIndexEntry {
  mistake_id: string;
  tag_id: string;
  node_id: string;
  id_path?: string;
  display_order: number;
  sort_position: number;
  sort_strategy: NodeDossierSortStrategy;
  sort_reason: string;
  title_excerpt: string;
  answer_excerpt: string;
  mistake_excerpt: string;
  mastery_level: number | null;
  recent_error_at: string;
  recent_edit_at: string;
  due_at: string | null;
  keywords: string[];
  metrics: NodeDossierSortMetric[];
}

export interface NodeNotebookSection {
  section_id: string;
  order: number;
  title: string;
  content_markdown: string;
  preview: string;
}

export interface NodeNotebookBlock {
  node_id: string;
  tag_id: string;
  title: string;
  summary: string;
  content_markdown: string;
  source_key: string;
  sections: NodeNotebookSection[];
}

export interface NodeDossierPagination {
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  next_offset: number | null;
}

export interface NodeDossierScope {
  surface: 'question_bank' | 'mistake_node_hub';
  tag_id: string;
  node_id: string;
  tag_name: string;
  node_name: string;
}

export interface NodeDossierRelationGraph {
  tag_id: string;
  node_id: string;
  mistake_ids: string[];
  mistake_count: number;
}

export interface NodeDossierSummary {
  mistake_count: number;
  visible_count: number;
  due_count: number;
  average_mastery_level: number | null;
  sort_strategy: NodeDossierSortStrategy;
}

export interface NodeDossier {
  snapshot_version: string;
  scope: NodeDossierScope;
  summary: NodeDossierSummary;
  relation_graph: NodeDossierRelationGraph;
  pagination: NodeDossierPagination;
  mistake_index: NodeMistakeIndexEntry[];
  active_mistake_id: string | null;
  active_mistake_ids: string[];
  active_mistake: Question | null;
  active_mistakes: Question[];
  node_notebook: NodeNotebookBlock;
}

export interface NodeDossierQuery {
  tagId?: string;
  nodeId?: string;
  activeMistakeId?: string;
  activeMistakeIds?: string[];
  surface?: NodeDossierScope['surface'];
  sortBy?: NodeDossierSortStrategy;
  offset?: number;
  limit?: number;
}

export interface NodeMistakeLookupQuery extends NodeDossierQuery {
  mistakeId?: string;
  keyword?: string;
  createdAfter?: string;
  createdBefore?: string;
  dueAfter?: string;
  dueBefore?: string;
}

export interface NodeDossierFileExport {
  file_name: string;
  content_type: 'application/json';
  content: string;
  snapshot_version: string;
}

export type CopilotRiskLevel = 'low' | 'medium' | 'high';

export type CopilotActionType =
  | 'get_node_dossier'
  | 'list_node_mistakes'
  | 'rank_node_mistakes'
  | 'compare_mistakes'
  | 'explain_mistake'
  | 'create_mistake'
  | 'update_mistake'
  | 'move_mistake_to_node'
  | 'delete_mistake'
  | 'batch_update_mistakes'
  | 'create_node_note_section'
  | 'rewrite_node_notebook'
  | 'reorder_node_notebook'
  | 'start_review'
  | 'start_drill'
  | 'update_tags'
  | 'update_learning_content';

export type CopilotReadActionType =
  | 'get_node_dossier'
  | 'list_node_mistakes'
  | 'rank_node_mistakes'
  | 'compare_mistakes';

export type CopilotInterpretActionType = 'explain_mistake';

export type CopilotWriteActionType =
  | 'create_mistake'
  | 'update_mistake'
  | 'move_mistake_to_node'
  | 'delete_mistake'
  | 'batch_update_mistakes'
  | 'create_node_note_section'
  | 'rewrite_node_notebook'
  | 'reorder_node_notebook'
  | 'update_tags'
  | 'update_learning_content';

export type MiniCopilotWorkMode =
  | 'single_question'
  | 'node_summary'
  | 'precise_edit'
  | 'multi_compare'
  | 'ingest'
  | 'study'
  | 'route';

export type CopilotActionStage = 'preview' | 'confirm' | 'execute';

export interface CopilotActionTargetIds {
  tag_id?: string;
  node_id?: string;
  mistake_id?: string;
  mistake_ids?: string[];
}

export interface CopilotActionScope extends CopilotActionTargetIds {
  surface?: NodeDossierScope['surface'];
  work_mode?: MiniCopilotWorkMode;
}

export interface CopilotActionValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  refresh_targets: {
    tag_ids: string[];
    node_ids: string[];
    mistake_ids: string[];
  };
}

export interface CopilotActionRequest {
  action_type: CopilotActionType;
  title?: string;
  description?: string;
  target_ids: CopilotActionTargetIds;
  field_patch?: Record<string, unknown>;
  reason?: string;
  risk_level: CopilotRiskLevel;
  impact_scope?: string[];
  snapshot_version?: string;
  stage: CopilotActionStage;
  scope?: CopilotActionScope;
}

export interface CopilotExecutionPreview {
  title: string;
  summary: string;
  affected_count: number;
  affected_ids: string[];
}

export interface CopilotExecutionReceipt {
  action_type: CopilotActionType;
  requested_stage: CopilotActionStage;
  executed_stage: CopilotActionStage;
  success: boolean;
  target_ids: CopilotActionTargetIds;
  applied_fields: string[];
  skipped_fields: string[];
  validation_warnings: string[];
  failure_reason?: string;
  latest_snapshot_version?: string;
  affected_objects: {
    tag_ids: string[];
    node_ids: string[];
    mistake_ids: string[];
  };
  follow_up_updates: string[];
  preview?: CopilotExecutionPreview;
}

export interface UserWeakness {
  id: string;
  user_id: string;
  knowledge_point: string;
  ability: string;
  error_count: number;
  last_updated: string;
}

export type Subject = '英语' | 'C语言';

const runtimeDictionary = {
  knowledge_point: {
    英语: [] as string[],
    C语言: [] as string[],
  },
  error_type: {
    英语: [] as string[],
    C语言: [] as string[],
  },
  ability: [] as string[],
};

export const ENGLISH_KNOWLEDGE_POINTS = runtimeDictionary.knowledge_point.英语;
export const PROGRAMMING_KNOWLEDGE_POINTS = runtimeDictionary.knowledge_point.C语言;
export const ABILITIES = runtimeDictionary.ability;
export const SUBJECT_ERROR_TYPES: Record<Subject, string[]> = {
  英语: runtimeDictionary.error_type.英语,
  C语言: runtimeDictionary.error_type.C语言,
};
export const ERROR_TYPES: string[] = [];

function replaceArray(target: string[], source: string[]) {
  target.splice(0, target.length, ...Array.from(new Set(source.map((item) => String(item || '').trim()).filter(Boolean))));
}

export function applyRuntimeTagDictionary(payload: {
  knowledgePointBySubject?: Partial<Record<Subject, string[]>>;
  errorTypeBySubject?: Partial<Record<Subject, string[]>>;
  abilities?: string[];
}) {
  replaceArray(runtimeDictionary.knowledge_point.英语, payload.knowledgePointBySubject?.英语 || []);
  replaceArray(runtimeDictionary.knowledge_point.C语言, payload.knowledgePointBySubject?.C语言 || []);
  replaceArray(runtimeDictionary.error_type.英语, payload.errorTypeBySubject?.英语 || []);
  replaceArray(runtimeDictionary.error_type.C语言, payload.errorTypeBySubject?.C语言 || []);
  replaceArray(runtimeDictionary.ability, payload.abilities || []);
  replaceArray(ERROR_TYPES, [...runtimeDictionary.error_type.英语, ...runtimeDictionary.error_type.C语言]);
}

export function getKnowledgePointsBySubject(subject?: string) {
  if (subject === 'C语言') return PROGRAMMING_KNOWLEDGE_POINTS;
  return ENGLISH_KNOWLEDGE_POINTS;
}

export function getErrorTypesBySubject(subject?: string) {
  if (subject === 'C语言') return SUBJECT_ERROR_TYPES.C语言;
  return SUBJECT_ERROR_TYPES.英语;
}

export interface Stats {
  total: number;
  weaknessCount: number;
  dueReviewCount: number;
  topWeakness: UserWeakness | null;
  subjectCounts: Record<string, number>;
  newThisWeek: number;
  recent: Question[];
  subjectMastery: { subject: string; score: number; count: number }[];
  weeklyActivity: number[];
  errorTypes: { name: string; value: number }[];
  weaknessesList: UserWeakness[];
}

export interface QuestionCardData {
  subject: string;
  question_text: string;
  image_url?: string;
  knowledge_point: string;
  ability: string;
  error_type: string;
  note?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  reasoningContent?: string;
  thinking?: boolean;
  questionCard?: QuestionCardData;
  saved?: boolean;
}

export interface VariantQuestion {
  level: number;
  question_type: QuestionType;
  question_text: string;
  options: string[];
  correct_answer: string;
  acceptable_answers?: string[];
  explanation: string;
  source_kind?: 'ai' | 'cache' | 'rule_fallback';
  source_label?: string;
  validation_status?: 'accepted' | 'repaired' | 'rejected';
}

export interface LearningWritebackContext {
  idempotencyKey: string;
  proposalId?: string;
  sessionId?: string;
  sessionKind?: 'practice' | 'review' | 'guided';
  sourceSurface?: string;
  sourceReason?: string;
  plannerSource?: 'ai' | 'rule_fallback' | 'manual' | 'unknown';
  judgeMode?: 'server' | 'local';
  generationQuality?: 'full' | 'partial' | 'fallback' | 'cache';
  fallbackReason?: string;
}

export interface GovernedGenerationRequest {
  proposalId: string;
  subject: Subject;
  nodes: string[];
  amount: number;
  strategy: '递进' | '随机' | '攻坚';
  sourceSurface: string;
  sourceReason: string;
  objectiveCode: string;
  explanationSummary: string;
  successCriteria: string;
  generationPolicy: {
    allowAiGenerate: boolean;
    allowCache: boolean;
    allowRuleFallback: boolean;
  };
}

export interface GovernedGenerationResult {
  variants: VariantQuestion[];
  effectiveAmount: number;
  sourceKind: 'ai' | 'cache' | 'rule_fallback';
  quality: 'full' | 'partial' | 'fallback' | 'cache';
  fallbackReason?: string;
  validation: {
    requested: number;
    accepted: number;
    rejected: number;
  };
}

export interface LearningTelemetryEventInput {
  eventType: string;
  proposalId?: string;
  sessionId?: string;
  sessionKind?: 'practice' | 'review' | 'guided';
  sourceSurface?: string;
  sourceReason?: string;
  plannerSource?: string;
  judgeMode?: string;
  generationQuality?: string;
  fallbackReason?: string;
  completionOutcome?: string;
  metadata?: Record<string, unknown>;
}

export interface QuestionQuery {
  subject?: string;
  category?: string;

  nodes?: string[];
  onlyDue?: boolean;
  onlyUnmastered?: boolean;
  onlyStubborn?: boolean;
  includeArchived?: boolean;
  onlyArchived?: boolean;
  sortBy?: 'latestWrong' | 'lowestMastery' | 'nearestDue';
  offset?: number;
  limit?: number;
}

export type ReviewRating = 'forgot' | 'vague' | 'mastered';

export interface ReviewAttemptDiagnosis {
  why_wrong: string;
  evidence: string;
  fix_strategy: string;
  next_practice_type: string;
  error_pattern?: 'repeat_same_option' | 'keyword_missing' | 'knowledge_gap' | 'careless' | 'unknown';
  confidence_score?: number;
  history_hint?: string;
}

export interface ReviewAttemptRecord {
  id: string;
  question_id: string;
  user_answer?: string;
  selected_option_text?: string;
  correct_answer?: string;
  is_correct: boolean;
  rating: ReviewRating;
  ai_diagnosis?: ReviewAttemptDiagnosis | null;
  next_review_date?: string;
  created_at: string;
}

export interface SubmitReviewAttemptInput {
  questionId: string;
  userAnswer: string;
  selectedOptionText?: string;
  correctAnswer?: string;
  isCorrect: boolean;
  rating: ReviewRating;
  diagnosis: ReviewAttemptDiagnosis;
  writebackContext?: LearningWritebackContext;
}

export interface SubmitReviewAttemptResult {
  question: Question;
  attemptId?: string;
  nextReviewDate?: string;
}

export interface GenerateReviewDiagnosisInput {
  subject?: string;
  questionText: string;
  correctAnswer: string;
  userAnswer: string;
  selectedOptionText?: string;
  isChoice: boolean;
  recentAttempts?: Array<{
    is_correct: boolean;
    user_answer?: string;
    rating?: ReviewRating;
    created_at?: string;
  }>;
  fallbackDiagnosis: ReviewAttemptDiagnosis;
}

export type TagExtensions = Partial<Record<'knowledge_point' | 'ability' | 'error_type', string[]>>;

export type TaxonomyOverrideMap = Partial<Record<Subject, Record<string, { category: string; node: string }>>>;

export interface LearningKeywordCard {
  title: string;
  keywords: string[];
}

export interface LearningDrawerContent {
  title?: string;
  markdown?: string;
  summary?: string;
  keyword_cards?: LearningKeywordCard[];
  last_sync_report?: {
    decision: 'skip' | 'rewrite' | 'create';
    reason: string;
    next_markdown?: string;
    synced_at: string;
    source: 'draft_review_batch' | 'ai_update' | 'mistake_sync';
    question_count: number;
  };
}

export interface LearningContentState {
  tipsByNode: Record<string, string[]>;
  drawerByTag: Record<string, LearningDrawerContent>;
}

export interface UserLearningStateRecord {
  user_id: string;
  tag_extensions: TagExtensions;
  taxonomy_overrides: TaxonomyOverrideMap;
  learning_content: LearningContentState;
  created_at?: string;
  updated_at?: string;
}

export interface PlannerUserStats {
  review_count: number;
  accuracy: number;
  interruption_rate: number;
}

export interface PlannerQuestionItem {
  question_id: string;
  subject: '英语' | 'C语言';
  knowledge_point?: string;
  mastery_state: 'active' | 'mastered' | 'archived';
  review_count: number;
  last_result: 'correct' | 'wrong' | 'unknown';
  last_interval_days: number;
  lapse_count: number;
  stability: number;
  difficulty: number;
  predicted_recall: number;
  is_due: boolean;
  is_archived: boolean;
}

export interface PlannerInputPayload {
  request_id: string;
  request_at?: string;
  user: {
    user_id: string;
    stats_7d: PlannerUserStats;
    stats_30d: PlannerUserStats;
    subject_preference?: Subject[];
  };
  session_constraints: {
    budget_count: number;
    prefer_due: boolean;
    subjects: Subject[];
  };
  system_constraints: {
    min_interval_days: number;
    max_session_count: number;
    due_min_ratio: number;
    archived_excluded: boolean;
  };
  questions: PlannerQuestionItem[];
}

export interface PlannerQueueItem {
  question_id: string;
  rank: number;
  reason: string;
  suggested_interval_days: number;
  priority_score: number;
  strategy?: 'rescue' | 'reinforce' | 'new' | 'revisit';
}

export interface PlannerOutputPayload {
  request_id: string;
  plan_version: string;
  queue: PlannerQueueItem[];
  mix: {
    rescue: number;
    reinforce: number;
    new: number;
    revisit: number;
  };
  risk: {
    high_volatility: boolean;
    high_fatigue: boolean;
    missing_data: boolean;
    notes?: string[];
  };
  confidence: number;
}

export type ReviewPlanSource = 'ai' | 'rule_fallback';

export interface PlanTelemetry {
  request_id: string;
  user_id: string;
  plan_source: ReviewPlanSource;
  plan_version: string;
  fallback_reason?: string;
  schema_validation_passed?: boolean;
  planning_latency_ms: number;
  request_summary: any;
  rule_queue_snapshot: any[];
  shadow_queue_snapshot?: any[];
  comparison_summary?: any;
  risk_flags?: any;
  created_at?: string;
}

export interface ReviewPlannerRunInput {
  subject: Subject;
  scope: 'all' | 'due' | 'unmastered' | 'stubborn';
  budget_count: number;
  due_min_ratio: number;
  page_number?: number;
  rule_queue: Question[];
}

export interface ReviewPlannerRunResult {
  request_id: string;
  plan_source: ReviewPlanSource;
  plan_version: string;
  fallback_reason?: string;
  planning_latency_ms: number;
  strategy_template: string;
  strategy_label: string;
  execution_queue: Question[];
  rule_queue: Question[];
  ai_queue?: PlannerQueueItem[];
  reasons: string[];
  confidence?: number;
  comparison_summary?: Record<string, unknown>;
  risk_flags?: Record<string, unknown>;
  rollout_metadata?: {
    planner_enabled: boolean;
    gray_percent: number;
    gray_bucket: number;
    selected: boolean;
    page_number: number;
  };
}
