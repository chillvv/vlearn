-- Seed basic and common tags for English and C language without any dummy questions.
-- These tags are directly inserted into knowledge_points, which will trigger upsert_tag_catalog
-- and populate tag_catalog and tag_dictionary_items.

INSERT INTO knowledge_points (id, subject, name, created_at)
VALUES
  -- 英语标签
  (gen_random_uuid(), '英语', '时态', NOW()),
  (gen_random_uuid(), '英语', '主谓一致', NOW()),
  (gen_random_uuid(), '英语', '虚拟语气', NOW()),
  (gen_random_uuid(), '英语', '从句', NOW()),
  (gen_random_uuid(), '英语', '非谓语动词', NOW()),
  (gen_random_uuid(), '英语', '完型填空', NOW()),
  (gen_random_uuid(), '英语', '语法填空', NOW()),
  (gen_random_uuid(), '英语', '阅读理解', NOW()),
  (gen_random_uuid(), '英语', '书面表达', NOW()),
  (gen_random_uuid(), '英语', '词汇运用', NOW()),
  (gen_random_uuid(), '英语', '听力理解', NOW()),
  (gen_random_uuid(), '英语', '翻译', NOW()),
  (gen_random_uuid(), '英语', '特殊句式', NOW()),
  (gen_random_uuid(), '英语', '形容词与副词', NOW()),
  (gen_random_uuid(), '英语', '词义猜测', NOW()),
  (gen_random_uuid(), '英语', '翻译技巧', NOW()),
  (gen_random_uuid(), '英语', '介词', NOW()),
  (gen_random_uuid(), '英语', '冠词', NOW()),
  (gen_random_uuid(), '英语', '代词', NOW()),
  (gen_random_uuid(), '英语', '词形变化', NOW()),
  (gen_random_uuid(), '英语', '词义辨析', NOW()),
  (gen_random_uuid(), '英语', '固定搭配', NOW()),
  (gen_random_uuid(), '英语', '阅读主旨', NOW()),
  (gen_random_uuid(), '英语', '阅读细节', NOW()),
  (gen_random_uuid(), '英语', '阅读推理', NOW()),
  (gen_random_uuid(), '英语', '写作表达', NOW()),

  -- C语言标签
  (gen_random_uuid(), 'C语言', '变量与数据类型', NOW()),
  (gen_random_uuid(), 'C语言', '运算符与表达式', NOW()),
  (gen_random_uuid(), 'C语言', '选择结构', NOW()),
  (gen_random_uuid(), 'C语言', '循环结构', NOW()),
  (gen_random_uuid(), 'C语言', '函数', NOW()),
  (gen_random_uuid(), 'C语言', '数组', NOW()),
  (gen_random_uuid(), 'C语言', '字符串', NOW()),
  (gen_random_uuid(), 'C语言', '指针', NOW()),
  (gen_random_uuid(), 'C语言', '结构体', NOW()),
  (gen_random_uuid(), 'C语言', '文件操作', NOW()),
  (gen_random_uuid(), 'C语言', '排序与查找', NOW()),
  (gen_random_uuid(), 'C语言', '内存管理', NOW()),
  (gen_random_uuid(), 'C语言', '边界条件', NOW()),
  (gen_random_uuid(), 'C语言', '预处理与宏定义', NOW()),
  (gen_random_uuid(), 'C语言', '位运算', NOW()),
  (gen_random_uuid(), 'C语言', '递归算法', NOW()),
  (gen_random_uuid(), 'C语言', '共用体与枚举', NOW()),
  (gen_random_uuid(), 'C语言', '函数指针', NOW()),
  (gen_random_uuid(), 'C语言', '格式化输入输出', NOW()),
  (gen_random_uuid(), 'C语言', '二维数组与数组指针', NOW()),
  (gen_random_uuid(), 'C语言', '存储类别', NOW()),
  (gen_random_uuid(), 'C语言', '进制转换', NOW())
ON CONFLICT (subject, name) DO NOTHING;

INSERT INTO tag_dictionary_items (item_type, subject, label, sort_order, source)
SELECT DISTINCT 'knowledge_point', subject, name, 0, 'db'
FROM knowledge_points
ON CONFLICT (item_type, subject, label) DO UPDATE SET updated_at = NOW();

WITH raw_tags AS (
  SELECT DISTINCT subject, name AS tag_name FROM knowledge_points
)
SELECT upsert_tag_catalog(subject, tag_name, NULL, NULL, NULL)
FROM raw_tags;
