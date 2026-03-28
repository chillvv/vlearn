# AIWeb Mobile Solution

## 1. 选型结论

- 跨平台框架：Expo + React Native。
- 复用策略：沿用现有 Web 端 TypeScript 领域模型、Supabase Auth、RPC、AI Action 协议与统计口径。
- 状态管理：Zustand 管本地会话与灰度，React Query 管服务端状态。
- 埋点与异常：PostHog + Sentry，补充现有 perf / AI diagnosis telemetry。
- 热更新：EAS Update。

## 2. 品牌映射

现有 Web 端品牌核心是“知识图谱 + 高信息密度 + Linear 风格克制科技感”。移动端继承以下基因：

- 主品牌色：Klein Blue 系列。
- 背景基调：高亮灰白 + 深色模式近黑。
- 信息组织：Bento 卡片、分段控件、数据优先。
- 学习反馈：蓝色代表掌握路径，绿色代表正向激励，红色代表待修复风险。

## 3. 原子级设计 Token

### 3.1 分辨率与断点

| Token | 范围 | 用途 |
| --- | --- | --- |
| `screen-xs` | 320-359 | 小屏 iPhone SE / Android compact |
| `screen-sm` | 360-389 | 主流 Android |
| `screen-md` | 390-429 | 主流 iPhone |
| `screen-lg` | 430-539 | Max / Plus |
| `screen-xl` | 540-767 | 折叠屏单页 |
| `screen-2xl` | 768+ | 折叠屏双列 / 平板兼容 |

### 3.2 字号 / 行高

| Token | 字号 | 行高 | 场景 |
| --- | --- | --- | --- |
| `label-s` | 11 | 16 | tab、徽标、状态字 |
| `label-m` | 13 | 18 | 按钮、标签、分组名 |
| `body-s` | 13 | 20 | 辅助信息、说明 |
| `body-m` | 15 | 22 | 默认正文 |
| `body-l` | 17 | 26 | 题干、长文案 |
| `heading-s` | 16 | 24 | 卡片标题 |
| `heading-m` | 18 | 26 | 区块标题 |
| `heading-l` | 20 | 28 | 页面二级标题 |
| `title-m` | 24 | 32 | 模块 hero |
| `title-l` | 28 | 36 | 页面标题 |
| `title-xl` | 32 | 40 | 启动 / 登录视觉锤 |

### 3.3 间距 / 圆角 / 阴影

| 类型 | Token | 值 |
| --- | --- | --- |
| Spacing | `space-1..10` | 4 / 8 / 12 / 16 / 20 / 24 / 28 / 32 / 36 / 40 |
| Radius | `radius-sm..xxl` | 8 / 12 / 16 / 20 / 24 |
| Radius | `radius-full` | 999 |
| Shadow | `card-soft` | y=10 blur=24 alpha=0.08 |
| Shadow | `sheet-soft` | y=-8 blur=28 alpha=0.12 |

### 3.4 配色

| 语义 | Token | 值 |
| --- | --- | --- |
| 品牌 | `brand-500` | `#2563EB` |
| 品牌按下 | `brand-600` | `#1D4ED8` |
| 品牌浅底 | `brand-100` | `#DBEAFE` |
| 背景 | `bg-canvas` | `#F8FAFC` |
| 卡片 | `surface-1` | `#FFFFFF` |
| 描边 | `stroke-soft` | `#E2E8F0` |
| 主文字 | `text-strong` | `#0F172A` |
| 次文字 | `text-soft` | `#334155` |
| 成功 | `success-500` | `#16A34A` |
| 警示 | `warning-500` | `#D97706` |
| 危险 | `danger-500` | `#DC2626` |
| OLED 黑 | `oled-black` | `#000000` |

### 3.5 动效

| Token | 时长 | 说明 |
| --- | --- | --- |
| `motion-instant` | 100ms | 点击反馈、波纹 |
| `motion-fast` | 160ms | tab 切换、卡片状态 |
| `motion-base` | 220ms | Bottom Sheet、列表刷新 |
| `motion-slow` | 320ms | 页面转场、骨架淡入 |

### 3.6 手持端交互规范

- 单手热区：底部 60% 为核心 CTA 区，主按钮与主 tab 固定在拇指半径内。
- 底部导航：五项以内，默认“总览 / 录题 / 复习 / 练习 / 设置”。
- 手势返回：Android 预测返回开启；iOS 左缘返回优先于自定义拖拽。
- 刘海避让：顶部安全区至少 16dp，底部手势区至少 24dp。
- 触控尺寸：任何点击目标不小于 44x44dp。

