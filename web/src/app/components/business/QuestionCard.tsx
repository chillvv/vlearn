import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Eye, EyeOff, Edit2, Trash2, RotateCcw, Archive, ArchiveRestore, Sparkles } from 'lucide-react';
import { getSubjectColor } from '../../lib/subjects';
import type { Question } from '../../lib/types';
import { Button } from '../ui/button';
import { MistakeQuestionPreview } from './MistakeQuestionPreview';

interface QuestionCardProps {
  question: Question;
  onDelete?: (id: string) => void;
  onEdit?: (q: Question) => void;
  onToggleArchive?: (q: Question) => void;
  onAskQuestion?: (q: Question) => void;
  readonly?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
}

export function QuestionCard({ question, onDelete, onEdit, onToggleArchive, onAskQuestion, readonly = false, selectable = false, selected = false, onSelect }: QuestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  const sc = getSubjectColor(question.subject);
  const archived = Boolean(question.is_archived || question.mastery_state === 'archived');

  return (
    <div className={`rounded-2xl bg-card border transition-all duration-200 overflow-hidden ${expanded ? 'border-primary/30 shadow-md' : 'border-border hover:border-primary/20 hover:shadow-sm'} ${selected ? 'border-indigo-400 bg-indigo-50/20' : ''}`}>
      {/* Collapsed header */}
      <div
        className="p-5 cursor-pointer"
        onClick={() => {
          if (selectable && onSelect) {
            onSelect(!selected);
          } else {
            setExpanded(!expanded);
            setShowAnswer(false);
          }
        }}
      >
        <div className="flex items-start gap-3">
          {selectable && (
            <div className="flex items-center justify-center pt-1" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected}
                onChange={e => onSelect?.(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 transition-colors cursor-pointer"
              />
            </div>
          )}
          <div className={`flex-shrink-0 w-1 self-stretch rounded-full ${sc.dot}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${sc.bg} ${sc.text}`}>{question.subject}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-muted text-muted-foreground">{question.knowledge_point}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </div>
            </div>

            {expanded ? (
              <MistakeQuestionPreview
                questionText={question.question_text}
                normalizedPayload={question.normalized_payload}
                validationStatus={question.validation_status}
                stemClassName="text-sm text-card-foreground leading-relaxed"
                optionClassName="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-gradient-to-r from-slate-50 to-white px-2.5 py-1 text-[11px] text-slate-600"
                maxOptions={8}
                showKindBadge
              />
            ) : (
              <MistakeQuestionPreview
                questionText={question.question_text}
                normalizedPayload={question.normalized_payload}
                validationStatus={question.validation_status}
                stemClassName="line-clamp-2 text-sm text-card-foreground leading-relaxed"
                optionClassName="inline-flex max-w-[180px] items-center gap-1 rounded-lg border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                showKindBadge
              />
            )}
            {question.image_url && !expanded && (
              <p className="text-xs text-muted-foreground mt-1">[图片]</p>
            )}

            {!expanded && (
              <div className="mt-3 flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />{new Date(question.created_at).toLocaleDateString()}
                </span>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" />复习 {question.review_count} 次
                </span>
                {!readonly && !selectable && onAskQuestion && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAskQuestion(question);
                    }}
                    className="ml-auto h-7 rounded-full px-3 text-[11px] font-medium"
                  >
                    <Sparkles className="mr-1 h-3.5 w-3.5" />
                    问这题
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-5 pb-5">
          <div className="pt-4 space-y-4">
            
            {question.image_url && (
              <div className="rounded-lg overflow-hidden border border-border flex justify-center items-center min-h-[100px] bg-muted/30">
                <img src={question.image_url} alt="Question" className="max-w-full h-auto" loading="lazy" decoding="async" />
              </div>
            )}

            {/* Note reveal */}
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => { e.stopPropagation(); setShowAnswer(!showAnswer); }}
                className="rounded-xl flex items-center gap-2"
              >
                {showAnswer ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showAnswer ? '隐藏解析' : '查看解析'}
              </Button>
              {showAnswer && (
                <div className="mt-3 space-y-3">
                  {question.note ? (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-xl p-4">
                      <p className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1.5">解析笔记</p>
                      <p className="text-sm text-blue-900 dark:text-blue-200 leading-relaxed whitespace-pre-wrap">{question.note}</p>
                    </div>
                  ) : (
                    <div className="bg-muted rounded-xl p-4 text-center text-sm text-muted-foreground">
                      暂无解析笔记
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer stats + actions */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" />已复习{question.review_count}次
                </span>
              </div>
              {!readonly && (
                <div className="flex items-center gap-1">
                  {onAskQuestion && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAskQuestion(question);
                      }}
                      className="h-8 rounded-xl px-3 text-xs"
                    >
                      <Sparkles className="mr-1 h-3.5 w-3.5" />
                      问这题
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); onEdit?.(question); }}
                    className="w-8 h-8 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); onToggleArchive?.(question); }}
                    className="w-8 h-8 rounded-xl text-muted-foreground hover:text-amber-600 hover:bg-amber-100/50"
                  >
                    {archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  </Button>
                  <DeleteConfirmButton onDelete={() => onDelete?.(question.id)} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DeleteConfirmButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <Button
      variant="destructive"
      size="sm"
      onClick={(e) => { e.stopPropagation(); onDelete(); }}
      onMouseLeave={() => setConfirming(false)}
      className="h-8 rounded-xl text-xs px-3 font-bold"
    >
      确定删除?
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
      className="w-8 h-8 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </Button>
  );
}
