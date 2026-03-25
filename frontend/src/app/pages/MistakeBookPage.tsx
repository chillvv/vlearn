import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { questionsApi } from '../lib/api';
import { getKnowledgePointsBySubject, type Question, type Subject } from '../lib/types';
import { BookOpen, Sparkles, ArrowRight, MoreHorizontal, Plus, Pencil, Trash2, X } from 'lucide-react';

import { getKnowledgeNodeMeta, registerCustomKnowledgeTaxonomy } from '../lib/knowledgeTaxonomy';
import { approveNewTags, getTagExtensionsSnapshot, removeTagExtension, renameTagExtension } from '../lib/copilot';
import { toast } from 'sonner';

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <button 
      onClick={onDelete} 
      onMouseLeave={() => setConfirming(false)} 
      className="text-[10px] bg-rose-500 text-white px-2 py-1 rounded-md font-bold hover:bg-rose-600 transition-colors shadow-sm"
    >
      删除?
    </button>
  ) : (
    <button 
      onClick={() => setConfirming(true)} 
      className="p-1 hover:bg-rose-50 hover:text-rose-600 text-gray-400 rounded-lg transition-colors"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

function InlineTagEditor({
  tags, onRename, onDelete, onAdd, onFinish, l2
}: {
  tags: string[], 
  onRename: (oldVal: string, newVal: string) => void,
  onDelete: (val: string) => void,
  onAdd: (val: string) => void,
  onFinish: () => void,
  l2: string
}) {
  const [newTag, setNewTag] = useState('');
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});

  return (
    <div className="w-full bg-indigo-50/40 rounded-2xl p-3 border border-indigo-100 space-y-3 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-indigo-800 flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5"/> 编辑「{l2}」下的标签</span>
        <button onClick={onFinish} className="text-[11px] bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-700 shadow-sm transition-all hover:-translate-y-0.5">完成编辑</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <div key={tag} className="flex items-center gap-1.5 bg-white border border-indigo-100 rounded-xl pl-3 pr-1.5 py-1.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
            <input 
              value={editingValues[tag] ?? tag} 
              onChange={e => setEditingValues({...editingValues, [tag]: e.target.value})}
              onBlur={() => {
                const newVal = editingValues[tag]?.trim();
                if (newVal && newVal !== tag) {
                  onRename(tag, newVal);
                  setEditingValues(prev => {
                    const next = {...prev};
                    delete next[tag];
                    return next;
                  });
                }
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="text-xs font-bold text-gray-700 outline-none w-20 bg-transparent"
            />
            <DeleteButton onDelete={() => onDelete(tag)} />
          </div>
        ))}
        <div className="flex items-center gap-1.5 bg-white border border-dashed border-indigo-200 rounded-xl px-3 py-1.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <Plus className="w-3.5 h-3.5 text-indigo-400" />
          <input 
            value={newTag} 
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newTag.trim()) {
                onAdd(newTag.trim());
                setNewTag('');
              }
            }}
            placeholder="输入新标签回车"
            className="text-xs font-medium text-gray-600 outline-none w-24 bg-transparent placeholder:text-gray-300"
          />
        </div>
      </div>
    </div>
  );
}

type NodeMap = Record<string, Question[]>;
type L2Map = Record<string, NodeMap>;
type CategoryMap = Record<string, L2Map>;

