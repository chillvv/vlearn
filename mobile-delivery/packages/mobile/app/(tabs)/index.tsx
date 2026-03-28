import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { InfoCard } from '../../src/components/ui/InfoCard';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { parityHighlights, performanceTargets } from '../../src/data/mobile-plan';

export default function HomeScreen() {
  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>移动端总览</Text>
        <Text style={styles.title}>沿用 Web 端知识图谱，重构为单手高频学习流</Text>
        <Text style={styles.subtitle}>
          保持 Supabase、RPC 与 AI 动作协议同源，手机端聚焦底部导航、手势返回、刘海避让与随手拍题。
        </Text>
      </View>
      <SectionTitle title="性能基线" subtitle="首屏 1 秒渲染，核心交互 0.1 秒响应" />
      <View style={styles.grid}>
        {performanceTargets.map((item) => (
          <InfoCard key={item.label} title={item.label} value={item.value} />
        ))}
      </View>
      <SectionTitle title="功能一致性" subtitle="统一服务端契约，分层做端差异增强" />
      <View style={styles.stack}>
        {parityHighlights.map((item) => (
          <InfoCard key={item.title} title={item.title} description={item.summary} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.spacing[6],
    paddingBottom: tokens.spacing[8],
  },
  hero: {
    gap: tokens.spacing[3],
  },
  kicker: {
    color: tokens.colors.primary.default,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  title: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.title.l.fontSize,
    lineHeight: tokens.typography.title.l.lineHeight,
    fontWeight: '700',
  },
  subtitle: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.m.fontSize,
    lineHeight: tokens.typography.body.m.lineHeight,
  },
  grid: {
    gap: tokens.spacing[3],
  },
  stack: {
    gap: tokens.spacing[3],
  },
});
