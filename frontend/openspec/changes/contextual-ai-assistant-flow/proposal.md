## Why

当前产品把错题录入与学习支持耦合在全局 AI 聊天页中，导致流程割裂、上下文弱、页面噪音高。需要将 AI 能力下沉到“草稿确认”和“错题详情”场景中，形成可控、结构化、不中断学习主线的体验。

## What Changes

- 移除独立的 AI 聊天页面入口与对应导航项，避免用户在主流程外游离。
- 新增“AI 草稿确认流”：用户拍照/录入后先进入草稿确认页，确认后再入库。
- 新增图像增强与原图保真展示能力，保留题目图形真相并提升可读性。
- 将错题详情改造为动态结构化展示，支持步骤化解析、公式渲染与前置知识抽屉。
- 引入场景化 AI 助手触发器（步骤内触发、底部召唤），以抽屉/Bottom Sheet 承载对话，不跳转页面。
- 首期不提供全局 AI 重写，改为轻量“报告解析错误”和“个人笔记置顶”。

## Capabilities

### New Capabilities
- `draft-review-flow`: 错题录入后的 AI 草稿确认与修订闭环。
- `contextual-ai-assistant`: 详情页内上下文化 AI 面板与局部触发交互。
- `image-enhance-and-source-preview`: 图片增强处理与原图优先展示。

### Modified Capabilities
- `mistake-book`: 错题详情从静态展示升级为结构化动态积木渲染与笔记置顶。
- `node-as-a-hub`: 节点页中 AI 模块改为场景触发式助手，不再依赖全局聊天页。

## Impact

- 前端页面：`AIChatPage`、`routes.tsx`、`Sidebar.tsx`、`MistakeNodeHubPage.tsx`、错题录入相关页面。
- 前端基础能力：Markdown/GFM 渲染、数学公式渲染、抽屉与移动端 Bottom Sheet 交互。
- 数据与接口：错题结构字段扩展（如 `original_image_url`、步骤化内容），保存流程由“直接入库”调整为“草稿确认后入库”。
- 体验与指标：降低主流程跳转，提升录入准确率、详情停留时长和个人笔记使用率。
