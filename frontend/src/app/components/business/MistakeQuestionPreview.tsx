import { parseQuestionPreview } from '../../lib/questionPreview';
import { normalizeCorrectAnswer } from '../../lib/questionPayload';
import type { QuestionNormalizedPayload, ValidationStatus } from '../../lib/questionPayload';

interface MistakeQuestionPreviewProps {
  questionText: string;
  normalizedPayload?: QuestionNormalizedPayload | null;
  validationStatus?: ValidationStatus;
  className?: string;
  stemClassName?: string;
  optionClassName?: string;
  maxOptions?: number;
  showKindBadge?: boolean;
  userAnswer?: string;
  correctAnswer?: string;
  showResultComparison?: boolean;
  hideOptions?: boolean;
}

export function MistakeQuestionPreview({
  questionText,
  normalizedPayload,
  validationStatus,
  className,
  stemClassName,
  optionClassName,
  maxOptions = 4,
  showKindBadge = false,
  userAnswer,
  correctAnswer,
  showResultComparison = false,
  hideOptions = false,
}: MistakeQuestionPreviewProps) {
  const fallback = parseQuestionPreview(questionText);
  const structuredStem = normalizedPayload?.contentBlocks.find((item) => item.type === 'stem')?.text?.trim();
  const structuredOptions = normalizedPayload?.options || [];
  const stem = structuredStem || fallback.stem;
  const previewOptions = structuredOptions.length > 0 ? structuredOptions : fallback.options;
  const options = previewOptions.slice(0, maxOptions);
  const moreCount = Math.max(0, previewOptions.length - options.length);
  const kind = normalizedPayload?.questionType || fallback.kind;
  const kindLabel = kind === 'choice' ? '选择题' : kind === 'fill' || kind === 'blank' ? '填空题' : kind === 'judge' ? '判断题' : '题干';

  const finalCorrectAnswer = kind === 'choice' && correctAnswer ? normalizeCorrectAnswer(correctAnswer, previewOptions) : correctAnswer;

  return (
    <div className={className ?? 'space-y-3'}>
      <div className="flex items-start justify-between gap-2">
        <p className={stemClassName ?? 'text-[15px] leading-relaxed text-slate-800'}>{stem}</p>
        {showKindBadge && (
          <span className={`inline-flex flex-shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${validationStatus === 'invalid' ? 'border-amber-200 bg-amber-50 text-amber-600' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
            {kindLabel}
          </span>
        )}
      </div>
      {!hideOptions && options.length > 0 && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((opt) => {
            const isUserAnswer = showResultComparison && userAnswer === opt.label;
            const isCorrectAnswer = showResultComparison && finalCorrectAnswer === opt.label;
            
            let finalClassName = optionClassName ?? 'inline-flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600';
            let labelBgClassName = 'bg-slate-100 text-slate-600';
            
            if (showResultComparison) {
              if (isCorrectAnswer) {
                finalClassName = 'inline-flex min-w-0 items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 shadow-sm';
                labelBgClassName = 'bg-emerald-500 text-white';
              } else if (isUserAnswer) {
                finalClassName = 'inline-flex min-w-0 items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 shadow-sm';
                labelBgClassName = 'bg-rose-500 text-white';
              } else {
                finalClassName = 'inline-flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 opacity-60';
              }
            }

            return (
              <span
                key={`${opt.label}-${opt.text}`}
                className={finalClassName}
                title={`${opt.label}. ${opt.text}`}
              >
                <span className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${labelBgClassName}`}>
                  {opt.label}
                </span>
                <span className="min-w-0 flex-1 truncate">{opt.text}</span>
                {showResultComparison && isCorrectAnswer && (
                  <span className="text-emerald-500 font-bold shrink-0">✅</span>
                )}
                {showResultComparison && isUserAnswer && !isCorrectAnswer && (
                  <span className="text-rose-500 font-bold shrink-0">❌</span>
                )}
              </span>
            );
          })}
          {moreCount > 0 && (
            <span className="inline-flex items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-3 py-2 text-xs font-medium text-slate-500">
              还有 {moreCount} 个选项
            </span>
          )}
        </div>
      )}
    </div>
  );
}
