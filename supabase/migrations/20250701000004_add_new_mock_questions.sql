-- Insert mock questions for testing UI that match the new schema
-- Uses the first available user in the system

DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get the first user ID
    SELECT id INTO v_user_id FROM auth.users LIMIT 1;

    -- If no user exists, do nothing
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No users found, skipping mock data insertion';
        RETURN;
    END IF;

    -- Insert realistic English/C language mistake questions
    INSERT INTO questions (user_id, subject, question_text, knowledge_point, ability, error_type, note, review_count)
    VALUES 
    (v_user_id, '英语', 'By the time the lecture starts, we ______ all the slides.\nA. review\nB. reviewed\nC. will review\nD. will have reviewed', '时态', '应用', '混淆', '时间点在将来且强调“到那时已经完成”，主句用将来完成时，答案 D。', 2),
    (v_user_id, '英语', 'Neither the students nor the teacher ______ ready for the surprise test.\nA. are\nB. were\nC. is\nD. have been', '主谓一致', '识别', '概念不清', 'neither...nor... 就近一致，谓语和 teacher 保持一致，用 is。', 1),
    (v_user_id, '英语', 'The village ______ we stayed last summer has built a new library.\nA. which\nB. where\nC. when\nD. what', '从句', '理解', '混淆', '先行词是地点且从句中缺地点状语，用 where。', 1),
    (v_user_id, '英语', 'The report needs ______ before Friday.\nA. submit\nB. to submit\nC. being submitted\nD. to be submitted', '被动语态', '应用', '不熟练', 'need to be done 结构，答案 D。', 3),
    (v_user_id, '英语', 'I regret ______ you that your application was rejected.\nA. tell\nB. to tell\nC. telling\nD. told', '非谓语动词', '识别', '混淆', 'regret to do 表示“遗憾地去做（通知）”，此处用 to tell。', 2),
    (v_user_id, '英语', 'The manager insisted ______ checking every line of the contract.\nA. at\nB. in\nC. on\nD. to', '固定搭配', '识别', '知识盲区', '固定搭配 insist on doing，答案 C。', 0),
    (v_user_id, '英语', 'According to Paragraph 3, why did the team delay the launch?\nA. The budget was cut.\nB. Key tests failed repeatedly.\nC. The market demand dropped.\nD. The manager resigned.', '细节理解', '理解', '审题错误', '定位 Paragraph 3 关键词 fail / retest，原文对应 B。', 2),
    (v_user_id, '英语', 'What can be inferred from the passage about Mia?\nA. She dislikes teamwork.\nB. She values long-term growth.\nC. She plans to quit immediately.\nD. She has no leadership experience.', '推理判断', '应用', '理解偏差', '推断题要基于文本证据，排除绝对化选项，答案 B。', 4),
    (v_user_id, '英语', 'What is the best title for the passage?\nA. A New Coffee Brand\nB. How to Save Electricity at Home\nC. Community Libraries Reviving Local Learning\nD. Why Teenagers Need More Sleep', '主旨理解', '理解', '审题错误', '主旨题优先看首段+各段主题句，全文围绕社区图书馆复兴。', 3),
    (v_user_id, '英语', '请翻译：这项新政策在减轻学生作业负担方面起到了积极作用。', '翻译', '表达', '不熟练', '参考：The new policy has played a positive role in reducing students homework burden.', 1),
    (v_user_id, '英语', '写一封约80词的邮件，向交换生介绍你们学校的社团活动并邀请其参加。', '书面表达', '表达', '概念不清', '常见失分点：格式不完整、时态混乱、邀请目的不明确。先列提纲再成文。', 0),
    (v_user_id, 'C语言', '以下哪个标识符在 C 语言中合法？\nA. 2value\nB. total-score\nC. _count1\nD. float', '变量', '识别', '概念不清', '标识符不能数字开头、不能含 -、不能用关键字，答案 C。', 2),
    (v_user_id, 'C语言', '在 32 位环境下，以下说法正确的是：\nA. sizeof(char)=2\nB. sizeof(int)=2\nC. sizeof(double)=4\nD. sizeof(char)=1', '数据类型', '理解', '混淆', '标准规定 sizeof(char) 恒为 1，答案 D。', 1),
    (v_user_id, 'C语言', 'if (score = 60) printf("pass"); 这段代码的主要问题是？\nA. 应写成 ==\nB. printf 不能放在 if 中\nC. score 不能是变量\nD. 少写分号', '选择结构', '应用', '粗心', '把比较写成赋值会导致逻辑错误，应为 score == 60。', 5),
    (v_user_id, 'C语言', '下面循环会执行多少次？\nfor (int i = 0; i <= 9; i++)\nA. 9 次\nB. 10 次\nC. 11 次\nD. 无限次', '循环结构', '应用', '边界条件', 'i 从 0 到 9 共 10 次，常见错误是把 <= 当成 <。', 3),
    (v_user_id, 'C语言', '已知函数声明 int max(int a, int b); 以下调用正确的是？\nA. max(3)\nB. max("3","4")\nC. max(3,4)\nD. int max = max(3,4,5)', '函数', '识别', '不熟练', '形参数量和类型需匹配，答案 C。', 1),
    (v_user_id, 'C语言', 'char s[5] = "hello"; 的问题是？\nA. 没问题\nB. 需要 6 个字节空间\nC. 必须用 malloc\nD. 只能定义为指针', '数组与字符串', '理解', '数组越界', '字符串常量含结尾 \\0，"hello" 需要 6 字节。', 4),
    (v_user_id, 'C语言', 'int *p = NULL; *p = 10; 运行时最可能发生什么？\nA. 正常输出\nB. 编译报错\nC. 段错误\nD. 自动分配内存', '指针', '应用', '指针错误', '解引用空指针会触发段错误。', 4),
    (v_user_id, 'C语言', '已定义 struct Student s; 指针 struct Student *ps=&s; 访问 name 成员应写：\nA. s->name\nB. ps.name\nC. ps->name\nD. s.name()', '结构体', '识别', '混淆', '结构体变量用 .，结构体指针用 ->，此题答案 C。', 2),
    (v_user_id, 'C语言', '阅读代码并判断问题：\nint a[5];\nfor (int i = 0; i <= 5; i++) a[i] = i;\nA. 循环次数正确\nB. 可能发生越界写\nC. i 必须从 1 开始\nD. a 必须动态分配', '代码阅读', '理解', '边界条件', 'a[5] 合法下标是 0~4，i<=5 会访问 a[5]。', 3),
    (v_user_id, 'C语言', '二分查找中，若使用 while (left <= right)，更新区间时更稳妥的是：\nA. mid = (left + right) / 2；left = mid\nB. mid = (left + right) / 2；right = mid\nC. mid = left + (right-left)/2；命中后 left = mid + 1 或 right = mid - 1\nD. 每轮都把 left 和 right 置零', '算法', '应用', '逻辑错误', '避免死循环和溢出，常规写法是 C。', 2);

END $$;
