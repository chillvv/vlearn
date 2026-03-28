import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { PrimaryButton } from '../../src/components/ui/PrimaryButton';
import { tokens } from '../../src/design/tokens';
import { evaluateFlagsForUser } from '../../src/lib/feature-flags';
import { track } from '../../src/lib/analytics';
import { useSessionStore } from '../../src/store/session-store';

export default function LoginScreen() {
  const signInPreview = useSessionStore((state) => state.signInPreview);

  const handleSignIn = async () => {
    await signInPreview();
    evaluateFlagsForUser('preview-user');
    track('auth_preview_login', { method: 'email_magic_link' });
    router.replace('/(tabs)');
  };

  return (
    <Screen contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>AIWeb Mobile</Text>
        </View>
        <Text style={styles.title}>把错题本升级为随手可用的 AI 提分助手</Text>
        <Text style={styles.subtitle}>
          沿用 Web 端知识图谱与复习节奏，在手机端强化拍照录题、单手热区、手势返回与生物识别登录。
        </Text>
      </View>
      <View style={styles.card}>
        <PrimaryButton label="预览登录" onPress={handleSignIn} />
        <Pressable onPress={handleSignIn} style={styles.secondaryButton}>
          <Text style={styles.secondaryLabel}>指纹 / 面容快速登录</Text>
        </Pressable>
        <Text style={styles.footnote}>
          默认接入 Supabase Auth，可切换密码、验证码、Apple、微信与校园统一认证。
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingVertical: tokens.spacing[8],
  },
  hero: {
    gap: tokens.spacing[4],
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: tokens.spacing[3],
    paddingVertical: tokens.spacing[1],
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.colors.primary.soft,
  },
  badgeText: {
    color: tokens.colors.primary.default,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  title: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.title.xl.fontSize,
    lineHeight: tokens.typography.title.xl.lineHeight,
    fontWeight: '700',
  },
  subtitle: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.l.fontSize,
    lineHeight: tokens.typography.body.l.lineHeight,
  },
  card: {
    gap: tokens.spacing[4],
    padding: tokens.spacing[6],
    borderRadius: tokens.radius.xl,
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    shadowColor: tokens.shadows.card.shadowColor,
    shadowOpacity: tokens.shadows.card.shadowOpacity,
    shadowOffset: tokens.shadows.card.shadowOffset,
    shadowRadius: tokens.shadows.card.shadowRadius,
    elevation: tokens.shadows.card.elevation,
  },
  secondaryButton: {
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    paddingVertical: tokens.spacing[4],
    alignItems: 'center',
  },
  secondaryLabel: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.label.l.fontSize,
    fontWeight: '600',
  },
  footnote: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
