# AIWeb Mobile Delivery

独立交付目录，包含移动端方案文档、设计库清单、Expo 初始工程、视觉回归脚本与发布命令。

## 目录

- `docs/`：方案文档、路线图、性能与无障碍报告
- `design/`：组件库清单、设计 token、`.fig` 设计清单
- `packages/mobile/`：Expo + React Native 初始工程
- `tests/visual/`：Appium + pixelmatch 视觉对比
- `Makefile`：一键安装、运行、构建、发布命令

## 快速开始

1. 复制 `packages/mobile/.env.example` 为 `.env` 并填写 Supabase / PostHog / Sentry。
2. 运行 `make install`。
3. 运行 `make mobile-web` 或 `make mobile-dev`。
4. 运行 `make visual-test`。

## 发布命令

- 预览二维码：`make build-qr`
- TestFlight：`make testflight`
- 蒲公英：`make pgyer`
- OTA 预发：`make ota-preview`

## 说明

- 当前目录可独立运行，不依赖原 Web 构建产物。
- `design/mobile-ui-kit.fig` 为可机读设计清单，记录 200+ 命名组件与 token。
- 若需要正式发布，建议将 Expo canary SDK 回锁到稳定版后再走预发。
