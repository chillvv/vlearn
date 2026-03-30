import { useState, useEffect } from 'react';
import { Sparkles, Play, Check, ChevronRight, RotateCcw } from 'lucide-react';
import { chatApi, weaknessApi, questionsApi } from '../lib/api';
import { toast } from 'sonner';
import type { UserWeakness } from '../lib/types';
import { parseQuestionPreview } from '../lib/questionPreview';
import { normalizeQuestionTags } from '../lib/questionTagEngine';

interface TestQuestion {
  id: string;
  question: string;
  questionType: 'choice' | 'fill' | 'essay';
  options: string[];
  correctAnswer: string;
  analysis: string;
  knowledge: string;
  ability: string;
  userAnswer?: string;
  isCorrect?: boolean;
}

function normalizeChoiceOptions(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item, index) => {
      const parsed = parseQuestionPreview(item);
      if (parsed.options.length > 0) {
        return `${parsed.options[0].label}. ${parsed.options[0].text}`;
      }
      const match = item.match(/^([A-Ha-h1-8])[\.．、:：\)）\]]\s*(.+)$/);
      if (match) {
        const label = match[1].toUpperCase();
        return `${label}. ${match[2].trim()}`;
      }
      const label = String.fromCharCode(65 + index);
      return `${label}. ${item}`;
    });
}

function normalizeCorrectAnswer(answer: string, options: string[]) {
  const raw = String(answer || '').trim();
  
  // Try matching exactly with an option text (ignoring the "A. " part)
  const optionIdxByText = options.findIndex((item) => {
    const textPart = item.replace(/^[A-H][\.．、:：\)）\]]\s*/i, '').trim().toLowerCase();
    return textPart === raw.toLowerCase();
  });
  if (optionIdxByText >= 0) return String.fromCharCode(65 + optionIdxByText);

  // Exact letter match
  const exactLetterMatch = raw.match(/^([A-H])(\.|、|:)?$/i);
  if (exactLetterMatch) return exactLetterMatch[1].toUpperCase();

  // Prefix match (like "A. is")
  const prefixMatch = raw.match(/^([A-H])[\.\s、:]/i);
  if (prefixMatch) return prefixMatch[1].toUpperCase();

  // Single letter match
  if (raw.length === 1 && raw.match(/[A-H]/i)) {
    return raw.toUpperCase();
  }

  return raw;
}

