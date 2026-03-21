## Context

目前的 Web 端项目 `frontend` 是一个 React + Vite 应用，使用 Tailwind CSS 和 Lucide-react 等 UI 库。当前最大的问题在于“演示性质”过重，很多核心页面（如 `KnowledgeUniversePage.tsx`, `KnowledgeBasePage.tsx`, `KnowledgeDetailPage.tsx` 等）直接把假数据（Mock Data）写死在了组件内部。这导致即使后端 Supabase 数据库是空的，前端依然显示花里胡哨的数据，且用户的真实操作无法保存或影响这些页面。此外，UI 排版在真实数据为空或加载时缺乏处理，导致体验割裂。用户希望系统成为一个真正的生产可用工具，专注“英语”和“编程”两个学科。

## Goals / Non-Goals

**Goals:**
- 全面清理前端的假数据（Mock Data）。
- 将所有的数据读取和写入操作对接至现有的 `src/app/lib/api.ts` 中的 Supabase 接口。
- 全局状态和过滤器仅支持“英语”和“编程”两个学科。
- 优化现有的 UI 排版，处理数据为空（Empty State）和加载中（Loading State）的展示。
- 修复现存残缺的交互逻辑（如错题本详情、专项训练的数据流转）。

**Non-Goals:**
- **UI 彻底重构**：不在本次直接进行页面的“大整容”（如完全改变布局结构）。UI 调整仅限于优化排版、修复错位、增加空状态。若后续需要结构大改，将另行沟通。
- **更改数据库结构**：不修改现有的 Supabase Schema，仅在前端适配现有表结构（如 `questions`, `knowledge_nodes`, `user_weakness`）。

## Decisions

- **数据获取模式**：在 React 组件中使用 `useEffect` 和状态管理（或引入简单的 React Query，如果必要，但为保持轻量，优先使用原生 Hook）来获取 Supabase 数据。
- **空状态处理**：为 `KnowledgeUniversePage` 和 `Dashboard` 设计友好的空状态（Empty State）UI，引导用户去“AI 录入错题”页面添加真实数据。
- **学科硬编码修改**：在 `subjects.ts` 或相关配置中，将学科枚举严格限制为 `['英语', '编程']`。
- **知识树渲染逻辑**：`KnowledgeUniversePage` 原有的写死层级将被替换为通过 `knowledgeTreeApi.getTree()` 获取动态树结构，并根据真实数据递归渲染。

## Risks / Trade-offs

- **Risk: 移除 Mock 数据后页面显得空旷**
  - **Mitigation**: 必须精心设计 Empty State，告诉用户“这里没有数据，请去录入”，而不是留白或报错。
- **Risk: 现有的 AI 接口生成的数据格式不稳定，导致前端解析报错**
  - **Mitigation**: 增强 `api.ts` 中对 AI 返回 JSON 的鲁棒性解析，并在 UI 层增加错误边界（Error Boundary）或 Toast 提示。
- **Risk: Supabase 数据库中缺乏基础的“英语”和“编程”知识节点**
  - **Mitigation**: 在前端实现一套逻辑，当检测到某学科知识树为空时，通过 AI 或预置脚本自动向 Supabase 初始化一层基础节点（或者提示用户自行创建）。