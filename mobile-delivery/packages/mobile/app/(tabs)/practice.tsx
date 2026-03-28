import { StyleSheet, Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { InfoCard } from '../../src/components/ui/InfoCard';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';

export default function PracticeScreen() {
  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <SectionTitle title="专项练习" subtitle="保留最弱知识点推荐逻辑，移动端改为分步卡片与底部 CTA" />
      <InfoCard
        title="统一接口"
        description="practiceApi 继续复用 Web 端 session / attempt 契约，客户端仅感知题组、掌握度与渐进生成状态。"
      />
      <InfoCard
        title="大屏与折叠屏"
        description="≥6.7 英寸与横向折叠模式切双列练习；≤5.4 英寸压缩次级信息，CTA 固定在底部拇指热区。"
      />
      <Text style={styles.note}>高刷设备使用 120 Hz 动效曲线，小屏机型自动降级为轻量过渡并遵守减少动态效果设置。</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.spacing[5],
    paddingBottom: tokens.spacing[8],
  },
  note: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
