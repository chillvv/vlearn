# AIWeb Mobile Function Matrix

## 1. Web 功能基线

| 模块 | Web 入口 | 移动策略 | 一致性 |
| --- | --- | --- | --- |
| 登录 / 会话 | `/login` | Magic Link + 生物识别 | 100% 一致 |
| Dashboard | `/` | 底部 Tab 首页 | 100% 一致 |
| AI 管家录题 | `/draft-review` | 拍照 / 相册 / OCR + Bottom Sheet | 增强 |
| 错题库 | `/questions` | 卡片流 + 搜索筛选 | 100% 一致 |
| 知识点 Hub | `/questions/node` | 单列详情，折叠屏双列 | 100% 一致 |
| 复习中心 | `/review` | 下拉刷新 + 底部 CTA | 100% 一致 |
| 专项练习 | `/practice` | 分步卡片 + 底部固定提交 | 100% 一致 |
| 复习统计 | `/review/stats` | 卡片图表，复杂图表降级 | 轻降级 |
| 设置 / 同步 | `/settings` | 原生权限、通知、导入导出 | 增强 |

## 2. 差异矩阵

| 分类 | 功能 | 移动策略 | 接口契约 | 状态管理 | 埋点 |
| --- | --- | --- | --- | --- | --- |
| 100% 一致 | Dashboard 聚合统计 | 原契约直出，UI 卡片化 | `statsApi.getDashboardStats()` | React Query | `dashboard_view`, `dashboard_latency` |
| 100% 一致 | 复习计划 | 原 RPC 直接复用 | `questionsApi.list`, `questionsApi.submitReviewAttempt` | React Query + 局部 UI state | `review_submit`, `review_ai_diagnosis` |
| 100% 一致 | 专项练习 | 保留最弱节点与 session 机制 | `practiceApi.createSession`, `practiceApi.submitAttempt` | React Query + ephemeral store | `practice_session_start`, `practice_attempt_submit` |
| 增强 | 拍照录题 | 相机/相册替代拖拽 | `chatApi.send`, `questionsApi.createQuestion` | Zustand 草稿 + React Query | `capture_open`, `capture_upload`, `draft_confirm` |
| 增强 | 生物识别登录 | 指纹/面容加速会话恢复 | `authApi.signIn`, `authApi.refreshSession` | Zustand session store | `auth_biometric_try`, `auth_biometric_success` |
| 增强 | 下拉刷新 | 替代按钮刷新 | 原查询无改动 | React Query invalidate | `pull_to_refresh` |
| 轻降级 | 复杂图表 | 默认精简卡片，进入详情看完整图 | `statsApi.getGlobalErrorStats()` | React Query | `stats_card_expand` |
| 移除 | Hover / 桌面拖拽 | 不进入移动端 | 无新增接口 | 无 | 无 |

## 3. 接口契约建议

### Auth

```ts
type MobileAuthContract = {
  signInWithMagicLink(email: string): Promise<void>;
  restoreSession(): Promise<{ userId: string } | null>;
  signOut(): Promise<void>;
};
```

### Capture / Draft Review

```ts
type MobileCaptureContract = {
  uploadSource(source: 'camera' | 'gallery', assetUri: string): Promise<{ imageUrl: string }>;
  inferDraft(imageUrl: string, prompt: string): Promise<{ action: string; payload: unknown }>;
  confirmDraft(payload: unknown): Promise<{ questionId: string }>;
};
```

### Review / Practice

```ts
type MobileLearningContract = {
  getDueQuestions(): Promise<Array<{ id: string; nextReviewDate: string }>>;
  submitReviewAttempt(input: { questionId: string; rating: 'forgot' | 'vague' | 'mastered' }): Promise<void>;
  createPracticeSession(node: string): Promise<{ sessionId: string }>;
};
```

## 4. 状态管理分层

- React Query：所有服务端主数据。
- Zustand：
  - `session-store`：登录态、灰度、偏好。
  - `draft-store`：相机草稿、上传中状态、断点续传。
  - `ui-store`：Bottom Sheet、筛选、局部交互。
- 设备缓存：
  - SecureStore：敏感会话。
  - AsyncStorage / MMKV：非敏感草稿、视觉基线元数据。

## 5. 埋点方案

| 事件 | 属性 |
| --- | --- |
| `auth_preview_login` | `method` |
| `dashboard_view` | `source`, `latencyMs` |
| `capture_open` | `entry`, `deviceType` |
| `capture_upload` | `source`, `networkType`, `durationMs` |
| `draft_confirm` | `subject`, `knowledgePoint`, `aiConfidence` |
| `review_submit` | `questionId`, `rating`, `durationMs` |
| `review_ai_diagnosis` | `status`, `latencyMs`, `errorPattern` |
| `practice_session_start` | `node`, `masteryLevel` |
| `practice_attempt_submit` | `result`, `difficulty`, `durationMs` |
| `ota_update_check` | `channel`, `hasUpdate` |

## 6. 前后端零冗余原则

- 服务端规则不下沉到 UI 层。
- 移动端只负责端能力编排，不复制 Web 端学习规则。
- 统一 query key 与错误模型。
- 能力增强只发生在设备适配层。
