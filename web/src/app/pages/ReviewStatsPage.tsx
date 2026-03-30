import { useState } from 'react';
import { useNavigate } from 'react-router';
import { questionsApi } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, PieChart, Pie, Legend } from 'recharts';
import { ArrowLeft, BarChart3, AlertTriangle, PieChart as PieChartIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';

const REVIEW_PATTERN_LABELS: Record<string, string> = {
  repeat_same_option: '重复误选',
  keyword_missing: '关键词缺失',
  knowledge_gap: '知识断层',
  careless: '粗心失误',
  unknown: '待归类',
};

const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#F43F5E', '#6B7280'];

type StatRecord = {
  date_key: string;
  date_label: string;
  error_pattern: string;
  count: number;
};

export function ReviewStatsPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState<7 | 30>(7);
  const statsQuery = useQuery({
    queryKey: queryKeys.globalErrorStats(days),
    queryFn: () => questionsApi.getGlobalErrorStats(days),
    staleTime: 60 * 1000,
  });
  const stats = (statsQuery.data || []) as StatRecord[];
  const loading = statsQuery.isLoading || statsQuery.isFetching;
  const loadError = statsQuery.error instanceof Error ? statsQuery.error.message : '';

  // Aggregate by pattern for Pie chart
  const patternCounts = stats.reduce((acc, curr) => {
    acc[curr.error_pattern] = (acc[curr.error_pattern] || 0) + curr.count;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(patternCounts)
    .map(([key, value]) => ({
      name: REVIEW_PATTERN_LABELS[key] || key,
      value,
    }))
    .sort((a, b) => b.value - a.value);

  // Aggregate by date for Bar chart
  const dates = Array.from(new Set(stats.map((s) => s.date_key))).sort();
  const barData = dates.map((dateKey) => {
    const dateLabel = stats.find((item) => item.date_key === dateKey)?.date_label || dateKey.slice(5);
    const record: any = { date: dateLabel };
    let total = 0;
    stats.filter((s) => s.date_key === dateKey).forEach((s) => {
      const label = REVIEW_PATTERN_LABELS[s.error_pattern] || s.error_pattern;
      record[label] = (record[label] || 0) + s.count;
      total += s.count;
    });
    record.total = total;
    return record;
  });

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/review')}
            className="p-2 hover:bg-secondary/80 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-foreground" />
          </button>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            全局错因分析
          </h1>
        </div>
        
        <div className="flex bg-secondary/30 rounded-lg p-1">
          <button 
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${days === 7 ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setDays(7)}
          >
            近 7 天
          </button>
          <button 
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${days === 30 ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setDays(30)}
          >
            近 30 天
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center h-64 bg-card rounded-2xl border border-border">
          <AlertTriangle className="w-12 h-12 text-rose-500 mb-4 opacity-80" />
          <p className="text-foreground mb-2">统计加载失败</p>
          <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
          <button
            type="button"
            onClick={() => void statsQuery.refetch()}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/60"
          >
            重试
          </button>
        </div>
      ) : stats.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 bg-card rounded-2xl border border-border">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          <p className="text-muted-foreground">暂无错因数据，快去复习吧！</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart: Overall Distribution */}
          <section className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2 mb-6">
              <PieChartIcon className="w-5 h-5 text-primary" />
              错因分布占比
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Bar Chart: Trend over time */}
          <section className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2 mb-6">
              <BarChart3 className="w-5 h-5 text-primary" />
              每日错因趋势
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis 
                    dataKey="date" 
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
                  <Legend verticalAlign="bottom" height={36} />
                  {Object.values(REVIEW_PATTERN_LABELS).map((label, index) => (
                    <Bar key={label} dataKey={label} stackId="a" fill={COLORS[index % COLORS.length]} radius={index === 0 ? [0, 0, 4, 4] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
