# AIWeb Mobile Performance Profile

## 1. 基线指标

| 指标 | 目标 | 采样方式 |
| --- | --- | --- |
| 冷启动 | ≤ 2s | Expo performance trace + 真机秒表双校验 |
| 首屏可交互 | ≤ 1s | 首屏 skeleton 消失与首个 CTA 可点击 |
| 核心交互响应 | ≤ 0.1s | 点击反馈到视觉响应 |
| 平均滑动帧率 | ≥ 55fps | Android Profile GPU Rendering / Xcode Instruments |
| 内存峰值增量 | ≤ 基线 20% | Instruments / Android Studio Profiler |
| 包体积增量 | ≤ 基线 15% | `eas build` 产物对比 |

## 2. 关键优化动作

- 启动期只拉取 session 与轻量首页骨架数据。
- 图像类资源采用懒加载与分辨率分级。
- Markdown / 数学公式内容延迟进入详情页渲染。
- 高刷设备上禁用昂贵的阴影与重排动画。
- 通过 React Query 缓存减少切 tab 重取。

## 3. 页面 Profile 重点

| 页面 | 风险 | 优化 |
| --- | --- | --- |
| 登录 | 启动依赖多 | 登录页静态化，Supabase session 异步恢复 |
| Dashboard | 聚合统计多 | 先骨架后明细，图表改摘要卡 |
| 录题 | 图片处理重 | 客户端先压缩再上传，OCR 串流异步回填 |
| 复习 | 切题频繁 | 局部刷新，选项组件保持稳定 key |
| 练习 | AI 题组生成慢 | session 先建后填题，状态机可感知加载阶段 |

## 4. 风险阈值

- 任一页面滚动帧率低于 50fps：阻断发布。
- 冷启动 > 2.5s：阻断发布。
- 内存峰值超基线 25%：阻断发布。
- 视觉回归误差 > 0.2%：阻断合入。

## 5. 采样模板

| 设备 | 系统 | 结果 |
| --- | --- | --- |
| iPhone 15 | iOS 18 | 待补充 |
| iPhone SE 3 | iOS 17 | 待补充 |
| Redmi K70 | Android 14 | 待补充 |
| OPPO Find N3 | Android 14 | 待补充 |
