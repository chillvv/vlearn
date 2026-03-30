export const performanceTargets = [
  { label: '首屏渲染', value: '≤ 1 s' },
  { label: '核心交互响应', value: '≤ 0.1 s' },
  { label: '冷启动', value: '≤ 2 s' },
  { label: '滚动帧率', value: '≥ 55 fps' },
];

export const parityHighlights = [
  {
    title: '100% 一致',
    summary: 'Dashboard、错题库、知识点 Hub、复习中心、专项练习、设置与同步保持同源数据契约。',
  },
  {
    title: '移动增强',
    summary: '拍照上传替代拖拽、下拉刷新替代刷新按钮、生物识别替代纯密码登录、底部导航替代侧边栏。',
  },
  {
    title: '降级移除',
    summary: '桌面拖拽排序、复杂 hover 态、大尺寸多栏图表页在手机端改为分步式卡片。',
  },
];

export const captureActions = [
  '拍照录题',
  '相册导入',
  'OCR 纠偏',
  'AI 推荐标签',
  'Bottom Sheet 二次确认',
];

export const reviewQueue = [
  { title: '时态混用', status: 'due', next: '今天 19:30' },
  { title: '指针越界', status: 'stubborn', next: '今天 21:00' },
  { title: '阅读推理', status: 'unmastered', next: '明天 07:30' },
];

export const rolloutFlags = [
  { key: 'biometricLogin', desc: '指纹 / 面容登录灰度 100%' },
  { key: 'cameraUpload', desc: '拍照录题灰度 100%' },
  { key: 'realtimeSync', desc: '实时多端同步灰度 10%' },
];
