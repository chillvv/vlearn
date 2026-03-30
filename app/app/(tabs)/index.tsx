import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { useDashboardStatsQuery } from '../../src/queries/dashboard';
import { useSessionStore } from '../../src/store/session-store';

export default function HomeScreen() {
  const router = useRouter();
  const session = useSessionStore((state) => state.session);
  const { data, error, isLoading, isFetching, refetch } = useDashboardStatsQuery();

  const stats = data?.stats;

  const statusTitle = data?.source === 'live'
      ? `${getGreeting()}，${session?.email?.split('@')[0] || '同学'}`
      : '欢迎来到 AIWeb';

  const dueReviewCount = stats?.dueReviewCount ?? 0;
  const totalCount = stats?.total ?? 0;

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      {/* Header Section */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{statusTitle}</Text>
          <Text style={styles.subtitle}>今天想学点什么？</Text>
        </View>
        <Pressable 
          style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
          onPress={() => router.push('/settings')}
        >
          <Feather name="user" size={24} color={tokens.colors.primary.default} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={tokens.colors.primary.default} size="large" />
          <Text style={styles.loadingText}>加载数据中...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorCard}>
          <Feather name="alert-circle" size={24} color={tokens.colors.danger.default} />
          <Text style={styles.errorTitle}>数据加载失败</Text>
          <Text style={styles.errorBody}>{error.message}</Text>
          <Pressable style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Quick Actions (High Frequency Scenarios) */}
          <View style={styles.quickActions}>
            <Pressable 
              style={({ pressed }) => [styles.actionCard, styles.reviewCard, pressed && styles.pressedCard]}
              onPress={() => router.push('/review')}
            >
              <View style={styles.actionIconWrapper}>
                <Feather name="refresh-cw" size={24} color={tokens.colors.surface.primary} />
              </View>
              <View style={styles.actionTextWrapper}>
                <Text style={styles.actionTitleInverse}>开始复习</Text>
                <Text style={styles.actionSubtitleInverse}>
                  {dueReviewCount > 0 ? `有 ${dueReviewCount} 题待复习` : '今日已完成，真棒！'}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={tokens.colors.surface.primary} style={{ opacity: 0.8 }} />
            </Pressable>

            <Pressable 
              style={({ pressed }) => [styles.actionCard, styles.practiceCard, pressed && styles.pressedCard]}
              onPress={() => router.push('/practice')}
            >
              <View style={[styles.actionIconWrapper, { backgroundColor: tokens.colors.secondary.default }]}>
                <Feather name="target" size={24} color={tokens.colors.surface.primary} />
              </View>
              <View style={styles.actionTextWrapper}>
                <Text style={styles.actionTitle}>专项练习</Text>
                <Text style={styles.actionSubtitle}>针对薄弱点强化</Text>
              </View>
              <Feather name="chevron-right" size={20} color={tokens.colors.text.tertiary} />
            </Pressable>
          </View>

          {/* Stats Overview */}
          <SectionTitle title="学习概览" />
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>错题总量</Text>
              <Text style={styles.statValue}>{totalCount}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>本周新增</Text>
              <Text style={styles.statValue}>{stats?.newThisWeek ?? 0}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>头号薄弱点</Text>
              <Text style={styles.statValueSmall} numberOfLines={1}>
                {stats?.topWeakness?.knowledge_point ?? '暂无'}
              </Text>
            </View>
          </View>

          {/* Subject Mastery */}
          {stats?.subjectMastery && stats.subjectMastery.length > 0 && (
            <>
              <SectionTitle title="科目熟练度" />
              <View style={styles.masteryList}>
                {stats.subjectMastery.slice(0, 3).map((item) => (
                  <View key={item.subject} style={styles.masteryItem}>
                    <View style={styles.masteryHeader}>
                      <Text style={styles.masteryTitle}>{item.subject}</Text>
                      <Text style={styles.masteryScore}>{item.score}%</Text>
                    </View>
                    <View style={styles.masteryTrack}>
                      <View style={[styles.masteryBar, { width: `${Math.max(5, item.score)}%` }]} />
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Recent Entries */}
          <View style={styles.recentHeader}>
            <SectionTitle title="最近录入" />
            <Pressable onPress={() => router.push('/questions')}>
              <Text style={styles.viewAllText}>查看全部</Text>
            </Pressable>
          </View>
          
          <View style={styles.recentList}>
            {stats?.recent && stats.recent.length > 0 ? (
              stats.recent.map((item) => (
                <Pressable key={item.id} style={styles.recentItem}>
                  <View style={styles.recentItemTop}>
                    <Text style={styles.recentBadge}>{item.subject}</Text>
                    <Text style={styles.recentDate}>{formatDateLabel(item.created_at)}</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.recentQuestionText}>
                    {item.question_text}
                  </Text>
                </Pressable>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>暂无最近录入记录</Text>
              </View>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

const styles = StyleSheet.create({
  content: {
    padding: tokens.spacing[4],
    paddingBottom: tokens.spacing[10],
    gap: tokens.spacing[6],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: tokens.spacing[2],
  },
  greeting: {
    fontSize: tokens.typography.title.m.fontSize,
    fontWeight: '800',
    color: tokens.colors.text.primary,
  },
  subtitle: {
    fontSize: tokens.typography.body.m.fontSize,
    color: tokens.colors.text.tertiary,
    marginTop: tokens.spacing[1],
  },
  avatarButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: tokens.colors.primary.soft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
  loadingContainer: {
    paddingVertical: tokens.spacing[10],
    alignItems: 'center',
    gap: tokens.spacing[4],
  },
  loadingText: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.m.fontSize,
  },
  errorCard: {
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.danger.soft,
    borderRadius: tokens.radius.lg,
    alignItems: 'center',
    gap: tokens.spacing[2],
  },
  errorTitle: {
    color: tokens.colors.danger.default,
    fontWeight: '700',
    fontSize: tokens.typography.heading.s.fontSize,
  },
  errorBody: {
    color: tokens.colors.danger.default,
    textAlign: 'center',
    opacity: 0.8,
  },
  retryButton: {
    marginTop: tokens.spacing[3],
    paddingHorizontal: tokens.spacing[5],
    paddingVertical: tokens.spacing[2],
    backgroundColor: tokens.colors.danger.default,
    borderRadius: tokens.radius.full,
  },
  retryButtonText: {
    color: tokens.colors.surface.primary,
    fontWeight: '600',
  },
  quickActions: {
    gap: tokens.spacing[3],
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: tokens.spacing[5],
    borderRadius: tokens.radius.xl,
    shadowColor: tokens.colors.text.primary,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  reviewCard: {
    backgroundColor: tokens.colors.primary.default,
  },
  practiceCard: {
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  pressedCard: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  actionIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: tokens.spacing[4],
  },
  actionTextWrapper: {
    flex: 1,
  },
  actionTitle: {
    fontSize: tokens.typography.heading.m.fontSize,
    fontWeight: '700',
    color: tokens.colors.text.primary,
    marginBottom: 2,
  },
  actionTitleInverse: {
    fontSize: tokens.typography.heading.m.fontSize,
    fontWeight: '700',
    color: tokens.colors.surface.primary,
    marginBottom: 2,
  },
  actionSubtitle: {
    fontSize: tokens.typography.body.s.fontSize,
    color: tokens.colors.text.secondary,
  },
  actionSubtitleInverse: {
    fontSize: tokens.typography.body.s.fontSize,
    color: tokens.colors.surface.secondary,
    opacity: 0.9,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: tokens.spacing[3],
  },
  statBox: {
    flex: 1,
    backgroundColor: tokens.colors.surface.primary,
    padding: tokens.spacing[4],
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    alignItems: 'center',
    gap: tokens.spacing[1],
  },
  statLabel: {
    fontSize: tokens.typography.label.s.fontSize,
    color: tokens.colors.text.tertiary,
  },
  statValue: {
    fontSize: tokens.typography.title.m.fontSize,
    fontWeight: '800',
    color: tokens.colors.text.primary,
  },
  statValueSmall: {
    fontSize: tokens.typography.heading.s.fontSize,
    fontWeight: '700',
    color: tokens.colors.text.primary,
    marginTop: 4,
  },
  masteryList: {
    backgroundColor: tokens.colors.surface.primary,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    gap: tokens.spacing[4],
  },
  masteryItem: {
    gap: tokens.spacing[2],
  },
  masteryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  masteryTitle: {
    fontSize: tokens.typography.body.m.fontSize,
    fontWeight: '600',
    color: tokens.colors.text.primary,
  },
  masteryScore: {
    fontSize: tokens.typography.body.m.fontSize,
    fontWeight: '700',
    color: tokens.colors.primary.default,
  },
  masteryTrack: {
    height: 8,
    backgroundColor: tokens.colors.primary.soft,
    borderRadius: tokens.radius.full,
    overflow: 'hidden',
  },
  masteryBar: {
    height: '100%',
    backgroundColor: tokens.colors.primary.default,
    borderRadius: tokens.radius.full,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  viewAllText: {
    color: tokens.colors.primary.default,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '600',
    marginBottom: tokens.spacing[2],
  },
  recentList: {
    gap: tokens.spacing[3],
  },
  recentItem: {
    backgroundColor: tokens.colors.surface.primary,
    padding: tokens.spacing[4],
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    gap: tokens.spacing[2],
  },
  recentItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recentBadge: {
    color: tokens.colors.primary.default,
    fontSize: tokens.typography.label.s.fontSize,
    fontWeight: '600',
    backgroundColor: tokens.colors.primary.soft,
    paddingHorizontal: tokens.spacing[2],
    paddingVertical: 2,
    borderRadius: tokens.radius.sm,
  },
  recentDate: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.label.s.fontSize,
  },
  recentQuestionText: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.body.m.fontSize,
    lineHeight: tokens.typography.body.m.lineHeight,
  },
  emptyCard: {
    padding: tokens.spacing[6],
    alignItems: 'center',
    backgroundColor: tokens.colors.surface.tertiary,
    borderRadius: tokens.radius.lg,
  },
  emptyText: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.m.fontSize,
  },
});
