import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { InfoCard } from '../../src/components/ui/InfoCard';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { useQuestionBankQuery } from '../../src/queries/questions';
import { useSessionStore } from '../../src/store/session-store';

export default function QuestionsScreen() {
  const session = useSessionStore((state) => state.session);
  const questionsQuery = useQuestionBankQuery();
  const questions = questionsQuery.data ?? [];

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <SectionTitle title="错题库" subtitle="录题后会通过同一个 create_question RPC 入库，这里展示真实数据。" />
      <InfoCard title="当前数量" value={`${questions.length} 题`} description={session ? `当前账号：${session.email}` : '登录后查看你的同源错题库'} />
      <Pressable disabled={questionsQuery.isFetching} onPress={() => void questionsQuery.refetch()} style={[styles.refreshButton, questionsQuery.isFetching && styles.refreshButtonDisabled]}>
        <Text style={styles.refreshButtonLabel}>{questionsQuery.isFetching ? '刷新中...' : '刷新错题库'}</Text>
      </Pressable>

      {questionsQuery.isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={tokens.colors.primary.default} />
          <Text style={styles.stateTitle}>正在加载错题库</Text>
        </View>
      ) : null}
      {questionsQuery.error ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>错题库加载失败</Text>
          <Text style={styles.stateBody}>{questionsQuery.error.message}</Text>
        </View>
      ) : null}

      {questions.length > 0 ? (
        <View style={styles.stack}>
          {questions.map((item) => (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.subjectBadge}>{item.subject}</Text>
                <Text style={styles.metaText}>{formatDateTime(item.created_at)}</Text>
              </View>
              <Text numberOfLines={2} style={styles.itemTitle}>{item.question_text}</Text>
              <Text style={styles.itemMeta}>{item.knowledge_point} · {item.error_type}</Text>
              {item.correct_answer ? <Text style={styles.itemMeta}>答案：{item.correct_answer}</Text> : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>还没有错题</Text>
          <Text style={styles.stateBody}>完成一次录题提交后，这里会自动出现刚入库的题目。</Text>
        </View>
      )}
    </Screen>
  );
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
  itemCard: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacing[2],
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
  itemTitle: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.body.m.fontSize,
    lineHeight: tokens.typography.body.m.lineHeight,
    fontWeight: '600',
  },
  itemMeta: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
