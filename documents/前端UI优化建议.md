# 前端 UI/UX 优化建议书

## 1. 现状分析

通过对项目核心页面（Dashboard, QuestionBankPage）和样式配置的分析，发现项目虽然配置了基于 CSS 变量的现代设计系统（`theme.css`），但在实际开发中并未有效利用。

**主要问题：**
- **设计系统脱节**：尽管定义了 `primary`, `card`, `muted` 等语义化颜色，页面代码中仍大量使用 `bg-blue-500`, `text-gray-900` 等硬编码颜色。这导致主题切换（如暗色模式）失效，且难以全局调整品牌色。
- **组件复用率低**：核心组件如“错题卡片”在 Dashboard 和 QuestionBank 中存在重复的内联实现，维护成本高。
- **响应式适配缺失**：Sidebar 固定宽度且无移动端折叠逻辑；Dashboard Grid 布局在小屏下缺乏适配。
- **交互体验粗糙**：使用了原生的 `confirm` 弹窗；Loading 状态样式不统一。

## 2. 优化建议

### 2.1. 落地设计系统 (Design System Adoption)

**目标**：消除硬编码颜色，全面接管主题配置，实现“一处修改，全局生效”。

- **颜色替换**：
  - `bg-white` -> `bg-card`
  - `text-gray-900` -> `text-card-foreground` 或 `text-foreground`
  - `bg-blue-600` -> `bg-primary`
  - `text-gray-500` -> `text-muted-foreground`
  - `border-gray-100` -> `border-border`
- **圆角统一**：
  - 将分散的 `rounded-xl`, `rounded-2xl` 统一为配置中的 `rounded-lg` 或 `rounded-xl`（对应 `var(--radius)`）。

### 2.2. 组件化重构 (Component Refactoring)

**目标**：降低代码冗余，提升可维护性。

- **提取 `QuestionCard`**：
  - 将 `QuestionBankPage.tsx` 中的卡片逻辑提取为 `src/app/components/business/QuestionCard.tsx`。
  - 统一 Dashboard 中使用的简化版卡片与主列表卡片的视觉风格。
- **封装基础 UI 组件**：
  - 建议引入或封装 `Button`, `Input`, `Select`, `Dialog` 组件，替代原生 HTML 标签，确保交互态（Hover, Focus, Disabled）一致。
- **统一 Loading 态**：
  - 创建 `QuestionSkeleton` 和 `DashboardSkeleton` 组件，替代随手写的 `animate-pulse` div。

### 2.3. 布局与响应式升级 (Layout & Responsiveness)

**目标**：支持移动端访问，优化宽屏体验。

- **响应式 Sidebar**：
  - 桌面端：保持侧边栏常驻。
  - 移动端：使用 `Sheet` (Drawer) 组件，通过汉堡菜单触发侧边栏，通过断点（`md:hidden`）控制显示。
- **Dashboard 布局优化**：
  - 统计卡片区：使用 `grid-cols-1 md:grid-cols-3` 实现响应式排列。
  - 内容区：增加 `max-w-7xl mx-auto` 限制，防止在大屏显示器上视线跨度过大。

### 2.4. 交互体验升级 (UX Improvements)

**目标**：提供更细腻、更友好的用户反馈。

- **移除原生弹窗**：
  - 使用自定义 `AlertDialog` 替代 `window.confirm`，保持视觉风格一致。
- **空状态 (Empty State) 优化**：
  - 为不同场景（无错题、无搜索结果、无复习任务）设计差异化的插画或图标提示，并提供明确的引导按钮。
- **微交互 (Micro-interactions)**：
  - 为列表项添加 `Framer Motion` 或 CSS 动画（`animate-in fade-in slide-in-from-bottom-4`），使数据加载更平滑。

## 3. 实施路线图

1.  **基础建设**：封装 `Button`, `Dialog` 等基础组件，确认 `theme.css` 变量映射无误。
2.  **Sidebar 改造**：实现移动端响应式布局。
3.  **Dashboard 重构**：应用语义化颜色，提取骨架屏组件。
4.  **错题本重构**：提取 `QuestionCard`，替换原生弹窗，优化筛选栏移动端体验。

---

**是否开始执行？**
如果确认，建议从 **Sidebar 响应式改造** 或 **Dashboard 主题色替换** 开始。
