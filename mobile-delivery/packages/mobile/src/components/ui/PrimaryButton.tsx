import { Pressable, StyleSheet, Text } from 'react-native';
import { tokens } from '../../design/tokens';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void | Promise<void>;
  tone?: 'primary' | 'ghost';
}

export function PrimaryButton({ label, onPress, tone = 'primary' }: PrimaryButtonProps) {
  return (
    <Pressable onPress={onPress} style={[styles.button, tone === 'ghost' && styles.ghost]}>
      <Text style={[styles.label, tone === 'ghost' && styles.ghostLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: tokens.layout.touchTargetMin,
    borderRadius: tokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.colors.primary.default,
    paddingHorizontal: tokens.spacing[5],
    paddingVertical: tokens.spacing[4],
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: tokens.colors.stroke.strong,
  },
  label: {
    color: tokens.colors.text.inverse,
    fontSize: tokens.typography.label.l.fontSize,
    fontWeight: '700',
  },
  ghostLabel: {
    color: tokens.colors.text.primary,
  },
});
