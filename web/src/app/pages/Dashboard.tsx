import { useMemo } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  BookText,
  Brain,
  Camera,
  Play,
  Rocket,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useAuth } from '../lib/auth';
import { Skeleton } from '../components/ui/skeleton';
import { useDashboardStatsQuery } from '../queries/questions';

export function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading: loading } = useDashboardStatsQuery();

  const displayName = user?.user_metadata?.name || user?.email?.split('@')[0] || '同学';

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6)  return '夜深了';
    if (h < 12) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  })();

  const insightText = useMemo(() => {
    if (!stats?.topWeakness) {
      return '💡 昨夜模型已完成学习诊断，建议先完成今日复习计划，再开启 AI 专属突破。';
    }
    return `💡 经过一夜分析，系统发现您在「${stats.topWeakness.knowledge_point}」存在明显短板，建议优先突破。`;
  }, [stats]);

  const subjectMasteryData = useMemo(() => {
    const source = stats?.subjectMastery ?? [];
    if (source.length === 0) {
      return [
        { subject: '暂无数据', score: 0, color: 'from-slate-200 to-slate-300' },
      ];
    }
    const colors = [
      'from-blue-400 to-indigo-500',
      'from-emerald-400 to-teal-500',
      'from-orange-400 to-rose-500',
      'from-purple-400 to-fuchsia-500',
      'from-cyan-400 to-blue-500',
    ];
    return source.slice(0, 5).map((item, idx) => ({
      subject: item.subject,
      score: item.score,
      color: colors[idx % colors.length],
    }));
  }, [stats]);

  const weekDays = useMemo(() => {
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      result.push(days[d.getDay()]);
    }
    return result;
  }, []);
  
  const activityData = useMemo(() => {
    return stats?.weeklyActivity ?? [0, 0, 0, 0, 0, 0, 0];
  }, [stats]);

  const errorTypeData = useMemo(() => {
    const source = stats?.errorTypes ?? [];
    if (source.length === 0) {
      return [
        { name: '暂无数据', value: 100, color: '#E2E8F0' },
      ];
    }
    const colors = ['#F97316', '#3B82F6', '#A855F7', '#10B981', '#EC4899'];
    return source.map((item, idx) => ({
      name: item.name,
      value: item.value,
      color: colors[idx % colors.length],
    }));
  }, [stats]);

  const targetedWeaknesses = useMemo(() => {
    const list = stats?.weaknessesList ?? [];
    if (list.length === 0) {
      return [];
    }
    const colors = ['bg-rose-500', 'bg-amber-500', 'bg-blue-500', 'bg-purple-500'];
    return list.map((item, idx) => ({
      id: item.id,
      node: item.knowledge_point,
      count: item.error_count,
      color: colors[idx % colors.length],
    }));
  }, [stats]);

  const backlogHigh = (stats?.dueReviewCount ?? 0) >= 10;

  const cardBaseClass =
    'group rounded-3xl border border-white/70 bg-white/88 p-6 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.22)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_65px_-28px_rgba(15,23,42,0.32)]';

  return (
    <div className="flex flex-col min-h-full">
      <div className="mx-auto mt-6 w-full max-w-[1600px] space-y-6 px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8 2xl:px-10 md:mt-0 pb-6">
        <section className={`${cardBaseClass} relative overflow-hidden`}>
          <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-blue-300/25 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/3 h-32 w-32 rounded-full bg-purple-300/20 blur-2xl" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
                {greeting}，{displayName} 👋
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-500 md:text-base">{insightText}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/draft-review"
                className="group relative inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-blue-500 to-cyan-400 px-6 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_-16px_rgba(59,130,246,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-14px_rgba(79,70,229,0.9)]"
              >
                <span className="absolute inset-0 rounded-2xl bg-[linear-gradient(120deg,transparent_35%,rgba(255,255,255,0.45)_50%,transparent_65%)] bg-[length:230%_100%] opacity-70 transition-all duration-700 group-hover:bg-[position:130%_0]" />
                <Camera size={18} />
                <span className="relative">✨ 拍照录入错题</span>
              </Link>
              <Link
                to="/draft-review"
                className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-5 py-3 text-sm font-medium text-slate-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_14px_28px_-18px_rgba(15,23,42,0.45)]"
              >
                <Sparkles size={17} />
                <span>✨ 唤起 AI 管家</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <article className={`${cardBaseClass} flex flex-col justify-between bg-gradient-to-br from-orange-50 to-white`}>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                  <BookText size={14} />
                  今日复习计划 Review
                </div>
                {backlogHigh && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
                    <AlertTriangle size={13} />
                    严重积压
                  </span>
                )}
              </div>
              <div>
                <p className="text-sm text-slate-500">基于艾宾浩斯遗忘曲线</p>
                {loading ? (
                  <Skeleton className="mt-2 h-12 w-32 rounded-xl" />
                ) : (
                  <p className="mt-2 text-4xl font-semibold text-slate-900">待复习：{stats?.dueReviewCount ?? 0} 题</p>
                )}
              </div>
            </div>
            <Link
              to="/review"
              className="mt-8 inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_-18px_rgba(249,115,22,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-[0_20px_34px_-18px_rgba(249,115,22,0.95)]"
            >
              <Play size={16} />
              ▶ 开始沉浸式复习
            </Link>
          </article>

          <article className={`${cardBaseClass} flex flex-col justify-between bg-gradient-to-br from-violet-600/8 via-blue-600/10 to-cyan-500/10`}>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                  <Brain size={14} />
                  AI 专属突破 Targeted Drill
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-2.5 py-1 text-xs font-semibold text-white">
                  <Sparkles size={12} />
                  Pro
                </span>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-slate-500">当前最高错误率知识点</p>
                <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-600">
                  🔴 {stats?.topWeakness?.knowledge_point ?? '暂无薄弱点'}
                </span>
                <p className="text-slate-700">基于真实数据，针对性强化训练</p>
              </div>
            </div>
            <Link
              to="/practice"
              className="mt-8 inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-[0_20px_34px_-20px_rgba(15,23,42,0.75)]"
            >
              <Rocket size={16} />
              🚀 开启专属训练
            </Link>
          </article>
        </section>
      </div>

      <div className="flex-1 bg-[#F9FAFB] w-full border-t border-slate-100">
        <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-8 sm:px-6 lg:px-8 2xl:px-10">
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <article className="rounded-3xl border border-white/70 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.08)]">
              <h3 className="text-base font-bold text-slate-900">学科熟练度榜单</h3>
              <div className="mt-5 space-y-4">
                {subjectMasteryData.map((item, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span className="w-8 text-sm font-medium text-slate-700">{item.subject}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div 
                        className={`h-full rounded-full bg-gradient-to-r ${item.color}`} 
                        style={{ width: `${item.score}%` }} 
                      />
                    </div>
                    <span className="w-9 text-right text-sm font-semibold text-slate-700">{item.score}%</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-3xl border border-white/70 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.08)]">
              <h3 className="text-base font-bold text-slate-900">本周记录错题</h3>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <p className="text-4xl font-bold tracking-tight text-slate-900">+{stats?.newThisWeek ?? 0}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                    <TrendingUp size={14} strokeWidth={3} />
                    坚持记录，稳步提升
                  </p>
                </div>
              </div>
              <div className="mt-5 flex h-[72px] items-end justify-between gap-2">
                {activityData.map((val, i) => {
                  const isToday = i === 6;
                  const maxVal = Math.max(...activityData, 1);
                  const heightPct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-2 h-full justify-end">
                      <div 
                        className={`w-full max-w-[20px] rounded-sm transition-all duration-500 ${isToday ? 'bg-blue-500' : 'bg-slate-200 hover:bg-slate-300'}`} 
                        style={{ height: `${heightPct}%`, minHeight: '4px' }}
                      />
                      <span className={`text-[10px] font-medium ${isToday ? 'text-blue-600' : 'text-slate-400'}`}>{weekDays[i]}</span>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="rounded-3xl border border-white/70 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.08)] flex flex-col">
              <h3 className="text-base font-bold text-slate-900">AI 核心错因分析</h3>
              <div className="mt-4 flex-1 flex items-center">
                <div className="h-32 w-1/2 -ml-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={errorTypeData}
                        innerRadius={32}
                        outerRadius={48}
                        paddingAngle={4}
                        dataKey="value"
                        stroke="none"
                        cornerRadius={4}
                      >
                        {errorTypeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex w-1/2 flex-col justify-center gap-3 pl-2">
                  {errorTypeData.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="font-medium text-slate-600">{item.name}</span>
                      </div>
                      <span className="font-bold text-slate-900">{item.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </section>

          <section className="rounded-3xl border border-white/70 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                🚨 AI 诊断：优先攻克清单
              </h3>
              <Link to="/questions" className="text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                查看完整知识图谱 &gt;
              </Link>
            </div>
            
            <div className="space-y-3">
              {targetedWeaknesses.map((item) => (
                <div 
                  key={item.id} 
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-slate-50/80 px-5 py-4 transition-all duration-300 hover:bg-slate-100/80"
                >
                  <div className="flex items-center gap-3 sm:w-1/3">
                    <span className={`h-2.5 w-2.5 rounded-full shadow-sm ${item.color}`} />
                    <span className="font-bold text-slate-800">{item.node}</span>
                  </div>
                  
                  <div className="flex-1 sm:text-center text-[13px] font-medium text-slate-500">
                    薄弱点错题积压 <span className="text-rose-500 font-bold">{item.count}</span> 题
                  </div>
                  
                  <div className="flex sm:w-1/3 sm:justify-end opacity-90 transition-opacity group-hover:opacity-100">
                    <Link
                      to={`/questions/node?node=${encodeURIComponent(item.node)}`}
                      className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_-4px_rgba(15,23,42,0.5)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_16px_-6px_rgba(15,23,42,0.6)] hover:bg-slate-800"
                    >
                      去攻克 🚀
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
