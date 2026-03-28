import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '../../design/tokens';

interface ChipProps {
  label: string;
}

export function Chip({ label }: ChipProps) {
  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: tokens.spacing[3],
    paddingVertical: tokens.spacing[2],
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.colors.primary.soft,
  },
  label: {
    color: tokens.colors.primary.default,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
});
