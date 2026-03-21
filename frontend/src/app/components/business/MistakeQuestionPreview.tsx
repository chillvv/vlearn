import { parseQuestionPreview } from '../../lib/questionPreview';

interface MistakeQuestionPreviewProps {
  questionText: string;
  className?: string;
  stemClassName?: string;
  optionClassName?: string;
  maxOptions?: number;
  showKindBadge?: boolean;
}

export function MistakeQuestionPreview({
  questionText,
  className,
  stemClassName,
  optionClassName,
  maxOptions = 4,
  showKindBadge = false,
}: MistakeQuestionPreviewProps) {
  const preview = parseQuestionPreview(questionText);
  const options = preview.options.slice(0, maxOptions);
  const moreCount = Math.max(0, preview.options.length - options.length);
  const kindLabel = preview.kind === 'choice' ? '选择题' : preview.kind === 'blank' ? '填空题' : preview.kind === 'judge' ? '判断题' : '题干';

  return (
    <div className={className ?? 'space-y-2'}>
      <div className="flex items-start justify-between gap-2">
        <p className={stemClassName ?? 'text-sm leading-relaxed text-slate-700'}>{preview.stem}</p>
        {showKindBadge && (
          <span className="inline-flex flex-shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            {kindLabel}
          </span>
        )}
      </div>
      {options.length > 0 && (
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {options.map((opt) => (
            <span
              key={`${opt.label}-${opt.text}`}
              className={optionClassName ?? 'inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-gradient-to-r from-slate-50 to-white px-2.5 py-1 text-[11px] text-slate-600'}
              title={`${opt.label}. ${opt.text}`}
            >
              <span className="inline-flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded-md bg-slate-900/90 text-[10px] font-bold text-white">
                {opt.label}
              </span>
              <span className="min-w-0 truncate">{opt.text}</span>
            </span>
          ))}
          {moreCount > 0 && (
            <span className="inline-flex items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              还有 {moreCount} 个选项
            </span>
          )}
        </div>
      )}
    </div>
  );
}
