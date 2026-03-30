import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { questionsApi, userLearningStateApi } from '../lib/api';
import { getKnowledgePointsBySubject, type Question, type Subject } from '../lib/types';
import { BookOpen, Sparkles, ArrowRight, Plus, Pencil, Trash2, X, Download, TriangleAlert } from 'lucide-react';

import { getKnowledgeNodeMeta, hydrateTaxonomyOverridesFromCloud, registerCustomKnowledgeTaxonomy, removeCustomKnowledgeTaxonomy, renameCustomKnowledgeTaxonomy, isKnowledgePointInSubjectTaxonomy } from '../lib/knowledgeTaxonomy';
import { approveNewTags, getTagExtensionsSnapshot, hydrateTagExtensionsFromCloud, removeTagExtension, renameTagExtension } from '../lib/copilot';
import { getLearningSyncSnapshot, subscribeLearningSyncSnapshot, type LearningSyncSnapshot } from '../lib/learningSyncStatus';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';

function formatRelativeTime(timestamp: number, now: number) {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60 * 1000) return '刚刚';
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  return `${Math.round(ms)}ms`;
}

const PERF_WARN_THRESHOLD_MS = 800;
const PERF_EVENT_KEY = 'mistake_book_perf_events_v1';

type PerfEvent = {
  type: 'load' | 'tree' | 'batch';
  ms: number;
  at: number;
};

type WeeklyPerfReport = {
  slowTotal: number;
  loadSlow: number;
  treeSlow: number;
  batchSlow: number;
  loadP95: number;
  treeP95: number;
  batchP95: number;
};

function readPerfEvents(): PerfEvent[] {
  try {
    const raw = window.localStorage.getItem(PERF_EVENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PerfEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendPerfEvent(event: PerfEvent) {
  const horizon = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const events = readPerfEvents()
    .filter((item) => item.at >= horizon)
    .slice(-199);
  events.push(event);
  window.localStorage.setItem(PERF_EVENT_KEY, JSON.stringify(events));
  
  // Async upload to cloud telemetry
  questionsApi.submitPerfTelemetry({
    eventType: event.type,
    latencyMs: Math.round(event.ms),
  }).catch(() => {
    // silently fail
  });
  
  return events;
}

function getP95(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] || 0;
}

function buildWeeklyPerfReport(events: PerfEvent[]): WeeklyPerfReport {
  const slowEvents = events.filter((item) => item.ms >= PERF_WARN_THRESHOLD_MS);
  const loadValues = events.filter((item) => item.type === 'load').map((item) => item.ms);
  const treeValues = events.filter((item) => item.type === 'tree').map((item) => item.ms);
  const batchValues = events.filter((item) => item.type === 'batch').map((item) => item.ms);
  return {
    slowTotal: slowEvents.length,
    loadSlow: slowEvents.filter((item) => item.type === 'load').length,
    treeSlow: slowEvents.filter((item) => item.type === 'tree').length,
    batchSlow: slowEvents.filter((item) => item.type === 'batch').length,
    loadP95: getP95(loadValues),
    treeP95: getP95(treeValues),
    batchP95: getP95(batchValues),
  };
}

function DeleteButton({ onDelete, className }: { onDelete: () => void, className?: string }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <button 
      onClick={onDelete} 
      onMouseLeave={() => setConfirming(false)} 
      className={`text-[10px] bg-rose-500 text-white px-1.5 py-0.5 rounded font-bold hover:bg-rose-600 transition-colors shadow-sm ${className || ''}`}
    >
      删除?
    </button>
  ) : (
    <button 
      onClick={() => setConfirming(true)} 
      className={`p-0.5 hover:bg-rose-50 hover:text-rose-600 text-gray-400 rounded transition-colors ${className || ''}`}
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

function EditableTag({ 
  node, 
  buttonClasses, 
  onRename, 
  onDelete, 
  onDragStart 
}: { 
  node: string, 
  buttonClasses: string, 
  onRename: (newVal: string) => void, 
  onDelete: () => void,
  onDragStart: (e: React.DragEvent) => void
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(node);

  return (
    <div 
      draggable={!editing}
      onDragStart={onDragStart}
      className={`inline-flex items-center gap-1 pl-3 pr-1 py-1.5 rounded-xl border text-xs font-bold transition-all duration-200 shadow-sm ring-2 ring-indigo-400/50 ring-offset-1 ${editing ? 'cursor-text' : 'cursor-move'} ${buttonClasses}`}
    >
      {editing ? (
        <input 
          autoFocus
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (val.trim() && val.trim() !== node) onRename(val.trim());
            else setVal(node);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setVal(node);
              setEditing(false);
            }
          }}
          className="bg-transparent outline-none text-xs font-bold"
          style={{ width: `${Math.max(2, val.length * 1.2)}em` }}
        />
      ) : (
        <span 
          onClick={() => setEditing(true)} 
          className="py-0.5 hover:opacity-80"
          title="点击编辑标签名称"
        >
          {node}
        </span>
      )}
      <div className="w-[1px] h-3 bg-black/10 mx-0.5" />
      <DeleteButton onDelete={onDelete} />
    </div>
  );
}

function AddTagBox({ onAdd }: { onAdd: (tag: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div className="inline-flex items-center gap-1 pl-2.5 pr-3 py-1.5 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 text-xs font-bold transition-all shadow-sm focus-within:ring-2 focus-within:ring-indigo-400/50 focus-within:bg-white hover:bg-white">
      <Plus className="w-3.5 h-3.5 text-indigo-400" />
      <input 
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && val.trim()) {
            onAdd(val.trim());
            setVal('');
          }
        }}
        placeholder="新增标签..."
        className="bg-transparent outline-none text-xs font-bold placeholder:text-indigo-300 placeholder:font-medium text-indigo-700 min-w-[60px]"
        style={{ width: val ? `${Math.max(4, val.length * 1.2)}em` : '60px' }}
      />
    </div>
  );
}

