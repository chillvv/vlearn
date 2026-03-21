import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { questionsApi } from '../lib/api';
import type { Question, Subject } from '../lib/types';
import { Zap, Settings, Flame, Trophy, Calendar, CheckCircle2, AlertCircle, RefreshCw, BarChart3, BookOpen, Calculator, Play } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

type ReviewStatus = 'configuring' | 'ready' | 'loading' | 'active' | 'completed';

type ReviewConfig = {
  subject: Subject;
  scope: 'all' | 'due' | 'unmastered' | 'stubborn';
  amount: 10 | 20 | 999;
  sortBy: 'latestWrong' | 'lowestMastery' | 'nearestDue';
};

type ReviewPresetState = {
  preset?: Partial<ReviewConfig>;
};

const defaultConfig: ReviewConfig = {
  subject: '英语',
  scope: 'due',
  amount: 10,
  sortBy: 'nearestDue',
};

// Mock chart data for last 7 days
const generateChartData = () => {
  const data = [];
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const todayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  
  for (let i = 6; i >= 0; i--) {
    const dIndex = (todayIndex - i + 7) % 7;
    data.push({
      name: days[dIndex],
      count: i === 0 ? 0 : Math.floor(Math.random() * 20) + 5, // Today is 0 initially
    });
  }
  return data;
};

