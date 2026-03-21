## MODIFIED Requirements

### Requirement: 错题详情采用结构化动态积木渲染
系统 MUST 按结构化 JSON 字段进行条件渲染：字段非空显示模块，字段为 `null` 或空数组时无缝折叠隐藏，且不得出现空标题或占位留白。

#### Scenario: 简单错题仅显示核心模块
- **WHEN** 结构化数据仅包含 `core_reason` 与 `detailed_steps`
- **THEN** 页面仅渲染核心错因与步骤模块，其他模块全部折叠

### Requirement: 用户个人笔记置顶展示
系统 MUST 支持用户为每道错题添加可选个人笔记，且在详情页中优先于 AI 解析内容显示。

#### Scenario: 已添加笔记
- **WHEN** 当前错题存在用户笔记
- **THEN** 页面在 AI 解析区域上方展示笔记内容
