export const tokens = {
  colors: {
    background: {
      canvas: '#F8FAFC',
      elevated: '#FFFFFF',
      inverse: '#0F172A',
      oled: '#000000',
    },
    surface: {
      primary: '#FFFFFF',
      secondary: '#EFF6FF',
      tertiary: '#E2E8F0',
      inverse: '#111827',
    },
    text: {
      primary: '#0F172A',
      secondary: '#334155',
      tertiary: '#64748B',
      inverse: '#F8FAFC',
    },
    primary: {
      default: '#2563EB',
      pressed: '#1D4ED8',
      soft: '#DBEAFE',
    },
    success: {
      default: '#16A34A',
      soft: '#DCFCE7',
    },
    warning: {
      default: '#D97706',
      soft: '#FEF3C7',
    },
    danger: {
      default: '#DC2626',
      soft: '#FEE2E2',
    },
    stroke: {
      soft: '#E2E8F0',
      strong: '#CBD5E1',
    },
    overlay: 'rgba(15, 23, 42, 0.56)',
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    9: 36,
    10: 40,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    full: 999,
  },
  typography: {
    title: {
      xl: { fontSize: 32, lineHeight: 40 },
      l: { fontSize: 28, lineHeight: 36 },
      m: { fontSize: 24, lineHeight: 32 },
    },
    heading: {
      l: { fontSize: 20, lineHeight: 28 },
      m: { fontSize: 18, lineHeight: 26 },
      s: { fontSize: 16, lineHeight: 24 },
    },
    body: {
      l: { fontSize: 17, lineHeight: 26 },
      m: { fontSize: 15, lineHeight: 22 },
      s: { fontSize: 13, lineHeight: 20 },
    },
    label: {
      l: { fontSize: 15, lineHeight: 20 },
      m: { fontSize: 13, lineHeight: 18 },
      s: { fontSize: 11, lineHeight: 16 },
    },
  },
  shadows: {
    card: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 10 },
      shadowRadius: 24,
      elevation: 6,
    },
  },
  motion: {
    instant: 100,
    fast: 160,
    base: 220,
    slow: 320,
  },
  layout: {
    contentMaxWidth: 560,
    touchTargetMin: 44,
    safeTop: 16,
    safeBottom: 24,
  },
} as const;