export function ReviewModePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as ReviewPresetState;

  const [status, setStatus] = useState<ReviewStatus>('ready');
  const [config, setConfig] = useState<ReviewConfig>({ ...defaultConfig, ...state.preset });
  const [cards, setCards] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  
  const [dueCount, setDueCount] = useState(0);
  const [chartData] = useState(generateChartData());

  useEffect(() => {
    // Fetch initial stats
    const fetchStats = async () => {
      try {
        const allDue = await questionsApi.getAll({ onlyDue: true, limit: 100 });
        setDueCount(allDue.length || 25); // Fallback to 25 if none for demo
      } catch (e) {
        setDueCount(25);
      }
    };
    fetchStats();
  }, []);

  const current = cards[currentIndex];

  const startReview = async () => {
    setStatus('loading');
    const next = await questionsApi.getAll({
      subject: config.subject,
      onlyDue: config.scope === 'due',
      onlyUnmastered: config.scope === 'unmastered',
      onlyStubborn: config.scope === 'stubborn',
      sortBy: config.sortBy,
      limit: config.amount === 999 ? undefined : config.amount,
    });
    setCards(next.length > 0 ? next : []);
    setCurrentIndex(0);
    setFlipped(false);
    setStatus('active');
  };

  const handleAction = async (action: 'forgot' | 'vague' | 'mastered') => {
    if (!current) return;
    if (action === 'forgot') {
      await questionsApi.swipeReview(current.id, 'again');
    } else if (action === 'mastered') {
      await questionsApi.swipeReview(current.id, 'easy');
    } else {
      await questionsApi.update(current.id, {
        confidence: Math.min(1, (current.confidence || 0.5) + 0.03),
        review_count: (current.review_count || 0) + 1,
      });
    }
    if (currentIndex >= cards.length - 1) {
      setStatus('completed');
      return;
    }
    setCurrentIndex(prev => prev + 1);
    setFlipped(false);
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 text-primary animate-spin" />
          <p className="text-muted-foreground font-medium">正在提取艾宾浩斯复习队列...</p>
        </div>
      </div>
    );
  }

  if (status === 'active' && current) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* We will refactor this Practice Interface in a later step. For now, keep it basic but styled better */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            智能复习
          </h1>
          <div className="flex items-center gap-3">
            <div className="w-32 h-2 bg-secondary/20 rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${((currentIndex) / cards.length) * 100}%` }} />
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{currentIndex + 1} / {cards.length}</span>
          </div>
        </div>
        
        <section className="rounded-2xl border border-border bg-card p-6 md:p-10 min-h-[400px] flex flex-col shadow-sm">
          <div className="flex-1">
            {!flipped ? (
              <div className="space-y-6">
                <div className="flex gap-2">
                  <span className="inline-flex items-center rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">{current.subject}</span>
                  <span className="inline-flex items-center rounded-md bg-secondary/20 px-2.5 py-1 text-xs font-medium text-foreground">{current.category || current.knowledge_point}</span>
                </div>
                <p className="text-xl font-medium text-foreground leading-relaxed mt-4">{current.question_text}</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="border-b border-border pb-4">
                  <p className="text-sm text-primary font-bold tracking-wide uppercase flex items-center gap-1 mb-2">
                    <CheckCircle2 className="h-4 w-4" />
                    AI 解析
                  </p>
                  <p className="text-lg font-medium text-foreground leading-relaxed">{current.note || '请按知识点复盘'}</p>
                </div>
                <div>
                  <p className="text-sm text-destructive font-bold tracking-wide uppercase flex items-center gap-1 mb-2">
                    <AlertCircle className="h-4 w-4" />
                    上次误区
                  </p>
                  <p className="text-base text-muted-foreground">{current.summary || '暂无记录'}</p>
                </div>
              </div>
            )}
          </div>
          
          <div className="mt-8 pt-6 border-t border-border">
            {!flipped ? (
              <button 
                type="button" 
                onClick={() => setFlipped(true)} 
                className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-bold text-primary-foreground hover:bg-primary/90 transition-all shadow-sm"
              >
                查看解析
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-center text-sm font-medium text-muted-foreground mb-4">根据你的掌握情况评估</p>
                <div className="grid grid-cols-3 gap-3">
                  <button 
                    type="button" 
                    onClick={() => handleAction('forgot')} 
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-destructive/30 bg-destructive/5 py-4 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <span className="text-lg font-bold">忘记了</span>
                    <span className="text-xs opacity-80">1天后复习</span>
                  </button>
                  <button 
                    type="button" 
                    onClick={() => handleAction('vague')} 
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background py-4 text-foreground hover:bg-accent/50 transition-colors"
                  >
                    <span className="text-lg font-bold">有点模糊</span>
                    <span className="text-xs text-muted-foreground">近期再看</span>
                  </button>
                  <button 
                    type="button" 
                    onClick={() => handleAction('mastered')} 
                    className="flex flex-col items-center justify-center gap-1 rounded-xl bg-emerald-500 py-4 text-white hover:bg-emerald-600 transition-colors shadow-sm"
                  >
                    <span className="text-lg font-bold">完全掌握</span>
                    <span className="text-xs opacity-90">4天后复习</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (status === 'completed' || (status === 'active' && cards.length === 0)) {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-12 text-center sm:px-6">
        <div className="rounded-full bg-amber-100 p-6 w-24 h-24 mx-auto mb-6 flex items-center justify-center">
          <Trophy className="h-12 w-12 text-amber-500" />
        </div>
        <h1 className="text-3xl font-bold text-foreground">今日复习达标！</h1>
        <p className="text-muted-foreground">你已完成所有复习任务，记忆曲线已更新</p>
        
        <div className="flex gap-4 justify-center mt-8">
          <button type="button" onClick={() => navigate('/questions')} className="rounded-xl border border-border bg-card px-6 py-3 font-semibold hover:bg-accent transition-colors">
            返回错题库
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 to-primary p-8 sm:p-12 text-center text-white shadow-xl mb-8">
        <div className="absolute top-0 right-0 -translate-y-1/4 translate-x-1/4 opacity-10">
          <Zap className="w-64 h-64" />
        </div>
        
        <div className="relative z-10 max-w-2xl mx-auto space-y-6">
          <h1 className="text-3xl font-extrabold sm:text-4xl tracking-tight">今日待复习</h1>
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-7xl font-black">{dueCount}</span>
            <span className="text-xl font-medium opacity-80">题</span>
          </div>
          <p className="text-base font-medium text-indigo-100 bg-black/20 inline-block px-4 py-2 rounded-full backdrop-blur-sm">
            基于艾宾浩斯记忆曲线，AI 已为你提取今日到期需要巩固的错题。只需一键开始，无需手动挑选。
          </p>
          
          <div className="pt-4">
            <button 
              onClick={startReview}
              className="group relative w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-full bg-white px-8 py-4 text-xl font-bold text-primary shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)] hover:scale-105 hover:shadow-[0_0_60px_-15px_rgba(255,255,255,0.7)] transition-all duration-300"
            >
              <Zap className="h-6 w-6 text-amber-500 group-hover:animate-bounce" />
              开始今日复习
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Recharts BarChart */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              最近 7 天学习活跃度
            </h2>
          </div>
          
          <div className="h-[250px] w-full mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#8C8C8C', fontSize: 12 }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#8C8C8C', fontSize: 12 }} 
                />
                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="count" radius={[6, 6, 6, 6]} barSize={32}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === chartData.length - 1 ? '#4F46E5' : '#E0E7FF'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Right: Custom Review Section */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Settings className="h-5 w-5 text-muted-foreground" />
              自定义复习
            </h2>
          </div>

          <div className="space-y-6 flex-1">
            {/* Subject Toggle */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">选择学科</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfig(prev => ({ ...prev, subject: '英语' }))}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-colors ${config.subject === '英语' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary/20 text-foreground hover:bg-secondary/40'}`}
                >
                  <BookOpen className="h-4 w-4" />
                  英语
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, subject: 'C语言' }))}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-colors ${config.subject === 'C语言' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary/20 text-foreground hover:bg-secondary/40'}`}
                >
                  <Calculator className="h-4 w-4" />
                  C语言
                </button>
              </div>
            </div>

            {/* Scope Toggle */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">复习范围</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfig(prev => ({ ...prev, scope: 'due' }))}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${config.scope === 'due' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-background border border-border text-foreground hover:bg-accent/50'}`}
                >
                  到期优先 (推荐)
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, scope: 'unmastered' }))}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${config.scope === 'unmastered' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-background border border-border text-foreground hover:bg-accent/50'}`}
                >
                  未掌握优先
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, scope: 'stubborn' }))}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${config.scope === 'stubborn' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-background border border-border text-foreground hover:bg-accent/50'}`}
                >
                  顽固错题
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, scope: 'all' }))}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${config.scope === 'all' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-background border border-border text-foreground hover:bg-accent/50'}`}
                >
                  全部错题
                </button>
              </div>
            </div>

            {/* Amount & Sort Toggle */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <label className="text-sm font-semibold text-foreground">题目数量</label>
                <div className="flex bg-secondary/20 p-1 rounded-xl">
                  {[10, 20, 999].map(num => (
                    <button
                      key={num}
                      onClick={() => setConfig(prev => ({ ...prev, amount: num as 10 | 20 | 999 }))}
                      className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${config.amount === num ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {num === 999 ? '不限' : num}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="space-y-3">
                <label className="text-sm font-semibold text-foreground">排序方式</label>
                <select
                  value={config.sortBy}
                  onChange={(event) => setConfig(prev => ({ ...prev, sortBy: event.target.value as ReviewConfig['sortBy'] }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 focus:ring-2 ring-primary/20 outline-none transition-all h-10 text-sm"
                >
                  <option value="nearestDue">最近到期</option>
                  <option value="latestWrong">最近做错</option>
                  <option value="lowestMastery">最低掌握度</option>
                </select>
              </div>
            </div>
          </div>

          <button
            onClick={startReview}
            className="w-full mt-6 rounded-xl bg-primary/10 text-primary px-4 py-3.5 text-base font-bold hover:bg-primary hover:text-primary-foreground transition-all flex items-center justify-center gap-2"
          >
            <Play className="h-5 w-5" />
            开始自定义复习
          </button>
        </section>
      </div>
    </main>
  );
}
