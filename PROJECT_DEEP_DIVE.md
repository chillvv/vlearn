# VLearn 项目全景分析与维护手册（面向接手开发者）

> 文档目标：让新同学在最短时间内理解项目全貌、核心业务、关键链路与改动边界，尤其是 AI 管家、提示词、知识点沉淀、错题库入库与权限控制。

## 1. 项目一句话定义

VLearn 是一个“AI 驱动的错题学习系统”，由 Web 管理端 + App 移动端 + Supabase 数据与 RPC + AI 流式能力组成，覆盖「错题录入 → 结构化标签 → 复习计划 → 专项训练 → 知识点沉淀」完整闭环。

---

## 2. 仓库结构与职责分工

### 2.1 顶层目录

- `web/`：React + Vite 的主业务前端（当前 AI 管家主战场）。
- `app/`：Expo + React Native 移动端（拍题、练习、复习）。
- `supabase/`：数据库迁移、RLS、RPC、Edge Function。
- `shared-contracts/`：跨端共享契约（类型、query keys、部分业务结构）。

### 2.2 责任边界（非常重要）

- `web` 负责：后台式学习操作台、AI 管家交互、错题/知识点可视化管理。
- `app` 负责：移动采集与练习场景，强调轻量快速录入和碎片化学习。
- `supabase` 负责：真实业务真相（表结构、RLS、RPC 逻辑、统计函数）。
- `shared-contracts` 负责：跨端一致性基础，但当前 Web 仍存在部分自有类型实现。

---

## 3. 技术栈与运行模式

### 3.1 前端栈

- Web：React 18 + Vite + React Router + TanStack Query + Supabase JS。
- App：Expo Router + React Native + TanStack Query + Zustand + Supabase JS。

### 3.2 后端与数据栈

- 数据库：PostgreSQL（由 Supabase 承载）。
- 业务能力：RLS + SQL RPC（复习、练习、统计、标签处理等）。
- AI 能力：DashScope OpenAI-Compatible 流式接口（SSE）。

### 3.3 双数据访问模式（高频踩坑点）

- `supabase` 模式：前端直接访问 Supabase（生产主路径）。
- `local_api` 模式：前端请求本地 API，本地 API 再落本地 Postgres（用于本地联调和迁移复现）。

---

## 4. 业务域模型（你改功能前必须先看）

### 4.1 错题域（核心）

主表：`questions`

关键字段语义：
- 题目主体：`content / answer / analysis / source`
- 分类标签：`subject / category / node / knowledge_point / ability / error_type`
- 学习状态：`confidence / mastery_level / next_review_date / review_count / stubborn_flag`
- 生命周期：`mastery_state / is_archived`
- AI 质量追踪：`raw_ai_response / normalized_payload / validation_status / render_mode`

### 4.2 薄弱项域

主表：`user_weakness`

语义：按 `knowledge_point + ability` 聚合错误次数，驱动仪表盘和优先复习策略。

### 4.3 知识点域

三层构成：
- `knowledge_points`：标准知识点字典（基础标签）。
- `knowledge_nodes`：知识节点与技巧缓存（node 维度组织）。
- `user_learning_state`：用户私有学习状态与知识沉淀（含 AI 补充内容）。

### 4.4 复习与练习域

- `question_review_attempts`：复习作答记录。
- `review_plan_cache`：复习计划缓存。
- `practice_sessions / practice_attempts`：专项练习会话与作答明细。
- `ai_diagnosis_telemetry / perf_telemetry`：AI 诊断与性能遥测。

---

## 5. 关键业务闭环（按用户旅程）

### 5.1 闭环总览

1. 录入错题（手动或 AI 协助）  
2. 结构化标签与归一化  
3. 入库 `questions` 并更新薄弱项  
4. 复习引擎出题与计划  
5. 练习模式强化薄弱点并回流错题  
6. AI 管家沉淀“知识点内容”到 `user_learning_state`  
7. 仪表盘/节点页展示学习结果

### 5.2 复习链路

- 前端提交评分/正确性给 `submit_review_attempt`。
- RPC 统一更新掌握度、下次复习时间、归档状态。
- 同步写复习尝试日志，供统计与策略迭代使用。

