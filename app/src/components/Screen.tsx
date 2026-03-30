import { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tokens } from '../design/tokens';

interface ScreenProps extends PropsWithChildren {
  scrollable?: boolean;
  header?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function Screen({ children, scrollable, header, contentContainerStyle }: ScreenProps) {
  if (scrollable) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={tokens.colors.background.canvas} />
        {header}
        <ScrollView contentContainerStyle={[styles.content, contentContainerStyle]} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={tokens.colors.background.canvas} />
      {header}
      <View style={[styles.content, contentContainerStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.colors.background.canvas,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: tokens.spacing[5],
    paddingTop: tokens.spacing[5],
  },
});
