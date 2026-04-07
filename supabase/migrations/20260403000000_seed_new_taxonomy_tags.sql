INSERT INTO knowledge_points (id, subject, name, created_at)
VALUES
  (gen_random_uuid(), '英语', '特殊句式', NOW()),
  (gen_random_uuid(), '英语', '形容词与副词', NOW()),
  (gen_random_uuid(), '英语', '词义猜测', NOW()),
  (gen_random_uuid(), '英语', '听力理解', NOW()),
  (gen_random_uuid(), '英语', '翻译技巧', NOW()),
  (gen_random_uuid(), '英语', '完型填空', NOW()),
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

INSERT INTO knowledge_nodes (id, subject, category, node, tips_and_tricks, created_at, updated_at)
VALUES
  (gen_random_uuid(), '英语', '语法', '特殊句式', '倒装、强调、省略是常考的特殊结构；解题时先还原成普通语序，再判断句子成分。', NOW(), NOW()),
  (gen_random_uuid(), '英语', '词法', '形容词与副词', '形容词修饰名词或作表语，副词修饰动词、形容词或全句；比较级和最高级需注意范围和修饰词。', NOW(), NOW()),
  (gen_random_uuid(), '英语', '阅读', '词义猜测', '生词题绝不是考词汇量，而是考上下文逻辑；利用并列、转折、因果和释义关系推导。', NOW(), NOW()),
  (gen_random_uuid(), '英语', '听力', '听力理解', '听力题关键在“预判”和“抓取”；利用播放前的空隙扫读选项，听时重点关注转折词和重音。', NOW(), NOW()),
  (gen_random_uuid(), '英语', '翻译', '翻译技巧', '翻译不是词对词的硬翻，而是“理解+重构”；遵循中英表达差异，理顺主干和修饰逻辑。', NOW(), NOW()),
  (gen_random_uuid(), '英语', '综合', '完型填空', '完型填空是“穿了词汇马甲的阅读理解”；先通读抓大意，再利用上下文复现和逻辑关系解题。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '基础语法', '预处理与宏定义', '宏定义是简单的文本替换，不做语法检查；做题时必须“先原样替换，再考虑优先级”。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '算法基础', '位运算', '位运算直接操作二进制位；掌握“与0清零，或1置位，异或翻转”三大基本口诀。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '函数与模块', '递归算法', '递归就是“自己调用自己”；解题时找准“终止条件”和“递推关系”，可以画递归树辅助理解。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '数据结构', '共用体与枚举', '共用体所有成员共享同一块内存，枚举是命名整型常量的集合；主要用于节省空间和提高可读性。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '内存与指针', '函数指针', '函数指针指向函数的首地址，常用于回调机制；先看懂声明，再掌握调用方式。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '输入输出', '格式化输入输出', 'printf 和 scanf 是最常用的 I/O 函数；格式控制符必须和变量类型严格对应。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '数据结构', '二维数组与数组指针', '先建立三层地址模型：a、a[0]、a[0][0]；再判断指针类型和步长，最后做越界检查。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '内存与指针', '存储类别', '存储类别题先从“作用域+存储期+默认初值+能否取地址/优化限制”四维记忆。', NOW(), NOW()),
  (gen_random_uuid(), 'C语言', '基础语法', '进制转换', '进制题高效做法是“十进制↔二进制双向熟练 + 二进制与十六进制四位分组”。', NOW(), NOW())
ON CONFLICT (subject, category, node) DO NOTHING;