### 5.3 练习链路

- 先创建 `practice_session`。
- 作答后调用 `submit_practice_attempt`。
- 错题可自动回流 `questions`，并联动 `user_weakness`。

---

## 6. AI 管家：最复杂模块全解

> 这一节是核心中的核心。任何改动 AI 管家的人，至少完整阅读本节一遍。

### 6.1 入口与展示位置

- 受保护路由下的 `/draft-review` 页面是主入口。
- 侧边栏、仪表盘、错题库空态都可跳转到 AI 管家。
- 页面承载：会话流、动作反馈、草稿结构化结果、落库结果提示。

### 6.2 提示词体系（Prompt System）

项目不是单一提示词，而是分层组合：

1. 系统结构化提示词（约束输出结构、字段完整性）。  
2. Copilot 行为提示词（告诉模型可执行动作协议）。  
3. 页面上下文补充（当前页面、是否带图、用户学习画像）。  
4. 学习画像快照（近期错题分布、高频弱点、标签信息）。

维护原则：
- 提示词改动必须考虑动作协议兼容（否则前端解析动作会失败）。
- 提示词和动作枚举要同步，不可只改一侧。

#### 6.2.1 结构化系统提示词（AI_SYSTEM_PROMPT）到底约束了什么

这一层的目标是“强制把自然语言题目转成结构化错题卡片”，并且格式必须是：

- 外层必须出现 `<CARD>...</CARD>`
- 内部必须是合法 JSON
- 必填字段固定为：
  - `subject`：只能是“英语”或“C语言”
  - `question_text`：完整题干
  - `knowledge_point`：必须从系统知识点列表选
  - `ability`：必须从能力维度列表选
  - `error_type`：必须从错因列表选
  - `note`：必须是有效分析，不允许空泛描述

系统级硬约束重点：
- 不允许用户手动决定分类，AI 必须给出结构化分类。
- 分类只能从系统给定标签库中选，不允许模型新造标签。
- 明确禁止泛化标签（如“粗心”“不熟练”）替代真实错因。
- `note` 必须包含三段核心信息：考查知识点、错因分析、核心解析。
- 禁止模板化空话，必须引用题目证据来解释结论。

这意味着：你改提示词时，不能只追求“回答更像人”，要先保证“字段可落库、标签可校验、解析可复用”。

#### 6.2.2 Copilot 行为提示词（AI_COPILOT_PROMPT）到底约束了什么

这一层的目标是“AI 先给解释，再给机器可执行动作”，核心协议如下：

- 输出分两段：
  - 先输出给用户看的中文解释
  - 若要触发系统动作，最后必须输出 `<ACTION>...</ACTION>`
- `<ACTION>` 的 JSON 不能包在 Markdown 代码块里。
- 严格限制动作类型：`create_mistake / update_tags / start_review / start_drill / delete_mistake / update_learning_content`。

对 `create_mistake` 的强约束（你最关心）：
- 不是直接写库，而是生成“待确认草稿卡片”。
- 支持单题或 `questions[]` 批量草稿。
- 每题必须只有 1 个最终 `knowledge_point`，不能多主知识点并列。
- 每题必须补齐：`subject / question_text / knowledge_point / ability / error_type / note / correct_answer`。
- `summary` 可空，不要求强制给。
- 选择题必须带 `options`，且要求题干和选项拆分干净。

对知识点沉淀（`update_learning_content`）的强约束：
- 必须输出可直接入库的高质量 Markdown，不是“补一句话”。
- 要求按 `###`（必要时 `####`）结构化分组，统一归并旧内容，避免重复堆叠。
- 支持单点更新和 `updates[]` 批量更新。

#### 6.2.3 提示词之外的“防崩层”

即使模型偶尔格式不稳，前端也做了容错：

- 动作解析支持三种来源：`<ACTION>`、代码块 JSON、裸 JSON 兜底。
- 流式展示时会剥离动作块，只展示自然语言解释，避免把执行 JSON 暴露给用户。
- 若动作不完整或字段不全，会退回“重写草稿”而不是盲目执行。