## 4. 组件库策略

- 设计源文件：`design/mobile-ui-kit.fig` 中包含 200+ 已命名组件清单。
- 命名规则：`Category/Component/Size/State`。
- 页面组织：Foundations、Navigation、Inputs、Cards、Feedback、DataDisplay、Templates 七页。
- 设计与开发映射：
  - Figma Variant = React Native `props`
  - Auto Layout = Flexbox
  - Variables = `tokens`
  - Prototype Overlay = Bottom Sheet / Modal

## 5. 关键界面差异化

| Web 端模式 | 手机端转译 |
| --- | --- |
| 左侧固定 Sidebar | 底部 Tab + 局部分段控件 |
| 抽屉 / Hover Card | Bottom Sheet / Full Screen Modal |
| 拖拽上传 | 拍照 / 相册 / OCR |
| 大表格与多列图表 | 卡片流 + 可折叠明细 |
| 按钮刷新 | 下拉刷新 |
| 密码登录 | 指纹 / 面容 + Magic Link |

## 6. 视觉体验优化策略

### 6.1 性能指标

- 首屏 1 秒渲染：Skeleton + 关键数据预取 + 图片延迟加载。
- 核心交互 0.1 秒响应：本地 optimistic update、按钮按下态 100ms 内反馈、动画在 native driver 上执行。
- 冷启动 ≤ 2 秒：精简启动资源、拆分 AI 重逻辑、首屏不阻塞校验。

### 6.2 深色模式 / 高刷 / 折叠屏

| 场景 | 方案 |
| --- | --- |
| OLED 深色 | 纯黑背景 + 品牌蓝降饱和，阴影改描边，不使用大面积灰雾 |
| 120 Hz | 关键滚动区使用原生滚动与低成本阴影，避免 JS thread 重布局 |
| 折叠屏 | 540dp 以上进入双列，保留主流与预览流同步 |
| ≤5.4" 小屏 | 压缩次级信息，优先显示题干、评分与 CTA |
| ≥6.7" 大屏 | 允许双层信息卡与固定底部操作区 |

### 6.3 无障碍

- 对比度：正文与背景至少 4.5:1，大字号 3:1。
- 焦点顺序：标题 → 主要内容 → 操作区 → 补充信息。
- 语音朗读：题干、选项、解析、下次复习时间、按钮文案必须显式设置可读标签。
- 动效控制：跟随系统“减少动态效果”，将页面转场降级为透明度过渡。

## 7. Flutter / React Native / 小程序落地片段

### React Native Token Snippet

```ts
export const tokens = {
  colors: { brand500: '#2563EB', bgCanvas: '#F8FAFC', textStrong: '#0F172A' },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24 },
  radius: { sm: 8, md: 12, lg: 16, xl: 20, full: 999 },
};
```

### Flutter Token Snippet

```dart
class AiwebTokens {
  static const brand500 = Color(0xFF2563EB);
  static const bgCanvas = Color(0xFFF8FAFC);
  static const textStrong = Color(0xFF0F172A);
  static const radiusLg = 16.0;
  static const space4 = 16.0;
}
```

### Mini Program Token Snippet

```js
export const tokens = {
  brand500: '#2563EB',
  bgCanvas: '#F8FAFC',
  textStrong: '#0F172A',
  radiusLg: '16rpx',
  space4: '16rpx',
}
```

## 8. 技术架构

| 层级 | 职责 |
| --- | --- |
| `app/` | 页面与路由 |
| `src/design/` | Token 与设计基础 |
| `src/components/` | 跨场景基础组件 |
| `src/store/` | 会话、灰度、本地偏好 |
| `src/lib/` | Supabase、埋点、热更新、异常上报 |
| `tests/visual/` | Appium + pixelmatch 自动对比 |

## 9. 服务端复用策略

- 直接复用 Web 端 Auth、Questions、Review、Practice、Stats、Sync、Chat 契约。
- 目标服务端复用率 ≥ 80%。
- 客户端仅新增设备层适配：相机、相册、生物识别、通知、OTA。

## 10. 验收标准映射

- 设计评审通过率：靠 `mobile-ui-kit.fig` + `walkthrough-report.html`。
- 走查问题单关闭率：靠 `mobile-a11y-checklist.md` 与视觉回归脚本。
- 机型覆盖：Top 20 设备矩阵写入 QA 执行单。
- 性能基线：`performance-profile.md` 提供目标与采样方式。
