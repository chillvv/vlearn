import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { Platform } from 'react-native';
import { tokens } from '../design/tokens';

export async function syncSystemUi() {
  await SystemUI.setBackgroundColorAsync(tokens.colors.background.canvas);
  if (Platform.OS === 'android') {
    await NavigationBar.setBackgroundColorAsync(tokens.colors.surface.primary);
  }
}