#### 6.2.4 学习档案快照如何约束 AI（很多人会漏掉这层）

Copilot 的系统提示词不是固定文本，而是“固定规则 + 实时学习档案快照”拼接而成。  
这个快照包含：

- 错题总数、待复习数、低掌握度数量、近 7 天新增
- 科目分布、高频知识点、高频错因
- `user_weakness` 高频组合
- 最近错题样本
- 每个知识点的已有总结摘要（用于去重与增量）
- 当前完整标签库（包含用户扩展标签）

这层会直接影响 AI 的回答边界：
- 当总错题 > 0 时，AI 不能说“暂无数据”。
- AI 在推荐复习优先级时必须先看真实分布，而不是凭常识输出套话。
- AI 在输出知识点沉淀时会参考已有内容，减少重复。

#### 6.2.5 标签库并不是静态常量（维护者必须知道）

系统标签库 = 内置标签 + 用户扩展标签（`user_learning_state.tag_extensions`）。

意义：
- AI 约束“只能从标签库选”并不代表死板，它允许在受控范围内演进。
- 扩展标签会影响后续草稿校验下拉、标签归一化和知识点沉淀映射。

风险提醒：
- 扩展标签命名如果无规范，会导致“同义标签分裂”（例如“时态综合” vs “时态综合题”）。
- 维护时建议定期做标签清洗与别名归并，避免统计碎片化。

### 6.3 AI 调用协议

- 采用 SSE 风格流式返回。
- 前端逐行读取 `data: ...`，拼接 `delta.content`（部分场景也处理 `reasoning_content`）。
- 收到 `[DONE]` 结束。
- 有超时控制与中断处理。

#### 6.3.1 请求装配细节（为什么能稳定）

- 请求前会校验登录态，无 access token 直接中断并提示重登。
- 默认模型可由 `VITE_QWEN_MODEL` 覆盖，未配置时回落到 `qwen3.5-plus`。
- 默认超时 120 秒，支持用户中途停止生成。
- 可选“深度思考”通道，会把 `reasoning_content` 与正文分离展示。
- 简单问候语会自动关闭深度思考，避免无意义消耗 token。

#### 6.3.2 内容安全与展示安全

- 流式渲染阶段会隐藏动作 JSON，仅展示可读解释内容。
- 最终落地时才解析动作并挂在消息对象上，不会边流边执行。
- 这避免了“模型中途吐半截 JSON 就触发动作”的高风险场景。

### 6.4 动作协议（Action Protocol）

AI 响应中可携带 `<ACTION>` 指令，前端解析后执行。

当前关键动作类型：
- `create_mistake`：创建错题（入库核心）。
- `update_tags`：更新标签。
- `start_review`：触发复习流程。
- `start_drill`：触发专项练习流程。
- `update_learning_content`：更新知识点沉淀内容。

这是“AI 建议 → 系统可执行动作”的桥梁层，属于高风险改动点。

#### 6.4.1 动作协议的“执行哲学”

- 模型负责“建议动作”，前端负责“验证动作”，用户负责“确认动作”。
- 任何跨数据边界的动作都必须经过前端显式按钮触发。
- `risk` 字段用于驱动 UI 提示，`high` 风险动作需更谨慎的人机确认。

#### 6.4.2 动作解析容错规则

为适应模型偶发格式波动，解析器做了三层兜底：

