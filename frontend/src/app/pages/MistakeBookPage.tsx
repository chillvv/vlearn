import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { questionsApi } from '../lib/api';
import type { Question, Subject } from '../lib/types';
import { BookOpen, CheckCircle2, Sparkles, ArrowRight } from 'lucide-react';

type NodeMap = Record<string, Question[]>;
type L2Map = Record<string, NodeMap>;
type CategoryMap = Record<string, L2Map>;

export function MistakeBookPage() {
  const navigate = useNavigate();
  const [subject, setSubject] = useState<Subject>('英语');
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
    const load = async () => {
      const result = await questionsApi.getAll({ subject });
      setQuestions(result);
    };
    void load();
  }, [subject]);

  const treeData = useMemo(() => {
    const map: CategoryMap = {};
    questions.forEach(item => {
      const category = item.category || '未分类';
      const l2 = item.ability || item.error_type || '核心考点';
      const node = item.node || item.knowledge_point || '其他';
      if (!map[category]) map[category] = {};
      if (!map[category][l2]) map[category][l2] = {};
      if (!map[category][l2][node]) map[category][l2][node] = [];
      map[category][l2][node].push(item);
    });
    return map;
  }, [questions]);

  const totalQuestions = questions.length;
  const masteredQuestions = questions.filter(item => (item.mastery_level ?? 0) >= 80).length;
  const overallMastery = totalQuestions > 0 ? Math.round((masteredQuestions / totalQuestions) * 100) : 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] space-y-8 bg-[#F9FAFB] px-4 py-6 pb-20 sm:px-6 sm:py-8 lg:px-8 2xl:px-10">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">错题资产 (管理中心)</h1>
        <p className="text-sm font-medium text-gray-500">知识点枢纽视图</p>
      </div>

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
            <button className="text-xs font-bold bg-rose-500 text-white px-4 py-2 rounded-xl shadow-sm hover:bg-rose-600 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-1.5 w-fit">
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
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">{category}</h2>
                </div>
                <div className="w-24">
                  <p className="text-right text-xs font-bold text-gray-500 mb-1.5">掌握度 <span className="text-indigo-600">{catMastery}%</span></p>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-indigo-500 transition-all duration-1000 ease-out rounded-full" style={{ width: `${catMastery}%` }} />
                  </div>
                </div>
              </div>
              
              <div className="space-y-5">
                {Object.entries(l2Map).map(([l2, nodes]) => {
                  
                  // Sort nodes based on Traffic Light System
                  const nodesArray = Object.entries(nodes).map(([node, list]) => {
                    const pending = list.filter(item => (item.mastery_level ?? 0) < 80).length;
                    let status = 'green';
                    let priority = 3;
                    if (pending > 5) {
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
                      <p className="inline-block rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-500">{l2}</p>
                      <div className="flex flex-wrap gap-2.5">
                        {nodesArray.map(({ node, pending, status }) => {
                          let buttonClasses = '';
                          let icon = null;
                          let badge = null;

                          if (status === 'red') {
                            buttonClasses = 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100';
                            icon = <span className="text-xs">🔴</span>;
                            badge = <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">{pending}</span>;
                          } else if (status === 'orange') {
                            buttonClasses = 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100';
                            icon = <span className="text-xs">🟡</span>;
                            badge = <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">{pending}</span>;
                          } else {
                            buttonClasses = 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
                            icon = <span className="text-xs">🟢</span>;
                            badge = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
                          }

                          return (
                            <button
                              type="button"
                              key={node}
                              onClick={() => navigate(`/questions/node?subject=${encodeURIComponent(subject)}&category=${encodeURIComponent(category)}&l2=${encodeURIComponent(l2)}&node=${encodeURIComponent(node)}`, { state: { subject, category, l2, node } })}
                              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all duration-200 cursor-pointer shadow-sm ${buttonClasses}`}
                            >
                              {icon}
                              <span>{node}</span>
                              {badge}
                            </button>
                          );
                        })}
                      </div>
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
