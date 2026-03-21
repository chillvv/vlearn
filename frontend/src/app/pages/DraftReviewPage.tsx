import { useMemo, useState } from 'react';
import { AlertCircle, Check, ImagePlus, Send, Sparkles, Wand2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BlockMath } from 'react-katex';
import { questionsApi } from '../lib/api';
import { toast } from 'sonner';
import 'katex/dist/katex.min.css';

type Step = {
  step: number;
  title: string;
  content: string;
};

type StructuredDraft = {
  subject: string;
  question_text: string;
  core_reason: string;
  detailed_steps: Step[];
  formula_or_rule: string | null;
  prerequisite_knowledge: { title: string; content: string } | null;
  warning_tags: string[];
  original_image_url: string | null;
};

const QUICK_COMMANDS = ['只保留核心步骤', '换个更易懂的口诀', '纠正：这题其实考的是定语从句'];

function createInitialDraft(questionText: string, imageUrl: string | null): StructuredDraft {
  return {
    subject: '英语',
    question_text: questionText || '请粘贴或上传题目后生成草稿',
    core_reason: '长难句结构拆解错误',
    detailed_steps: [
      { step: 1, title: '定位主干', content: '先找到主语、谓语和宾语，排除插入成分干扰。' },
      { step: 2, title: '识别从句', content: '判断定语从句修饰对象，再验证先行词与关系词匹配。' },
      { step: 3, title: '回到选项对比', content: '逐项比对时态与语义一致性，排除过度推理项。' },
    ],
    formula_or_rule: '$$先抓主干\\rightarrow再拆从句\\rightarrow最后校验选项$$',
    prerequisite_knowledge: {
      title: '倒装句的 4 种形态',
      content: `| 类型 | 触发词 | 结构示例 |\n| --- | --- | --- |\n| 否定副词前置 | never, seldom | Never **have I seen**... |\n| only+状语前置 | only then | Only then **did he**... |\n| so/such 前置 | so + adj | So difficult **was it**... |`,
    },
    warning_tags: ['主谓一致', '关系词误选'],
    original_image_url: imageUrl,
  };
}

function applyCommand(draft: StructuredDraft, command: string): StructuredDraft {
  if (command.includes('只保留核心步骤')) {
    return { ...draft, detailed_steps: draft.detailed_steps.slice(0, 2) };
  }
  if (command.includes('更易懂')) {
    return {
      ...draft,
      formula_or_rule: '$$先看主谓\\Rightarrow再看从句\\Rightarrow最后选最稳答案$$',
      core_reason: '先行词定位不稳定',
    };
  }
  if (command.includes('定语从句')) {
    return {
      ...draft,
      core_reason: '定语从句先行词判断偏差',
      warning_tags: ['先行词定位', '关系代词选择'],
    };
  }
  return draft;
}

function stripMathWrapper(input: string) {
  return input.replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\\\(([\s\S]*)\\\)$/, '$1').trim();
}