1. 优先解析 `<ACTION>...</ACTION>`。  
2. 若没有，尝试解析 ```json 代码块。  
3. 再失败，尝试从裸文本中提取 JSON。  

但即使解析成功，也必须满足：
- `type` 存在且在允许枚举里
- `payload` 必须存在
- 否则动作直接丢弃，只保留文字解释

### 6.5 入库链路（错题）

AI 管家触发 `create_mistake` 后：

1. 前端组织结构化 payload。  
2. 优先尝试直接写 `questions`。  
3. 失败时 fallback 到 RPC `create_question`。  
4. 成功后更新 `user_weakness` 聚合。  
5. 刷新错题列表与相关查询缓存。

这保证了“直接写快、RPC兜底稳”的双通道策略。

#### 6.5.1 你提到的“入库卡片功能”完整流程

这部分是 AI 管家最关键的产品机制：**AI 只负责提案，人来定稿，系统再入库。**

1) 草稿生成  
- AI 返回 `create_mistake` 后，前端先把 payload 转成 `drafts`。  
- 会自动补默认解析骨架（考查知识点/错因分析/核心解析）与答案字段兜底。

2) 卡片分组  
- 系统按“知识点”把草稿自动分批（batch）。  
- 支持“分页按知识点确认”或“一次性展开全部确认”两种视图。

3) 人工可编辑区（核心交互）  
- 可直接修改：主知识点、能力维度、错因、题干、选项、正确答案、解析笔记。  
- 标签下拉来自系统字典，防止写入非法标签。  
- 每张卡片都显示“AI 建议值”，方便人工对比修正。

4) 入库前校验  
- 必查：题干、知识点、能力、错因、解析是否完整。  
- 选择题至少 2 个选项。  
- 任一校验不通过会直接阻断入库并提示具体题号问题。

5) 相似题去重与二次确认  
- 入库前会和当前题库做文本归一化比对。  
- 若检测到相似题，可选择“跳过相似题，仅入库其余题目”。

6) 退回重分析  
- 某一分组不满意时，可“退回重分析”只重算这一批。  
- 系统会要求题数一致、结构一致，避免覆盖错位。

7) 执行入库  
- 可“确认本分组入库”，也可“一键全部入库”。  
- 每批写入成功后会立即给结果反馈（写入数、跳过重复数）。

8) 入库后知识点沉淀联动  
- 每个分组入库后，会触发该知识点内容同步判断：  
  - 无新增价值：跳过沉淀  
  - 有新增规律：追加到对应知识点 Markdown

换句话说，这个卡片系统本质是“低风险 AI 执行框架”：把高风险动作拆成**提案、校验、人工确认、分批执行、沉淀复用**五层。

#### 6.5.2 卡片状态机（给维护者的真实心智模型）

每一批卡片通常会经历以下状态：

- `draft_generated`：模型给出草稿。
- `draft_edited`：用户对标签/题干/选项/解析做了人工修订。
- `draft_reanalyzing`：退回 AI 重分析当前批。
- `ready_to_import`：通过必填校验，允许执行入库。
- `import_executing`：正在写库。
- `import_success`：已入库（并记录执行状态，防止重复提交）。
- `import_failed`：执行失败，停留在可编辑状态可重试。

为什么这很关键：
- 它解释了为什么“已入库批次”会被收起，避免重复操作。
- 它解释了为什么“批量一键入库”内部仍按批循环执行（便于部分成功与统计反馈）。

#### 6.5.3 卡片入库前校验清单（严格版）

每题都要过以下门槛：

- 题干非空
- `knowledge_point` 在字典内
- `ability` 在字典内
- `error_type` 在字典内
- 选择题选项数量 >= 2
- `note` 非空（至少具备可用解析）

批次级校验：
- 退回重分析后，返回题数必须和原批次一致，否则拒绝覆盖。
- 相似题检测后，用户必须显式确认是否“跳过重复继续导入”。

#### 6.5.4 去重策略（现在是启发式，不是语义向量）

当前重复检测主要基于文本归一化 + 近似匹配：

- 去空白与标点后比较包含关系
- 字符长度相近时做差异位计数近似
- 达到阈值则视为相似题

这意味着：
- 它对“文字相近题”有效。
- 对“语义相同但措辞完全不同题”识别能力有限。
- 后续若要升级，可考虑引入语义 embedding 去重，但要评估成本和可解释性。

### 6.6 入库链路（知识点内容）

知识沉淀走 `user_learning_state.learning_content`：

1. 读取当前学习状态。  
2. 将 AI 新内容按 tag 合并到 `drawerByTag`。  
3. 调用 upsert 持久化。  
4. 节点页/知识点页渲染 Markdown + 数学公式。

这部分相当于“用户私有知识库”，不是公共题库字典。

### 6.7 Web 与 App 在 AI 路径上的差异

- Web：多数 AI 调用走前端直连 AI 代理 URL。
- App：走 Supabase Edge Function 再转发至模型服务。

影响：
- 排障路径不同（Web 看浏览器网络；App 看 Edge Function 日志）。
- 密钥暴露风险面不同（App 边界更集中在服务端）。

---

## 7. 权限体系与安全边界

### 7.1 三层权限模型

1. 路由层：未登录不可进核心业务页。  
2. API 层：请求需会话 token（本地 API 也会验证 Bearer）。  
3. 数据层：RLS 按 `auth.uid() = user_id` 隔离用户数据。

### 7.2 当前需要重点关注的风险位

- `knowledge_nodes` 的写策略对 authenticated 较宽，可能引入脏数据污染。
- 部分 RPC 对 anon 开放（如标签提交/分享读取），需确认是否符合长期安全策略。
- 使用 `SECURITY DEFINER` 的 RPC 要持续审计入参与数据边界。

### 7.3 权限改动原则

- 先收敛再放开：先最小权限，必要时按业务场景增加。
- 每次权限改动都要配套“可验证测试脚本或 SQL 校验”。
- 避免让前端决定安全边界，边界应固化在 RLS/RPC 层。

---

## 8. 页面与能力映射（维护者索引）

### 8.1 核心页面

- Dashboard：学习总览与快捷动作入口。
- DraftReviewPage：AI 管家会话与动作执行中心。
- QuestionBankPage：错题管理、筛选、空态跳转 AI 管家。
- MistakeNodeHubPage：知识节点、知识点抽屉、节点内 AI 辅助。
- ReviewModePage：复习流程与诊断反馈。
- TargetedDrillPage：专项练习与错题回流。

### 8.2 核心 API 聚合层（Web）

- `web/src/app/lib/api.ts` 是最大业务汇聚点，覆盖：
  - 题库 CRUD
  - 复习/练习 RPC
  - AI 流式 chat
  - telemetry 落库
  - 用户学习状态读写

维护建议：新增业务能力优先接入该层统一封装，避免页面直接散落调用。

---

## 9. 数据一致性与工程一致性

### 9.1 已识别一致性风险

- `shared-contracts` 与 Web 自有 `types/queryKeys` 并行，存在契约漂移可能。
- `supabase/schema.sql` 与迁移历史存在代差，真实生产结构应以 `migrations/` 为准。

### 9.2 改进方向

- 将 Web 逐步接入共享契约，减少重复定义。
- 建立“字段变更清单”机制：表字段变化必须同步到 API 类型、页面渲染和本地 API。

---

## 10. 配置与环境变量（部署前必核）

### 10.1 Web 关键变量

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_AI_PROXY_URL`
- `VITE_QWEN_MODEL`
- `VITE_DASHSCOPE_API_KEY`（代码中已读取，需确认注入路径）

