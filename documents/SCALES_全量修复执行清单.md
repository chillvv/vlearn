# SCALES 全量修复执行清单（目标：尽可能接近满分）

本清单用于把“白盒发现的问题 + 真实交互复现的问题”全部修到可用，并用统一脚本做回归验证。

## 1. 数据库侧（必须）

### 1.1 应用迁移（分享码安全 + RPC）
- 迁移文件：`supabase/migrations/20260324000005_secure_share_code_rpc.sql`
- 目的：
  - 移除 `shared_questions` 的“匿名可全表读取”风险
  - 提供 `create_share_code()` / `get_shared_questions()` RPC，前端通过 RPC 精确按码读取

执行方式（任选其一）：
- Supabase CLI：`supabase db push`
- Supabase Dashboard：把迁移 SQL 粘贴到 SQL Editor 执行

验收点：
- `create_share_code` 可被 authenticated 执行
- `get_shared_questions` 可被 anon/authenticated 执行
- `shared_questions` 不再允许匿名全表扫描式读取

## 2. 前端侧（必须）

### 2.1 安装与运行
```bash
cd frontend
npm install
npm run dev -- --port 5174
```

### 2.2 一键回归（SCALES）
```bash
cd frontend
npm run scales
```

SCALES 覆盖内容：
- TypeScript typecheck
- Vite build
- 关键修复点的静态断言（防止回归成旧问题）

## 3. 关键问题修复点（已落地的文件）

### 3.1 错题库“立即去清零”假按钮
- 文件：`frontend/src/app/pages/MistakeBookPage.tsx`
- 行为：按钮现在会跳转到专项练习并自动开始（preset 节点为洞察节点）

### 3.2 复习中心“先作答后解析后评分”强制链路
- 文件：`frontend/src/app/pages/ReviewModePage.tsx`
- 行为：
  - 未作答时“查看解析”禁用
  - 点击“查看解析”会校验已作答，否则 toast 明确提示
  - 评分动作有 try/catch，失败会 toast 提示，且不推进下一题

### 3.3 专项练习“判题结果与解析结论一致性”
- 文件：`frontend/src/app/pages/TargetedDrillPage.tsx`
- 行为：
  - 判题与高亮使用 `effectiveCorrectAnswer`（优先从解析文本中推断 “答案X”）
  - 解析抽屉最终结论同源显示

### 3.4 设置页规则一致性
- 文件：`frontend/src/app/pages/SettingsPage.tsx`
- 行为：
  - 分享码导入：必须 8 位才可点，并在 handler 再次校验
  - 改密：按钮仅在“新密码≥6且两次一致”时可点
  - 退出登录：加 try/catch，失败可见

### 3.5 导入导出/分享码从 Dummy 变成真实逻辑
- 文件：`frontend/src/app/lib/api.ts`
- 行为：
  - `syncApi.export()`：导出当前用户全部错题为 JSON 并下载
  - `syncApi.import()`：支持 merge/replace，replace 会先清空当前用户 questions 再导入
  - `syncApi.createShareCode()` / `importByCode()`：优先走 RPC（安全），否则 fallback 到表读写（用于过渡）

## 4. 手工回归用例（建议上线前必跑）

### 4.1 复习链路
- 进入 `/review` → 开始复习
- 不作答：确认“查看解析”不可点（或点击会明确提示）
- 作答后：可看解析、可评分
- 评分失败时：页面不推进且有错误提示

### 4.2 专项练习链路
- 进入 `/practice` → 选择知识点 → 开始练习
- 提交答案后：高亮“正确选项”与解析的“最终结论”一致

### 4.3 分享码链路
- 设置页生成分享码（应为 8 位）
- 另一账号/同账号输入分享码导入：8 位才允许提交；导入成功后错题库数量变化可见

