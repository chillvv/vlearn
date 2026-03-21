import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Bot, Check, ChevronDown, MessageCircle, Rocket, Send, Sparkles, TriangleAlert, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BlockMath } from 'react-katex';
import { questionsApi } from '../lib/api';
import type { Question, Subject } from '../lib/types';
import { toast } from 'sonner';
import 'katex/dist/katex.min.css';

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

  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      let result = await questionsApi.getAll({ subject, category, l2, nodes: [node], sortBy: 'lowestMastery' });
      if (result.length === 0) {
        result = await questionsApi.getAll({ subject, nodes: [node], sortBy: 'lowestMastery' });
      }
      if (result.length === 0) {
        const fallback = await questionsApi.getAll({ subject, sortBy: 'lowestMastery' });
        result = fallback.filter(item => (item.node || item.knowledge_point || '其他') === node);
      }
      setItems(result);
      setLoading(false);
    };
    void load();
  }, [subject, category, l2, node]);

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

  const generatedTips = useMemo(() => {
    return [
      `先确认题目是否属于「${node}」再进入求解步骤。`,
      `本节点高频错因是「${topErrorType}」，优先检查边界条件。`,
      '先写一句个人复盘，再看 AI 解析，记忆保持更稳定。',
    ];
  }, [node, topErrorType]);

  return (
    <div className="min-h-screen bg-[#F9FAFB] pb-32">
      <main className="mx-auto w-full max-w-5xl space-y-8 px-4 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        
        {/* 1. Header & Stats */}
        <div className="flex flex-col gap-6">
          <div>
            <button 
              type="button"
              onClick={() => navigate('/questions')} 
              className="group flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              返回错题资产
            </button>
          </div>
          
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3 font-medium">
                <span>{subject}</span>
                <span>›</span>
                <span>{category}</span>
                <span>›</span>
                <span className="text-foreground">{l2}</span>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">{node}</h1>
            </div>
            
            <div className="flex items-center gap-5 rounded-3xl border border-gray-100 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-5">
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
                  <span>错题 <strong className="text-gray-900 text-sm">{items.length}</strong> 道</span>
                  <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                  <span>待攻克 <strong className="text-indigo-600 text-sm">{unresolvedCount}</strong> 道</span>
                </div>
                <div className="text-xs text-gray-500 font-medium">
                  核心错因：<span className="text-rose-500">{topErrorType}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <AITipsCard tips={generatedTips} topErrorType={topErrorType} />

        <div className="space-y-6 mt-12">
          <h2 className="text-xl font-bold text-gray-900">此考点下的全部错题 ({items.length} 道)</h2>
          
          {loading ? (
            <div className="rounded-3xl border border-gray-100 bg-white p-12 text-center text-muted-foreground shadow-sm">
              正在加载错题...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white p-12 text-center text-muted-foreground shadow-sm">
              当前节点暂无错题
            </div>
          ) : (
            <div className="space-y-6">
              {items.map((item) => (
                <MistakeCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </main>

      <div className="fixed bottom-6 left-0 right-0 z-50 flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-3xl px-4 sm:px-6">
          <button 
            type="button"
            onClick={() => navigate('/practice')}
            className="w-full py-4 rounded-2xl bg-gray-900 text-white font-bold text-base shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.2)] hover:-translate-y-1 transition-all duration-300 flex items-center justify-center gap-2"
          >
            <Rocket className="w-5 h-5 text-indigo-400" />
            我已复习完毕，开启专属冲刺 (生成 3 道变式题)
          </button>
        </div>
      </div>
    </div>
  );
}

function AITipsCard({ tips, topErrorType }: { tips: string[], topErrorType: string }) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-50/80 via-purple-50/50 to-amber-50/80 border border-indigo-100/50 shadow-[0_4px_20px_-4px_rgba(79,70,229,0.05)] transition-all duration-300">
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-white/40 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white shadow-sm border border-indigo-50 shrink-0">
            <Sparkles className="w-6 h-6 text-indigo-500" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-lg">✨ AI 专属提分锦囊</h3>
            <p className="text-sm text-gray-600 mt-1 font-medium">
              💡 AI 诊断：该考点常见错因为「<span className="text-rose-500">{topErrorType}</span>」。
            </p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-indigo-600 font-semibold bg-white/60 px-4 py-2 rounded-full shadow-sm border border-indigo-100/50">
          <span>{isOpen ? '收起锦囊' : '展开锦囊'}</span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>
      <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <ul className="mx-6 mb-6 border-t border-indigo-100/60 pt-4 space-y-3">
            {tips.map((tip, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm text-gray-700 font-medium">
                <span className="mt-0.5 text-indigo-500">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function MistakeCard({ item }: { item: Question }) {
  const [expanded, setExpanded] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [activeStep, setActiveStep] = useState('');
  const detail = useMemo(() => parseStructuredDetail(item), [item]);
  
  return (
    <article className="bg-white rounded-3xl p-6 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.03)] border border-gray-100 transition-all duration-300 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3 text-xs font-medium">
          <span className="text-gray-500">
            {new Date(item.created_at).toLocaleDateString() === new Date().toLocaleDateString() 
              ? '今天' 
              : '昨天'}
          </span>
          <span className="px-2.5 py-1 bg-gray-50 text-gray-600 rounded-md border border-gray-100">
            #{item.error_type || '理解偏差'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
           <span>掌握度</span>
           <div className="w-12 h-1.5 rounded-full bg-gray-100 overflow-hidden">
             <div 
               className="h-full bg-indigo-500 rounded-full transition-all duration-1000" 
               style={{ width: `${item.mastery_level || 0}%` }}
             ></div>
           </div>
        </div>
      </div>
      
      <div className="text-gray-800 text-base leading-relaxed font-serif tracking-wide mb-6">
        {item.question_text}
      </div>
      
      {!expanded && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-rose-50/50 border border-rose-100/50 mb-4">
          <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-bold text-sm">
            !
          </div>
          <div className="text-rose-600 font-medium text-sm flex items-center gap-2">
            <span>核心错因：{detail.coreReason}</span>
          </div>
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

            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">核心错因</p>
              <p className="mt-1 text-sm font-semibold text-rose-700">{detail.coreReason}</p>
            </div>

            {detail.steps.map(step => (
              <div key={`${item.id}-${step.step}`} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900">步骤 {step.step} · {step.title}</p>
                  <button
                    onClick={() => {
                      setActiveStep(step.title);
                      setAiOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    对这一步有疑问？
                  </button>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">{step.content}</p>
              </div>
            ))}

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
                <p className="text-sm font-semibold text-blue-900">📚 {detail.prerequisite.title}</p>
                <div className="prose prose-sm mt-2 max-w-none text-blue-900">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.prerequisite.content}</ReactMarkdown>
                </div>
              </div>
            )}

            {detail.warningTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detail.warningTags.map(tag => (
                  <span key={tag} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">#{tag}</span>
                ))}
              </div>
            )}

            <UserNoteEditor item={item} initialValue={detail.userNote} />

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => toast.success('已记录本条解析问题，稍后将用于模型优化')}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                <TriangleAlert className="h-3.5 w-3.5" />
                报告解析错误
              </button>
              <button
                onClick={() => {
                  setActiveStep('整题');
                  setAiOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                召唤 AI 私教
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="mt-4">
        <button 
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={`w-full py-3.5 rounded-2xl border font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2
            ${expanded 
              ? 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200' 
              : 'bg-indigo-50 border-indigo-100 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200 shadow-sm'
            }`}
        >
          {expanded ? '收起解析' : '查看正确答案与 AI 解析'}
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <ContextualAIPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        questionText={item.question_text}
        stepTitle={activeStep}
      />
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
};

function parseStructuredDetail(item: Question): StructuredDetail {
  const lines = (item.note || '').split('\n').map(line => line.trim()).filter(Boolean);
  const coreLine = lines.find(line => line.startsWith('核心错因：'));
  const formulaLine = lines.find(line => line.startsWith('公式：'));
  const noteLine = lines.find(line => line.startsWith('我的笔记：'));
  const stepLines = lines.filter(line => /^步骤\d+\s/.test(line));
  const steps = stepLines.map(line => {
    const match = line.match(/^步骤(\d+)\s(.+?)：(.*)$/);
    return {
      step: Number(match?.[1] || 1),
      title: match?.[2] || '解题步骤',
      content: match?.[3] || line,
    };
  });
  return {
    coreReason: coreLine?.replace('核心错因：', '') || item.error_type || '理解偏差',
    steps: steps.length > 0 ? steps : [{ step: 1, title: '核心解析', content: item.note || '请先定位题干核心信息，再逐项验证。' }],
    formula: formulaLine?.replace('公式：', '') || null,
    prerequisite: item.summary
      ? { title: '必备前置知识', content: item.summary }
      : null,
    warningTags: [item.error_type, item.knowledge_point].filter(Boolean) as string[],
    originalImageUrl: item.image_url || null,
    userNote: noteLine?.replace('我的笔记：', '') || '',
  };
}

function stripMathWrapper(input: string) {
  return input.replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\\\(([\s\S]*)\\\)$/, '$1').trim();
}

function UserNoteEditor({ item, initialValue }: { item: Question; initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const lines = (item.note || '').split('\n').filter(line => line && !line.startsWith('我的笔记：'));
      const merged = [...lines, value ? `我的笔记：${value}` : ''].filter(Boolean).join('\n');
      await questionsApi.update(item.id, { note: merged });
      toast.success('个人笔记已置顶保存');
    } catch (error: any) {
      toast.error(error?.message || '笔记保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">我的专属笔记（置顶）</p>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={3}
        className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none ring-indigo-400/30 focus:border-indigo-300 focus:ring-2"
        placeholder="例如：先划关系词，再找先行词，最后核对时态"
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 inline-flex items-center gap-1 rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:bg-gray-400"
      >
        <Check className="h-3.5 w-3.5" />
        {saving ? '保存中...' : '保存笔记'}
      </button>
    </div>
  );
}

function ContextualAIPanel({
  open,
  onClose,
  questionText,
  stepTitle,
}: {
  open: boolean;
  onClose: () => void;
  questionText: string;
  stepTitle: string;
}) {
  const [messages, setMessages] = useState<Array<{ role: 'assistant' | 'user'; content: string }>>([
    { role: 'assistant', content: '我已加载当前错题上下文。你可以继续追问细节。' },
  ]);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const handleSend = () => {
    if (!input.trim()) return;
    const ask = input.trim();
    setMessages(prev => [
      ...prev,
      { role: 'user', content: ask },
      { role: 'assistant', content: `关于「${stepTitle || '整题'}」，建议先回到题干定位关键词，再逐步验证每个推理环节。` },
    ]);
    setInput('');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 h-[60vh] rounded-t-3xl bg-white shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-[430px] md:rounded-none">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-gray-900">AI 私教助手</p>
            <p className="text-xs text-gray-500">上下文：{stepTitle || '整题'} · {questionText.slice(0, 16)}...</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-[calc(100%-126px)] space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((msg, idx) => (
            <div key={`${msg.role}-${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                {msg.content}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 p-3">
          <div className="flex items-end gap-2 rounded-xl border border-gray-200 px-3 py-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              rows={1}
              className="min-h-[24px] flex-1 resize-none bg-transparent text-sm outline-none"
              placeholder="继续追问这一步..."
            />
            <button onClick={handleSend} className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
