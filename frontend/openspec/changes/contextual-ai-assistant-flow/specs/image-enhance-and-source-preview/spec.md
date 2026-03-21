## ADDED Requirements

### Requirement: 录入图片必须保留原图语义
系统 SHALL 在结构化结果中存储 `original_image_url`，并在错题详情顶部优先展示处理后的题目原图。

#### Scenario: 原图优先展示
- **WHEN** 错题存在 `original_image_url`
- **THEN** 详情页在解析内容之前展示对应图片

### Requirement: 首期仅支持图像增强
系统 MUST 对用户上传图片执行去阴影、提亮、裁边等增强处理，不得尝试生成式重绘几何或电路图。

#### Scenario: 几何题图像处理
- **WHEN** 用户上传包含几何图形的题目图片
- **THEN** 系统仅返回增强后的清晰图像，不修改图形结构
