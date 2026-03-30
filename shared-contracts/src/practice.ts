export type PracticeSubject = '英语' | 'C语言';

export type PracticeStrategy = '递进' | '随机' | '攻坚';

export type PracticeQuestionType = 'choice' | 'fill';

export interface PracticeGeneratedQuestion {
  level: number;
  question_type: PracticeQuestionType;
  question_text: string;
  options: string[];
  correct_answer: string;
  acceptable_answers: string[];
  explanation: string;
}