### 10.2 App 关键变量

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_DATA_ACCESS_MODE`
- `EXPO_PUBLIC_API_BASE`
- `EXPO_PUBLIC_POSTHOG_KEY/HOST`
- `EXPO_PUBLIC_SENTRY_DSN`

### 10.3 Edge Function 关键变量

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DASHSCOPE_API_KEY`
- `QWEN_MODEL`
- `QWEN_BASE_URL`

---

## 11. 新人 30 分钟上手路径（推荐）

1. 看本手册第 2、4、5、6、7 节，建立全局地图。  
2. 只跑 Web：确认登录、仪表盘、AI 管家页面可用。  
3. 只走一条完整链路：AI 创建错题 → 入库 → 复习一次 → 查看统计变化。  
4. 再看 App 的拍题与练习，理解与 Web 的差异。  
5. 最后阅读 `supabase/migrations` 最近 15 个迁移，理解数据层演进方向。

---

## 12. 高频改动场景与正确切入点

### 场景 A：想优化 AI 提示词效果

- 改提示词前先核对动作协议枚举。
- 保持输出结构稳定，否则会影响动作解析与入库。
- 需要做至少一次“流式响应 + 动作执行 + 数据落库”端到端验证。

### 场景 B：新增错题字段

- 先加 migration。
- 同步 `questionsApi`、相关 RPC、页面编辑与展示、筛选逻辑。
- 补充 local-api 对应字段映射。

