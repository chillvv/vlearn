import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { PrimaryButton } from '../../src/components/ui/PrimaryButton';
import { tokens } from '../../src/design/tokens';
import { evaluateFlagsForUser } from '../../src/lib/feature-flags';
import { track } from '../../src/lib/analytics';
import { supabase } from '../../src/lib/supabase';
import { useSessionStore } from '../../src/store/session-store';

type AuthTab = 'login' | 'register';

export default function LoginScreen() {
  const session = useSessionStore((state) => state.session);
  const signIn = useSessionStore((state) => state.signIn);
  const register = useSessionStore((state) => state.register);
  const [tab, setTab] = useState<AuthTab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const isConfigured = useMemo(() => Boolean(supabase), []);

  useEffect(() => {
    if (session) {
      router.replace('/(tabs)');
    }
  }, [session]);

  const handleSignIn = async () => {
    if (!email || !password) {
      setMessage('请填写邮箱和密码');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      if (tab === 'register') {
        const result = await register(email.trim(), password, name.trim());
        if (result.session) {
          evaluateFlagsForUser(result.session.userId);
          track('auth_register_success', { method: 'email_password' });
          router.replace('/(tabs)');
          return;
        }
        setMessage(result.requiresEmailConfirmation ? '注册成功，请先去邮箱完成验证后再登录。' : '注册成功，请直接登录。');
        setTab('login');
        return;
      }

      const result = await signIn(email.trim(), password);
      if (result.session) {
        evaluateFlagsForUser(result.session.userId);
        track('auth_login_success', { method: 'email_password' });
      }
      router.replace('/(tabs)');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>AIWeb Mobile</Text>
        </View>
        <Text style={styles.title}>把错题本升级为随手可用的 AI 提分助手</Text>
        <Text style={styles.subtitle}>
          现在直接接入和 Web 端相同的 Supabase 用户体系与题库数据，登录后读取同一份真实学习记录。
        </Text>
      </View>
      <View style={styles.card}>
        <View style={styles.tabRow}>
          <Pressable onPress={() => setTab('login')} style={[styles.tabButton, tab === 'login' && styles.tabButtonActive]}>
            <Text style={[styles.tabLabel, tab === 'login' && styles.tabLabelActive]}>登录</Text>
          </Pressable>
          <Pressable onPress={() => setTab('register')} style={[styles.tabButton, tab === 'register' && styles.tabButtonActive]}>
            <Text style={[styles.tabLabel, tab === 'register' && styles.tabLabelActive]}>注册</Text>
          </Pressable>
        </View>
        {tab === 'register' ? (
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>昵称</Text>
            <TextInput
              autoCapitalize="none"
              onChangeText={setName}
              placeholder="可选昵称"
              placeholderTextColor={tokens.colors.text.tertiary}
              style={styles.input}
              value={name}
            />
          </View>
        ) : null}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>邮箱</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="your@email.com"
            placeholderTextColor={tokens.colors.text.tertiary}
            style={styles.input}
            value={email}
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>密码</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPassword}
            placeholder={tab === 'register' ? '至少 6 位字符' : '输入密码'}
            placeholderTextColor={tokens.colors.text.tertiary}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
        {!isConfigured ? (
          <Text style={styles.warningText}>当前未配置 Supabase 环境变量，无法接入与 Web 同源的真实数据。</Text>
        ) : null}
        {message ? <Text style={styles.messageText}>{message}</Text> : null}
        <PrimaryButton label={submitting ? '提交中...' : tab === 'login' ? '登录真实账号' : '注册真实账号'} onPress={handleSignIn} />
        <Text style={styles.footnote}>账号体系与 Web 端一致：登录后直接读取同一个用户在 Supabase 中的题目、复习与统计数据。</Text>
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
  tabRow: {
    flexDirection: 'row',
    gap: tokens.spacing[2],
    backgroundColor: tokens.colors.background.canvas,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing[1],
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing[3],
  },
  tabButtonActive: {
    backgroundColor: tokens.colors.surface.primary,
  },
  tabLabel: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: tokens.colors.text.primary,
  },
  fieldGroup: {
    gap: tokens.spacing[2],
  },
  fieldLabel: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '600',
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
  warningText: {
    color: tokens.colors.warning.default,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
  messageText: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
  footnote: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
