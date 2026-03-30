import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { tokens } from '../../src/design/tokens';

const iconMap = {
  index: 'home',
  practice: 'target',
  capture: 'camera',
  settings: 'user',
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
          paddingBottom: 24, // 适配全面屏底部安全区
          backgroundColor: tokens.colors.surface.primary,
          borderTopColor: tokens.colors.stroke.soft,
          elevation: 8,
          shadowColor: tokens.colors.text.primary,
          shadowOpacity: 0.05,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarLabelStyle: {
          fontSize: tokens.typography.label.s.fontSize,
          fontWeight: '600',
          marginTop: 4,
        },
        tabBarIcon: ({ color, size, focused }) => (
          <Feather 
            name={iconMap[route.name as keyof typeof iconMap] || 'circle'} 
            size={focused ? 28 : 24} // 选中时图标稍微放大
            color={color} 
          />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: '首页' }} />
      <Tabs.Screen name="practice" options={{ title: '练习' }} />
      <Tabs.Screen 
        name="capture" 
        options={{ 
          title: '录题',
          tabBarIcon: ({ color, size }) => (
            <Feather name="camera" size={28} color={tokens.colors.surface.primary} />
          ),
          tabBarItemStyle: {
            // 将录题按钮做成凸起的特殊按钮样式（可选简化版：这里只是简单的样式调整）
            backgroundColor: tokens.colors.primary.default,
            borderRadius: 100,
            marginHorizontal: 16,
            marginTop: 4,
            marginBottom: 4,
            height: 48,
            justifyContent: 'center',
            alignItems: 'center'
          },
          tabBarLabel: () => null // 录题按钮不显示文字，只显示图标
        }} 
      />
      <Tabs.Screen name="settings" options={{ title: '我的' }} />
      
      {/* 以下页面从底部 Tab 中隐藏，但仍然可以通过路由跳转访问 */}
      <Tabs.Screen name="questions" options={{ href: null }} />
      <Tabs.Screen name="review" options={{ href: null }} />
    </Tabs>
  );
}