### 场景 C：调权限

- 优先改 RLS/RPC，不要只改前端判断。
- 增加最小可复现的 SQL 验证。
- 回归测试“本人数据可读写、他人数据不可见”。

### 场景 D：知识点展示改版

- 区分“字典数据（knowledge_points）”和“用户沉淀（user_learning_state）”。
- 防止误把用户私有内容写入公共节点表。

---

## 13. 可观测性与排障建议

### 13.1 你应该优先看哪里

- AI 超时/失败：先看前端网络流是否结束、是否超时、是否触发 fallback。
- 复习/练习异常：检查 RPC 返回与 telemetry 记录。
- App AI 异常：查看 Edge Function 日志与模型上游响应。

### 13.2 现有遥测能力

- `ai_diagnosis_telemetry`：AI 诊断状态、耗时、错误信息。
- `perf_telemetry`：性能指标上报。
- 页面层部分流程带控制台 observability 日志。

---

## 14. 当前项目的“红线”与“护栏”

### 14.1 红线（不要踩）

- 不要绕过 RLS 直接信任前端 user_id。
- 不要单改提示词而不校验动作协议。
- 不要把 `schema.sql` 当作当前唯一真相源。

### 14.2 护栏（建议长期保持）

- 所有关键流程都保留 fallback（直写失败 → RPC 兜底）。
- 每个高风险改动都具备“可验证路径”。
- 以 migration 为核心维护数据库演进历史。

---

## 15. 维护者结论

这个项目的复杂度不在“页面数量”，而在“跨层协作一致性”：

- AI 输出格式要和前端动作协议一致。  
- 前端动作执行要和数据库权限/RPC 一致。  
- 知识沉淀要和展示体系一致。  
- Web、App、local-api、Supabase 四条链路要保持语义一致。  

只要牢牢抓住这四个一致性，后续功能扩展会非常快；一旦其中一个断裂，就会出现“能聊不能落库 / 能落库不能展示 / 能展示但权限不安全”的隐性故障。

---

## 16. AI 约束与动作协议实战模板（可直接给维护者复制使用）

### 16.1 create_mistake（单题草稿）模板

```json
<ACTION>
{
  "type": "create_mistake",
  "risk": "low",
  "title": "生成待确认错题草稿",
  "description": "已按你的题目生成 1 道待确认草稿，请先检查后入库",
  "payload": {
    "subject": "英语",
    "question_text": "By the time he ___ home, the meeting had ended.",
    "knowledge_point": "时态",
    "ability": "规则应用",
    "error_type": "时态",
    "correct_answer": "got",
    "options": [
      "A. gets",
      "B. got",
      "C. has got",
      "D. had got"
    ],
    "note": "【考查知识点】过去完成时与一般过去时的时序关系。\n【错因分析】把 by the time 从句误当成主句同一时态，忽略“会议已结束”作为先发生事件。\n【核心解析】主句 had ended 表示先发生；从句到家是后发生，用一般过去时 got。"
  }
}
</ACTION>
```

### 16.2 create_mistake（批量草稿）模板

```json
<ACTION>
{
  "type": "create_mistake",
  "risk": "low",
  "title": "批量生成待确认草稿",
  "description": "已生成 3 道草稿并按知识点分组，请逐组确认入库",
  "payload": {
    "questions": [
      {
        "subject": "英语",
        "question_text": "If I ___ enough time, I would join the club.",
        "knowledge_point": "虚拟语气",
        "ability": "规则应用",
        "error_type": "语法结构",
        "correct_answer": "had",
        "note": "【考查知识点】与现在事实相反的虚拟条件句。\n【错因分析】把 would + 动词原形误放在 if 从句。\n【核心解析】if 从句用过去式 had，主句用 would join。"
      },
      {
        "subject": "英语",
        "question_text": "She is the only person ___ can solve this puzzle.",
        "knowledge_point": "定语从句",
        "ability": "理解",
        "error_type": "关系词误选",
        "correct_answer": "who",
        "note": "【考查知识点】定语从句关系代词选择。\n【错因分析】忽略先行词 person 与从句主语位置对应。\n【核心解析】先行词指人且在从句作主语，应选 who。"
      }
    ]
  }
}
</ACTION>
```