export function DraftReviewPage() {
  const [questionText, setQuestionText] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<StructuredDraft | null>(null);
  const [command, setCommand] = useState('');
  const [userNote, setUserNote] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = Boolean(draft?.question_text && draft?.core_reason);

  const enhancedImage = useMemo(() => {
    if (!imagePreview) return null;
    return imagePreview;
  }, [imagePreview]);

  const handleUpload = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateDraft = () => {
    setDraft(createInitialDraft(questionText.trim(), enhancedImage));
    toast.success('AI 草稿已生成，请确认后入库');
  };

  const handleApplyCommand = (value: string) => {
    if (!draft) return;
    setDraft(applyCommand(draft, value));
    setCommand('');
    toast.success('草稿已根据指令更新');
  };

  const handleSave = async () => {
    if (!draft || !canSave) return;
    setSaving(true);
    try {
      const note = [
        `核心错因：${draft.core_reason}`,
        ...draft.detailed_steps.map(item => `步骤${item.step} ${item.title}：${item.content}`),
        draft.formula_or_rule ? `公式：${draft.formula_or_rule}` : '',
        userNote ? `我的笔记：${userNote}` : '',
      ].filter(Boolean).join('\n');
      await questionsApi.create({
        subject: draft.subject,
        question_text: draft.question_text,
        image_url: draft.original_image_url || undefined,
        knowledge_point: draft.warning_tags[0] || '综合分析',
        ability: '理解',
        error_type: '概念不清',
        note,
      });
      toast.success('已存入错题库');
      setDraft(null);
      setQuestionText('');
      setUserNote('');
      setImagePreview(null);
      setCommand('');
    } catch (error: any) {
      toast.error(error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto mt-6 w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 md:mt-0">
      <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Wand2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">AI 草稿确认页</h1>
            <p className="text-sm text-gray-500">拍照或粘贴题目后，先确认草稿再入库</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <textarea
            value={questionText}
            onChange={e => setQuestionText(e.target.value)}
            rows={6}
            className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none ring-indigo-400/30 transition focus:border-indigo-300 focus:ring-2"
            placeholder="输入题目文本，或上传图片后点击生成草稿"
          />
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm">
              <ImagePlus className="h-4 w-4" />
              上传题目图片
              <input type="file" accept="image/*" className="hidden" onChange={e => handleUpload(e.target.files?.[0] || null)} />
            </label>
            {enhancedImage && (
              <img
                src={enhancedImage}
                alt="enhanced-preview"
                className="mt-4 max-h-48 w-full rounded-xl border border-gray-200 object-contain bg-white p-2"
                style={{ filter: 'contrast(1.2) brightness(1.08)' }}
              />
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={handleGenerateDraft}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <Sparkles className="h-4 w-4" />
            生成 AI 草稿
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <AlertCircle className="h-3.5 w-3.5" />
            首期采用图像增强，不做生成式重绘
          </span>
        </div>
      </div>

      {draft && (
        <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">结构化草稿预览</h2>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{draft.subject}</span>
          </div>

          {draft.original_image_url && (
            <div className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <img src={draft.original_image_url} alt="original-question" className="max-h-80 w-full rounded-xl object-contain" />
            </div>
          )}

          <div className="space-y-5">
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">核心错因</p>
              <p className="mt-1 text-sm font-medium text-rose-700">{draft.core_reason}</p>
            </div>

            <div className="space-y-3">
              {draft.detailed_steps.map(item => (
                <article key={item.step} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-900">步骤 {item.step} · {item.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{item.content}</p>
                </article>
              ))}
            </div>

            {draft.formula_or_rule && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">公式 / 口诀</p>
                <div className="mt-2 overflow-x-auto rounded-xl bg-white p-3">
                  <BlockMath math={stripMathWrapper(draft.formula_or_rule)} />
                </div>
              </div>
            )}

            {draft.prerequisite_knowledge && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-900">📚 {draft.prerequisite_knowledge.title}</p>
                <div className="prose prose-sm mt-2 max-w-none text-blue-900">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.prerequisite_knowledge.content}</ReactMarkdown>
                </div>
              </div>
            )}

            {draft.warning_tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {draft.warning_tags.map(tag => (
                  <span key={tag} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">#{tag}</span>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">我的专属笔记（可选）</p>
              <textarea
                value={userNote}
                onChange={e => setUserNote(e.target.value)}
                rows={3}
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none ring-indigo-400/30 focus:border-indigo-300 focus:ring-2"
                placeholder="补充你自己的记忆钩子或老师提醒"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:bg-gray-300"
          >
            <Check className="h-4 w-4" />
            {saving ? '保存中...' : '准确无误，存入错题库'}
          </button>
        </div>
      )}

      {draft && (
        <div className="sticky bottom-4 z-20 rounded-2xl border border-indigo-100 bg-white/95 p-3 shadow-[0_12px_30px_-16px_rgba(79,70,229,0.45)] backdrop-blur">
          <p className="mb-2 px-1 text-xs font-semibold text-indigo-600">有偏差？告诉 AI 老师怎么改...</p>
          <div className="mb-2 flex flex-wrap gap-2">
            {QUICK_COMMANDS.map(item => (
              <button
                key={item}
                onClick={() => handleApplyCommand(item)}
                className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2 rounded-xl border border-gray-200 px-3 py-2">
            <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              rows={1}
              className="min-h-[24px] flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none"
              placeholder="输入修改指令"
            />
            <button
              onClick={() => command.trim() && handleApplyCommand(command.trim())}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
