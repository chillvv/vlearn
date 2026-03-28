import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { InfoCard } from '../../src/components/ui/InfoCard';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { reviewQueue } from '../../src/data/mobile-plan';

export default function ReviewScreen() {
  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <SectionTitle title="复习中心" subtitle="下拉刷新、手势返回、即时诊断保持 0.1 秒感知响应" />
      <View style={styles.stack}>
        {reviewQueue.map((item) => (
          <InfoCard
            key={item.title}
            title={item.title}
            value={item.next}
            description={`状态：${item.status}`}
          />
        ))}
      </View>
      <InfoCard
        title="无障碍"
        description="题干朗读顺序固定为题目、选项、解析、下一次复习时间；重点按钮维持 44dp 以上触控面积。"
      />
      <Text style={styles.note}>AI 错因诊断沿用现有 telemetry 结构，并补充移动端前后台切换、网络重试与耗时埋点。</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.spacing[5],
    paddingBottom: tokens.spacing[8],
  },
  stack: {
    gap: tokens.spacing[3],
  },
  note: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
