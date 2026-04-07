import { useState, useEffect, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronRight,
  Edit2, BookOpen, BarChart2, Filter, X,
  Plus, Save
} from 'lucide-react';
import { questionsApi } from '../lib/api';
import { getSubjectColor } from '../lib/subjects';
import { getKnowledgePointsBySubject, type Question } from '../lib/types';
import { approveNewTags, getCanonicalTagDictionary, getTagExtensionsSnapshot, hydrateTagExtensionsFromCloud, removeTagExtension, renameTagExtension } from '../lib/copilot';
import { useConfirm } from '../components/business/ConfirmProvider';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router';
import { QuestionCard } from '../components/business/QuestionCard';
import { getKnowledgeNodeMeta, getKnowledgePointsBySubjectFromTaxonomy, hydrateTaxonomyOverridesFromCloud, inferKnowledgeNodeMetaForNewTag, isKnowledgePointInSubjectTaxonomy, registerCustomKnowledgeTaxonomy, removeCustomKnowledgeTaxonomy, renameCustomKnowledgeTaxonomy } from '../lib/knowledgeTaxonomy';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { resolveCanonicalMistakeId, resolveCanonicalNodeId } from '../lib/entityIds';

const SELECT_EMPTY_VALUE = '__empty__';

// ---- Inline Delete Button ----
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <button 
      onClick={(e) => { e.stopPropagation(); onDelete(); }} 
      onMouseLeave={() => setConfirming(false)} 
      className="text-[10px] bg-rose-500 text-white px-2 py-0.5 rounded font-bold hover:bg-rose-600 transition-colors shadow-sm"
    >
      确认?
    </button>
  ) : (
    <button 
      onClick={(e) => { e.stopPropagation(); setConfirming(true); }} 
      className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-100"
    >
      删除
    </button>
  );
}

// ---- Inline Question Editor ----
function InlineQuestionEditor({ question, onSave, onClose }: {
  question: Question;
  onSave: (q: Partial<Question>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ ...question });
  const currentKnowledgePoints = getKnowledgePointsBySubjectFromTaxonomy(form.subject as '英语' | 'C语言');

  return (
    <div className="bg-indigo-50/30 rounded-2xl border-2 border-dashed border-indigo-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2"><Edit2 className="w-4 h-4"/> 内联编辑错题</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">学科</label>
          <Select 
            value={form.subject} 
            onValueChange={(val: any) => setForm({ ...form, subject: val, knowledge_point: '' })}
          >
            <SelectTrigger className="w-full h-10 border-white bg-white/80 rounded-xl px-3 text-sm focus:ring-indigo-400 shadow-sm">
              <SelectValue placeholder="选择学科" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="英语">英语</SelectItem>
              <SelectItem value="C语言">C语言</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">知识点</label>
          <Select 
            value={form.knowledge_point || SELECT_EMPTY_VALUE} 
            onValueChange={(val: any) => {
              if (val === SELECT_EMPTY_VALUE) {
                setForm({ ...form, knowledge_point: '', category: '', node: '' });
                return;
              }
              const meta = getKnowledgeNodeMeta(form.subject as any, val);
              setForm({ ...form, knowledge_point: val, category: meta.category, node: meta.node });
            }}
          >
            <SelectTrigger className="w-full h-10 border-white bg-white/80 rounded-xl px-3 text-sm focus:ring-indigo-400 shadow-sm">
              <SelectValue placeholder="选择知识点" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELECT_EMPTY_VALUE}>选择知识点</SelectItem>
              {currentKnowledgePoints.map(kp => <SelectItem key={kp} value={kp}>{kp}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">题目</label>
        <textarea value={form.question_text} onChange={e => setForm({ ...form, question_text: e.target.value })}
          rows={3} className="w-full text-sm border border-white bg-white/80 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 shadow-sm" />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">补充说明/解析</label>
        <textarea value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })}
          rows={3} className="w-full text-sm border border-white bg-white/80 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 shadow-sm" />
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={() => onSave(form)} className="flex-1 flex items-center justify-center gap-2 h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm">
          <Save className="w-4 h-4" /> 保存修改
        </button>
        <button onClick={onClose} className="h-10 px-6 border-2 border-white bg-white/50 text-gray-600 rounded-xl text-sm font-medium hover:bg-white transition-colors">取消</button>
      </div>
    </div>
  );
}

