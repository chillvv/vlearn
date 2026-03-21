import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { questionsApi } from '../lib/api';
import type { Subject, VariantQuestion } from '../lib/types';
import { Brain, Dice5, Flame, Target, Sparkles, Clock, ArrowRight, BookOpen, Calculator, BarChart3, X, Lightbulb, CheckCircle2, ChevronRight, TrendingUp } from 'lucide-react';
import { Slider } from '../components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';

type DrillStatus = 'configuring' | 'ready' | 'loading' | 'active' | 'completed';

type DrillConfig = {
  subject: Subject;
  nodes: string[];
  amount: number;
  strategy: '递进' | '随机' | '攻坚';
};

type PresetState = {
  preset?: Partial<DrillConfig>;
};

const defaultConfig: DrillConfig = {
  subject: '英语',
  nodes: [],
  amount: 10,
  strategy: '递进',
};

// Mock mastery data
const getMockMastery = (node: string) => {
  const hash = node.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return (hash % 60) + 30; // 30% to 90%
};

const getMasteryColor = (mastery: number) => {
  if (mastery < 50) return 'text-destructive bg-destructive/10 border-destructive/20';
  if (mastery < 80) return 'text-amber-600 bg-amber-500/10 border-amber-500/20';
  return 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20';
};

export function TargetedDrillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as PresetState;

  const [status, setStatus] = useState<DrillStatus>('configuring');
  const [allNodes, setAllNodes] = useState<{name: string, mastery: number}[]>([]);
  const [config, setConfig] = useState<DrillConfig>(defaultConfig);
  const [questions, setQuestions] = useState<VariantQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [correctCount, setCorrectCount] = useState(0);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  const [showAiHint, setShowAiHint] = useState(false);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);

  useEffect(() => {
    let timer: any;
    if (status === 'active') {
      timer = setInterval(() => setTimeElapsed(t => t + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleExit = () => {
    if (window.confirm('当前进度将不会保存，确定要退出练习吗？')) {
      setStatus('configuring');
    }
  };

  useEffect(() => {
    const load = async () => {
      const qs = await questionsApi.getAll({ subject: config.subject });
      const nodesSet = Array.from(new Set(qs.map(item => item.node || item.knowledge_point).filter(Boolean)));
      const nodesWithMastery = nodesSet.map(n => ({
        name: n,
        mastery: getMockMastery(n)
      })).sort((a, b) => a.mastery - b.mastery);
      setAllNodes(nodesWithMastery);
      
      // Auto-select lowest mastery node if none selected
      if (config.nodes.length === 0 && nodesWithMastery.length > 0) {
        setConfig(prev => ({ ...prev, nodes: [nodesWithMastery[0].name] }));
      }
    };
    void load();
  }, [config.subject]);

  useEffect(() => {
    if (state.preset) {
      setConfig(prev => ({
        ...prev,
        ...state.preset,
      }));
    }
    setStatus('ready');
  }, [state.preset]);

  const currentQuestion = questions[currentIdx];
  const progress = questions.length > 0 ? `${currentIdx + 1}/${questions.length}` : '0/0';

  const canGenerate = useMemo(
    () => config.nodes.length > 0 && config.amount > 0 && status !== 'loading',
    [config.nodes.length, config.amount, status],
  );

  const toggleNode = (node: string) => {
    setConfig(prev => ({
      ...prev,
      nodes: prev.nodes.includes(node) ? prev.nodes.filter(item => item !== node) : [...prev.nodes, node],
    }));
  };

  const autoSelectWeakest = () => {
    const weakest = allNodes.slice(0, 3).map(n => n.name);
    setConfig(prev => ({ ...prev, nodes: weakest }));
  };

  const startGenerate = async () => {
    setStatus('loading');
    const data = await questionsApi.generateVariants(config.subject, config.nodes, config.amount, config.strategy);
    setQuestions(data.variants);
    setCurrentIdx(0);
    setSelectedOption('');
    setCorrectCount(0);
    setStatus('active');
  };

  const submitCurrent = () => {
    if (!currentQuestion || !selectedOption) return;
    
    if (!isAnswerSubmitted) {
      // First click: submit answer and show explanation
      setIsAnswerSubmitted(true);
      const isCorrect = selectedOption === currentQuestion.correct_answer;
      if (isCorrect) setCorrectCount(prev => prev + 1);
      setIsExplanationOpen(true);
      return;
    }

    // Second click: next question
    if (currentIdx >= questions.length - 1) {
      setStatus('completed');
      return;
    }
    setCurrentIdx(prev => prev + 1);
    setSelectedOption('');
    setIsAnswerSubmitted(false);
    setIsExplanationOpen(false);
    setShowAiHint(false);
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-background px-4 py-6 sm:p-8">
        <div className="rounded-2xl border border-primary/20 bg-card p-8 shadow-lg text-center flex flex-col items-center max-w-md w-full">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 animate-pulse">
            <Sparkles className="h-8 w-8 text-primary animate-spin" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">AI 正在为您组卷...</h2>
          <p className="text-sm text-muted-foreground mb-6">正在分析您的薄弱点，匹配最适合的变式题</p>
          <div className="w-full bg-secondary/20 rounded-full h-2 overflow-hidden">
            <div className="bg-primary h-full animate-shimmer w-1/2 rounded-full"></div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'active' && currentQuestion) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 h-[calc(100vh-64px)] flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={handleExit} className="p-2 hover:bg-secondary/20 rounded-full transition-colors text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
            <div className="h-4 w-[1px] bg-border" />
            <span className="text-sm font-semibold text-foreground">专项练习</span>
          </div>
          
          <div className="flex-1 max-w-xs mx-8">
            <div className="flex justify-between text-xs font-medium text-muted-foreground mb-1.5">
              <span>进度</span>
              <span>{currentIdx + 1} / {questions.length}</span>
            </div>
            <div className="h-1.5 w-full bg-secondary/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-300 rounded-full"
                style={{ width: `${((currentIdx) / questions.length) * 100}%` }}
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground bg-secondary/10 px-3 py-1.5 rounded-full">
            <Clock className="h-4 w-4" />
            <span className="w-10 tabular-nums">{formatTime(timeElapsed)}</span>
          </div>
        </header>

        {/* Core Content Area */}
        <section className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-24">
          <div className="space-y-8 mt-4">
            <p className="text-xl font-medium text-foreground leading-relaxed tracking-wide">
              {currentQuestion.question_text}
            </p>
            
            <div className="grid gap-3">
              {currentQuestion.options.map((item, idx) => {
                const value = String.fromCharCode(65 + idx);
                const active = selectedOption === value;
                const isCorrectOption = value === currentQuestion.correct_answer;
                
                let btnClass = 'border-transparent bg-secondary/10 text-foreground hover:bg-secondary/20 hover:border-secondary/30';
                if (active) {
                  btnClass = 'border-primary bg-primary/5 text-primary shadow-sm';
                }
                
                // Show validation colors after submission
                if (isAnswerSubmitted) {
                  if (isCorrectOption) {
                    btnClass = 'border-emerald-500 bg-emerald-500/10 text-emerald-700 shadow-sm';
                  } else if (active && !isCorrectOption) {
                    btnClass = 'border-destructive bg-destructive/10 text-destructive shadow-sm';
                  } else {
                    btnClass = 'border-transparent bg-secondary/5 text-muted-foreground opacity-50';
                  }
                }

                return (
                  <button
                    key={`${idx}-${item}`}
                    type="button"
                    onClick={() => !isAnswerSubmitted && setSelectedOption(value)}
                    disabled={isAnswerSubmitted}
                    className={`rounded-2xl border-2 p-5 text-left transition-all duration-200 text-lg flex items-center justify-between group ${btnClass}`}
                  >
                    <span className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${active && !isAnswerSubmitted ? 'bg-primary text-primary-foreground' : 'bg-background border shadow-sm group-hover:border-primary/50'}`}>
                        {value}
                      </span>
                      {item.replace(/^[A-D]\.\s*/, '')}
                    </span>
                    {isAnswerSubmitted && isCorrectOption && <CheckCircle2 className="h-6 w-6 text-emerald-500" />}
                    {isAnswerSubmitted && active && !isCorrectOption && <X className="h-6 w-6 text-destructive" />}
                  </button>
                );
              })}
            </div>
            
            {showAiHint && !isAnswerSubmitted && (
              <div className="mt-6 p-4 rounded-xl bg-indigo-50 border border-indigo-100 flex gap-3 animate-in fade-in slide-in-from-top-4">
                <Lightbulb className="h-5 w-5 text-indigo-500 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-indigo-900">AI 提示</p>
                  <p className="text-sm text-indigo-700 leading-relaxed">
                    这道题考查的是知识点之间的关联。第一步你可以先回忆一下该概念的核心定义，然后尝试排除明显不符的选项。
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Footer fixed at bottom */}
        <footer className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t border-border p-4 sm:px-8 flex items-center justify-between lg:left-[var(--sidebar-width,0px)]">
          <div className="max-w-3xl mx-auto w-full flex items-center justify-between">
            {!isAnswerSubmitted ? (
              <button 
                onClick={() => setShowAiHint(true)}
                disabled={showAiHint}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-primary font-medium hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                <Sparkles className="h-5 w-5" />
                召唤AI提示
              </button>
            ) : (
              <button 
                onClick={() => setIsExplanationOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-foreground font-medium hover:bg-secondary/20 transition-colors border border-border bg-card shadow-sm"
              >
                <BookOpen className="h-5 w-5" />
                查看详细解析
              </button>
            )}
            
            <button
              type="button"
              onClick={submitCurrent}
              disabled={!selectedOption}
              className="rounded-xl bg-primary px-8 py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center gap-2 shadow-sm"
            >
              {!isAnswerSubmitted ? '提交答案' : (currentIdx >= questions.length - 1 ? '完成练习' : '下一题')}
              {!isAnswerSubmitted ? <CheckCircle2 className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            </button>
          </div>
        </footer>

        {/* Explanation Drawer */}
        <Sheet open={isExplanationOpen} onOpenChange={setIsExplanationOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto custom-scrollbar">
            <SheetHeader className="mb-6 border-b border-border pb-4 text-left">
              <SheetTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-primary" />
                AI 详细解析
              </SheetTitle>
              <SheetDescription>
                彻底搞懂这道题的考点和陷阱
              </SheetDescription>
            </SheetHeader>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">考点提取</h3>
                <div className="flex gap-2">
                  <span className="px-3 py-1 bg-primary/10 text-primary rounded-md text-sm font-medium">核心考点</span>
                  <span className="px-3 py-1 bg-secondary/20 text-foreground rounded-md text-sm font-medium">易错题型</span>
                </div>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">AI 步骤解析</h3>
                <div className="p-4 rounded-xl bg-secondary/10 text-sm leading-relaxed text-foreground space-y-2">
                  <p>1. {currentQuestion.explanation || '分析题干提取关键信息。'}</p>
                  <p>2. 对比各个选项的差异点。</p>
                  <p>3. 得出最终结论为 {currentQuestion.correct_answer}。</p>
                </div>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">易错点提示</h3>
                <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-sm text-destructive leading-relaxed">
                  ⚠️ 很多同学容易在这一步忽略隐含条件，导致误选。下次一定要仔细审题！
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </main>
    );
  }

  if (status === 'completed') {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-12 text-center sm:px-6">
        <div className="rounded-full bg-emerald-100 p-6 w-24 h-24 mx-auto mb-6 flex items-center justify-center">
          <Target className="h-12 w-12 text-emerald-600" />
        </div>
        <h1 className="text-3xl font-bold text-foreground">训练完成！</h1>
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm max-w-sm mx-auto">
          <p className="text-sm text-muted-foreground mb-2">本次练习正确率</p>
          <p className="text-4xl font-bold text-primary mb-4">{Math.round((correctCount / questions.length) * 100)}%</p>
          <p className="text-sm text-foreground">答对 {correctCount} / {questions.length} 题</p>
        </div>
        <div className="flex gap-4 justify-center mt-8">
          <button type="button" onClick={() => navigate('/questions')} className="rounded-xl border border-border bg-card px-6 py-3 font-semibold hover:bg-accent transition-colors">
            返回错题库
          </button>
          <button type="button" onClick={() => setStatus('configuring')} className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            再次练习
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">专项练习</h1>
        <p className="text-muted-foreground mt-2">针对薄弱知识点，进行高强度集中突破</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left Side: Knowledge Points Selection (60%) */}
        <section className="flex-1 space-y-6">
          <Tabs defaultValue={config.subject} onValueChange={(val) => setConfig(prev => ({ ...prev, subject: val as Subject, nodes: [] }))}>
            <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
              <TabsTrigger value="英语" className="flex gap-2"><BookOpen className="h-4 w-4"/>英语</TabsTrigger>
              <TabsTrigger value="C语言" className="flex gap-2"><Calculator className="h-4 w-4"/>C语言</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm min-h-[400px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                知识点掌握度
              </h2>
              <button 
                onClick={autoSelectWeakest}
                className="text-sm flex items-center gap-1 text-primary hover:text-primary/80 bg-primary/10 px-3 py-1.5 rounded-full font-medium transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                AI帮你挑
              </button>
            </div>

            {allNodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <p>暂无错题知识点</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {allNodes.map(({name, mastery}) => {
                  const active = config.nodes.includes(name);
                  const colorClass = getMasteryColor(mastery);
                  
                  return (
                    <button
                      type="button"
                      key={name}
                      onClick={() => toggleNode(name)}
                      className={`relative group flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all duration-200 
                        ${active 
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm' 
                          : 'border-border bg-background hover:border-primary/50 hover:shadow-sm'
                        }`}
                    >
                      <span className={`text-sm font-medium ${active ? 'text-primary' : 'text-foreground'}`}>
                        {name}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-16 h-1.5 bg-secondary/30 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${mastery < 50 ? 'bg-destructive' : mastery < 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                            style={{ width: `${mastery}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">{mastery}%</span>
                      </div>
                      
                      {/* Selection Indicator */}
                      {active && (
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Right Side: Configuration & CTA (40%) */}
        <aside className="w-full lg:w-[400px] shrink-0">
          <div className="sticky top-6 space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-bold text-foreground mb-6">练习配置</h2>

            {/* Amount Slider */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-foreground">题目数量</label>
                <span className="text-lg font-bold text-primary">{config.amount} 题</span>
              </div>
              <Slider
                value={[config.amount]}
                onValueChange={(vals) => setConfig(prev => ({ ...prev, amount: vals[0] }))}
                max={30}
                min={5}
                step={5}
                className="my-4"
              />
              <div className="flex gap-2">
                {[10, 20, 30].map(num => (
                  <button
                    key={num}
                    onClick={() => setConfig(prev => ({ ...prev, amount: num }))}
                    className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${config.amount === num ? 'bg-primary text-primary-foreground' : 'bg-secondary/20 text-foreground hover:bg-secondary/40'}`}
                  >
                    {num} 题
                  </button>
                ))}
              </div>
            </div>

            <hr className="border-border" />

            {/* Strategy Selection */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">难度策略</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setConfig(prev => ({ ...prev, strategy: '递进' }))}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '递进' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-accent/50 text-muted-foreground'}`}
                >
                  <TrendingUp className="h-5 w-5" />
                  <span className="text-xs font-medium">递进</span>
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, strategy: '随机' }))}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '随机' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-accent/50 text-muted-foreground'}`}
                >
                  <Dice5 className="h-5 w-5" />
                  <span className="text-xs font-medium">随机</span>
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, strategy: '攻坚' }))}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all ${config.strategy === '攻坚' ? 'border-destructive bg-destructive/5 text-destructive' : 'border-border hover:bg-accent/50 text-muted-foreground'}`}
                >
                  <Flame className="h-5 w-5" />
                  <span className="text-xs font-medium">攻坚</span>
                </button>
              </div>
            </div>

            {/* Estimated Time */}
            <div className="rounded-xl bg-secondary/20 p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">预计需要时间</p>
                <p className="text-sm font-semibold text-foreground">约 {Math.ceil(config.amount * 1.5)} 分钟</p>
              </div>
            </div>

            {/* CTA Button */}
            <button
              type="button"
              onClick={startGenerate}
              disabled={!canGenerate}
              className="w-full rounded-xl bg-gradient-to-r from-primary to-indigo-600 px-6 py-4 text-lg font-bold text-white shadow-md hover:opacity-90 hover:shadow-lg disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2"
            >
              <RocketIcon className="h-5 w-5" />
              开始专属练习
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

function RocketIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}
