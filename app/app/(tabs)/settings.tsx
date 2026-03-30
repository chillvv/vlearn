import { Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { PrimaryButton } from '../../src/components/ui/PrimaryButton';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { rolloutFlags } from '../../src/data/mobile-plan';
import { checkForUpdates } from '../../src/lib/updates';
import { useSessionStore } from '../../src/store/session-store';

export default function SettingsScreen() {
  const signOut = useSessionStore((state) => state.signOut);

  const handleUpdateCheck = async () => {
    const result = await checkForUpdates();
    Alert.alert('更新检查', result);
  };

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <SectionTitle title="交付配置" subtitle="已集成路由、状态管理、网络、埋点、灰度、热更新与异常上报钩子" />
      <View style={styles.list}>
        {rolloutFlags.map((item) => (
          <View key={item.key} style={styles.row}>
            <Text style={styles.rowTitle}>{item.key}</Text>
            <Text style={styles.rowDesc}>{item.desc}</Text>
          </View>
        ))}
      </View>
      <PrimaryButton label="检查 OTA 更新" onPress={handleUpdateCheck} />
      <PrimaryButton label="退出预览会话" tone="ghost" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.spacing[5],
    paddingBottom: tokens.spacing[8],
  },
  list: {
    borderRadius: tokens.radius.xl,
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  row: {
    paddingHorizontal: tokens.spacing[5],
    paddingVertical: tokens.spacing[4],
    gap: tokens.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.stroke.soft,
  },
  rowTitle: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.label.l.fontSize,
    fontWeight: '600',
  },
  rowDesc: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
