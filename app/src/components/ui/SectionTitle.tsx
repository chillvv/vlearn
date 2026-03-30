import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '../../design/tokens';

interface SectionTitleProps {
  title: string;
  subtitle?: string;
}

export function SectionTitle({ title, subtitle }: SectionTitleProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: tokens.spacing[1],
  },
  title: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.heading.l.fontSize,
    lineHeight: tokens.typography.heading.l.lineHeight,
    fontWeight: '700',
  },
  subtitle: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
