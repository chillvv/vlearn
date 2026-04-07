ALTER TABLE knowledge_nodes
ADD COLUMN IF NOT EXISTS branch TEXT;

UPDATE knowledge_nodes
SET branch = COALESCE(NULLIF(branch, ''), category, '其他');

ALTER TABLE knowledge_nodes
ALTER COLUMN branch SET DEFAULT '其他';

ALTER TABLE knowledge_nodes
ALTER COLUMN branch SET NOT NULL;

INSERT INTO knowledge_nodes (id, subject, category, branch, node, tips_and_tricks, created_at, updated_at)
VALUES
  (gen_random_uuid(), '英语', '语法', '动词系统', '时态', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '语法', '句法一致', '主谓一致', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '语法', '动词系统', '虚拟语气', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '语法', '句法结构', '从句', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '语法', '动词系统', '被动语态', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '语法', '动词系统', '非谓语动词', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '语法', '句法结构', '特殊句式', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '词法', '词性与用法', '介词', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '词法', '词性与用法', '冠词', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '词法', '词性与用法', '代词', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '词法', '词形规则', '词形变化', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '词法', '词性与用法', '形容词与副词', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '词汇', '词义语境', '词义辨析', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '词汇', '固定搭配', '固定搭配', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '阅读', '篇章理解', '主旨理解', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '阅读', '篇章理解', '细节理解', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '阅读', '篇章理解', '推理判断', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '阅读', '句子分析', '句子结构', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '阅读', '篇章逻辑', '逻辑连接', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '阅读', '篇章理解', '词义猜测', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '写作', '表达规范', '表达准确', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '听力', '听力技巧', '听力理解', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '翻译', '翻译方法', '翻译技巧', '', NOW(), NOW()),
  (gen_random_uuid(), '英语', '综合', '语篇填空', '完型填空', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '基础语法', '类型系统', '变量与数据类型', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '基础语法', '表达式规则', '运算符与表达式', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '流程控制', '分支判断', '选择结构', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '流程控制', '循环迭代', '循环结构', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '函数与模块', '函数设计', '函数', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '数据结构', '顺序存储', '数组', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '数据结构', '字符处理', '字符串', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '内存与指针', '地址与引用', '指针', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '数据结构', '复合类型', '结构体', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '输入输出', '文件读写', '文件操作', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '算法基础', '排序查找', '排序与查找', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '内存与指针', '内存生命周期', '内存管理', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '调试与健壮性', '边界与异常', '边界条件', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '基础语法', '编译预处理', '预处理与宏定义', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '算法基础', '位级操作', '位运算', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '函数与模块', '函数设计', '递归算法', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '数据结构', '复合类型', '共用体与枚举', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '内存与指针', '地址与引用', '函数指针', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '输入输出', '终端读写', '格式化输入输出', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '数据结构', '多维存储', '二维数组与数组指针', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '内存与指针', '变量生命周期', '存储类别', '', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '基础语法', '数据表示', '进制转换', '', NOW(), NOW())
ON CONFLICT (subject, category, node) DO UPDATE
SET branch = EXCLUDED.branch,
    updated_at = NOW();
