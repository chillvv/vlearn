# AIWeb Mobile Roadmap

## 1. 目标

- 以 Expo + React Native 建立独立可运行的手机端基座。
- 复用现有 Web 端 Supabase Auth、questions / review / practice / stats / sync / chat 服务契约。
- 在首个版本内实现“拍照录题、复习、专项练习、设置同步”四条高频链路。

## 2. 里程碑

| 里程碑 | 范围 | 交付物 | 验收口径 |
| --- | --- | --- | --- |
| M0 策略冻结 | 功能盘点、设计 token、技术选型 | `mobile-solution.md`、功能矩阵、风险清单 | 功能映射与端差异评审通过 |
| M1 体验基座 | Expo Router、Zustand、React Query、Supabase、灰度、Sentry、PostHog、OTA | `packages/mobile/` 初始工程 | 本地可运行、类型检查通过 |
| M2 核心闭环 | 登录、Dashboard、拍照录题、复习中心 | 关键页面与契约联调清单 | 真机首轮走查通过 |
| M3 强化学习 | 专项练习、知识点 Hub、离线草稿、推送提醒 | 性能调优报告、A11y 清单 | 冷启动、帧率、内存达到基线 |
| M4 预发交付 | 视觉回归、Top 20 机型、TestFlight / 蒲公英 | 可视化走查报告、发布命令、PR | 零 P0/P1，问题单关闭率 100% |

## 3. 排期建议

| 周次 | 重点 | 说明 |
| --- | --- | --- |
| 第 1 周 | 设计系统冻结 + 服务契约梳理 | 输出 token、组件库、功能矩阵、接口边界 |
| 第 2 周 | 移动端工程基建 | 路由、状态、网络、埋点、灰度、热更新、异常上报 |
| 第 3 周 | 登录 + Dashboard + 录题 | 单手热区、底部导航、相机与相册入口 |
| 第 4 周 | 复习中心 + 专项练习 | 下拉刷新、AI 诊断、折叠屏与小屏适配 |
| 第 5 周 | 无障碍 + 性能 + 视觉回归 | WCAG 2.2 AA 走查、Appium + pixelmatch CI |
| 第 6 周 | 真机验证 + 发版彩排 | TestFlight、蒲公英、灰度策略与回滚演练 |

## 4. 风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Expo 当前使用 canary SDK | 原生依赖兼容性波动 | 预发前回切稳定 SDK；锁定 `expo install` 版本 |
| Web `api.ts` 逻辑过于集中 | 移动端复用成本偏高 | 按 auth / questions / review / practice / sync / chat 六层拆包 |
| AI 流式协议直接在前端调用 | 移动端弱网体验不稳定 | 补充流式超时、重试、离线草稿与断点续传 |
| 视觉回归依赖真机截图 | CI 成本与维护复杂度高 | 先在模拟器建立基线，再补核心真机快照 |
| PR 所在仓库当前存在大量未整理改动 | 影响独立提交与审查 | 本次仅提交 `mobile-delivery/`；PR 说明标注与现有脏工作区隔离 |

## 5. 质量门禁

- 设计评审通过率 100%。
- 走查问题单关闭率 100%。
- 真机覆盖 Top 20 主流机型，iOS ≥ 14，Android ≥ API 28。
- 崩溃率 < 0.1%，ANR = 0。
- 冷启动 ≤ 2s，首屏 ≤ 1s，核心交互 ≤ 0.1s。
- 滑动平均帧率 ≥ 55fps。
- 包体积增量 ≤ 基线 15%，内存峰值增量 ≤ 基线 20%。

## 6. 发布节奏

- Preview：每日构建，面向产品 / 设计 / QA。
- Beta：每周冻结一次，走真机清单与视觉回归。
- Production：按功能灰度分批开启，支持 OTA 与原生包双轨发布。

## 7. 交付清单

- `design/mobile-ui-kit.fig`
- `packages/mobile/`
- `tests/visual/`
- `docs/mobile-solution.md`
- `docs/mobile-function-matrix.md`
- `docs/mobile-a11y-checklist.md`
- `docs/performance-profile.md`
- `docs/walkthrough-report.html`