export function TestModePage() {
  const [step, setStep] = useState<'setup' | 'generating' | 'testing' | 'result'>('setup');
  const [weaknesses, setWeaknesses] = useState<UserWeakness[]>([]);
  const [selectedWeaknessId, setSelectedWeaknessId] = useState<string>('');
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    weaknessApi.getAll().then(ws => {
      setWeaknesses(ws);
      if (ws.length > 0) setSelectedWeaknessId(ws[0].id);
    });
  }, []);

  const handleStart = async () => {
    const targetW = weaknesses.find(w => w.id === selectedWeaknessId);
    if (!targetW) return toast.error('请选择要训练的弱点');

    setStep('generating');

    const prompt = `请针对学习弱点生成3道训练题。
    学科相关，知识点是【${targetW.knowledge_point}】，能力维度是【${targetW.ability}】。
    
    出题结构：
    1道基础题，1道变式题，1道综合题。
    
    返回格式必须是纯 JSON 数组，不要有 Markdown 标记。
    JSON 格式如下：
    [
      {
        "question": "题目内容",
        "questionType": "choice" 或 "fill" 或 "essay",
        "options": ["A. ...", "B. ...", "C. ...", "D. ..."] (填空/解答题为空数组),
        "correctAnswer": "答案（单选填字母，填空解答填文字）",
        "analysis": "解析"
      }
    ]
    `;

    try {
      let fullContent = '';
      await chatApi.streamChat(
        [{ role: 'user', content: prompt }],
        () => {},
        (content) => { fullContent = content; },
        (err) => { throw new Error(err); }
      );

      const jsonMatch = fullContent.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('生成格式错误，请重试');
      
      const generated = JSON.parse(jsonMatch[0]).map((q: any, i: number) => {
        const parsedFromStem = parseQuestionPreview(String(q?.question || ''));
        const normalizedType = q?.questionType === 'choice' || q?.questionType === 'fill' || q?.questionType === 'essay'
          ? q.questionType
          : (parsedFromStem.kind === 'choice' ? 'choice' : parsedFromStem.kind === 'blank' ? 'fill' : 'essay');
        const options = normalizeChoiceOptions(q?.options);
        const mergedOptions = options.length > 0 ? options : parsedFromStem.options.map((item) => `${item.label}. ${item.text}`);
        return {
          ...q,
          id: Date.now().toString() + i,
          questionType: normalizedType,
          options: normalizedType === 'choice' ? mergedOptions : [],
          correctAnswer: normalizeCorrectAnswer(String(q?.correctAnswer || ''), mergedOptions),
          knowledge: targetW.knowledge_point,
          ability: targetW.ability,
        };
      });

      setQuestions(generated);
      setStep('testing');
    } catch (err: any) {
      toast.error('生成题目失败: ' + err.message);
      setStep('setup');
    }
  };

  const handleAnswer = (answer: string) => {
    setQuestions(prev => prev.map((q, i) => 
      i === currentIdx ? { ...q, userAnswer: answer } : q
    ));
  };

  const handleNext = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
    } else {
      const graded = questions.map(q => {
        const isCorrect = q.questionType === 'choice' 
          ? q.userAnswer === q.correctAnswer
          : q.userAnswer?.trim() === q.correctAnswer.trim(); 
        return { ...q, isCorrect };
      });
      setQuestions(graded);
      setStep('result');
    }
  };

  const handleSubmitWrong = async (q: TestQuestion) => {
    try {
      const targetW = weaknesses.find(w => w.id === selectedWeaknessId);
      // const formattedQuestionText = formatQuestionTextForStorage(q.question, q.options);
      const canonicalTags = normalizeQuestionTags({
        subject: targetW?.knowledge_point ? undefined : 'C语言',
        knowledgePoint: q.knowledge || targetW?.knowledge_point,
        ability: q.ability || targetW?.ability,
      });
      await questionsApi.create({
        subject: canonicalTags.subject,
        question_text: q.question,
        question_type: q.questionType,
        correct_answer: q.correctAnswer,
        raw_ai_response: JSON.stringify({
          question: q.question,
          questionType: q.questionType,
          options: q.options,
          correctAnswer: q.correctAnswer,
          analysis: q.analysis,
        }),
        knowledge_point: canonicalTags.knowledgePoint,
        ability: canonicalTags.ability,
        error_type: canonicalTags.errorType,
        note: q.analysis,
      });
      toast.success('已回流到错题库，弱点权重增加！');
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    }
  };

  if (step === 'setup') {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-indigo-100">
          <div className="bg-indigo-600 p-6 text-center sm:p-8">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">针对弱点训练</h1>
            <p className="text-indigo-100">AI将根据你的弱点智能生成训练题</p>
          </div>
          
          <div className="space-y-6 p-5 sm:p-8">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">选择要攻克的弱点</label>
              {weaknesses.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4 bg-gray-50 rounded-xl">暂无弱点数据，请先录入错题</p>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {weaknesses.map(w => (
                    <button
                      key={w.id}
                      onClick={() => setSelectedWeaknessId(w.id)}
                      className={`p-4 rounded-xl border text-sm font-medium transition-all text-left flex justify-between items-center ${
                        selectedWeaknessId === w.id 
                          ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500' 
                          : 'border-gray-200 hover:border-indigo-200 hover:bg-gray-50 text-gray-600'
                      }`}
                    >
                      <div>
                        <span className="font-bold text-base block mb-1">{w.knowledge_point}</span>
                        <span className="text-xs opacity-80">{w.ability}</span>
                      </div>
                      <div className="text-xs px-2 py-1 rounded-md bg-white/50 border border-current/10">
                        错误 {w.error_count} 次
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleStart}
              disabled={weaknesses.length === 0}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white rounded-xl font-bold text-lg shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" />
              开始生成训练题
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh]">
        <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-6" />
        <h2 className="text-xl font-bold text-gray-800">AI 正在出题中...</h2>
        <p className="text-gray-500 mt-2">正在根据你的要求生成题目，请稍候</p>
      </div>
    );
  }

  if (step === 'testing') {
    const q = questions[currentIdx];
    const progress = ((currentIdx + 1) / questions.length) * 100;

    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-500">进度 {currentIdx + 1}/{questions.length}</span>
          <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="flex min-h-[360px] flex-col rounded-3xl border border-indigo-100 bg-white p-5 shadow-sm sm:min-h-[400px] sm:p-8">
          <div className="flex-1">
            <span className="inline-block px-3 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold mb-4">
              {q.questionType === 'choice' ? '单选题' : '填空题'}
            </span>
            <h2 className="text-xl font-bold text-gray-900 mb-6 leading-relaxed">{q.question}</h2>

            {q.questionType === 'choice' ? (
              <div className="space-y-3">
                {q.options.map((opt, i) => {
                  const optionText = parseQuestionPreview(opt).options[0];
                  const optLetter = optionText?.label || opt.match(/^[A-Z]/)?.[0] || '';
                  const optContent = optionText?.text || opt.replace(/^[A-Z][\.．、:：\)）\]]\s*/, '');
                  const isSelectedLetter = q.userAnswer === optLetter;

                  return (
                    <button
                      key={i}
                      onClick={() => handleAnswer(optLetter)}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center gap-3 ${
                        isSelectedLetter
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                          : 'border-gray-100 hover:border-indigo-200 hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                        isSelectedLetter ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-500'
                      }`}>
                        {optLetter}
                      </span>
                      <span className="text-base">{optContent}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={q.userAnswer || ''}
                onChange={e => handleAnswer(e.target.value)}
                placeholder="请输入答案..."
                className="w-full p-4 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all text-base min-h-[150px]"
              />
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
            <button
              onClick={handleNext}
              disabled={!q.userAnswer}
              className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
            >
              {currentIdx === questions.length - 1 ? '提交试卷' : '下一题'}
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Result step
  const correctCount = questions.filter(q => q.isCorrect).length;
  const score = Math.round((correctCount / questions.length) * 100);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-indigo-100 text-indigo-600 mb-4 text-3xl font-bold">
          {score}
        </div>
        <h1 className="text-3xl font-bold text-gray-900">测试完成</h1>
        <p className="text-gray-500 mt-2">答对 {correctCount} / {questions.length} 题</p>
        <button 
          onClick={() => { setStep('setup'); setQuestions([]); setCurrentIdx(0); }}
          className="mt-6 px-6 py-2.5 border border-gray-300 hover:bg-gray-50 rounded-xl text-sm font-semibold text-gray-700 transition-colors inline-flex items-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          再测一次
        </button>
      </div>

      <div className="space-y-6">
        {questions.map((q, i) => (
          <div key={i} className={`bg-white rounded-2xl border-l-4 p-6 shadow-sm ${q.isCorrect ? 'border-l-green-500' : 'border-l-red-500'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold text-gray-400">#{i + 1}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-bold ${q.isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {q.isCorrect ? '正确' : '错误'}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">{q.question}</h3>
                
                <div className="mb-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <span className="block text-xs font-semibold text-gray-400 mb-1">你的答案</span>
                    <span className={`font-medium ${q.isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                      {q.userAnswer}
                    </span>
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg">
                    <span className="block text-xs font-semibold text-green-600/70 mb-1">正确答案</span>
                    <span className="font-medium text-green-800">{q.correctAnswer}</span>
                  </div>
                </div>

                <div className="bg-indigo-50/50 p-4 rounded-xl">
                  <span className="block text-xs font-bold text-indigo-400 mb-1 uppercase tracking-wider">解析</span>
                  <p className="text-sm text-indigo-900/80 leading-relaxed">{q.analysis}</p>
                </div>
              </div>

              {!q.isCorrect && (
                <button
                  onClick={(e) => {
                    const btn = e.currentTarget;
                    btn.disabled = true;
                    btn.textContent = '已加入';
                    handleSubmitWrong(q);
                  }}
                  className="flex-shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  加入错题库
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