// ---- Main page ----
export function QuestionBankPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [dictionaryVersion, setDictionaryVersion] = useState(0);
  const dictionary = useMemo(() => getCanonicalTagDictionary(), [dictionaryVersion]);
  const [search, setSearch] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedKnowledgePoint, setSelectedKnowledgePoint] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'review'>('date');
  const [archiveView, setArchiveView] = useState<'active' | 'archived'>('active');
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<{ type: 'knowledge_point', value: string } | null>(null);
  const [editingTagValue, setEditingTagValue] = useState('');
  
  // Batch mode state
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadQuestions = () => {
    setLoading(true);
    const query = archiveView === 'archived'
      ? { onlyArchived: true as const }
      : {};
    questionsApi.getAll(query)
      .then(setQuestions)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadQuestions();
  }, [archiveView]);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        hydrateTagExtensionsFromCloud(),
        hydrateTaxonomyOverridesFromCloud(),
      ]);
      setDictionaryVersion(prev => prev + 1);
    })();
  }, []);

  const toggleSubjectExpand = (subject: string) => {
    setExpandedSubjects(prev => {
      const next = new Set(prev);
      if (next.has(subject)) next.delete(subject);
      else next.add(subject);
      return next;
    });
  };

  // Subject counts
  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    questions.forEach(q => { counts[q.subject] = (counts[q.subject] || 0) + 1; });
    return counts;
  }, [questions]);

  // Filtered & sorted questions
  const filtered = useMemo(() => {
    let result = questions;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(q => q.question_text.toLowerCase().includes(s) || q.knowledge_point?.toLowerCase().includes(s));
    }
    if (selectedSubject) result = result.filter(q => q.subject === selectedSubject);
    if (selectedKnowledgePoint) result = result.filter(q => q.knowledge_point === selectedKnowledgePoint);

    result = [...result].sort((a, b) => {
      if (sortBy === 'review') return b.review_count - a.review_count;
      return b.created_at.localeCompare(a.created_at);
    });
    return result;
  }, [questions, search, selectedSubject, selectedKnowledgePoint, sortBy]);

  const handleDelete = async (id: string) => {
    try {
      await questionsApi.delete(id);
      setQuestions(prev => prev.filter(q => q.id !== id));
      toast.success('已删除');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleEdit = async (updates: Partial<Question>) => {
    if (!editingQuestion) return;
    try {
      const updated = await questionsApi.update(editingQuestion.id, updates);
      setQuestions(prev => prev.map(q => q.id === editingQuestion.id ? updated : q));
      setEditingQuestion(null);
      toast.success('修改已保存');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleToggleArchive = async (question: Question) => {
    try {
      const archived = Boolean(question.is_archived || question.mastery_state === 'archived');
      const updated = archived
        ? await questionsApi.unarchive(question.id)
        : await questionsApi.archive(question.id);
      setQuestions(prev => prev.map(q => q.id === question.id ? updated : q));
      if (archiveView === 'active' && !archived) {
        setQuestions(prev => prev.filter(q => q.id !== question.id));
      }
      if (archiveView === 'archived' && archived) {
        setQuestions(prev => prev.filter(q => q.id !== question.id));
      }
      toast.success(archived ? '已取消归档' : '已归档');
    } catch (err: any) {
      toast.error(err.message || '归档操作失败');
    }
  };

  const clearFilters = () => {
    setSearch(''); setSelectedSubject(''); setSelectedKnowledgePoint('');
  };

  const selectedTagSubject = (selectedSubject || '英语') as '英语' | 'C语言';
  const baseKnowledgeTags = getKnowledgePointsBySubjectFromTaxonomy(selectedTagSubject);
  const extensions = getTagExtensionsSnapshot();
  const customKnowledgeTags = (extensions.knowledge_point || []).filter(item => (
    !baseKnowledgeTags.includes(item) && isKnowledgePointInSubjectTaxonomy(selectedTagSubject, item)
  ));

  const addCustomTag = async () => {
    try {
      const value = newTagName.trim();
      if (!value) return;
      if (isKnowledgePointInSubjectTaxonomy(selectedTagSubject, value)) {
        toast.info('该知识点标签已存在');
        return;
      }
      const inferredMeta = inferKnowledgeNodeMetaForNewTag(selectedTagSubject, value);
      await registerCustomKnowledgeTaxonomy(value, inferredMeta.category, inferredMeta.branch, selectedTagSubject);
      approveNewTags({ knowledge_point: [value] });
      setNewTagName('');
      setDictionaryVersion(prev => prev + 1);
      toast.success('标签已添加');
    } catch (err: any) {
      toast.error(err?.message || '标签添加失败');
    }
  };

  const executeRenameCustomTag = async (type: 'knowledge_point', oldValue: string, nextValue: string) => {
    if (!nextValue || nextValue === oldValue) return;
    try {
      renameTagExtension(type, oldValue, nextValue);
      if (type === 'knowledge_point') {
        await renameCustomKnowledgeTaxonomy(oldValue, nextValue, selectedTagSubject);
      }
      const affected = questions.filter(item => item.knowledge_point === oldValue);
      for (const item of affected) {
        const meta = getKnowledgeNodeMeta(item.subject as any, nextValue);
        await questionsApi.update(item.id, { knowledge_point: nextValue, category: meta.category, node: meta.node });
      }
      setQuestions(prev => prev.map(item => {
        if (item.knowledge_point === oldValue) {
          const meta = getKnowledgeNodeMeta(item.subject as any, nextValue);
          return { ...item, knowledge_point: nextValue, category: meta.category, node: meta.node };
        }
        return item;
      }));
      setDictionaryVersion(prev => prev + 1);
      toast.success('标签已重命名');
    } catch (err: any) {
      toast.error(err?.message || '标签重命名失败');
    }
  };

  const executeDeleteCustomTag = async (type: 'knowledge_point', value: string) => {
    const affected = questions.filter(item => item.knowledge_point === value);
    
    if (affected.length > 0) {
      const confirmed = await confirm({
        title: '删除标签',
        description: `该标签下包含 ${affected.length} 道错题。删除后会自动转入默认标签，不会删除题目，确定继续吗？`,
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

    try {
      removeTagExtension(type, value);
      if (type === 'knowledge_point') {
        await removeCustomKnowledgeTaxonomy(value, selectedTagSubject);
      }
      
      if (affected.length > 0) {
        const updatedRows = await Promise.all(affected.map(async (item) => {
          const fallback = getKnowledgePointsBySubjectFromTaxonomy(item.subject as '英语' | 'C语言')[0]
            || getKnowledgePointsBySubject(item.subject as '英语' | 'C语言')[0]
            || value;
          const meta = getKnowledgeNodeMeta(item.subject as '英语' | 'C语言', fallback);
          return questionsApi.update(item.id, {
            knowledge_point: fallback,
            category: meta.category,
            node: meta.node,
          });
        }));
        setQuestions(prev => prev.map(item => updatedRows.find(row => row.id === item.id) || item));
      }
      
      setDictionaryVersion(prev => prev + 1);
      toast.success('标签已删除，相关错题已转入默认标签');
    } catch (err: any) {
      toast.error(err?.message || '标签删除失败');
    }
  };

  const handleToggleBatchMode = () => {
    setIsBatchMode(prev => !prev);
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({
      title: '删除题目',
      description: `确定要删除选定的 ${selectedIds.size} 道题目吗？`,
      tone: 'danger',
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const idsArray = Array.from(selectedIds);
      // Wait for all delete operations to complete
      await Promise.all(idsArray.map(id => questionsApi.delete(id)));
      toast.success(`成功删除 ${idsArray.length} 道题目`);
      setQuestions(prev => prev.filter(q => !selectedIds.has(q.id)));
      setSelectedIds(new Set());
      setIsBatchMode(false);
    } catch (err: any) {
      toast.error(`批量删除失败: ${err.message}`);
    } finally {
      setLoading(false);
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

  const hasFilters = search || selectedSubject || selectedKnowledgePoint;
  const selectedQuestions = useMemo(
    () => filtered.filter((question) => selectedIds.has(question.id)),
    [filtered, selectedIds],
  );
  const selectedCompareNodeIds = useMemo(
    () => Array.from(new Set(selectedQuestions.map((question) => resolveCanonicalNodeId(question)).filter(Boolean))),
    [selectedQuestions],
  );
  const canCompareSelected = selectedQuestions.length >= 2 && selectedCompareNodeIds.length === 1;
  const currentNodeQuestion = useMemo(() => {
    if (selectedKnowledgePoint) {
      return filtered.find((question) => question.knowledge_point === selectedKnowledgePoint) || null;
    }
    return null;
  }, [filtered, selectedKnowledgePoint]);

  const openNodeHub = (question: Question, input: { aiInitialAsk: string; activeQuestionId?: string | null; activeQuestionIds?: string[] }) => {
    const nodeName = String(question.node || question.knowledge_point || '').trim();
    if (!nodeName) {
      toast.error('当前题目缺少知识点节点，无法打开小管家');
      return;
    }
    const params = new URLSearchParams();
    params.set('subject', question.subject);
    if (question.category) params.set('category', question.category);
    params.set('node', nodeName);
    navigate({
      pathname: '/questions/node',
      search: `?${params.toString()}`,
    }, {
      state: {
        subject: question.subject,
        category: question.category,
        node: nodeName,
        aiInitialAsk: input.aiInitialAsk,
        activeQuestionId: input.activeQuestionId ?? null,
        activeQuestionIds: input.activeQuestionIds,
      },
    });
  };

  const handleAskQuestion = (question: Question) => {
    const mistakeId = resolveCanonicalMistakeId(question);
    openNodeHub(question, {
      aiInitialAsk: `问这题：${question.question_text.slice(0, 24)}`,
      activeQuestionId: mistakeId,
      activeQuestionIds: [mistakeId],
    });
  };

  const handleOrganizeKnowledgeNode = () => {
    if (!currentNodeQuestion) {
      toast.info('请先筛选到一个明确的知识点，再打开小管家');
      return;
    }
    openNodeHub(currentNodeQuestion, {
      aiInitialAsk: '整理这个知识点',
      activeQuestionId: null,
    });
  };

  const handleCompareSelected = () => {
    if (selectedQuestions.length < 2) {
      toast.info('请至少选择两道题再比较');
      return;
    }
    if (!canCompareSelected) {
      toast.error('“比较这几题”当前只支持同一知识点节点内的多题比较');
      return;
    }
    const firstQuestion = selectedQuestions[0];
    openNodeHub(firstQuestion, {
      aiInitialAsk: '比较这几题',
      activeQuestionId: null,
      activeQuestionIds: selectedQuestions.map((question) => resolveCanonicalMistakeId(question)),
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 2xl:px-10">
      <div className="flex min-h-full flex-col gap-6 lg:flex-row">
        {/* Left sidebar */}
        <aside className="w-full flex-shrink-0 space-y-3 lg:w-64">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">科目筛选</span>
            </div>
            <div className="p-2">
              <button
                onClick={() => { setSelectedSubject(''); setSelectedKnowledgePoint(''); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors ${!selectedSubject ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <span>全部科目</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${!selectedSubject ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>{questions.length}</span>
              </button>

              {['英语', 'C语言'].filter(s => subjectCounts[s]).map((name) => {
                const sc = getSubjectColor(name);
                const isSelected = selectedSubject === name;
                const isExpanded = expandedSubjects.has(name);
                const kpList = dictionary.knowledge_point.filter(tag => (
                  getKnowledgePointsBySubjectFromTaxonomy(name as '英语' | 'C语言').includes(tag)
                  || (extensions.knowledge_point || []).includes(tag)
                ));
                
                return (
                  <div key={name}>
                    <button
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors ${isSelected ? `${sc.light} ${sc.text} font-medium` : 'text-gray-600 hover:bg-gray-50'}`}
                      onClick={() => {
                        if (isSelected) { setSelectedSubject(''); setSelectedKnowledgePoint(''); }
                        else { setSelectedSubject(name); setSelectedKnowledgePoint(''); }
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span>{name}</span>
                      </span>
                      <div className="flex items-center gap-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${isSelected ? `${sc.bg} ${sc.text}` : 'bg-gray-100 text-gray-500'}`}>{subjectCounts[name]}</span>
                        <button onClick={e => { e.stopPropagation(); toggleSubjectExpand(name); }} className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600">
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      </div>
                    </button>
                    {isExpanded && isSelected && kpList.map(kp => (
                      <button
                        key={kp}
                        onClick={() => setSelectedKnowledgePoint(selectedKnowledgePoint === kp ? '' : kp)}
                        className={`w-full flex items-center px-3 py-1.5 pl-9 rounded-xl text-xs transition-colors ${selectedKnowledgePoint === kp ? `${sc.light} ${sc.text} font-medium` : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        <span className="w-1 h-1 rounded-full bg-gray-300 mr-2 flex-shrink-0" />
                        {kp}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">标签管理</span>
            </div>
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  placeholder="输入标签名"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void addCustomTag();
                    }
                  }}
                  className="h-8 flex-1 rounded-lg border border-gray-200 px-2 text-xs outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="button"
                  onClick={addCustomTag}
                  className="h-8 rounded-lg bg-gray-900 px-2.5 text-xs font-semibold text-white hover:bg-black"
                >
                  新增
                </button>
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {customKnowledgeTags.map(item => {
                  const isEditing = editingTag?.type === 'knowledge_point' && editingTag?.value === item;
                  return isEditing ? (
                    <div key={item} className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-2 py-1.5">
                      <input
                        value={editingTagValue}
                        onChange={e => setEditingTagValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            executeRenameCustomTag('knowledge_point', item, editingTagValue.trim());
                            setEditingTag(null);
                          } else if (e.key === 'Escape') {
                            setEditingTag(null);
                          }
                        }}
                        onBlur={() => {
                          executeRenameCustomTag('knowledge_point', item, editingTagValue.trim());
                          setEditingTag(null);
                        }}
                        autoFocus
                        className="flex-1 min-w-0 bg-white border border-indigo-100 rounded text-xs px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-indigo-300"
                      />
                    </div>
                  ) : (
                    <div key={item} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5 group/tag">
                      <span className="truncate text-xs text-gray-700">{item}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover/tag:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTag({ type: 'knowledge_point', value: item });
                            setEditingTagValue(item);
                          }}
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          修改
                        </button>
                        <DeleteButton onDelete={() => executeDeleteCustomTag('knowledge_point', item)} />
                      </div>
                    </div>
                  );
                })}
                {customKnowledgeTags.length === 0 && (
                  <p className="text-[11px] text-gray-400 py-1">暂无自定义标签</p>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Search bar & sort */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索题目、考点、知识点..."
                className="w-full h-11 pl-10 pr-4 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-300 shadow-sm placeholder:text-gray-400"
              />
            </div>
            <Select value={sortBy} onValueChange={(val: any) => setSortBy(val)}>
              <SelectTrigger className="h-11 rounded-xl border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm cursor-pointer focus:ring-indigo-400/30 sm:w-[120px]">
                <SelectValue placeholder="排序方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">最近添加</SelectItem>
                <SelectItem value="review">复习次数</SelectItem>
              </SelectContent>
            </Select>
            <Select value={archiveView} onValueChange={(val: any) => setArchiveView(val)}>
              <SelectTrigger className="h-11 rounded-xl border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm cursor-pointer focus:ring-indigo-400/30 sm:w-[120px]">
                <SelectValue placeholder="筛选状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">当前</SelectItem>
                <SelectItem value="archived">已归档</SelectItem>
              </SelectContent>
            </Select>
            <Link to="/draft-review" className="sm:w-auto">
              <button className="h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition-colors hover:bg-indigo-700 sm:w-auto flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" />
                添加错题
              </button>
            </Link>
          </div>

          {/* Filter pills + count */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-500">
                共 <span className="font-semibold text-gray-900">{filtered.length}</span> 道错题
              </span>
              {hasFilters && (
                <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors font-medium">
                  <X className="w-3 h-3" />清除筛选
                </button>
              )}
              {selectedKnowledgePoint && (
                <button
                  onClick={handleOrganizeKnowledgeNode}
                  className="flex items-center gap-1 text-xs text-violet-700 hover:text-violet-800 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-lg transition-colors font-medium"
                >
                  整理这个知识点
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isBatchMode ? (
                <>
                  <span className="text-xs text-indigo-600 font-medium">
                    已选 {selectedIds.size} 项
                  </span>
                  <button
                    onClick={() => {
                      const allIds = filtered.map(q => q.id);
                      if (selectedIds.size === allIds.length) {
                        setSelectedIds(new Set());
                      } else {
                        setSelectedIds(new Set(allIds));
                      }
                    }}
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    全选
                  </button>
                  <button
                    onClick={handleCompareSelected}
                    disabled={selectedIds.size < 2}
                    className="flex items-center gap-1 text-xs text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:bg-violet-100/60 disabled:text-violet-300 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    比较这几题
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
                </>
              ) : (
                <button
                  onClick={handleToggleBatchMode}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                >
                  批量管理
                </button>
              )}
              <div className="w-px h-3 bg-gray-200 hidden sm:block" />
              <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400">
                <BarChart2 className="w-3.5 h-3.5" />
                <span>总计 {questions.length} 题</span>
              </div>
            </div>
          </div>

          {/* Questions list */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
              <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              {questions.length === 0 ? (
                <>
                  <p className="text-gray-600 font-medium text-base">错题库还是空的</p>
                  <p className="text-gray-400 text-sm mt-1">去 AI 管家添加你的第一道错题吧</p>
                  <Link to="/draft-review">
                    <button className="mt-5 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm">
                      去添加错题
                    </button>
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-gray-600 font-medium">没有找到匹配的错题</p>
                  <button onClick={clearFilters} className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium">清除筛选条件</button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(q => editingQuestion?.id === q.id ? (
                <InlineQuestionEditor
                  key={q.id}
                  question={editingQuestion}
                  onSave={handleEdit}
                  onClose={() => setEditingQuestion(null)}
                />
              ) : (
                <QuestionCard
                  key={q.id}
                  question={q}
                  onDelete={handleDelete}
                  onEdit={setEditingQuestion}
                  onToggleArchive={handleToggleArchive}
                  onAskQuestion={handleAskQuestion}
                  selectable={isBatchMode}
                  selected={selectedIds.has(q.id)}
                  onSelect={(selected) => handleSelectQuestion(q.id, selected)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
