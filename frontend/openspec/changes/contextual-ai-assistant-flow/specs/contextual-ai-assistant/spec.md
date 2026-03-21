## ADDED Requirements

### Requirement: AI 助手必须为场景化触发
系统 MUST 仅在错题相关局部场景提供 AI 助手触发器，不得提供全局悬浮球或全局聊天入口。

#### Scenario: 详情页局部触发助手
- **WHEN** 用户在解析步骤区域点击“对这一步有疑问”
- **THEN** 系统打开带当前题目上下文的 AI 面板

### Requirement: AI 面板不打断主页面
系统 MUST 在详情页内通过 Drawer 或 Bottom Sheet 承载对话，并保持用户不离开当前错题页面。

#### Scenario: PC 抽屉承载对话
- **WHEN** 用户在桌面端点击“召唤 AI 私教”
- **THEN** 页面右侧滑出抽屉并保留当前错题内容状态

#### Scenario: 移动端半屏承载对话
- **WHEN** 用户在移动端点击“召唤 AI 私教”
- **THEN** 页面从底部弹出半屏对话面板并应用背景遮罩
