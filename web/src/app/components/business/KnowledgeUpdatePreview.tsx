import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { buildKnowledgeMarkdownDiff } from '../../lib/knowledgeContent';

type KnowledgeUpdatePreviewProps = {
  existingMarkdown: string;
  suggestedMarkdown: string;
  decision: 'skip' | 'rewrite' | 'create';
}

export function KnowledgeUpdatePreview(props: KnowledgeUpdatePreviewProps) {
  const existingMarkdown = String(props.existingMarkdown || '').trim();
  const suggestedMarkdown = String(props.suggestedMarkdown || '').trim();
  const diffLines = buildKnowledgeMarkdownDiff(existingMarkdown, suggestedMarkdown);

  if (props.decision === 'skip') {
    return (
      <div className="obsidian-markdown prose prose-sm max-w-none text-gray-700 leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {existingMarkdown || '当前内容已足够覆盖本次信息'}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
          <p className="mb-2 text-xs font-medium text-gray-500">当前内容</p>
          {existingMarkdown ? (
            <div className="obsidian-markdown prose prose-sm max-w-none text-gray-600 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {existingMarkdown}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="min-h-24 rounded-lg bg-white/70" />
          )}
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-emerald-700">AI 修改痕迹</p>
            <span className="text-[10px] text-emerald-700">红色删除 · 绿色新增</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-emerald-100 bg-white/80">
            <pre className="min-h-24 whitespace-pre-wrap break-words p-3 font-mono text-xs leading-6 text-slate-700">
              {diffLines.length > 0 ? diffLines.map((line, index) => (
                <div
                  key={`${line.type}-${index}-${line.content}`}
                  className={
                    line.type === 'removed'
                      ? 'mx-[-0.5rem] px-2 text-red-700 bg-red-50'
                      : line.type === 'added'
                      ? 'mx-[-0.5rem] px-2 text-emerald-700 bg-emerald-50'
                      : 'text-slate-500'
                  }
                >
                  <span className="inline-block w-4 select-none">
                    {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
                  </span>
                  <span>{line.content || ' '}</span>
                </div>
              )) : (
                <div className="text-slate-400">无差异</div>
              )}
            </pre>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-emerald-100 bg-white p-3">
        <p className="mb-2 text-xs font-medium text-emerald-700">修改后预览</p>
        {suggestedMarkdown ? (
          <div className="obsidian-markdown prose prose-sm prose-emerald max-w-none text-gray-700 leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {suggestedMarkdown}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="min-h-24 rounded-lg bg-emerald-50/50" />
        )}
      </div>
    </div>
  );
}
