UPDATE questions
SET subject = 'C语言'
WHERE subject = '编程';

DELETE FROM questions
WHERE subject IN ('英语', 'C语言');

WITH seed(subject, category, node, knowledge_point, ability, error_type, question_text, note, review_count) AS (
  VALUES
    ('英语', '语法', '时态', '时态', '应用', '混淆', 'By the time the lecture starts, we ______ all the slides.\nA. review\nB. reviewed\nC. will review\nD. will have reviewed', '时间点在将来且强调“到那时已经完成”，主句用将来完成时，答案 D。', 2),
    ('英语', '语法', '主谓一致', '主谓一致', '识别', '概念不清', 'Neither the students nor the teacher ______ ready for the surprise test.\nA. are\nB. were\nC. is\nD. have been', 'neither...nor... 就近一致，谓语和 teacher 保持一致，用 is。', 1),
    ('英语', '语法', '从句', '从句', '理解', '混淆', 'The village ______ we stayed last summer has built a new library.\nA. which\nB. where\nC. when\nD. what', '先行词是地点且从句中缺地点状语，用 where。', 1),
    ('英语', '语法', '非谓语动词', '非谓语动词', '识别', '混淆', 'I regret ______ you that your application was rejected.\nA. tell\nB. to tell\nC. telling\nD. told', 'regret to do 表示“遗憾地去做（通知）”，此处用 to tell。', 2),
    ('英语', '语法', '固定搭配', '固定搭配', '识别', '知识盲区', 'The manager insisted ______ checking every line of the contract.\nA. at\nB. in\nC. on\nD. to', '固定搭配 insist on doing，答案 C。', 0),
    ('英语', '阅读', '细节理解', '细节理解', '理解', '审题错误', 'According to Paragraph 3, why did the team delay the launch?\nA. The budget was cut.\nB. Key tests failed repeatedly.\nC. The market demand dropped.\nD. The manager resigned.', '定位 Paragraph 3 关键词 fail / retest，原文对应 B。', 2),
    ('英语', '阅读', '推理判断', '推理判断', '应用', '理解偏差', 'What can be inferred from the passage about Mia?\nA. She dislikes teamwork.\nB. She values long-term growth.\nC. She plans to quit immediately.\nD. She has no leadership experience.', '推断题要基于文本证据，排除绝对化选项，答案 B。', 4),
    ('英语', '阅读', '主旨理解', '主旨理解', '理解', '审题错误', 'What is the best title for the passage?\nA. A New Coffee Brand\nB. How to Save Electricity at Home\nC. Community Libraries Reviving Local Learning\nD. Why Teenagers Need More Sleep', '主旨题优先看首段+各段主题句，全文围绕社区图书馆复兴。', 3),
    ('英语', '写作', '翻译', '翻译', '表达', '不熟练', '请翻译：这项新政策在减轻学生作业负担方面起到了积极作用。', '参考：The new policy has played a positive role in reducing students homework burden.', 1),
    ('英语', '写作', '书面表达', '书面表达', '表达', '概念不清', '写一封约80词的邮件，向交换生介绍你们学校的社团活动并邀请其参加。', '常见失分点：格式不完整、时态混乱、邀请目的不明确。先列提纲再成文。', 0),
    ('C语言', '基础', '变量与数据类型', '变量与数据类型', '识别', '概念不清', '以下哪个标识符在 C 语言中合法？\nA. 2value\nB. total-score\nC. _count1\nD. float', '标识符不能数字开头、不能含 -、不能用关键字，答案 C。', 2),
    ('C语言', '基础', '运算符与表达式', '运算符与表达式', '理解', '混淆', 'int a = 5, b = 2; printf("%d", a / b); 输出是？\nA. 2.5\nB. 2\nC. 3\nD. 2.0', '整型相除结果仍为整型，答案 B。', 1),
    ('C语言', '基础', '选择结构', '选择结构', '应用', '粗心', 'if (score = 60) printf("pass"); 这段代码的主要问题是？\nA. 应写成 ==\nB. printf 不能放在 if 中\nC. score 不能是变量\nD. 少写分号', '把比较写成赋值会导致逻辑错误，应为 score == 60。', 5),
    ('C语言', '基础', '循环结构', '循环结构', '应用', '边界条件', '下面循环会执行多少次？\nfor (int i = 0; i <= 9; i++)\nA. 9 次\nB. 10 次\nC. 11 次\nD. 无限次', 'i 从 0 到 9 共 10 次，常见错误是把 <= 当成 <。', 3),
    ('C语言', '基础', '函数', '函数', '识别', '不熟练', '已知函数声明 int max(int a, int b); 以下调用正确的是？\nA. max(3)\nB. max("3","4")\nC. max(3,4)\nD. int max = max(3,4,5)', '形参数量和类型需匹配，答案 C。', 1),
    ('C语言', '语法进阶', '数组与字符串', '数组与字符串', '理解', '数组越界', 'char s[5] = "hello"; 的问题是？\nA. 没问题\nB. 需要 6 个字节空间\nC. 必须用 malloc\nD. 只能定义为指针', '字符串常量含结尾 \\0，"hello" 需要 6 字节。', 4),
    ('C语言', '语法进阶', '指针', '指针', '应用', '指针错误', 'int *p = NULL; *p = 10; 运行时最可能发生什么？\nA. 正常输出\nB. 编译报错\nC. 段错误\nD. 自动分配内存', '解引用空指针会触发段错误。', 4),
    ('C语言', '语法进阶', '结构体', '结构体', '识别', '混淆', '已定义 struct Student s; 指针 struct Student *ps=&s; 访问 name 成员应写：\nA. s->name\nB. ps.name\nC. ps->name\nD. s.name()', '结构体变量用 .，结构体指针用 ->，此题答案 C。', 2),
    ('C语言', '算法', '代码阅读', '代码阅读', '理解', '边界条件', '阅读代码并判断问题：\nint a[5];\nfor (int i = 0; i <= 5; i++) a[i] = i;\nA. 循环次数正确\nB. 可能发生越界写\nC. i 必须从 1 开始\nD. a 必须动态分配', 'a[5] 合法下标是 0~4，i<=5 会访问 a[5]。', 3),
    ('C语言', '算法', '排序与查找', '排序与查找', '应用', '逻辑错误', '二分查找中，若使用 while (left <= right)，更新区间时更稳妥的是：\nA. mid = (left + right) / 2；left = mid\nB. mid = (left + right) / 2；right = mid\nC. mid = left + (right-left)/2；命中后 left = mid + 1 或 right = mid - 1\nD. 每轮都把 left 和 right 置零', '避免死循环和溢出，常规写法是 C。', 2)
)
INSERT INTO questions (user_id, subject, category, node, knowledge_point, ability, error_type, question_text, note, review_count)
SELECT u.id, s.subject, s.category, s.node, s.knowledge_point, s.ability, s.error_type, s.question_text, s.note, s.review_count
FROM auth.users u
CROSS JOIN seed s;

DELETE FROM knowledge_points
WHERE subject = '编程';

DELETE FROM knowledge_points
WHERE subject = 'C语言';

INSERT INTO knowledge_points (subject, name)
VALUES
  ('C语言', '变量与数据类型'),
  ('C语言', '运算符与表达式'),
  ('C语言', '选择结构'),
  ('C语言', '循环结构'),
  ('C语言', '函数'),
  ('C语言', '数组与字符串'),
  ('C语言', '指针'),
  ('C语言', '结构体'),
  ('C语言', '代码阅读'),
  ('C语言', '排序与查找'),
  ('C语言', '边界条件');
