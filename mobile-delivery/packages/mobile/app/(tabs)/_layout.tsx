import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { tokens } from '../../src/design/tokens';

const iconMap = {
  index: 'home',
  capture: 'camera',
  review: 'refresh-cw',
  practice: 'target',
  settings: 'settings',
} as const;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: tokens.colors.primary.default,
        tabBarInactiveTintColor: tokens.colors.text.tertiary,
        tabBarStyle: {
          height: 84,
          paddingTop: 10,
          paddingBottom: 16,
          backgroundColor: tokens.colors.surface.primary,
          borderTopColor: tokens.colors.stroke.soft,
        },
        tabBarLabelStyle: {
          fontSize: tokens.typography.label.s.fontSize,
          fontWeight: '600',
        },
        tabBarIcon: ({ color, size }) => (
          <Feather name={iconMap[route.name as keyof typeof iconMap]} size={size} color={color} />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: '总览' }} />
      <Tabs.Screen name="capture" options={{ title: '录题' }} />
      <Tabs.Screen name="review" options={{ title: '复习' }} />
      <Tabs.Screen name="practice" options={{ title: '练习' }} />
      <Tabs.Screen name="settings" options={{ title: '设置' }} />
    </Tabs>
  );
}