export function MistakeBookPage() {
  const navigate = useNavigate();
  const [subject, setSubject] = useState<Subject>('英语');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [tagVersion, setTagVersion] = useState(0);
  const insightNode = subject === '英语' ? '非谓语动词' : '指针';

  // Inline edit states
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [errorTriggered, setErrorTriggered] = useState(false);

  const [addingBranchTo, setAddingBranchTo] = useState<string | null>(null);
  const [editingL2, setEditingL2] = useState<string | null>(null); // "category|l2"

  useEffect(() => {
    void refreshQuestions();
  }, [subject]);

  async function refreshQuestions() {
    try {
      const result = await questionsApi.getAll({ subject });
      setQuestions(result);
    } catch (error: any) {
      toast.error(error?.message || '获取错题失败');
      setQuestions([]);
    }
  }

  const customKnowledgeTags = useMemo(() => {
    const all = getTagExtensionsSnapshot().knowledge_point || [];
    const base = getKnowledgePointsBySubject(subject);
    return all.filter(item => !base.includes(item));
  }, [subject, tagVersion]);

  const treeData = useMemo(() => {
    const map: CategoryMap = {};
    questions.forEach(item => {
      const meta = getKnowledgeNodeMeta(subject, item.knowledge_point);
      const category = meta.category;
      const l2 = meta.branch;
      const node = meta.node;
      if (!map[category]) map[category] = {};
      if (!map[category][l2]) map[category][l2] = {};
      if (!map[category][l2][node]) map[category][l2][node] = [];
      map[category][l2][node].push(item);
    });
    customKnowledgeTags.forEach(tag => {
      const meta = getKnowledgeNodeMeta(subject, tag);
      const category = meta.category;
      const l2 = meta.branch;
      const node = meta.node;
      if (!map[category]) map[category] = {};
      if (!map[category][l2]) map[category][l2] = {};
      if (!map[category][l2][node]) map[category][l2][node] = [];
    });
    return map;
  }, [questions, customKnowledgeTags, subject]);

  const executeRenameNodeTag = async (oldValue: string, nextValue: string) => {
    if (!nextValue || nextValue === oldValue) return;
    try {
      renameTagExtension('knowledge_point', oldValue, nextValue);
      const affected = questions.filter(item => item.knowledge_point === oldValue);
      for (const item of affected) {
        const meta = getKnowledgeNodeMeta(item.subject as Subject, nextValue);
        await questionsApi.update(item.id, { knowledge_point: nextValue, category: meta.category, ability: meta.branch, node: meta.node });
      }
      setTagVersion(prev => prev + 1);
      await refreshQuestions();
      toast.success('标签已修改');
    } catch (error: any) {
      toast.error(error?.message || '修改失败');
    }
  };

  const executeDeleteNodeTag = async (value: string) => {
    const affected = questions.filter(item => item.knowledge_point === value);
    try {
      removeTagExtension('knowledge_point', value);
      const fallback = getKnowledgePointsBySubject(subject)[0] || '时态';
      for (const item of affected) {
        const meta = getKnowledgeNodeMeta(item.subject as Subject, fallback);
        await questionsApi.update(item.id, { knowledge_point: fallback, category: meta.category, ability: meta.branch, node: meta.node });
      }
      setTagVersion(prev => prev + 1);
      await refreshQuestions();
      toast.success('标签已删除');
    } catch (error: any) {
      toast.error(error?.message || '删除失败');
    }
  };

  const totalQuestions = questions.length;
  const masteredQuestions = questions.filter(item => (item.mastery_level ?? 0) >= 80).length;
  const overallMastery = totalQuestions > 0 ? Math.round((masteredQuestions / totalQuestions) * 100) : 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] space-y-8 bg-[#F9FAFB] px-4 py-6 pb-20 sm:px-6 sm:py-8 lg:px-8 2xl:px-10">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">错题资产 (管理中心)</h1>
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-gray-500 mr-2">知识点枢纽视图</p>
          <button
            type="button"
            onClick={() => {
              setAddingCategory(true);
              setErrorTriggered(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 shadow-sm hover:border-indigo-300 hover:text-indigo-600 transition-all"
          >
            <Plus className="h-4 w-4" />
            新增大类
          </button>
        </div>
      </div>

      {addingCategory && (
        <div className="rounded-3xl border-2 border-dashed border-indigo-200 bg-indigo-50/30 p-6 flex flex-col gap-4 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2"><Plus className="w-4 h-4"/> 新增 {subject} 大类体系</h3>
            <button onClick={() => setAddingCategory(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <input 
              value={newCatName} 
              onChange={e=>setNewCatName(e.target.value)} 
              placeholder="1. 大类名称 (如: 语法)" 
              className={`flex-1 rounded-xl border ${newCatName.trim() === '' && errorTriggered ? 'border-rose-500 ring-2 ring-rose-100' : 'border-white'} bg-white/80 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm`} 
            />
            <input 
              value={newBranchName} 
              onChange={e=>setNewBranchName(e.target.value)} 
              placeholder="2. 首个分类 (如: 动词系统)" 
              className={`flex-1 rounded-xl border ${newBranchName.trim() === '' && errorTriggered ? 'border-rose-500 ring-2 ring-rose-100' : 'border-white'} bg-white/80 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm`} 
            />
            <input 
              value={newTagName} 
              onChange={e=>setNewTagName(e.target.value)} 
              placeholder="3. 首个标签 (如: 时态)" 
              className={`flex-1 rounded-xl border ${newTagName.trim() === '' && errorTriggered ? 'border-rose-500 ring-2 ring-rose-100' : 'border-white'} bg-white/80 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-sm`} 
            />
            <button onClick={() => {
              if(newCatName.trim() && newBranchName.trim() && newTagName.trim()) {
                try {
                  registerCustomKnowledgeTaxonomy(newTagName.trim(), newCatName.trim(), newBranchName.trim(), subject);
                  approveNewTags({ knowledge_point: [newTagName.trim()] });
                  setTagVersion(v => v + 1);
                  toast.success('大类与标签已创建');
                  setAddingCategory(false);
                  setNewCatName(''); setNewBranchName(''); setNewTagName('');
                  setErrorTriggered(false);
                } catch (err: any) { toast.error(err.message); }
              } else {
                setErrorTriggered(true);
                toast.error('请填写完整的大类、分类和标签名称');
              }
            }} className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 transition-colors">保存创建</button>
          </div>
        </div>
      )}

      {/* 1. Hero Section */}
      <section className="flex flex-col justify-between gap-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.02)] sm:p-6 xl:flex-row xl:items-center">
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="relative h-24 w-24 flex-shrink-0">
            <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="8" fill="none" className="text-gray-100" />
              <circle
                cx="50"
                cy="50"
                r="42"
                stroke="currentColor"
                strokeWidth="8"
                fill="none"
                strokeDasharray="264"
                strokeDashoffset={264 - (264 * overallMastery) / 100}
                className="text-indigo-600 transition-all duration-1000 ease-out"
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-black text-gray-900">{overallMastery}%</span>
            </span>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-bold tracking-wider text-indigo-600 uppercase">整体掌握程度</p>
            <h2 className="text-2xl font-extrabold text-gray-900">{subject} 错题学习看板</h2>
            <p className="text-sm text-gray-500 font-medium">
              总错题 <span className="text-gray-900 font-bold">{totalQuestions}</span> · 
              已掌握 <span className="text-emerald-600 font-bold">{masteredQuestions}</span> · 
              待攻克 <span className="text-rose-600 font-bold">{Math.max(totalQuestions - masteredQuestions, 0)}</span>
            </p>
          </div>
        </div>

        {/* AI Insight */}
        <div className="flex-1 max-w-md bg-gradient-to-br from-rose-50/80 to-orange-50/50 border border-rose-100/80 rounded-2xl p-5 flex items-start gap-4 shadow-[0_4px_12px_-4px_rgba(244,63,94,0.1)]">
          <div className="mt-0.5 text-rose-500">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-rose-800 mb-1.5 flex items-center gap-2">
              ⚠️ AI 核心洞察
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
              </span>
            </h3>
            <p className="text-sm text-rose-700/90 font-medium mb-4 leading-relaxed">
              警报：本周「非谓语动词」错误率飙升，建议优先处理！
            </p>
            <button
              type="button"
              onClick={() => navigate('/practice', { state: { preset: { subject, nodes: [insightNode], amount: 10, strategy: '攻坚' }, autoStart: true } })}
              className="text-xs font-bold bg-rose-500 text-white px-4 py-2 rounded-xl shadow-sm hover:bg-rose-600 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-1.5 w-fit"
            >
              立即去清零
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* 2. Subject Switcher */}
      <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.02)] sm:p-5">
        <p className="mb-3 text-sm font-bold text-gray-500 ml-1">学科切换</p>
        <div className="inline-flex flex-wrap rounded-2xl bg-gray-100/80 p-1.5">
          {(['英语', 'C语言'] as const).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setSubject(item)}
              className={`rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-300 sm:px-8 ${
                subject === item 
                  ? 'bg-white text-gray-900 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      {/* 3. Core Knowledge Tree Cards */}
      <section className="grid gap-4 sm:gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        {Object.entries(treeData).map(([category, l2Map]) => {
          const catItems = Object.values(l2Map).flatMap(nodes => Object.values(nodes).flat());
          let catMastery = catItems.length > 0
            ? Math.round(catItems.reduce((sum, item) => sum + (item.mastery_level ?? 0), 0) / catItems.length)
            : 0;
            
          // Mock data for empty/NaN
          if (isNaN(catMastery) || catMastery === 0) {
            catMastery = 45; 
          }

          return (
            <article key={category} className="space-y-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] transition-all duration-300 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.06)] sm:p-6">
              <div className="flex items-center justify-between border-b border-gray-100 pb-4 group/category">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">{category}</h2>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setAddingBranchTo(category)}
                    className="inline-flex items-center gap-1 rounded-lg border border-dashed border-gray-300 bg-transparent px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all opacity-0 group-hover/category:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新增分类
                  </button>
                  <div className="w-24">
                    <p className="text-right text-xs font-bold text-gray-500 mb-1.5">掌握度 <span className="text-indigo-600">{catMastery}%</span></p>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full bg-indigo-500 transition-all duration-1000 ease-out rounded-full" style={{ width: `${catMastery}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {addingBranchTo === category && (
                <div className="mt-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-4 flex flex-col gap-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-600">在「{category}」下新增分类</span>
                    <button onClick={() => setAddingBranchTo(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4"/></button>
                  </div>
                  <div className="flex gap-3">
                    <input id={`branch-input-${category}`} placeholder="分类名称 (如: 动词系统)" className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50" />
                    <input id={`tag-input-${category}`} placeholder="首个标签 (如: 时态)" className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50" />
                    <button onClick={() => {
                      const bVal = (document.getElementById(`branch-input-${category}`) as HTMLInputElement).value.trim();
                      const tVal = (document.getElementById(`tag-input-${category}`) as HTMLInputElement).value.trim();
                      if(bVal && tVal) {
                        try {
                          registerCustomKnowledgeTaxonomy(tVal, category, bVal, subject);
                          approveNewTags({ knowledge_point: [tVal] });
                          setTagVersion(v => v + 1);
                          toast.success('分类与标签已创建');
                          setAddingBranchTo(null);
                        } catch(e:any) { toast.error(e.message); }
                      } else toast.error('请填写完整');
                    }} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black transition-colors shadow-sm">保存创建</button>
                  </div>
                </div>
              )}
              
              <div className="space-y-5">
                {Object.entries(l2Map).map(([l2, nodes]) => {
                  
                  
                  const nodesArray = Object.entries(nodes).map(([node, list]) => {
                    const pending = list.filter(item => (item.mastery_level ?? 0) < 80).length;
                    let status = 'green';
                    let priority = 3;
                    if (list.length === 0) {
                      status = 'orange';
                      priority = 2;
                    } else if (pending > 5) {
                      status = 'red';
                      priority = 1;
                    } else if (pending >= 1) {
                      status = 'orange';
                      priority = 2;
                    }
                    return { node, list, pending, status, priority };
                  });

                  nodesArray.sort((a, b) => a.priority - b.priority);

                  const isEditing = editingL2 === `${category}|${l2}`;

                  return (
                    <div key={l2} className="space-y-3">
                      <div className="flex items-center justify-between gap-2 group/l2">
                        <div className="flex items-center gap-2">
                          <p className="inline-block rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-500">{l2}</p>
                          {!isEditing && (
                            <button
                              type="button"
                              onClick={() => setEditingL2(`${category}|${l2}`)}
                              className="opacity-0 group-hover/l2:opacity-100 p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all"
                              title="管理标签"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {isEditing ? (
                        <InlineTagEditor 
                          l2={l2} 
                          tags={nodesArray.map(n => n.node)} 
                          onRename={executeRenameNodeTag} 
                          onDelete={executeDeleteNodeTag} 
                          onAdd={(tag) => {
                             try {
                               registerCustomKnowledgeTaxonomy(tag, category, l2, subject);
                               approveNewTags({ knowledge_point: [tag] });
                               setTagVersion(v => v + 1);
                             } catch (e:any) { toast.error(e.message); }
                          }}
                          onFinish={() => setEditingL2(null)} 
                        />
                      ) : (
                        <div className="flex flex-wrap gap-2.5">
                          {nodesArray.map(({ node, status, list }) => {
                            let buttonClasses = '';
                            if (list.length === 0) {
                              buttonClasses = 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100';
                            } else if (status === 'red') {
                              buttonClasses = 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100';
                            } else if (status === 'orange') {
                              buttonClasses = 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100';
                            } else {
                              buttonClasses = 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
                            }

                            return (
                              <button
                                key={node}
                                type="button"
                                onClick={() => navigate(`/questions/node?subject=${encodeURIComponent(subject)}&category=${encodeURIComponent(category)}&l2=${encodeURIComponent(l2)}&node=${encodeURIComponent(node)}`, { state: { subject, category, l2, node } })}
                                className={`inline-flex items-center px-3 py-1.5 rounded-xl border text-xs font-bold transition-all duration-200 shadow-sm hover:-translate-y-0.5 ${buttonClasses}`}
                              >
                                {node}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>

    </main>
  );
}
