import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Eye, EyeOff, Edit2, Trash2, RotateCcw } from 'lucide-react';
import { getSubjectColor, getErrorTagColor } from '../../lib/subjects';
import type { Question } from '../../lib/types';
import { Button } from '../ui/button';
import { MistakeQuestionPreview } from './MistakeQuestionPreview';

interface QuestionCardProps {
  question: Question;
  onDelete?: (id: string) => void;
  onEdit?: (q: Question) => void;
  readonly?: boolean;
}

export function QuestionCard({ question, onDelete, onEdit, readonly = false }: QuestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  const sc = getSubjectColor(question.subject);
  const ec = getErrorTagColor(question.error_type);

  return (
    <div className={`rounded-2xl bg-card border transition-all duration-200 overflow-hidden ${expanded ? 'border-primary/30 shadow-md' : 'border-border hover:border-primary/20 hover:shadow-sm'}`}>
      {/* Collapsed header */}
      <div
        className="p-5 cursor-pointer"
        onClick={() => { setExpanded(!expanded); setShowAnswer(false); }}
      >
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 w-1 self-stretch rounded-full ${sc.dot}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${sc.bg} ${sc.text}`}>{question.subject}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-muted text-muted-foreground">{question.knowledge_point}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-secondary text-secondary-foreground">{question.ability}</span>
                {question.error_type && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${ec.bg} ${ec.text}`}>
                    {question.error_type}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </div>
            </div>

            {expanded ? (
              <p className="text-sm text-card-foreground leading-relaxed">{question.question_text}</p>
            ) : (
              <MistakeQuestionPreview
                questionText={question.question_text}
                stemClassName="line-clamp-2 text-sm text-card-foreground leading-relaxed"
                optionClassName="inline-flex max-w-[180px] items-center gap-1 rounded-lg border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                showKindBadge
              />
            )}
            {question.image_url && !expanded && (
              <p className="text-xs text-muted-foreground mt-1">[图片]</p>
            )}

            {!expanded && (
              <div className="flex items-center gap-4 mt-3">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />{new Date(question.created_at).toLocaleDateString()}
                </span>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" />复习 {question.review_count} 次
                </span>
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
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={question.image_url} alt="Question" className="max-w-full h-auto" />
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
                    onClick={(e) => { e.stopPropagation(); onDelete?.(question.id); }}
                    className="w-8 h-8 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
