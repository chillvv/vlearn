import { useMemo, useState } from 'react';
import type { PracticeGeneratedQuestion, PracticeStrategy, PracticeSubject } from '@aiweb/mobile-shared';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { InfoCard } from '../../src/components/ui/InfoCard';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { useGeneratePracticeQuestionsMutation, usePracticeOverviewQuery, useStartPracticeSessionMutation, useSubmitPracticeAttemptMutation } from '../../src/queries/practice';
import { useSessionStore } from '../../src/store/session-store';

type DrillStatus = 'configuring' | 'generating' | 'active' | 'completed';

export default function PracticeScreen() {
  const session = useSessionStore((state) => state.session);
  const practiceQuery = usePracticeOverviewQuery();
  const generateMutation = useGeneratePracticeQuestionsMutation();
  const startSessionMutation = useStartPracticeSessionMutation();
  const submitAttemptMutation = useSubmitPracticeAttemptMutation();
  const overview = practiceQuery.data;
  const sessions = overview?.sessions ?? [];
  const attempts = overview?.attempts ?? [];
  const [status, setStatus] = useState<DrillStatus>('configuring');
  const [subject, setSubject] = useState<PracticeSubject>('英语');
  const [strategy, setStrategy] = useState<PracticeStrategy>('递进');
  const [amountInput, setAmountInput] = useState('5');
  const [nodesInput, setNodesInput] = useState('');
  const [questions, setQuestions] = useState<PracticeGeneratedQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [textAnswer, setTextAnswer] = useState('');
  const [questionStartedAt, setQuestionStartedAt] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [lastResult, setLastResult] = useState<{ isCorrect: boolean; wrongSaved: boolean } | null>(null);
  const [message, setMessage] = useState('');
  const [sessionNodes, setSessionNodes] = useState<string[]>([]);
  const currentQuestion = questions[currentIndex];
  const isChoiceQuestion = currentQuestion?.question_type === 'choice' && currentQuestion.options.length > 1;

  const totalAmount = useMemo(() => {
    const value = Number(amountInput);
    if (!Number.isFinite(value)) return 5;
    return Math.max(1, Math.min(20, Math.round(value)));
  }, [amountInput]);

  function parseNodes() {
    const parsed = nodesInput
      .split(/[,，/\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
    const fallback = sessions[0]?.nodes?.filter(Boolean) ?? [];
    return fallback.slice(0, 5);
  }

  async function handleGenerate() {
    if (!session) {
      setMessage('请先登录后再开始专项练习');
      return;
    }
    const nodes = parseNodes();
    if (nodes.length === 0) {
      setMessage('请至少输入一个知识点，多个可用逗号分隔');
      return;
    }
    setStatus('generating');
    setMessage('');
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedOption('');
    setTextAnswer('');
    setSubmitted(false);
    setCorrectCount(0);
    setLastResult(null);
    try {
      const generated = await generateMutation.mutateAsync({
        subject,
        strategy,
        nodes,
        amount: totalAmount,
      });
      const createdSession = await startSessionMutation.mutateAsync({
        subject,
        strategy,
        nodes,
        planned_amount: totalAmount,
        generated_amount: generated.length,
      });
      setQuestions(generated);
      setSessionId(createdSession.id);
      setSessionNodes(nodes);
      setQuestionStartedAt(Date.now());
      setStatus('active');
    } catch (error) {
      setStatus('configuring');
      setMessage(error instanceof Error ? error.message : '出题失败，请稍后重试');
    }
  }

  async function handleSubmitCurrent() {
    if (!currentQuestion || !sessionId || submitted || submitAttemptMutation.isPending) {
      return;
    }
    const userAnswer = isChoiceQuestion ? selectedOption : textAnswer.trim();
    if (!userAnswer) {
      setMessage(isChoiceQuestion ? '请先选择一个答案' : '请先填写你的答案');
      return;
    }
    setMessage('');
    const isFinal = currentIndex >= questions.length - 1;
    const durationSeconds = Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000));
    const mappedNode = sessionNodes[currentIndex % Math.max(sessionNodes.length, 1)] || '';
    try {
      const result = await submitAttemptMutation.mutateAsync({
        sessionId,
        questionIndex: currentIndex,
        question: currentQuestion,
        userAnswer,
        subject,
        knowledgePoint: mappedNode,
        ability: '规则应用',
        errorType: mappedNode || '未分类',
        durationSeconds,
        isFinal,
      });
      setSubmitted(true);
      setLastResult({ isCorrect: result.isCorrect, wrongSaved: result.wrongSaved });
      if (result.isCorrect) {
        setCorrectCount((value) => value + 1);
      }
      await practiceQuery.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败，请稍后重试');
    }
  }

  function goNextQuestion() {
    if (!submitted) return;
    if (currentIndex >= questions.length - 1) {
      setStatus('completed');
      return;
    }
    setCurrentIndex((value) => value + 1);
    setSelectedOption('');
    setTextAnswer('');
    setSubmitted(false);
    setLastResult(null);
    setQuestionStartedAt(Date.now());
  }

  function resetPractice() {
    setStatus('configuring');
    setQuestions([]);
    setCurrentIndex(0);
    setSessionId('');
    setSelectedOption('');
    setTextAnswer('');
    setSubmitted(false);
    setLastResult(null);
    setCorrectCount(0);
    setMessage('');
    setSessionNodes([]);
  }


  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <SectionTitle title="专项练习" subtitle="本页已补齐出题入口与单题提交，提交走同一个 submit_practice_attempt RPC。" />
      <View style={styles.grid}>
        <InfoCard title="练习场次" value={`${overview?.totals.sessionCount ?? 0} 场`} description={session ? `当前账号：${session.email}` : '登录后自动同步同一账号数据'} />
        <InfoCard title="进行中" value={`${overview?.totals.activeCount ?? 0} 场`} description="仍未完成的练习会话" />
        <InfoCard title="累计答对" value={`${overview?.totals.correctCount ?? 0} 题`} description="取自 practice_attempts 真数据" />
        <InfoCard title="累计答错" value={`${overview?.totals.wrongCount ?? 0} 题`} description="与 Web 错题回流链路同源" />
      </View>
      <Pressable disabled={practiceQuery.isFetching} onPress={() => void practiceQuery.refetch()} style={[styles.refreshButton, practiceQuery.isFetching && styles.refreshButtonDisabled]}>
        <Text style={styles.refreshButtonLabel}>{practiceQuery.isFetching ? '刷新中...' : '刷新真实练习数据'}</Text>
      </Pressable>

      <SectionTitle title="练习配置" subtitle="先配置科目、知识点和题量，再启动 AI 出题。" />
      <View style={styles.stateCard}>
        <Text style={styles.fieldLabel}>科目</Text>
        <View style={styles.row}>
          <Pressable onPress={() => setSubject('英语')} style={[styles.tag, subject === '英语' && styles.tagActive]}>
            <Text style={[styles.tagLabel, subject === '英语' && styles.tagLabelActive]}>英语</Text>
          </Pressable>
          <Pressable onPress={() => setSubject('C语言')} style={[styles.tag, subject === 'C语言' && styles.tagActive]}>
            <Text style={[styles.tagLabel, subject === 'C语言' && styles.tagLabelActive]}>C语言</Text>
          </Pressable>
        </View>

        <Text style={styles.fieldLabel}>策略</Text>
        <View style={styles.row}>
          {(['递进', '随机', '攻坚'] as PracticeStrategy[]).map((item) => (
            <Pressable key={item} onPress={() => setStrategy(item)} style={[styles.tag, strategy === item && styles.tagActive]}>
              <Text style={[styles.tagLabel, strategy === item && styles.tagLabelActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>知识点（逗号分隔）</Text>
        <TextInput
          value={nodesInput}
          onChangeText={setNodesInput}
          style={styles.input}
          placeholder="例如：时态, 阅读理解, 完形填空"
          placeholderTextColor={tokens.colors.text.tertiary}
          editable={status !== 'generating'}
        />

        <Text style={styles.fieldLabel}>题量（1-20）</Text>
        <TextInput
          value={amountInput}
          onChangeText={setAmountInput}
          style={styles.input}
          keyboardType="number-pad"
          placeholder="5"
          placeholderTextColor={tokens.colors.text.tertiary}
          editable={status !== 'generating'}
        />

        <Pressable disabled={status === 'generating'} onPress={() => void handleGenerate()} style={[styles.primaryButton, status === 'generating' && styles.refreshButtonDisabled]}>
          <Text style={styles.primaryButtonLabel}>{status === 'generating' ? 'AI 出题中...' : '开始专项练习'}</Text>
        </Pressable>
      </View>

      {status === 'active' && currentQuestion ? (
        <View style={styles.questionCard}>
          <View style={styles.sessionHeader}>
            <Text style={styles.subjectBadge}>第 {currentIndex + 1}/{questions.length} 题</Text>
            <Text style={styles.metaText}>{subject} · {strategy}</Text>
          </View>
          <Text style={styles.sessionTitle}>{currentQuestion.question_text}</Text>
          {isChoiceQuestion ? (
            <View style={styles.stack}>
              {currentQuestion.options.map((option) => {
                const label = option.slice(0, 1).toUpperCase();
                const isActive = selectedOption === label;
                return (
                  <Pressable key={option} disabled={submitted} onPress={() => setSelectedOption(label)} style={[styles.optionButton, isActive && styles.optionButtonActive]}>
                    <Text style={styles.sessionMeta}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              value={textAnswer}
              onChangeText={setTextAnswer}
              style={styles.input}
              placeholder="输入你的答案"
              placeholderTextColor={tokens.colors.text.tertiary}
              editable={!submitted}
            />
          )}
          {submitted ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>{lastResult?.isCorrect ? '回答正确' : '回答错误'}</Text>
              <Text style={styles.stateBody}>标准答案：{currentQuestion.correct_answer || '暂无'}</Text>
              <Text style={styles.stateBody}>{currentQuestion.explanation || '暂无解析'}</Text>
              {!lastResult?.isCorrect ? (
                <Text style={styles.stateBody}>{lastResult?.wrongSaved ? '错题已自动回流到题库' : '该错题已存在于题库'}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.actionRow}>
            <Pressable disabled={submitted || submitAttemptMutation.isPending} onPress={() => void handleSubmitCurrent()} style={[styles.actionButton, styles.successButton, (submitted || submitAttemptMutation.isPending) && styles.refreshButtonDisabled]}>
              <Text style={styles.actionButtonLabel}>{submitAttemptMutation.isPending ? '提交中...' : '提交本题'}</Text>
            </Pressable>
            <Pressable disabled={!submitted} onPress={goNextQuestion} style={[styles.actionButton, styles.warningButton, !submitted && styles.refreshButtonDisabled]}>
              <Text style={styles.actionButtonLabelInverse}>{currentIndex >= questions.length - 1 ? '完成练习' : '下一题'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {status === 'completed' ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>本轮练习已完成</Text>
          <Text style={styles.stateBody}>正确 {correctCount} / {questions.length} 题</Text>
          <Text style={styles.stateBody}>练习会话与作答记录已写入同一份真实数据。</Text>
          <Pressable onPress={resetPractice} style={styles.refreshButton}>
            <Text style={styles.refreshButtonLabel}>再来一轮</Text>
          </Pressable>
        </View>
      ) : null}

      {message ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>提示</Text>
          <Text style={styles.stateBody}>{message}</Text>
        </View>
      ) : null}

      {practiceQuery.isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={tokens.colors.primary.default} />
          <Text style={styles.stateTitle}>正在加载练习会话</Text>
          <Text style={styles.stateBody}>当前直接读取 practice_sessions 与 practice_attempts 表。</Text>
        </View>
      ) : null}

      {practiceQuery.error ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>练习数据加载失败</Text>
          <Text style={styles.stateBody}>{practiceQuery.error.message}</Text>
        </View>
      ) : null}

      <SectionTitle title="最近场次" subtitle="出题后会创建 practice_sessions，会在这里同步显示。" />
      {sessions.length > 0 ? (
        <View style={styles.stack}>
          {sessions.map((item) => (
            <View key={item.id} style={styles.sessionCard}>
              <View style={styles.sessionHeader}>
                <Text style={styles.subjectBadge}>{item.subject}</Text>
                <Text style={styles.metaText}>{formatSessionStatus(item.status)}</Text>
              </View>
              <Text style={styles.sessionTitle}>{item.strategy} · {item.nodes.slice(0, 3).join(' / ') || '未记录知识点'}</Text>
              <Text style={styles.sessionMeta}>
                进度 {Math.min(item.correct_count + item.wrong_count, item.planned_amount)}/{item.planned_amount} · 生成 {item.generated_amount} 题
              </Text>
              <Text style={styles.sessionMeta}>
                答对 {item.correct_count} · 答错 {item.wrong_count} · 耗时 {formatDuration(item.total_elapsed_seconds)}
              </Text>
              <Text style={styles.sessionMeta}>开始于 {formatDateTime(item.created_at)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>还没有练习会话</Text>
          <Text style={styles.stateBody}>完成一次练习后，这里会出现刚创建的会话。</Text>
        </View>
      )}

      <SectionTitle title="最近作答" subtitle="提交本题后会立即写入 practice_attempts 并刷新。" />
      {attempts.length > 0 ? (
        <View style={styles.stack}>
          {attempts.map((item) => (
            <View key={item.id} style={styles.attemptCard}>
              <View style={styles.sessionHeader}>
                <Text style={[styles.subjectBadge, !item.is_correct && styles.errorBadge]}>{item.is_correct ? '答对' : '答错'}</Text>
                <Text style={styles.metaText}>{formatDateTime(item.created_at)}</Text>
              </View>
              <Text numberOfLines={3} style={styles.sessionTitle}>{item.question_text}</Text>
              <Text style={styles.sessionMeta}>
                第 {item.question_index + 1} 题 · {item.knowledge_point || '未记录知识点'} · {formatDuration(item.duration_seconds)}
              </Text>
              <Text style={styles.sessionMeta}>
                你的答案：{item.user_answer || '未填写'} · 正确答案：{item.correct_answer || '未记录'}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>还没有练习作答记录</Text>
          <Text style={styles.stateBody}>完成一次答题提交后，这里会出现同一份提交历史。</Text>
        </View>
      )}

      <Text style={styles.note}>本页已实现“配置出题 → 创建会话 → 单题提交 → 服务端判题与错题回流”的闭环，和 Web 共用同一套 Supabase 数据层。</Text>
    </Screen>
  );
}

function formatSessionStatus(value: string) {
  if (value === 'completed') return '已完成';
  if (value === 'abandoned') return '已放弃';
  return '进行中';
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainSeconds = safeSeconds % 60;
  return `${minutes}分${String(remainSeconds).padStart(2, '0')}秒`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.spacing[5],
    paddingBottom: tokens.spacing[8],
  },
  grid: {
    gap: tokens.spacing[3],
  },
  stack: {
    gap: tokens.spacing[3],
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    backgroundColor: tokens.colors.surface.primary,
    paddingVertical: tokens.spacing[3],
  },
  refreshButtonDisabled: {
    opacity: 0.6,
  },
  refreshButtonLabel: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.colors.primary.default,
    paddingVertical: tokens.spacing[4],
    marginTop: tokens.spacing[2],
    elevation: 2,
    shadowColor: tokens.colors.primary.default,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryButtonLabel: {
    color: tokens.colors.surface.primary,
    fontSize: tokens.typography.heading.s.fontSize,
    fontWeight: '700',
  },
  fieldLabel: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: tokens.spacing[2],
    flexWrap: 'wrap',
  },
  tag: {
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    backgroundColor: tokens.colors.surface.primary,
    paddingHorizontal: tokens.spacing[3],
    paddingVertical: tokens.spacing[2],
  },
  tagActive: {
    borderColor: tokens.colors.primary.default,
    backgroundColor: tokens.colors.primary.soft,
  },
  tagLabel: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    fontWeight: '600',
  },
  tagLabelActive: {
    color: tokens.colors.primary.default,
  },
  input: {
    minHeight: tokens.layout.touchTargetMin,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    backgroundColor: tokens.colors.surface.primary,
    paddingHorizontal: tokens.spacing[4],
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.body.m.fontSize,
  },
  stateCard: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  stateTitle: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.heading.s.fontSize,
    lineHeight: tokens.typography.heading.s.lineHeight,
    fontWeight: '700',
  },
  stateBody: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
  sessionCard: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  attemptCard: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  questionCard: {
    gap: tokens.spacing[3],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  optionButton: {
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    backgroundColor: tokens.colors.surface.primary,
    paddingHorizontal: tokens.spacing[4],
    paddingVertical: tokens.spacing[3],
  },
  optionButtonActive: {
    borderColor: tokens.colors.primary.default,
    backgroundColor: tokens.colors.primary.soft,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacing[3],
  },
  subjectBadge: {
    color: tokens.colors.primary.default,
    fontSize: tokens.typography.label.s.fontSize,
    fontWeight: '700',
  },
  errorBadge: {
    color: tokens.colors.danger.default,
  },
  actionRow: {
    flexDirection: 'row',
    gap: tokens.spacing[3],
    marginTop: tokens.spacing[2],
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.full,
    paddingVertical: tokens.spacing[3],
    elevation: 2,
    shadowColor: tokens.colors.text.primary,
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  warningButton: {
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.strong,
  },
  successButton: {
    backgroundColor: tokens.colors.primary.default,
  },
  actionButtonLabel: {
    color: tokens.colors.surface.primary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  actionButtonLabelInverse: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  metaText: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
  },
  sessionTitle: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.body.m.fontSize,
    lineHeight: tokens.typography.body.m.lineHeight,
    fontWeight: '600',
  },
  sessionMeta: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
  note: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
