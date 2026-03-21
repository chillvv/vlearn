# 重构方案 3：AI 规范与后端数据对齐 (The AI & Logic Specification)

## 核心目标
解决“题目多了变乱”的问题，强制 AI 进行逻辑查重和结构化输出。

## 1. Deduplication & Grouping Logic (去重与分组逻辑)
- **扫描现有知识库**：当用户上传新的错题时，AI 必须首先扫描现有的“知识库 (Knowledge Base)”。
- **匹配与追加**：如果存在匹配的方法论（例如“分离参数法”），AI 必须将新错题追加到现有的“变式组 (Variation Set)”中，或者在该知识节点下创建一个“新的变式分支 (New Variation Branch)”。
- **禁止重复**：严禁创建重复的知识节点。AI 必须评估相似度阈值（建议 > 85%）以决定是合并还是新建。

## 2. Content Structure (JSON 强制结构化)
AI 生成的方法论必须遵循严格的 JSON schema。这确保了无论添加多少条目，UI 都能保持完美的一致性。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "Title": {
      "type": "string",
      "description": "方法论名称，例如 '# 分离参数法'"
    },
    "CoreLogic": {
      "type": "string",
      "description": "核心逻辑 (Aha! Moment)"
    },
    "Steps": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "text": { "type": "string", "description": "具体步骤描述" }
        }
      },
      "description": "逐步执行的工作流"
    },
    "Pitfalls": {
      "type": "array",
      "items": { "type": "string" },
      "description": "关键易错点"
    },
    "ProTips": {
      "type": "array",
      "items": { "type": "string" },
      "description": "进阶技巧或二级结论"
    }
  },
  "required": ["Title", "CoreLogic", "Steps", "Pitfalls", "ProTips"]
}
```

## 3. Human-in-the-Loop (草稿模式/人工确认)
- **草稿卡片 (Draft Card)**：当 AI 生成新的知识点或方法论总结时，它首先应作为“草稿卡片”出现。
- **用户所有权**：用户可以编辑或确认摘要，然后再将其正式加入“知识库”。这赋予了学生对自己方法的归属感和控制权。

## 4. Pagination Strategy (分页策略)
- **服务端分页**：为了处理 1000+ 条目而不产生性能卡顿，必须对“错题集 (Mistake Sets)”和“知识卡片 (Knowledge Cards)”实施服务端分页。
- **游标分页 (Cursor-based Pagination)**：推荐使用游标分页而不是基于页码的分页，以保证数据在动态插入（如新错题上传）时不会发生偏移。
- **UI 呈现**：在详情页左侧面板底部包含现代且精致的分页栏 (`Prev | 1 | 2 | 3 | ... | 8 | Next`)。

---
*注：此规范配合前端 `KnowledgeBaseScreen` 与 `KnowledgeDetailScreen` 使用，确保 UI 与数据逻辑高度统一。*