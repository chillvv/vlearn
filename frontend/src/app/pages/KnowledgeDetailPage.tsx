import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Check, Pencil, Save } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { toast } from 'sonner';
import { getMergedKnowledgeContent, normalizeKnowledgeMarkdown, readLearningContentState, writeLearningContentState } from '../lib/knowledgeContent';
import 'katex/dist/katex.min.css';

export function KnowledgeDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const subject = searchParams.get('subject') || '英语';
  const category = searchParams.get('category') || '未分类';
  const l2 = searchParams.get('l2') || '核心考点';
  const node = searchParams.get('node') || '其他';
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);

  const learningState = useMemo(() => readLearningContentState(), [version]);
  const data = useMemo(() => getMergedKnowledgeContent(node, learningState.drawerByTag), [node, learningState]);
  const tips = learningState.tipsByNode[node] || [];

  const [summaryDraft, setSummaryDraft] = useState(data.summary || '');
  const [tipsDraft, setTipsDraft] = useState(tips.join('\n'));
  const [markdownDraft, setMarkdownDraft] = useState(data.markdown || '');

  const startEdit = () => {
    setSummaryDraft(data.summary || '');
    setTipsDraft(tips.join('\n'));
    setMarkdownDraft(data.markdown || '');
    setEditing(true);
  };

  const saveEdit = () => {
    const next = readLearningContentState();
    const nextTips = tipsDraft.split('\n').map(item => item.trim()).filter(Boolean);
    next.tipsByNode[node] = nextTips;
    next.drawerByTag[node] = {
      ...(next.drawerByTag[node] || {}),
      summary: summaryDraft.trim(),
      markdown: normalizeKnowledgeMarkdown(markdownDraft),
    };
    writeLearningContentState(next);
    setEditing(false);
    setVersion(prev => prev + 1);
    toast.success('知识点文档已更新');
  };

  return (
    <div className="h-screen overflow-hidden bg-[#F8FAFC]">
      <div className="h-full max-w-5xl mx-auto px-4 md:px-8 py-6 flex flex-col">
        <div className="shrink-0 flex items-center justify-between mb-4">
          <div>
            <button
              type="button"
              onClick={() => navigate(`/questions/node?subject=${encodeURIComponent(subject)}&category=${encodeURIComponent(category)}&l2=${encodeURIComponent(l2)}&node=${encodeURIComponent(node)}`)}
              className="group mb-3 flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              返回标签详情
            </button>
            <p className="text-xs text-gray-500">{subject} › {category} › {l2}</p>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">{node} · 完整知识体系</h1>
          </div>
          {!editing ? (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <Pencil className="h-4 w-4" />
              编辑文档
            </button>
          ) : (
            <button
              type="button"
              onClick={saveEdit}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
            >
              <Save className="h-4 w-4" />
              保存修改
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto rounded-3xl border border-gray-100 bg-white p-6 md:p-8 shadow-sm">
          {!editing ? (
            <div className="space-y-6">
              {tips.length > 0 && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-2">提分建议</p>
                  <ul className="space-y-1.5">
                    {tips.map((tip, idx) => (
                      <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <article className="obsidian-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {data.markdown}
                </ReactMarkdown>
              </article>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">AI 总结（支持 Markdown）</p>
                <textarea
                  rows={4}
                  value={summaryDraft}
                  onChange={e => setSummaryDraft(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">提分建议（每行一条）</p>
                <textarea
                  rows={4}
                  value={tipsDraft}
                  onChange={e => setTipsDraft(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">完整知识点 Markdown</p>
                <textarea
                  rows={20}
                  value={markdownDraft}
                  onChange={e => setMarkdownDraft(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div className="pt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
                >
                  <Check className="h-4 w-4" />
                  保存并应用
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
