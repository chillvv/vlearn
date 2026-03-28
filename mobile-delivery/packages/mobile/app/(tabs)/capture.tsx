import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Chip } from '../../src/components/ui/Chip';
import { InfoCard } from '../../src/components/ui/InfoCard';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { captureActions } from '../../src/data/mobile-plan';

export default function CaptureScreen() {
  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <SectionTitle title="录题链路" subtitle="拍照上传替代拖拽，Bottom Sheet 替代桌面抽屉" />
      <InfoCard
        title="移动端增强"
        description="相机、相册、OCR 校正、裁切与知识点补录都在拇指热区内完成，提交前用底部确认卡片降低误操作。"
      />
      <View style={styles.chips}>
        {captureActions.map((item) => (
          <Chip key={item} label={item} />
        ))}
      </View>
      <InfoCard
        title="适配点"
        description="刘海屏顶部安全区 16dp，底部手势区预留 24dp；折叠屏转双栏时保留主编辑流与预览流同步。"
      />
      <Text style={styles.note}>默认支持拍照、相册、扫码导入，弱网时降级为本地草稿 + 稍后上传。</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.spacing[5],
    paddingBottom: tokens.spacing[8],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing[2],
  },
  note: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
