import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  BookText,
  Brain,
  Camera,
  ChevronRight,
  Clock3,
  Play,
  Rocket,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import { statsApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Stats } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { MistakeQuestionPreview } from '../components/business/MistakeQuestionPreview';

export function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const displayName = user?.user_metadata?.name || user?.email?.split('@')[0] || '同学';

  useEffect(() => {
    statsApi.get()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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

  const subjectRadarData = useMemo(() => {
    const source = stats?.subjectCounts ?? {};
    const entries = Object.entries(source);
    if (entries.length === 0) {
      return [
        { subject: '英语', score: 50 },
        { subject: '数学', score: 62 },
        { subject: '物理', score: 58 },
      ];
    }
    const maxCount = Math.max(...entries.map(([, count]) => count), 1);
    return entries.slice(0, 5).map(([subject, count]) => ({
      subject,
      score: Math.max(35, Math.round((1 - count / (maxCount * 1.2)) * 100)),
    }));
  }, [stats]);

  const trendPoints = useMemo(() => {
    const base = Math.max(40, (stats?.total ?? 60) - (stats?.weaknessCount ?? 8));
    return [base - 16, base - 10, base - 7, base - 2, base + 3, base + 7, base + 11];
  }, [stats]);

  const topWeaknessTags = useMemo(() => {
    if (stats?.topWeakness?.knowledge_point) {
      const main = stats.topWeakness.knowledge_point;
      const second = `${stats.topWeakness.ability}-${stats.topWeakness.error_count}次`;
      return [main, second, '专项复盘'];
    }
    return ['英语-定语从句', '数学-函数最值', '物理-受力分析'];
  }, [stats]);

  const backlogHigh = (stats?.weaknessCount ?? 0) >= 10;

  const formatRelativeTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '刚刚';
    const diff = Date.now() - date.getTime();
    const hour = 1000 * 60 * 60;
    const day = hour * 24;
    if (diff < hour) return '1小时内';
    if (diff < day) return `${Math.floor(diff / hour)}小时前`;
    return `${Math.floor(diff / day)}天前`;
  };

  const cardBaseClass =
    'group rounded-3xl border border-white/70 bg-white/88 p-6 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.22)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_65px_-28px_rgba(15,23,42,0.32)]';

  return (
    <div className="mx-auto mt-6 w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 2xl:px-10 md:mt-0">
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
              <span>✨ 进入草稿确认流</span>
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
                <p className="mt-2 text-4xl font-semibold text-slate-900">待复习：{stats?.weaknessCount ?? 0} 题</p>
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
                🔴 {stats?.topWeakness?.knowledge_point ?? '英语-定语从句'}
              </span>
              <p className="text-slate-700">AI 已为您生成 {Math.max(3, stats?.newThisWeek ?? 0)} 道弱点变式题</p>
            </div>
          </div>
          <Link
            to="/review?onlyUnmastered=true"
            className="mt-8 inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-[0_20px_34px_-20px_rgba(15,23,42,0.75)]"
          >
            <Rocket size={16} />
            🚀 开启专属训练
          </Link>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <article className={cardBaseClass}>
          <h3 className="text-lg font-semibold text-slate-900">学科掌握度雷达</h3>
          <div className="mt-4 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={subjectRadarData}>
                <PolarGrid stroke="#E2E8F0" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748B', fontSize: 12 }} />
                <Radar name="掌握度" dataKey="score" stroke="#6366F1" fill="#6366F1" fillOpacity={0.3} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-sm text-slate-500">整体掌握度：{Math.round(subjectRadarData.reduce((a, c) => a + c.score, 0) / subjectRadarData.length)}%</p>
        </article>

        <article className={cardBaseClass}>
          <h3 className="text-lg font-semibold text-slate-900">累计消灭弱点：{Math.max(0, (stats?.total ?? 0) - (stats?.weaknessCount ?? 0))} 个</h3>
          <div className="mt-5 flex items-end justify-between">
            <div>
              <p className="text-4xl font-semibold tracking-tight text-slate-900">+{Math.max(6, stats?.newThisWeek ?? 0)}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <TrendingUp size={15} />
                较上周提升 18%
              </p>
            </div>
            <svg viewBox="0 0 160 60" className="h-16 w-44">
              <defs>
                <linearGradient id="trendStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#6366F1" />
                </linearGradient>
              </defs>
              <polyline
                fill="none"
                stroke="url(#trendStroke)"
                strokeWidth="4"
                strokeLinecap="round"
                points={trendPoints.map((value, i) => `${4 + i * 24},${58 - Math.min(50, value / 2)}`).join(' ')}
              />
            </svg>
          </div>
        </article>

        <article className={cardBaseClass}>
          <h3 className="text-lg font-semibold text-slate-900">顽固错题 Top 3</h3>
          <p className="mt-2 text-sm text-slate-500">点击标签可直达错题库对应位置</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {topWeaknessTags.map((tag) => (
              <Link
                key={tag}
                to={`/questions?nodes=${encodeURIComponent(tag)}`}
                className="inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              >
                {tag}
              </Link>
            ))}
          </div>
        </article>
      </section>

      <section className={cardBaseClass}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">最近添加的错题轨迹</h3>
          <span className="text-xs text-slate-400">实时更新</span>
        </div>
        {loading ? (
          <div className="mt-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-2xl" />
            ))}
          </div>
        ) : stats?.recent?.length ? (
          <ul className="mt-4 space-y-3">
            {stats.recent.slice(0, 6).map((item) => (
              <li
                key={item.id}
                className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-100 bg-white/90 px-3 py-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-[0_16px_30px_-24px_rgba(15,23,42,0.5)]"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {item.subject.slice(0, 1)}
                </span>
                <MistakeQuestionPreview
                  questionText={item.question_text}
                  className="min-w-0 flex-1"
                  stemClassName="truncate text-sm text-slate-700"
                  optionClassName="inline-flex min-w-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
                  maxOptions={2}
                />
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">#{item.knowledge_point}</span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap pt-0.5 text-xs text-slate-400">
                  <Clock3 size={12} />
                  {formatRelativeTime(item.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-sm text-slate-500">
            暂无错题轨迹，去草稿确认页录入第一题吧。
          </div>
        )}
        <Link
          to="/questions"
          className="mt-5 inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-blue-600 transition-colors duration-300 hover:text-blue-700"
        >
          查看全部错题本
          <ChevronRight size={14} />
        </Link>
      </section>
    </div>
  );
}