type NodeMap = Record<string, Question[]>;
type L2Map = Record<string, NodeMap>;
type CategoryMap = Record<string, L2Map>;

function AddL2Box({ category, subject, setTagVersion }: { category: string, subject: string, setTagVersion: React.Dispatch<React.SetStateAction<number>> }) {
  const [bVal, setBVal] = useState('');
  const [tVal, setTVal] = useState('');

  const handleSave = () => {
    if (bVal.trim() && tVal.trim()) {
      try {
        registerCustomKnowledgeTaxonomy(tVal.trim(), category, bVal.trim(), subject as any);
        approveNewTags({ knowledge_point: [tVal.trim()] });
        setTagVersion(v => v + 1);
        setBVal('');
        setTVal('');
        toast.success('分类与标签已创建');
      } catch(e:any) { toast.error(e.message); }
    } else if (bVal.trim() || tVal.trim()) {
      toast.error('分类名称和首个标签都必须填写');
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-indigo-200 bg-indigo-50/30 px-3 py-1 text-xs font-bold text-gray-500">
          <Plus className="w-3.5 h-3.5 text-indigo-400" />
          <input 
            value={bVal}
            onChange={e => setBVal(e.target.value)}
            placeholder="新增分类名称..."
            className="bg-transparent outline-none w-28 text-gray-700 placeholder:text-indigo-300"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5 min-h-[40px] p-1.5 -m-1.5 rounded-xl border-2 border-transparent">
        <div className="inline-flex items-center gap-1 pl-2.5 pr-3 py-1.5 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 text-xs font-bold transition-all shadow-sm focus-within:ring-2 focus-within:ring-indigo-400/50 focus-within:bg-white hover:bg-white">
          <Plus className="w-3.5 h-3.5 text-indigo-400" />
          <input 
            value={tVal}
            onChange={e => setTVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleSave();
              }
            }}
            placeholder="输入首个标签后回车保存"
            className="bg-transparent outline-none text-xs font-bold placeholder:text-indigo-300 placeholder:font-medium text-indigo-700 min-w-[140px]"
            style={{ width: tVal ? `${Math.max(10, tVal.length * 1.2)}em` : '140px' }}
          />
        </div>
      </div>
    </div>
  );
}

