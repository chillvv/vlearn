import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { InfoCard } from '../../src/components/ui/InfoCard';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { useDueQuestionsCountQuery, useDueQuestionsQuery, useRecentReviewAttemptsQuery, useSubmitReviewAttemptMutation } from '../../src/queries/review';
import { useSessionStore } from '../../src/store/session-store';

export default function ReviewScreen() {
  const session = useSessionStore((state) => state.session);
  const dueCountQuery = useDueQuestionsCountQuery();
  const dueQuestionsQuery = useDueQuestionsQuery();
  const submitReviewMutation = useSubmitReviewAttemptMutation();
  const questions = dueQuestionsQuery.data ?? [];
  const [activeQuestionId, setActiveQuestionId] = useState<string | undefined>();
  const [lastSubmittedQuestionId, setLastSubmittedQuestionId] = useState<string | undefined>();

  useEffect(() => {
    if (questions.length === 0) {
      setActiveQuestionId(undefined);
      return;
    }
    if (!activeQuestionId || !questions.some((item) => item.id === activeQuestionId)) {
      setActiveQuestionId(questions[0].id);
    }
  }, [activeQuestionId, questions]);

  const activeQuestion = useMemo(
    () => questions.find((item) => item.id === activeQuestionId) ?? questions[0],
    [activeQuestionId, questions],
  );
  const recentAttemptsQuery = useRecentReviewAttemptsQuery(activeQuestion?.id);
  const isRefreshing = dueQuestionsQuery.isFetching || dueCountQuery.isFetching;
  const isSubmitting = submitReviewMutation.isPending;

  async function handleSubmit(rating: 'forgot' | 'vague' | 'mastered') {
    if (!activeQuestion || isSubmitting) {
      return;
    }

    await submitReviewMutation.mutateAsync({
      questionId: activeQuestion.id,
      questionText: activeQuestion.question_text,
      questionType: activeQuestion.question_type,
      rating,
      correctAnswer: activeQuestion.correct_answer,
      knowledgePoint: activeQuestion.knowledge_point,
    });
    setLastSubmittedQuestionId(activeQuestion.id);
    await Promise.all([dueCountQuery.refetch(), dueQuestionsQuery.refetch(), recentAttemptsQuery.refetch()]);
  }

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <SectionTitle title="复习中心" subtitle="读取与提交都走 Web 同源 Supabase 数据，移动端已接通真实复习闭环。" />
      <View style={styles.stack}>
        <InfoCard
          title="待复习总量"
          value={`${dueCountQuery.data ?? 0} 题`}
          description={session ? `当前账号：${session.email}` : '请先登录真实账号后查看同源数据'}
        />
        <InfoCard
          title="当前题目"
          value={activeQuestion ? activeQuestion.knowledge_point : '待选择'}
          description={activeQuestion ? `${activeQuestion.subject} · ${activeQuestion.error_type}` : '登录后自动读取当前到期题目'}
        />
        <Pressable
          disabled={isRefreshing || isSubmitting}
          onPress={() => {
            void dueCountQuery.refetch();
            void dueQuestionsQuery.refetch();
            void recentAttemptsQuery.refetch();
          }}
          style={[styles.refreshButton, (isRefreshing || isSubmitting) && styles.refreshButtonDisabled]}
        >
          <Text style={styles.refreshButtonLabel}>{isRefreshing || isSubmitting ? '同步中...' : '刷新真实数据'}</Text>
        </Pressable>
      </View>
      {dueQuestionsQuery.isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={tokens.colors.primary.default} />
          <Text style={styles.stateTitle}>正在加载待复习题目</Text>
          <Text style={styles.stateBody}>查询条件与 Web 一致：`next_review_date` 为空或已到期。</Text>
        </View>
      ) : null}
      {dueQuestionsQuery.error ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>复习数据加载失败</Text>
          <Text style={styles.stateBody}>{dueQuestionsQuery.error.message}</Text>
        </View>
      ) : null}
      {session && !dueQuestionsQuery.isLoading ? (
        <View style={styles.stack}>
          {activeQuestion ? (
            <>
              <View style={styles.questionCard}>
                <View style={styles.questionHeader}>
                  <Text style={styles.subjectBadge}>{activeQuestion.subject}</Text>
                  <Text style={styles.metaText}>{formatNextReview(activeQuestion.next_review_date)}</Text>
                </View>
                <Text style={styles.questionTitle}>{activeQuestion.question_text}</Text>
                <Text style={styles.questionMeta}>
                  {activeQuestion.knowledge_point} · {activeQuestion.error_type}
                </Text>
                <Text style={styles.questionMeta}>
                  复习次数 {activeQuestion.review_count} · 掌握度 {activeQuestion.mastery_level ?? Math.round((activeQuestion.confidence ?? 0.5) * 100)}%
                </Text>
                {activeQuestion.correct_answer ? (
                  <View style={styles.answerPanel}>
                    <Text style={styles.answerLabel}>参考答案</Text>
                    <Text style={styles.answerBody}>{activeQuestion.correct_answer}</Text>
                  </View>
                ) : null}
                {activeQuestion.note || activeQuestion.summary ? (
                  <View style={styles.answerPanel}>
                    <Text style={styles.answerLabel}>复盘提示</Text>
                    <Text style={styles.answerBody}>{activeQuestion.note || activeQuestion.summary}</Text>
                  </View>
                ) : null}
                <Text style={styles.actionHint}>看完答案后直接做自评，结果会通过同一个 `submit_review_attempt` RPC 写回 Supabase。</Text>
                <View style={styles.actionRow}>
                  <Pressable disabled={isSubmitting} onPress={() => void handleSubmit('forgot')} style={[styles.actionButton, styles.dangerButton, isSubmitting && styles.refreshButtonDisabled]}>
                    <Text style={styles.actionButtonLabel}>忘了</Text>
                  </Pressable>
                  <Pressable disabled={isSubmitting} onPress={() => void handleSubmit('vague')} style={[styles.actionButton, styles.warningButton, isSubmitting && styles.refreshButtonDisabled]}>
                    <Text style={styles.actionButtonLabel}>模糊</Text>
                  </Pressable>
                  <Pressable disabled={isSubmitting} onPress={() => void handleSubmit('mastered')} style={[styles.actionButton, styles.successButton, isSubmitting && styles.refreshButtonDisabled]}>
                    <Text style={styles.actionButtonLabel}>掌握</Text>
                  </Pressable>
                </View>
              </View>

              {submitReviewMutation.data && lastSubmittedQuestionId === submitReviewMutation.data.question.id ? (
                <View style={styles.stateCard}>
                  <Text style={styles.stateTitle}>复习结果已写回真实数据</Text>
                  <Text style={styles.stateBody}>下次复习时间：{formatNextReview(submitReviewMutation.data.nextReviewDate)}</Text>
                </View>
              ) : null}

              {submitReviewMutation.error ? (
                <View style={styles.stateCard}>
                  <Text style={styles.stateTitle}>复习提交失败</Text>
                  <Text style={styles.stateBody}>{submitReviewMutation.error.message}</Text>
                </View>
              ) : null}

              <SectionTitle title="最近复习记录" subtitle="和 Web 共用 question_review_attempts 表" />
              {recentAttemptsQuery.isLoading ? (
                <View style={styles.stateCard}>
                  <Text style={styles.stateBody}>正在读取当前题目的最近提交记录。</Text>
                </View>
              ) : null}
              {recentAttemptsQuery.data && recentAttemptsQuery.data.length > 0 ? (
                recentAttemptsQuery.data.map((item) => (
                  <View key={item.id} style={styles.historyCard}>
                    <View style={styles.questionHeader}>
                      <Text style={styles.historyBadge}>{formatRating(item.rating)}</Text>
                      <Text style={styles.metaText}>{formatDateTime(item.created_at)}</Text>
                    </View>
                    <Text style={styles.questionMeta}>
                      判定 {item.is_correct ? '正确' : '未掌握'} · 下次 {formatNextReview(item.next_review_date)}
                    </Text>
                  </View>
                ))
              ) : (
                <View style={styles.stateCard}>
                  <Text style={styles.stateTitle}>暂无最近复习记录</Text>
                  <Text style={styles.stateBody}>本题首次在移动端或 Web 端提交后，这里会显示统一的复习历史。</Text>
                </View>
              )}

              <SectionTitle title="待复习队列" subtitle="点击切换要复习的题目" />
              {questions.map((item) => (
                <Pressable key={item.id} onPress={() => setActiveQuestionId(item.id)} style={[styles.queueCard, item.id === activeQuestion.id && styles.queueCardActive]}>
                  <View style={styles.questionHeader}>
                    <Text style={styles.subjectBadge}>{item.subject}</Text>
                    <Text style={styles.metaText}>{formatNextReview(item.next_review_date)}</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.questionTitle}>
                    {item.question_text}
                  </Text>
                  <Text style={styles.questionMeta}>
                    {item.knowledge_point} · 掌握度 {item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100)}%
                  </Text>
                </Pressable>
              ))}
            </>
          ) : (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>当前没有待复习题目</Text>
              <Text style={styles.stateBody}>这说明当前账号在同一套真实数据里没有到期题目，移动端与 Web 端看到的是同一状态。</Text>
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function formatNextReview(value?: string) {
  if (!value) return '立即复习';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '立即复习';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatRating(value: 'forgot' | 'vague' | 'mastered') {
  if (value === 'forgot') return '忘了';
  if (value === 'vague') return '模糊';
  return '掌握';
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.spacing[5],
    paddingBottom: tokens.spacing[8],
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
  questionCard: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  queueCard: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[4],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  queueCardActive: {
    borderColor: tokens.colors.primary.default,
    backgroundColor: tokens.colors.primary.soft,
  },
  historyCard: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing[4],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  questionHeader: {
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
  metaText: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
  },
  questionTitle: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.body.m.fontSize,
    lineHeight: tokens.typography.body.m.lineHeight,
    fontWeight: '600',
  },
  questionMeta: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
  answerPanel: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing[4],
    backgroundColor: tokens.colors.surface.secondary,
  },
  answerLabel: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.label.s.fontSize,
    fontWeight: '700',
  },
  answerBody: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.body.m.fontSize,
    lineHeight: tokens.typography.body.m.lineHeight,
  },
  actionHint: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
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
    paddingVertical: tokens.spacing[4],
    elevation: 1,
    shadowColor: tokens.colors.text.primary,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  dangerButton: {
    backgroundColor: tokens.colors.danger.soft,
  },
  warningButton: {
    backgroundColor: tokens.colors.warning.soft,
  },
  successButton: {
    backgroundColor: tokens.colors.success.soft,
  },
  actionButtonLabel: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  historyBadge: {
    color: tokens.colors.primary.default,
    fontSize: tokens.typography.label.s.fontSize,
    fontWeight: '700',
  },
  note: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
