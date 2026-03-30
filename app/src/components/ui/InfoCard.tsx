import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '../../design/tokens';

interface InfoCardProps {
  title: string;
  value?: string;
  description?: string;
}

export function InfoCard({ title, value, description }: InfoCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    shadowColor: tokens.shadows.card.shadowColor,
    shadowOpacity: tokens.shadows.card.shadowOpacity,
    shadowOffset: tokens.shadows.card.shadowOffset,
    shadowRadius: tokens.shadows.card.shadowRadius,
    elevation: tokens.shadows.card.elevation,
  },
  title: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.label.l.fontSize,
    fontWeight: '600',
  },
  value: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.title.m.fontSize,
    lineHeight: tokens.typography.title.m.lineHeight,
    fontWeight: '700',
  },
  description: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