export function MistakeBookPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState<Subject>('英语');
  const [tagVersion, setTagVersion] = useState(0);
  const [syncSnapshot, setSyncSnapshot] = useState<LearningSyncSnapshot>(getLearningSyncSnapshot());
  const [timeNow, setTimeNow] = useState(Date.now());
  const [lastLoadMs, setLastLoadMs] = useState(0);
  const [lastBatchMs, setLastBatchMs] = useState(0);
  const [weeklyPerfReport, setWeeklyPerfReport] = useState<WeeklyPerfReport>({
    slowTotal: 0,
    loadSlow: 0,
    treeSlow: 0,
    batchSlow: 0,
    loadP95: 0,
    treeP95: 0,
    batchP95: 0,
  });
  const insightNode = subject === '英语' ? '非谓语动词' : '指针';
  const warnSnapshotRef = useRef({ load: 0, tree: 0, batch: 0 });

  // Inline edit states
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [errorTriggered, setErrorTriggered] = useState(false);

  const [isGlobalEditing, setIsGlobalEditing] = useState(false);
  const [renamingL2, setRenamingL2] = useState<string | null>(null); // "category|l2"
  const questionsQuery = useQuery({
    queryKey: queryKeys.questionsList({ subject }),
    queryFn: () => questionsApi.getAll({ subject }),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
  const questions = questionsQuery.data || [];

  useEffect(() => {
    if (questionsQuery.error) {
      const err = questionsQuery.error as Error;
      toast.error(err?.message || '获取错题失败');
    }
  }, [questionsQuery.error]);

  useEffect(() => {
    void refreshQuestions();
  }, [subject]);

  useEffect(() => subscribeLearningSyncSnapshot(setSyncSnapshot), []);

  useEffect(() => {
    const timer = window.setInterval(() => setTimeNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const horizon = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyEvents = readPerfEvents().filter((item) => item.at >= horizon);
    setWeeklyPerfReport(buildWeeklyPerfReport(weeklyEvents));
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        hydrateTagExtensionsFromCloud(),
        hydrateTaxonomyOverridesFromCloud(),
      ]);
      setTagVersion(prev => prev + 1);
      await refreshQuestions(true);
    })();
  }, []);

  async function refreshQuestions(forceRefresh = false) {
    try {
      const startedAt = performance.now();
      const result = await questionsApi.getAll({ subject }, { forceRefresh });
      queryClient.setQueryData(queryKeys.questionsList({ subject }), result);
      setLastLoadMs(performance.now() - startedAt);
    } catch (error: any) {
      toast.error(error?.message || '获取错题失败');
    }
  }

  const customKnowledgeTags = useMemo(() => {
    const all = getTagExtensionsSnapshot().knowledge_point || [];
    const base = getKnowledgePointsBySubject(subject);
    return all.filter(item => !base.includes(item) && isKnowledgePointInSubjectTaxonomy(subject, item));
  }, [subject, tagVersion]);

  const treeSnapshot = useMemo(() => {
    const startedAt = performance.now();
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
    return {
      map,
      computeMs: performance.now() - startedAt,
    };
  }, [questions, customKnowledgeTags, subject]);
  const treeData = treeSnapshot.map;

  useEffect(() => {
    if (lastLoadMs <= 0) return;
    const events = appendPerfEvent({ type: 'load', ms: lastLoadMs, at: Date.now() });
    setWeeklyPerfReport(buildWeeklyPerfReport(events));
    if (lastLoadMs >= PERF_WARN_THRESHOLD_MS && Math.round(lastLoadMs) !== Math.round(warnSnapshotRef.current.load)) {
      warnSnapshotRef.current.load = lastLoadMs;
      toast.warning(`错题加载耗时偏高（${Math.round(lastLoadMs)}ms）`);
    }
  }, [lastLoadMs]);

  useEffect(() => {
    if (treeSnapshot.computeMs <= 0) return;
    const events = appendPerfEvent({ type: 'tree', ms: treeSnapshot.computeMs, at: Date.now() });
    setWeeklyPerfReport(buildWeeklyPerfReport(events));
    if (treeSnapshot.computeMs >= PERF_WARN_THRESHOLD_MS && Math.round(treeSnapshot.computeMs) !== Math.round(warnSnapshotRef.current.tree)) {
      warnSnapshotRef.current.tree = treeSnapshot.computeMs;
      toast.warning(`树构建耗时偏高（${Math.round(treeSnapshot.computeMs)}ms）`);
    }
  }, [treeSnapshot.computeMs]);

  useEffect(() => {
    if (lastBatchMs <= 0) return;
    const events = appendPerfEvent({ type: 'batch', ms: lastBatchMs, at: Date.now() });
    setWeeklyPerfReport(buildWeeklyPerfReport(events));
    if (lastBatchMs >= PERF_WARN_THRESHOLD_MS && Math.round(lastBatchMs) !== Math.round(warnSnapshotRef.current.batch)) {
      warnSnapshotRef.current.batch = lastBatchMs;
      toast.warning(`批处理耗时偏高（${Math.round(lastBatchMs)}ms）`);
    }
  }, [lastBatchMs]);

  const executeMoveNodeTag = async (node: string, newCategory: string, newL2: string) => {
    try {
      const meta = getKnowledgeNodeMeta(subject as Subject, node);
      if (meta.category === newCategory && meta.branch === newL2) return; // No change

      const startedAt = performance.now();
      registerCustomKnowledgeTaxonomy(node, newCategory, newL2, subject);
      
      const affectedIds = questions.filter(item => item.knowledge_point === node).map(item => item.id);
      if (affectedIds.length > 0) {
        await questionsApi.batchUpdate(affectedIds, { knowledge_point: node, category: newCategory, ability: newL2, node: node });
      }
      setTagVersion(prev => prev + 1);
      await refreshQuestions();
      const duration = performance.now() - startedAt;
      setLastBatchMs(duration);
      toast.success(`「${node}」已移动到「${newL2}」`);
    } catch (error: any) {
      toast.error(error?.message || '移动失败');
    }
  };

  const executeRenameL2 = async (category: string, oldL2: string, newL2: string) => {
    if (!newL2 || oldL2 === newL2) return;
    try {
      const startedAt = performance.now();
      
      const affectedIds = questions.filter(item => {
        const meta = getKnowledgeNodeMeta(subject as Subject, item.knowledge_point);
        return meta.category === category && meta.branch === oldL2;
      }).map(item => item.id);

      const nodesInL2 = Object.keys(treeData[category]?.[oldL2] || {});
      nodesInL2.forEach(node => {
        registerCustomKnowledgeTaxonomy(node, category, newL2, subject);
      });
      
      if (affectedIds.length > 0) {
        await questionsApi.batchUpdate(affectedIds, { ability: newL2 });
      }
      
      setTagVersion(prev => prev + 1);
      await refreshQuestions();
      const duration = performance.now() - startedAt;
      setLastBatchMs(duration);
      toast.success(`分类已重命名为「${newL2}」`);
    } catch (error: any) {
      toast.error(error?.message || '重命名失败');
    }
  };

  const executeRenameNodeTag = async (oldValue: string, nextValue: string) => {
    if (!nextValue || nextValue === oldValue) return;
    try {
      const startedAt = performance.now();
      renameTagExtension('knowledge_point', oldValue, nextValue);
      renameCustomKnowledgeTaxonomy(oldValue, nextValue, subject);
      const affectedIds = questions.filter(item => item.knowledge_point === oldValue).map(item => item.id);
      if (affectedIds.length > 0) {
        const meta = getKnowledgeNodeMeta(subject as Subject, nextValue);
        await questionsApi.batchUpdate(affectedIds, { knowledge_point: nextValue, category: meta.category, ability: meta.branch, node: meta.node });
      }
      setTagVersion(prev => prev + 1);
      await refreshQuestions();
      const duration = performance.now() - startedAt;
      setLastBatchMs(duration);
      toast.success(`标签已修改（${Math.round(duration)}ms）`);
    } catch (error: any) {
      toast.error(error?.message || '修改失败');
    }
  };

  const executeDeleteNodeTag = async (value: string) => {
    const affectedIds = questions.filter(item => item.knowledge_point === value).map(item => item.id);
    try {
      const startedAt = performance.now();
      removeTagExtension('knowledge_point', value);
      removeCustomKnowledgeTaxonomy(value, subject);
      const fallback = getKnowledgePointsBySubject(subject)[0] || '时态';
      if (affectedIds.length > 0) {
        const meta = getKnowledgeNodeMeta(subject as Subject, fallback);
        await questionsApi.batchUpdate(affectedIds, { knowledge_point: fallback, category: meta.category, ability: meta.branch, node: meta.node });
      }
      setTagVersion(prev => prev + 1);
      await refreshQuestions();
      const duration = performance.now() - startedAt;
      setLastBatchMs(duration);
      toast.success(`标签已删除（${Math.round(duration)}ms）`);
    } catch (error: any) {
      toast.error(error?.message || '删除失败');
    }
  };

  const handleExportWeeklyReport = () => {
    const horizon = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const events = readPerfEvents().filter((item) => item.at >= horizon);
    const report = buildWeeklyPerfReport(events);
    
    const rows = [
      ['指标', '数值'],
      ['报告周期', '近7天'],
      ['慢操作总数', report.slowTotal.toString()],
      ['加载慢操作 (L)', report.loadSlow.toString()],
      ['树构建慢操作 (T)', report.treeSlow.toString()],
      ['批处理慢操作 (B)', report.batchSlow.toString()],
      ['P95 加载耗时 (ms)', Math.round(report.loadP95).toString()],
      ['P95 树构建耗时 (ms)', Math.round(report.treeP95).toString()],
      ['P95 批处理耗时 (ms)', Math.round(report.batchP95).toString()],
      ['', ''],
      ['慢操作明细 (阈值 >= 800ms)', ''],
      ['类型', '耗时(ms)', '发生时间']
    ];

    const slowEvents = events.filter(e => e.ms >= 800).sort((a, b) => b.at - a.at);
    slowEvents.forEach(e => {
      rows.push([
        e.type === 'load' ? '加载' : e.type === 'tree' ? '树构建' : '批处理',
        Math.round(e.ms).toString(),
        new Date(e.at).toLocaleString('zh-CN')
      ]);
    });

    const csvContent = "\uFEFF" + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `错题库性能周报_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('性能周报已导出');
  };

  const totalQuestions = questions.length;
  const masteredQuestions = questions.filter(item => (item.mastery_level ?? 0) >= 80).length;
  const overallMastery = totalQuestions > 0 ? Math.round((masteredQuestions / totalQuestions) * 100) : 0;
  const showPendingSyncDot = syncSnapshot.state === 'syncing' || syncSnapshot.state === 'error' || userLearningStateApi.hasPendingSync();

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] space-y-8 bg-[#F9FAFB] px-4 py-6 pb-20 sm:px-6 sm:py-8 lg:px-8 2xl:px-10">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">错题资产 (管理中心)</h1>
          <div className="mt-1.5 flex items-center gap-3">
            {showPendingSyncDot && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                待同步
              </span>
            )}
            <span className="text-xs font-medium text-gray-500">
              最近同步：{formatRelativeTime(syncSnapshot.updatedAt, timeNow)}
            </span>
            <span className="text-xs font-medium text-gray-500 flex items-center">
              加载耗时：{formatDuration(lastLoadMs)}{lastLoadMs >= PERF_WARN_THRESHOLD_MS && <TriangleAlert className="inline-block w-3.5 h-3.5 text-amber-500 ml-1" />}
            </span>
            <span className="text-xs font-medium text-gray-500 flex items-center">
              树构建：{formatDuration(treeSnapshot.computeMs)}{treeSnapshot.computeMs >= PERF_WARN_THRESHOLD_MS && <TriangleAlert className="inline-block w-3.5 h-3.5 text-amber-500 ml-1" />}
            </span>
            <span className="text-xs font-medium text-gray-500 flex items-center">
              批处理：{formatDuration(lastBatchMs)}{lastBatchMs >= PERF_WARN_THRESHOLD_MS && <TriangleAlert className="inline-block w-3.5 h-3.5 text-amber-500 ml-1" />}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              近7天慢操作 {weeklyPerfReport.slowTotal} 次
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
              P95 加载/树/批：{Math.round(weeklyPerfReport.loadP95)}/{Math.round(weeklyPerfReport.treeP95)}/{Math.round(weeklyPerfReport.batchP95)}ms
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
              慢操作分布 L/T/B：{weeklyPerfReport.loadSlow}/{weeklyPerfReport.treeSlow}/{weeklyPerfReport.batchSlow}
            </span>
            <button
              onClick={handleExportWeeklyReport}
              className="ml-1 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition-all active:scale-95"
              title="导出近7天性能周报"
            >
              <Download className="w-3 h-3" />
              导出周报
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-gray-500 mr-2">知识点枢纽视图</p>
          <button
            type="button"
            onClick={() => setIsGlobalEditing(!isGlobalEditing)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold shadow-sm transition-all ${
              isGlobalEditing 
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100' 
                : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300 hover:text-indigo-600'
            }`}
          >
            <Pencil className="h-4 w-4" />
            {isGlobalEditing ? '完成编辑' : '编辑结构'}
          </button>
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
        <article className="space-y-6 rounded-3xl border-2 border-dashed border-indigo-200 bg-indigo-50/30 p-5 shadow-sm sm:p-6 animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between border-b border-indigo-100/50 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-500">
                <Plus className="h-5 w-5" />
              </div>
              <input 
                value={newCatName} 
                onChange={e=>setNewCatName(e.target.value)} 
                placeholder="输入大类名称..." 
                className={`bg-transparent text-xl font-bold text-gray-900 outline-none placeholder:text-indigo-300 placeholder:font-medium border-b border-transparent focus:border-indigo-300 transition-colors ${newCatName.trim() === '' && errorTriggered ? 'border-rose-300 placeholder:text-rose-300' : ''}`}
              />
            </div>
            <button onClick={() => setAddingCategory(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-indigo-200 bg-white px-3 py-1 text-xs font-bold text-gray-500">
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                <input 
                  value={newBranchName} 
                  onChange={e=>setNewBranchName(e.target.value)} 
                  placeholder="输入分类名称..."
                  className={`bg-transparent outline-none w-28 text-gray-700 placeholder:text-indigo-300 ${newBranchName.trim() === '' && errorTriggered ? 'placeholder:text-rose-300' : ''}`}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5 min-h-[40px] p-1.5 -m-1.5 rounded-xl border-2 border-transparent">
              <div className="inline-flex items-center gap-1 pl-2.5 pr-3 py-1.5 rounded-xl border border-dashed border-indigo-300 bg-white text-xs font-bold transition-all shadow-sm focus-within:ring-2 focus-within:ring-indigo-400/50">
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                <input 
                  value={newTagName} 
                  onChange={e=>setNewTagName(e.target.value)} 
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
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
                    }
                  }}
                  placeholder="输入首个标签后回车保存"
                  className={`bg-transparent outline-none text-xs font-bold placeholder:text-indigo-300 placeholder:font-medium text-indigo-700 min-w-[150px] ${newTagName.trim() === '' && errorTriggered ? 'placeholder:text-rose-300' : ''}`}
                />
              </div>
            </div>
          </div>
        </article>
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
              <TriangleAlert className="w-4 h-4 text-rose-500" /> AI 核心洞察
              <span className="relative flex h-2.5 w-2.5 ml-1">
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
              className="text-xs font-bold bg-rose-500 text-white px-4 py-2 rounded-xl shadow-sm hover:bg-rose-600 hover:shadow-md hover:-translate-y-0.5 active:scale-95 transition-all flex items-center gap-1.5 w-fit"
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
              className={`rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-300 active:scale-95 sm:px-8 ${
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
          const catMasteryRaw = catItems.length > 0
            ? Math.round(catItems.reduce((sum, item) => sum + (item.mastery_level ?? 0), 0) / catItems.length)
            : null;
          const hasCatMastery = catMasteryRaw !== null && Number.isFinite(catMasteryRaw);
          const catMastery = hasCatMastery ? Math.max(0, Math.min(100, catMasteryRaw)) : 0;

          return (
            <article key={category} className="space-y-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] transition-all duration-300 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.06)] hover:border-indigo-100/80 sm:p-6">
              <div className="flex items-center justify-between border-b border-gray-100 pb-4 group/category">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">{category}</h2>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-24">
                    <p className="text-right text-xs font-bold text-gray-500 mb-1.5">
                      掌握度 <span className={hasCatMastery ? 'text-indigo-600' : 'text-gray-400'}>{hasCatMastery ? `${catMastery}%` : '暂无数据'}</span>
                    </p>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full transition-all duration-1000 ease-out rounded-full ${hasCatMastery ? 'bg-indigo-500' : 'bg-gray-300'}`} style={{ width: `${catMastery}%` }} />
                    </div>
                  </div>
                </div>
              </div>

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

                  return (
                    <div key={l2} className="space-y-3">
                      <div className="flex items-center justify-between gap-2 group/l2">
                        <div className="flex items-center gap-2">
                          {renamingL2 === `${category}|${l2}` ? (
                            <input
                              autoFocus
                              defaultValue={l2}
                              className="inline-block rounded-lg border-2 border-indigo-400 bg-white px-3 py-1 text-xs font-bold text-gray-900 outline-none w-32 shadow-sm"
                              onBlur={(e) => {
                                const newVal = e.target.value.trim();
                                if (newVal && newVal !== l2) {
                                  executeRenameL2(category, l2, newVal);
                                }
                                setRenamingL2(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                } else if (e.key === 'Escape') {
                                  setRenamingL2(null);
                                }
                              }}
                            />
                          ) : (
                            <p 
                              className="inline-block rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-500 cursor-pointer hover:bg-gray-200 transition-colors"
                              onClick={() => {
                                if (isGlobalEditing) {
                                  setRenamingL2(`${category}|${l2}`);
                                }
                              }}
                              title={isGlobalEditing ? "点击重命名分类" : ""}
                            >
                              {l2}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      <div 
                        className="flex flex-wrap gap-2.5 min-h-[40px] p-1.5 -m-1.5 rounded-xl transition-all duration-200 border-2 border-transparent"
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (isGlobalEditing) {
                            e.currentTarget.classList.add('bg-indigo-50/50', 'border-indigo-200', 'border-dashed');
                          }
                        }}
                        onDragLeave={(e) => {
                          if (isGlobalEditing) {
                            e.currentTarget.classList.remove('bg-indigo-50/50', 'border-indigo-200', 'border-dashed');
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('bg-indigo-50/50', 'border-indigo-200', 'border-dashed');
                          const node = e.dataTransfer.getData('application/my-app-node');
                          if (node && isGlobalEditing) {
                             executeMoveNodeTag(node, category, l2);
                          }
                        }}
                      >
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

                          if (isGlobalEditing) {
                            return (
                              <EditableTag
                                key={node}
                                node={node}
                                buttonClasses={buttonClasses}
                                onRename={(newVal) => executeRenameNodeTag(node, newVal)}
                                onDelete={() => executeDeleteNodeTag(node)}
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('application/my-app-node', node);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                              />
                            );
                          }

                          return (
                            <button
                              key={node}
                              type="button"
                              onClick={() => navigate(`/questions/node?subject=${encodeURIComponent(subject)}&category=${encodeURIComponent(category)}&l2=${encodeURIComponent(l2)}&node=${encodeURIComponent(node)}`, { state: { subject, category, l2, node } })}
                              className={`inline-flex items-center px-3 py-1.5 rounded-xl border text-xs font-bold transition-all duration-200 shadow-sm hover:-translate-y-0.5 active:scale-95 cursor-pointer ${buttonClasses}`}
                              title="点击查看错题"
                            >
                              {node}
                            </button>
                          );
                        })}
                        
                        {isGlobalEditing && (
                          <AddTagBox onAdd={(tag) => {
                             try {
                               registerCustomKnowledgeTaxonomy(tag, category, l2, subject);
                               approveNewTags({ knowledge_point: [tag] });
                               setTagVersion(v => v + 1);
                             } catch (e:any) { toast.error(e.message); }
                          }} />
                        )}
                      </div>
                    </div>
                  );
                })}
                {isGlobalEditing && (
                  <AddL2Box category={category} subject={subject} setTagVersion={setTagVersion} />
                )}
              </div>
            </article>
          );
        })}
      </section>

    </main>
  );
}
