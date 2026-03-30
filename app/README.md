# vlearn App

独立 App 工程目录，包含 Expo 客户端、移动端文档、设计清单、视觉回归脚本与发布命令。

## 目录

- `app/`：Expo Router 页面与路由入口
- `src/`：业务逻辑、数据层、状态管理与 UI 组件
- `docs/`：方案文档、路线图、性能与无障碍报告
- `design/`：组件库清单、设计 token、`.fig` 设计清单
- `tests/visual/`：Appium + pixelmatch 视觉对比
- `Makefile`：一键安装、运行、构建、发布命令

## 快速开始

1. 复制 `app/.env.example` 为 `.env` 并填写 Supabase / PostHog / Sentry。
2. 运行 `npm install --legacy-peer-deps`。
3. 运行 `npm run dev` 启动 Expo 开发服务。
4. 运行 `npm run web` 打开浏览器预览，或运行 `npm run android` / `npm run ios` 连接真机与模拟器。
5. 运行 `npm run typecheck` 与 `npm run visual:test`。

## 常用命令

- 开发服务：`npm run dev`
- Web 预览：`npm run web`
- 类型检查：`npm run typecheck`
- 视觉回归：`npm run visual:test`
- 文档预览：`npm run docs:serve`

## 说明

- 当前目录已经扁平化为真正的 `app/` 工程，不再需要进入 `mobile-client/` 子目录。
- 共享契约已外置到仓库根目录 `shared-contracts/`，供 App 与 Web 复用。
- 登录、Dashboard、复习读取已接入和 Web 相同的 Supabase 用户体系与业务数据。
- Expo 与 Web 的启动方式不同：`npm run dev` 会启动 Expo Dev Server，`npm run web` 只是其中一个 Web 渠道。
- 若需要正式发布，建议将 Expo canary SDK 回锁到稳定版后再走预发。
