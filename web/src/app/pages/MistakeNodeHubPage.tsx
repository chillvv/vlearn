import { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Edit2, PenSquare, Rocket, Send, Sparkles, TriangleAlert, X, Plus, BrainCircuit, BookMarked, XCircle, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BlockMath } from 'react-katex';
import { buildCopilotLearningProfile, chatApi, questionsApi } from '../lib/api';
import type { Question, Subject } from '../lib/types';
import { approveNewTags, collectMissingTagExtensions, getCanonicalTagDictionary, hydrateTagExtensionsFromCloud, isOutOfScopeLearningRequest, normalizeMistakeDraft, parseCopilotAction, stripActionBlock, type CopilotActionProposal } from '../lib/copilot';
import { toast } from 'sonner';
import { MistakeQuestionPreview } from '../components/business/MistakeQuestionPreview';
import { useConfirm } from '../components/business/ConfirmProvider';
import { getMergedKnowledgeContent, hydrateLearningContentStateFromCloud, normalizeKnowledgeMarkdown, readLearningContentState, writeLearningContentState, type LearningContentState } from '../lib/knowledgeContent';
import 'katex/dist/katex.min.css';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';

type NodeHubState = {
  subject?: Subject;
  category?: string;
  l2?: string;
  node?: string;
};

export function MistakeNodeHubPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || {}) as NodeHubState;

  const subject = (searchParams.get('subject') as Subject | null) || state.subject || '英语';
  const category = searchParams.get('category') || state.category || '未分类';
  const l2 = searchParams.get('l2') || state.l2 || '核心考点';
  const node = searchParams.get('node') || state.node || '其他';
  const hasScopedCategory = searchParams.has('category') || Boolean(state.category);
  const hasScopedL2 = searchParams.has('l2') || Boolean(state.l2);
  const useScopedFilter = hasScopedCategory && hasScopedL2;

  const [items, setItems] = useState<Question[]>([]);
  const [listPage, setListPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 20;

  const [activeTab, setActiveTab] = useState<'mistakes' | 'knowledge'>('mistakes');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInitialAsk, setAiInitialAsk] = useState('');
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');

  const [learningContentVersion, setLearningContentVersion] = useState(0);
  const learningContentState = useMemo(() => readLearningContentState(), [learningContentVersion]);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        hydrateLearningContentStateFromCloud(),
        hydrateTagExtensionsFromCloud(),
      ]);
      setLearningContentVersion(prev => prev + 1);
    })();
  }, []);

  useEffect(() => {
    setListPage(1);
  }, [subject, category, l2, node]);

  const listQuery = useQuery({
    queryKey: [
      ...queryKeys.questionsList({
        subject,
        category,
        l2,
        nodes: [node],
        sortBy: 'lowestMastery',
        limit: PAGE_SIZE,
        offset: (listPage - 1) * PAGE_SIZE,
      }),
      useScopedFilter ? 'scoped' : 'unscoped',
    ],
    queryFn: async () => {
      const offset = (listPage - 1) * PAGE_SIZE;
      const withScope = useScopedFilter;
      const fetchTotalCount = async (withCategoryAndL2: boolean) => {
        return questionsApi.count({
          subject,
          ...(withCategoryAndL2 ? { category, l2 } : {}),
          nodes: [node],
        });
      };
      const [primaryList, primaryTotal] = await Promise.all([
        questionsApi.getAll({
          subject,
          ...(withScope ? { category, l2 } : {}),
          nodes: [node],
          sortBy: 'lowestMastery',
          limit: PAGE_SIZE,
          offset,
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
            sortBy: 'lowestMastery',
            limit: PAGE_SIZE,
            offset,
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
  const loading = listQuery.isLoading || listQuery.isFetching;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)), [totalCount]);

  useEffect(() => {
    if (listPage > totalPages) {
      setListPage(totalPages);
    }
  }, [listPage, totalPages]);

  const unresolvedCount = items.filter(item => (item.mastery_level ?? 0) < 80).length;
  const avgMastery = items.length > 0 ? Math.round(items.reduce((sum, item) => sum + (item.mastery_level ?? 0), 0) / items.length) : 0;

  const topErrorType = useMemo(() => {
    if (items.length === 0) return '理解偏差';
    const countMap = new Map<string, number>();
    items.forEach(item => {
      const key = item.error_type || '理解偏差';
      countMap.set(key, (countMap.get(key) || 0) + 1);
    });
    return [...countMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '理解偏差';
  }, [items]);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setAiInitialAsk(chatInput);
    setActiveQuestionId(null);
    setChatInput('');
    setAiPanelOpen(true);
  };

  const LeftPaneContent = (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-8 pb-32">
        {/* Header */}
        <div>
          <button 
            type="button"
            onClick={() => navigate('/questions')} 
            className="group flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            返回错题资产
          </button>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2 font-medium">
            <span>{subject}</span><span>›</span><span>{category}</span><span>›</span><span>{l2}</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">{node}</h1>
        </div>

        {/* Status Card */}
        <div className="flex items-center gap-5 rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
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
        <KnowledgeBaseCard
          tag={node}
          drawerOverrides={learningContentState.drawerByTag}
          topErrorType={topErrorType}
          onContentUpdated={() => setLearningContentVersion(prev => prev + 1)}
        />
      </div>

      {/* Sticky Bottom AI Input */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F9FAFB] via-[#F9FAFB]/95 to-transparent pt-12 pointer-events-none">
        <form onSubmit={handleChatSubmit} className="pointer-events-auto relative flex items-center bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-gray-200/60 p-2 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-50 transition-all">
          <div className="pl-3 pr-2 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-indigo-500" />
          </div>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder={`对「${node}」还有疑问？直接问 AI...`}
            className="flex-1 bg-transparent border-none outline-none text-sm text-gray-800 placeholder:text-gray-400 py-2"
          />
          <button
            type="submit"
            disabled={!chatInput.trim()}
            className="w-9 h-9 rounded-xl bg-gray-900 text-white flex items-center justify-center hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-gray-900 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );

  const RightPaneContent = (
    <div className="flex flex-col h-full relative bg-white">
      <div className="flex-1 overflow-y-auto p-6 lg:p-8 pb-32">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900">当前标签下的错题 ({items.length} / 共 {totalCount} 道)</h2>
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
            <select className="text-sm border-none bg-gray-50 rounded-lg px-3 py-1.5 font-medium text-gray-600 outline-none cursor-pointer hover:bg-gray-100 transition-colors">
              <option>默认排序</option>
              <option>错误率最高</option>
              <option>最新添加</option>
            </select>
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
                onDeleted={(id) => setItems(prev => prev.filter(row => row.id !== id))}
                onAskAI={(step) => {
                  setAiInitialAsk(`关于【${step}】这一步，我有点没看懂。`);
                  setActiveQuestionId(item.id);
                  setAiPanelOpen(true);
                }}
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
            onClick={() => navigate('/practice')}
            className="px-8 py-3.5 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-[15px] shadow-xl shadow-indigo-600/20 hover:shadow-2xl hover:shadow-indigo-600/30 hover:-translate-y-1 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 group"
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
            className={`flex-1 py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'mistakes' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('mistakes')}
          >
            错题列表
          </button>
          <button
            className={`flex-1 py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'knowledge' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('knowledge')}
          >
            知识点与 AI
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {activeTab === 'mistakes' ? RightPaneContent : LeftPaneContent}
        </div>
      </div>

      {/* Desktop Split Workspace */}
      <div className="hidden md:flex h-full w-full">
        <div className="w-[40%] min-w-[360px] max-w-[500px] h-full border-r border-gray-200 bg-[#F9FAFB] shrink-0">
          {LeftPaneContent}
        </div>
        <div className="flex-1 h-full bg-white min-w-0">
          {RightPaneContent}
        </div>
      </div>

      <ContextualAIPanel
        open={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        items={items}
        subject={subject}
        node={node}
        activeQuestionId={activeQuestionId}
        stepTitle={aiInitialAsk ? undefined : '整题'}
        initialAsk={aiInitialAsk}
        learningContentData={learningContentState.drawerByTag[node] || {}}
        onLearningContentUpdated={() => setLearningContentVersion(prev => prev + 1)}
        onQuestionsUpdated={(updated: Question) => setItems(prev => prev.map(row => row.id === updated.id ? updated : row))}
      />
    </div>
  );
}

function KnowledgeBaseCard({
  tag,
  drawerOverrides,
  topErrorType,
  onContentUpdated,
}: {
  tag: string;
  drawerOverrides: LearningContentState['drawerByTag'];
  topErrorType: string;
  onContentUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const data = useMemo(() => getMergedKnowledgeContent(tag, drawerOverrides), [tag, drawerOverrides]);
  
  const [summaryDraft, setSummaryDraft] = useState(data.summary || '');
  const [markdownDraft, setMarkdownDraft] = useState(data.markdown || '');

  useEffect(() => {
    setSummaryDraft(data.summary || '');
    setMarkdownDraft(data.markdown || '');
  }, [data.summary, data.markdown, tag]);

  const handleSave = () => {
    const current = readLearningContentState();
    current.drawerByTag[tag] = {
      ...(current.drawerByTag[tag] || {}),
      summary: summaryDraft.trim(),
      markdown: normalizeKnowledgeMarkdown(markdownDraft),
    };
    writeLearningContentState(current);
    onContentUpdated();
    setEditing(false);
    toast.success('知识点内容已保存');
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col relative transition-all duration-300 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.08)] hover:border-indigo-100/80">
      <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-gradient-to-r from-indigo-50/50 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white shadow-sm border border-indigo-100 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">AI 专属提分锦囊</h2>
            <p className="text-xs text-gray-500 mt-0.5">该考点常见错因为「<span className="text-rose-500">{topErrorType}</span>」</p>
          </div>
        </div>
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSummaryDraft(data.summary || '');
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
          </div>
        )}
      </div>

      <div className="p-6 space-y-5">
        {!editing ? (
          <>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-2">AI 总结</p>
              <div className="obsidian-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {data.summary || `当前知识点「${tag}」还没有摘要，建议先让 AI 生成。`}
                </ReactMarkdown>
              </div>
            </div>

            {data.markdown && (
              <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">完整知识点</p>
                <div className="obsidian-markdown">
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
              <p className="text-xs text-gray-500 mb-1 font-medium">AI 总结 (支持 Markdown)</p>
              <textarea
                rows={4}
                value={summaryDraft}
                onChange={e => setSummaryDraft(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all shadow-sm"
                placeholder="输入 AI 总结内容..."
              />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium">完整知识点 (支持 Markdown + LaTeX)</p>
              <textarea
                rows={12}
                value={markdownDraft}
                onChange={e => setMarkdownDraft(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all shadow-sm"
                placeholder="输入完整知识点解析..."
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
}: {
  item: Question;
  onUpdated: (next: Question) => void;
  onDeleted: (id: string) => void;
  onAskAI: (step: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleting, setConfirmDeleting] = useState(false);
  const detail = useMemo(() => parseStructuredDetail(item), [item]);
  const dictionary = useMemo(() => getCanonicalTagDictionary(), []);
  const [draft, setDraft] = useState({
    question_text: item.question_text || '',
    correct_answer: item.correct_answer || '',
    knowledge_point: item.knowledge_point || '',
    error_type: item.error_type || '',
    note: item.note || '',
  });

  useEffect(() => {
    setDraft({
      question_text: item.question_text || '',
      correct_answer: item.correct_answer || '',
      knowledge_point: item.knowledge_point || '',
      error_type: item.error_type || '',
      note: item.note || '',
    });
  }, [item]);

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const updated = await questionsApi.update(item.id, {
        question_text: draft.question_text.trim(),
        correct_answer: draft.correct_answer.trim(),
        knowledge_point: draft.knowledge_point.trim(),
        error_type: draft.error_type.trim(),
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
    <article id={`mistake-${item.id}`} className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-gray-100 transition-all duration-300 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.08)] hover:border-indigo-100/80">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3 text-xs font-medium">
          <span className="text-gray-500">
            {new Date(item.created_at).toLocaleDateString() === new Date().toLocaleDateString() 
              ? '今天' 
              : '昨天'}
          </span>
          <div className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-md border border-indigo-100">
            #{item.knowledge_point || item.error_type || '时态'}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
           <span>掌握度</span>
           <div className="w-12 h-1.5 rounded-full bg-gray-100 overflow-hidden">
             <div 
               className="h-full bg-indigo-500 rounded-full transition-all duration-1000" 
               style={{ width: `${item.mastery_level || 0}%` }}
             ></div>
           </div>
           <button
             type="button"
             onClick={() => setEditOpen(!editOpen)}
             className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 active:scale-95 transition-transform"
           >
             {editOpen ? '取消编辑' : '编辑'}
           </button>
           {confirmDeleting ? (
             <button
               type="button"
               onClick={handleDelete}
               onMouseLeave={() => setConfirmDeleting(false)}
               disabled={deleting}
               className="rounded-lg border border-rose-500 bg-rose-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-600 disabled:opacity-60 active:scale-95 transition-transform"
             >
               {deleting ? '删除中...' : '确认删除?'}
             </button>
           ) : (
             <button
               type="button"
               onClick={() => setConfirmDeleting(true)}
               className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 active:scale-95 transition-transform"
             >
               删除
             </button>
           )}
        </div>
      </div>
      
      {editOpen && (
        <div className="mb-6 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/30 p-5">
          <div className="grid gap-3">
            <textarea
              rows={3}
              value={draft.question_text}
              onChange={e => setDraft(prev => ({ ...prev, question_text: e.target.value }))}
              className="w-full rounded-xl border border-white bg-white/80 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm"
              placeholder="题干"
            />
            <input
              value={draft.correct_answer}
              onChange={e => setDraft(prev => ({ ...prev, correct_answer: e.target.value }))}
              className="h-10 w-full rounded-xl border border-white bg-white/80 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm"
              placeholder="正确答案"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                value={draft.knowledge_point}
                onChange={e => setDraft(prev => ({ ...prev, knowledge_point: e.target.value }))}
                className="h-10 rounded-xl border border-white bg-white/80 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm"
              >
                <option value="">选择知识点</option>
                {dictionary.knowledge_point.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </select>
              <select
                value={draft.error_type}
                onChange={e => setDraft(prev => ({ ...prev, error_type: e.target.value }))}
                className="h-10 rounded-xl border border-white bg-white/80 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm"
              >
                <option value="">选择错误标签</option>
                {dictionary.error_type.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </div>
            <textarea
              rows={4}
              value={draft.note}
              onChange={e => setDraft(prev => ({ ...prev, note: e.target.value }))}
              className="w-full rounded-xl border border-white bg-white/80 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm"
              placeholder="解析与笔记"
            />
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 bg-white"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-500 shadow-sm"
            >
              {saving ? '保存中...' : '保存修改'}
            </button>
          </div>
        </div>
      )}

      {!editOpen && (
        <div className="mb-6">
          <MistakeQuestionPreview
            questionText={item.question_text}
            normalizedPayload={item.normalized_payload}
            validationStatus={expanded ? item.validation_status : item.validation_status ? { ...(item.validation_status as any), correct: undefined } : undefined}
            stemClassName="text-gray-800 text-base leading-relaxed font-serif tracking-wide"
            optionClassName="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-1.5 text-xs text-indigo-900"
            maxOptions={expanded ? 8 : 4}
            showKindBadge
            userAnswer={detail.userAnswer || undefined}
            correctAnswer={detail.correctAnswer || undefined}
            showResultComparison={expanded && Boolean(detail.userAnswer) && Boolean(detail.correctAnswer)}
          />
        </div>
      )}
      
      <div className={`grid transition-all duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="space-y-4">
            {detail.originalImageUrl && (
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <img src={detail.originalImageUrl} alt="source-question" className="max-h-80 w-full rounded-xl object-contain" />
              </div>
            )}

            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">AI 详细解析</p>
              </div>

              {/* Header 条 */}
              <div className="flex items-center justify-between bg-white/60 border border-indigo-100/50 px-4 py-3 rounded-xl mb-5 text-[13px] font-medium shadow-sm">
                <span className="text-gray-600 flex items-center">
                  你的作答：
                  <span className="text-rose-600 font-bold ml-1">{detail.userAnswer || '未记录'}</span>
                  {detail.userAnswer && detail.correctAnswer && detail.userAnswer !== detail.correctAnswer && <XCircle className="w-3.5 h-3.5 text-rose-500 ml-1.5" />}
                </span>
                <span className="text-gray-600 flex items-center">正确答案：<span className="text-emerald-600 font-bold ml-1">{detail.correctAnswer || '未记录'}</span>{detail.correctAnswer && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-1.5" />}</span>
              </div>
              
              <div className="space-y-4">
                {detail.steps.map(step => (
                  <div key={`${item.id}-${step.step}`} className="bg-white rounded-xl p-4 border border-indigo-100/50 border-l-4 border-l-indigo-500 shadow-sm transition-all duration-300 hover:shadow-md hover:border-indigo-200">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-gray-900">步骤 {step.step} · {step.title}</p>
                      <button
                        onClick={() => onAskAI(step.title)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 transition-colors active:scale-95"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        对这步有疑问
                      </button>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-gray-700">{step.content}</p>
                  </div>
                ))}
              </div>
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
      
      <div className="mt-6 border-t border-gray-100 pt-4">
        <button 
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          {expanded ? '收起解析' : '查看正确答案与 AI 解析'}
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>
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
  const coreLine = lines.find(line => line.startsWith('核心错因：'));
  const formulaLine = lines.find(line => line.startsWith('公式：'));
  const noteLine = lines.find(line => line.startsWith('我的笔记：'));
  const correctAnswerLine = lines.find(line => /^(正确答案|参考答案)[:：]/.test(line));
  const stepLines = lines.filter(line => /^步骤\d+\s/.test(line));
  const steps = stepLines.map(line => {
    const match = line.match(/^步骤(\d+)\s(.+?)：(.*)$/);
    return {
      step: Number(match?.[1] || 1),
      title: match?.[2] || '解题步骤',
      content: match?.[3] || line,
    };
  });
  
  const noteAnswerLine = lines.find(line => /^(我的作答|我的答案|用户作答|用户答案|作答|答案)[:：]/.test(line));
  const noteAnswer = noteAnswerLine?.replace(/^(我的作答|我的答案|用户作答|用户答案|作答|答案)[:：]\s*/, '').trim() || '';
  const textAnswerMatch = item.question_text.match(/(?:我的作答|我的答案|用户作答|用户答案|作答|答案)\s*[:：]?\s*([A-H])/i);
  const extractedUserAnswer = noteAnswer || (textAnswerMatch?.[1]?.toUpperCase() || '');
  const parsedCorrectAnswer = correctAnswerLine?.replace(/^(正确答案|参考答案)[:：]\s*/, '').trim() || '';
  const correctAnswer = item.correct_answer || item.normalized_payload?.answerSchema?.correctAnswer || parsedCorrectAnswer;
  const pureCoreReason = coreLine?.replace(/^核心错因[:：]\s*/, '').trim() || '';
  const analysisOnlyLines = lines.filter(line => !/^(我的笔记|我的作答|我的答案|用户作答|用户答案|作答|答案|正确答案|参考答案)[:：]/.test(line));
  const fallbackAnalysis = pureCoreReason || analysisOnlyLines.join('\n') || item.knowledge_point || item.error_type || '请先定位题干核心信息，再逐项验证。';
  const professionalFallback = buildProfessionalFallback(item, fallbackAnalysis);

  return {
    coreReason: pureCoreReason || professionalFallback.coreReason || item.knowledge_point || item.error_type || '时态',
    steps: steps.length > 0 ? steps : professionalFallback.steps,
    formula: formulaLine?.replace('公式：', '') || null,
    prerequisite: item.summary
      ? { title: '必备前置知识', content: item.summary }
      : null,
    warningTags: Array.from(new Set([item.knowledge_point, item.error_type].filter(Boolean))) as string[],
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
  node,
  activeQuestionId,
  stepTitle,
  initialAsk,
  learningContentData,
  onLearningContentUpdated,
  onQuestionsUpdated,
}: { 
  open: boolean; 
  onClose: () => void; 
  items: Question[];
  subject: Subject;
  node: string;
  activeQuestionId: string | null;
  stepTitle?: string;
  initialAsk?: string;
  learningContentData: any;
  onLearningContentUpdated: () => void;
  onQuestionsUpdated: (updated: Question) => void;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [dictionary, setDictionary] = useState(getCanonicalTagDictionary());
  const [messages, setMessages] = useState<Array<{
    role: 'assistant' | 'user';
    content: string;
    action?: CopilotActionProposal;
    draft?: Partial<Question>;
    reasoningContent?: string;
  }>>(() => {
    try {
      const savedChat = sessionStorage.getItem(`vlearn_context_ai_chat_${node}`);
      if (savedChat) {
        return JSON.parse(savedChat);
      }
    } catch (error) {
      console.error('Failed to parse chat history', error);
    }
    return [
      { role: 'assistant', content: `我是你的「${node}」专属管家。你可以让我帮你分析错题、修改当前标签的提分锦囊，或是梳理该知识点下的弱项。` },
    ];
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [draftEdits, setDraftEdits] = useState<Record<number, Partial<Question>>>({});
  const [deepThinking, setDeepThinking] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && initialAsk && messages.length === 1) {
      handleSend(initialAsk);
    }
  }, [open, initialAsk]);

  useEffect(() => {
    try {
      const messagesToSave = messages.slice(-50);
      sessionStorage.setItem(`vlearn_context_ai_chat_${node}`, JSON.stringify(messagesToSave));
    } catch (error) {
      console.warn('Session storage is full or unavailable', error);
    }
  }, [messages, node]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await hydrateTagExtensionsFromCloud();
      setDictionary(getCanonicalTagDictionary());
    })();
  }, [open]);

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

  const buildContextPrompt = (ask: string, learningProfile: string) => {
    const activeQuestion = activeQuestionId ? items.find(i => i.id === activeQuestionId) : null;
    const itemsSummary = items.slice(0, 10).map((i) => `[ID: ${i.id}] 错因: ${i.error_type}, 题干片段: ${i.question_text.slice(0, 30)}...`).join('\n');
    
    return `${learningProfile}

【当前标签环境】
- 科目：${subject}
- 知识点：${node}
- 该标签下已有错题数：${items.length}
- 前 10 道错题概览：
${itemsSummary || '暂无错题'}

【该知识点的当前解析内容】
- AI 总结：${learningContentData?.summary || '暂无'}
- 完整内容：${learningContentData?.markdown ? '已有详细内容' : '暂无'}

${activeQuestion ? `
【用户当前正在查看的具体错题】
- 完整题目：${activeQuestion.question_text}
- 正确答案：${activeQuestion.correct_answer || '未记录'}
- 当前提问步骤：${stepTitle || '整题'}
` : '【用户当前在看整个知识点页面，没有针对特定的一道题提问】'}

用户请求：${ask}

作为标签内的专属 AI 小管家，你可以：
1. 优先解答用户在这个知识点下的疑惑。
2. 你可以主动建议或执行修改这个知识点的“AI总结”和“完整知识点”(使用 update_learning_content 动作)。
3. 你可以帮助修改错题内容(使用 update_tags 等动作)。
4. 如果用户询问全局弱点，你也可以根据学习档案快照回答。
5. 只给证据驱动的解析，不写空话；必须使用“题眼→规则→答案回扣”。
6. 当你建议 create_mistake 或 update_tags 时，必须同时产出可用于 update_learning_content 的 node、summary、tips。`;
  };

  const syncKnowledgeFromMistake = (input: Partial<Question>) => {
    const targetNode = String(input.knowledge_point || input.node || node || '').trim();
    if (!targetNode) return;
    const detail = parseStructuredDetail(input as Question);
    const evidence = detail.steps.map((item) => `${item.title}：${item.content}`).filter(Boolean).slice(0, 3);
    const brief = evidence.join('；');
    if (!brief) return;
    const current = readLearningContentState();
    const currentTips = current.tipsByNode[targetNode] || [];
    const nextTip = `新错题规律：${brief}`;
    current.tipsByNode[targetNode] = Array.from(new Set([nextTip, ...currentTips])).slice(0, 8);
    const drawer = current.drawerByTag[targetNode] || {};
    const prevSummary = String(drawer.summary || '').trim();
    const summaryLine = `新增规律：${detail.coreReason}`;
    const summary = Array.from(new Set([summaryLine, ...prevSummary.split('\n').filter(Boolean)])).slice(0, 4).join('\n');
    const markdownSeed = String(drawer.markdown || '').trim();
    const noteBlock = `### 新增错题沉淀\n- 考点：${targetNode}\n- 核心错因：${detail.coreReason}\n- 规则链路：${brief}`;
    const markdown = markdownSeed ? `${markdownSeed}\n\n${noteBlock}` : noteBlock;
    current.drawerByTag[targetNode] = {
      ...drawer,
      summary,
      markdown: normalizeKnowledgeMarkdown(markdown),
    };
    writeLearningContentState(current);
    onLearningContentUpdated();
  };

  const executeAction = async (action: CopilotActionProposal, draft?: Partial<Question>) => {
    const doExecute = async () => {
      const activeQuestion = activeQuestionId ? items.find(i => i.id === activeQuestionId) : items[0];
      const targetQuestionId = action.payload?.question_id || activeQuestion?.id;
      const targetQuestion = items.find(i => i.id === targetQuestionId) || activeQuestion || { subject, knowledge_point: node, question_text: '' } as unknown as Question;

      const registerTagExtensions = async (input?: Partial<Question>) => {
        const additions = collectMissingTagExtensions(input, dictionary);
        const hasNewTags = additions.knowledge_point.length || additions.ability.length || additions.error_type.length;
        if (!hasNewTags) return true;
        const sections = [
          additions.knowledge_point.length ? `知识点：${additions.knowledge_point.join('、')}` : '',
          additions.ability.length ? `能力维度：${additions.ability.join('、')}` : '',
          additions.error_type.length ? `错因标签：${additions.error_type.join('、')}` : '',
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
        approveNewTags(additions);
        setDictionary(getCanonicalTagDictionary());
        return true;
      };
      
      if (action.type === 'create_mistake') {
          const canCreateTags = await registerTagExtensions(draft);
          if (!canCreateTags) return;
          const normalized = normalizeMistakeDraft({
            subject: subject as any,
          question_text: targetQuestion.question_text || '',
          knowledge_point: targetQuestion.knowledge_point || node,
          ability: targetQuestion.ability || '',
          error_type: targetQuestion.error_type || '',
          ...action.payload,
          ...draft,
        });
        const created = await questionsApi.create(normalized);
        syncKnowledgeFromMistake(created);
        toast.success('已确认并存入错题库');
        return;
      }
      if (action.type === 'update_tags') {
          if (!targetQuestion.id) {
            toast.error('找不到要更新的错题');
            return;
          }
          const canCreateTags = await registerTagExtensions(draft);
          if (!canCreateTags) return;
          const normalized = normalizeMistakeDraft({
            ...targetQuestion,
            subject: targetQuestion.subject as any,
            ...(action.payload || {}),
            ...draft,
          });
          const updated = await questionsApi.update(targetQuestion.id, {
          knowledge_point: normalized.knowledge_point,
          ability: normalized.ability,
          error_type: normalized.error_type,
          note: normalized.note,
          summary: normalized.summary,
        });
        syncKnowledgeFromMistake(updated);
        onQuestionsUpdated(updated);
        toast.success('错题标签已更新');
        return;
      }
      if (action.type === 'delete_mistake') {
        if (!targetQuestion.id) {
          toast.error('找不到要删除的错题');
          return;
        }
        await questionsApi.delete(targetQuestion.id);
        toast.success('错题已删除');
        return;
      }
      if (action.type === 'start_review') {
        const payload = action.payload?.preset || { subject: targetQuestion.subject as any, scope: 'due', sortBy: 'nearestDue' };
        const approved = await confirm({
          title: '确认生成复习计划',
          confirmText: '确认并开始',
          cancelText: '取消',
          description: (
            <div className="space-y-3 text-sm text-gray-700">
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-gray-500">科目：</span>
                <span className="font-medium text-gray-900">{payload.subject || targetQuestion.subject}</span>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-gray-500">范围：</span>
                <span className="font-medium text-gray-900">{payload.scope === 'due' ? '待复习错题' : '全部错题'}</span>
              </div>
            </div>
          ),
        });
        if (!approved) return;
        navigate('/review', {
          state: {
            preset: payload,
            autoStart: true,
          },
        });
        return;
      }
      if (action.type === 'start_drill') {
        const payload = action.payload?.preset || { subject: targetQuestion.subject as any, nodes: [targetQuestion.node || targetQuestion.knowledge_point], amount: 10, strategy: '递进' };
        const approved = await confirm({
          title: '确认生成专项练习',
          confirmText: '确认并开始',
          cancelText: '取消',
          description: (
            <div className="space-y-3 text-sm text-gray-700">
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-gray-500">科目：</span>
                <span className="font-medium text-gray-900">{payload.subject || targetQuestion.subject}</span>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-gray-500">题数：</span>
                <span className="font-medium text-gray-900">{payload.amount || 10}</span>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-gray-500">策略：</span>
                <span className="font-medium text-gray-900">{payload.strategy || '递进'}</span>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-gray-500">涉及考点：</span>
                <span className="font-medium text-gray-900">{(payload.nodes || []).join('、') || '未指定'}</span>
              </div>
            </div>
          ),
        });
        if (!approved) return;
        navigate('/practice', {
          state: {
            preset: payload,
            autoStart: true,
          },
        });
        return;
      }
      if (action.type === 'update_learning_content') {
        const current = readLearningContentState();
        const payload = action.payload || {};
        if (Array.isArray(payload.tips) && payload.tips.length > 0) {
          current.tipsByNode[String(payload.node || node)] = payload.tips.map((item: any) => String(item));
        }
        const targetTag = String(payload.tag || node || 'default');
        const drawerPatch: { title?: string; summary?: string; tables?: any[]; markdown?: string } = {};
        if (payload.title) drawerPatch.title = String(payload.title);
        if (payload.summary) drawerPatch.summary = normalizeKnowledgeMarkdown(String(payload.summary));
        if (payload.markdown) drawerPatch.markdown = normalizeKnowledgeMarkdown(String(payload.markdown));
        if (Array.isArray(payload.tables)) drawerPatch.tables = payload.tables;
        if (drawerPatch.title || drawerPatch.summary || drawerPatch.tables || drawerPatch.markdown) {
          current.drawerByTag[targetTag] = {
            ...(current.drawerByTag[targetTag] || {}),
            ...drawerPatch,
          };
        }
        writeLearningContentState(current);
        onLearningContentUpdated();
        toast.success('AI 内容更新已应用');
      }
    };

    if (action.risk === 'high') {
      doExecute();
    } else {
      doExecute();
    }
  };

  const handleSend = async (quickInput?: string) => {
    const ask = (quickInput || input).trim();
    if (!ask || sending) return;
    setSending(true);
    const baseMessages = [...messages, { role: 'user' as const, content: ask }];
    setMessages(baseMessages);
    setInput('');
    if (isOutOfScopeLearningRequest(ask)) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '我是你的错题学习管家，不能闲聊哦。你今天还有待复习题目，要我现在帮你开始吗？',
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
    setMessages(prev => [...prev, { role: 'assistant', content: deepThinking ? '' : '正在分析中...', reasoningContent: deepThinking ? '正在深度思考中...' : undefined }]);
    if (deepThinking) {
      setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: true }));
    }
    const learningProfile = await buildCopilotLearningProfile();
    await new Promise<void>((resolve) => {
      chatApi.streamCopilot(
        [...baseMessages.map(item => ({ role: item.role, content: item.content })), { role: 'user', content: buildContextPrompt(ask, learningProfile) }],
        (chunk, isReasoning) => {
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            if (!current) return prev;
            if (isReasoning) {
              next[placeholderIndex] = { ...current, reasoningContent: (current.reasoningContent === '正在深度思考中...' ? '' : current.reasoningContent || '') + chunk };
            } else {
              next[placeholderIndex] = { ...current, content: (current.content === '正在分析中...' ? '' : current.content) + chunk };
            }
            return next;
          });
        },
        (full) => {
          const action = parseCopilotAction(full);
          const cleaned = stripActionBlock(full) || '我已完成分析，请查看下方建议。';
          
          const activeQuestion = activeQuestionId ? items.find(i => i.id === activeQuestionId) : items[0];
          const targetQuestionId = action?.payload?.question_id || activeQuestion?.id;
          const targetQuestion = items.find(i => i.id === targetQuestionId) || activeQuestion || { subject, knowledge_point: node, question_text: '' } as unknown as Question;

          const rawDraft = action?.type === 'create_mistake' || action?.type === 'update_tags'
            ? normalizeMistakeDraft({ ...targetQuestion, subject: targetQuestion.subject as any, ...(action?.payload || {}) })
            : undefined;
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            next[placeholderIndex] = { ...current, role: 'assistant', content: cleaned, action: action || undefined, draft: rawDraft };
            return next;
          });
          setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
          resolve();
        },
        (error) => {
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            next[placeholderIndex] = { ...current, role: 'assistant', content: `请求失败：${error}` };
            return next;
          });
          setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
          resolve();
        },
        { injectLearningProfile: true, enableThinking: deepThinking }
      );
    });
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative flex h-[85vh] w-full flex-col bg-white shadow-2xl transition-transform duration-300 md:h-full md:w-[480px] rounded-t-3xl md:rounded-none mt-auto md:mt-0">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-gray-900">AI 错题管家</p>
              <p className="text-[11px] font-medium text-gray-500">
                上下文：{activeQuestionId ? `错题 - ${items.find(i => i.id === activeQuestionId)?.question_text.slice(0, 10)}...` : `标签 - ${node}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDeepThinking(!deepThinking)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                deepThinking
                  ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                  : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <BrainCircuit className="h-3.5 w-3.5" />
              深度思考
            </button>
            <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mb-6 flex flex-wrap gap-2">
            {['帮我总结这个知识点', '分析当前标签下的错题', '给我几道同类练习', '我的全局弱项是什么'].map(chip => (
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
                              <BrainCircuit className="h-4 w-4 text-indigo-500" />
                              {expandedThinking[idx] ? '深度思考过程' : '已完成深度思考'}
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
                      <div className="prose prose-sm prose-gray max-w-none leading-relaxed text-gray-800 break-words">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                      
                      {msg.action && (
                        <div className="mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ring-1 ring-black/5 transition-all">
                          <div className="border-b border-gray-50 bg-gray-50/50 px-4 py-2.5">
                            <p className="text-[13px] font-semibold text-gray-900">{msg.action.title || '执行建议'}</p>
                            <p className="mt-0.5 text-[11px] text-gray-500">{msg.action.description || '请确认后执行'}</p>
                          </div>
                          <div className="p-4">
                            {msg.draft && (
                              <div className="mb-4 grid grid-cols-1 gap-3">
                                <label className="flex flex-col gap-1">
                                  <span className="text-[11px] font-medium text-gray-500">知识点</span>
                                  <input
                                    value={(draftEdits[idx]?.knowledge_point as string) ?? (msg.draft.knowledge_point || '')}
                                    onChange={e => setDraftEdits(prev => ({ ...prev, [idx]: { ...prev[idx], knowledge_point: e.target.value } }))}
                                    list={`kp-${idx}`}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                  />
                                  <datalist id={`kp-${idx}`}>
                                    {dictionary.knowledge_point.map(item => <option key={item} value={item} />)}
                                  </datalist>
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                  <label className="flex flex-col gap-1">
                                    <span className="text-[11px] font-medium text-gray-500">能力维度</span>
                                    <input
                                      value={(draftEdits[idx]?.ability as string) ?? (msg.draft.ability || '')}
                                      onChange={e => setDraftEdits(prev => ({ ...prev, [idx]: { ...prev[idx], ability: e.target.value } }))}
                                      list={`ability-${idx}`}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                    />
                                    <datalist id={`ability-${idx}`}>
                                      {dictionary.ability.map(item => <option key={item} value={item} />)}
                                    </datalist>
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    <span className="text-[11px] font-medium text-gray-500">错因</span>
                                    <input
                                      value={(draftEdits[idx]?.error_type as string) ?? (msg.draft.error_type || '')}
                                      onChange={e => setDraftEdits(prev => ({ ...prev, [idx]: { ...prev[idx], error_type: e.target.value } }))}
                                      list={`error-${idx}`}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                    />
                                    <datalist id={`error-${idx}`}>
                                      {dictionary.error_type.map(item => <option key={item} value={item} />)}
                                    </datalist>
                                  </label>
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={async () => {
                                  try {
                                    await executeAction(msg.action!, draftEdits[idx] || msg.draft);
                                    setMessages(prev => [...prev, { role: 'assistant', content: '操作已完成。是否需要我继续安排下一步？' }]);
                                  } catch (error: any) {
                                    toast.error(error?.message || '执行失败');
                                  }
                                }}
                                className="rounded-xl bg-gray-900 px-3.5 py-1.5 text-[13px] font-medium text-white transition-all hover:bg-gray-800 hover:shadow-md active:scale-95"
                              >
                                确认执行
                              </button>
                              <span className="text-[10px] text-gray-400">
                                {msg.action.risk === 'high' ? '⚠️ 高风险动作' : '建议先确认再执行'}
                              </span>
                            </div>
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
          <div className="relative flex items-end gap-2 rounded-3xl border border-gray-200 bg-white p-1.5 shadow-sm transition-all duration-200 focus-within:border-indigo-400 focus-within:shadow-md focus-within:ring-4 focus-within:ring-indigo-50">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-3 py-1.5 text-[14px] text-gray-900 outline-none placeholder:text-gray-400"
              placeholder="继续追问..."
            />
            <button
              onClick={() => handleSend()}
              disabled={sending || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition-all hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none shadow-sm mb-0.5 mr-0.5 active:scale-95"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-gray-400">AI 可能会犯错，请结合实际情况参考。</p>
        </div>
      </div>
    </div>
  );
}
