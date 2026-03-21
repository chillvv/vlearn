import { useState, useEffect, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronRight, ChevronUp,
  Trash2, Edit2, BookOpen, Clock, BarChart2, Filter, X,
  Check, Eye, EyeOff, RotateCcw, Plus,
} from 'lucide-react';
import { questionsApi } from '../lib/api';
import { getSubjectColor, getErrorTagColor } from '../lib/subjects';
import type { Question } from '../lib/types';
import { ENGLISH_KNOWLEDGE_POINTS, PROGRAMMING_KNOWLEDGE_POINTS, ABILITIES, ERROR_TYPES } from '../lib/types';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { QuestionCard } from '../components/business/QuestionCard';

// ---- Inline edit modal ----
function EditModal({ question, onSave, onClose }: {
  question: Question;
  onSave: (q: Partial<Question>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ ...question });
  const currentKnowledgePoints = form.subject === '英语' ? ENGLISH_KNOWLEDGE_POINTS : 
                                 form.subject === 'C语言' ? PROGRAMMING_KNOWLEDGE_POINTS : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">编辑错题</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">学科</label>
              <select value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value, knowledge_point: '' })}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/30">
                <option value="英语">英语</option>
                <option value="C语言">C语言</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">能力维度</label>
              <select value={form.ability} onChange={e => setForm({ ...form, ability: e.target.value })}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/30">
                <option value="">选择能力维度</option>
                {ABILITIES.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">知识点</label>
              <select value={form.knowledge_point} onChange={e => setForm({ ...form, knowledge_point: e.target.value })}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/30">
                <option value="">选择知识点</option>
                {currentKnowledgePoints.map(kp => <option key={kp}>{kp}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">错误原因</label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {ERROR_TYPES.map(tag => (
                <button key={tag} onClick={() => setForm({ ...form, error_type: tag })}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${form.error_type === tag ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-400/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">题目</label>
            <textarea value={form.question_text} onChange={e => setForm({ ...form, question_text: e.target.value })}
              rows={3} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400/30" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">补充说明/解析</label>
            <textarea value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })}
              rows={4} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400/30" />
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 flex gap-3">
          <button onClick={() => onSave(form)} className="flex-1 h-11 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors">保存修改</button>
          <button onClick={onClose} className="h-11 px-6 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">取消</button>
        </div>
      </div>
    </div>
  );
}

// ---- Main page ----
export function QuestionBankPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedKnowledgePoint, setSelectedKnowledgePoint] = useState('');
  const [selectedErrorType, setSelectedErrorType] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'review'>('date');
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());

  const loadQuestions = () => {
    setLoading(true);
    questionsApi.getAll()
      .then(setQuestions)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadQuestions(); }, []);

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
    if (selectedErrorType) result = result.filter(q => q.error_type === selectedErrorType);

    result = [...result].sort((a, b) => {
      if (sortBy === 'review') return b.review_count - a.review_count;
      return b.created_at.localeCompare(a.created_at);
    });
    return result;
  }, [questions, search, selectedSubject, selectedKnowledgePoint, selectedErrorType, sortBy]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这道错题吗？')) return;
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

  const clearFilters = () => {
    setSearch(''); setSelectedSubject(''); setSelectedKnowledgePoint('');
    setSelectedErrorType('');
  };

  const hasFilters = search || selectedSubject || selectedKnowledgePoint || selectedErrorType;
  const activeKnowledgePoints = selectedSubject === '英语' ? ENGLISH_KNOWLEDGE_POINTS : 
                                selectedSubject === 'C语言' ? PROGRAMMING_KNOWLEDGE_POINTS : [];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 2xl:px-10">
      <div className="flex min-h-full flex-col gap-6 lg:flex-row">
        {editingQuestion && (
          <EditModal question={editingQuestion} onSave={handleEdit} onClose={() => setEditingQuestion(null)} />
        )}

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
                const kpList = name === '英语' ? ENGLISH_KNOWLEDGE_POINTS : PROGRAMMING_KNOWLEDGE_POINTS;
                
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

          {/* Error tag filter */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">错误原因</span>
            </div>
            <div className="p-3 space-y-1 max-h-60 overflow-y-auto">
              {ERROR_TYPES.map(tag => {
                const ec = getErrorTagColor(tag);
                const isActive = selectedErrorType === tag;
                const count = questions.filter(q => q.error_type === tag && (!selectedSubject || q.subject === selectedSubject)).length;
                if (!count) return null;
                return (
                  <button
                    key={tag}
                    onClick={() => setSelectedErrorType(isActive ? '' : tag)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs transition-all ${isActive ? `${ec.bg} ${ec.text} font-semibold` : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <span>{tag}</span>
                    <span className={`px-1.5 py-0.5 rounded-md font-medium ${isActive ? 'bg-white/60' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Search bar + sort */}
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
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-400/30 sm:w-auto"
            >
              <option value="date">最近添加</option>
              <option value="review">复习次数</option>
            </select>
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
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <BarChart2 className="w-3.5 h-3.5" />
              <span>总计 {questions.length} 题</span>
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
                  <p className="text-gray-400 text-sm mt-1">去草稿确认页添加你的第一道错题吧</p>
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
              {filtered.map(q => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  onDelete={handleDelete}
                  onEdit={setEditingQuestion}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