### 16.3 update_learning_content（单知识点）模板

```json
<ACTION>
{
  "type": "update_learning_content",
  "risk": "low",
  "title": "更新知识点沉淀",
  "description": "已重写“时态”知识点结构并归并新规律",
  "payload": {
    "tag": "时态",
    "markdown": "### 判别主线\n- 先看时间状语（by the time、since、for）再定时态。\n- 再看动作先后关系：先发生常用完成体，后发生常用一般时。\n\n### 高频错位\n- 看到 by the time 容易误判成同一时态。\n- 主句已给完成体时，从句常需回到一般过去时。\n\n### 易错规律\n- 不要只凭中文“已经”选时态，必须回到句内证据。"
  }
}
</ACTION>
```

### 16.4 start_review / start_drill 模板

```json
<ACTION>
{
  "type": "start_review",
  "risk": "low",
  "title": "启动复习计划",
  "description": "按你的要求生成待复习计划",
  "payload": {
    "preset": {
      "subject": "英语",
      "scope": "due",
      "amount": 10,
      "sortBy": "nearestDue"
    }
  }
}
</ACTION>
```

```json
<ACTION>
{
  "type": "start_drill",
  "risk": "low",
  "title": "启动专项练习",
  "description": "已配置专项训练参数",
  "payload": {
    "preset": {
      "subject": "英语",
      "nodes": ["时态", "定语从句"],
      "amount": 10,
      "strategy": "递进"
    }
  }
}
</ACTION>
```

---

## 17. AI 管家高频故障手册（按现象排查）

### 17.1 现象：AI 有解释但没有卡片

优先排查：
- 是否缺少 `<ACTION>` 块
- 是否动作 JSON 被包进 Markdown 代码块后解析失败
- 是否 `type/payload` 缺失导致动作被丢弃

处理建议：
- 先看聊天原文是否包含可提取 JSON
- 再看动作解析 fallback 是否命中
- 必要时要求模型“仅返回 create_mistake 动作且题数固定”

### 17.2 现象：卡片有了但点不了入库

优先排查：
- 知识点/能力/错因是否在字典中
- 选择题是否少于 2 个选项
- `note` 是否为空

处理建议：
- 在卡片编辑区补齐后再执行
- 若 AI 连续给非法标签，需调整提示词或标签映射规则

### 17.3 现象：入库失败

优先排查：
- 登录态是否失效
- 直写 `questions` 是否因字段兼容失败
- RPC `create_question` 是否返回错误

处理建议：
- 查看控制台/网络错误文案
- 检查 migration 是否与当前字段一致
- 本地与云端 schema 差异时优先走迁移修复

### 17.4 现象：知识点沉淀重复堆叠

优先排查：
- `update_learning_content` 是否输出“每题追加一段”而非结构化重写
- 旧内容摘要是否被正确注入模型上下文

处理建议：
- 强化“归并同类、去重表达、结构化标题”提示
- 对同标签内容定期人工整理，避免历史噪声累积

---

## 18. 改动前后检查清单（给任何接手者）

### 18.1 你改 AI 提示词后至少要过的 8 项

1. 问候语场景不会触发重动作。  
2. create_mistake 能产出完整必填字段。  
3. 多题时 `questions[]` 题数稳定。  
4. `<ACTION>` 不会混进 Markdown 代码块。  
5. 非法标签会被拦截，不会直接写库。  
6. 退回重分析能覆盖原批次且题数一致。  
7. 分组入库与一键入库都可成功。  
8. 入库后知识点沉淀行为符合预期（append 或 skip）。

### 18.2 你改入库卡片后至少要过的 6 项

1. 可编辑字段都能真正影响最终写库 payload。  
2. 校验错误提示可定位到具体题号。  
3. 已执行批次不会重复提交。  
4. 去重确认弹窗分支可用。  
5. 批量入库出现部分失败时不会污染全部状态。  
6. 结果 toast 与会话总结文案一致，不误导用户。
