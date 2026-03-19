-- Insert mock questions for testing UI
-- Uses the first available user in the system

DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get the first user ID
    SELECT id INTO v_user_id FROM auth.users LIMIT 1;

    -- If no user exists, do nothing (or raise notice)
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No users found, skipping mock data insertion';
        RETURN;
    END IF;

    -- Insert Choice Questions (Math)
    INSERT INTO questions (user_id, question, question_type, options, correct_answer, subject, sub_topic, error_tag, difficulty, analysis, knowledge)
    VALUES 
    (v_user_id, '已知集合 A={1,2,3}, B={2,3,4}, 则 A ∩ B = ?', 'choice', '["A. {1,2,3,4}", "B. {2,3}", "C. {1,4}", "D. ∅"]'::jsonb, 'B', '数学', '集合与逻辑', '概念混淆', '简单', '交集是指两个集合中都包含的元素组成的集合。A和B中都包含2和3，所以交集是{2,3}。', '集合的交集运算'),
    (v_user_id, '函数 y = sin(2x + π/3) 的最小正周期是？', 'choice', '["A. π/2", "B. π", "C. 2π", "D. 4π"]'::jsonb, 'B', '数学', '三角函数', '公式记错', '中等', '对于函数 y = Asin(ωx + φ)，其最小正周期 T = 2π/|ω|。这里 ω=2，所以 T = 2π/2 = π。', '三角函数的周期性'),
    (v_user_id, '若复数 z 满足 z(1+i) = 2，则 |z| = ?', 'choice', '["A. 1", "B. √2", "C. 2", "D. 2√2"]'::jsonb, 'B', '数学', '复数', '计算失误', '中等', '由题意 z = 2/(1+i) = 2(1-i)/((1+i)(1-i)) = 2(1-i)/2 = 1-i。所以 |z| = √(1²+(-1)²) = √2。', '复数的四则运算与模'),
    (v_user_id, '下列抛物线中，开口向下的是？', 'choice', '["A. y = x²", "B. y = 2x² + 1", "C. y = -x² + 3", "D. x = y²"]'::jsonb, 'C', '数学', '二次函数', '概念混淆', '简单', '二次函数 y=ax²+bx+c 中，a决定开口方向。a>0开口向上，a<0开口向下。选项C中a=-1<0，开口向下。', '二次函数的图像与性质'),
    (v_user_id, 'log₂8 + log₃9 = ?', 'choice', '["A. 4", "B. 5", "C. 6", "D. 7"]'::jsonb, 'B', '数学', '指数与对数', '知识盲区', '简单', 'log₂8 = 3 (因为 2³=8)，log₃9 = 2 (因为 3²=9)。所以 3 + 2 = 5。', '对数的运算性质');

    -- Insert Choice Questions (English)
    INSERT INTO questions (user_id, question, question_type, options, correct_answer, subject, sub_topic, error_tag, difficulty, analysis, knowledge)
    VALUES 
    (v_user_id, 'By the time you get back, I ______ all the work.', 'choice', '["A. will finish", "B. have finished", "C. will have finished", "D. finished"]'::jsonb, 'C', '英语', '语法与时态', '语法时态', '中等', 'By the time 引导的时间状语从句用一般现在时表将来，主句应用将来完成时，表示在将来某个时间之前已经完成的动作。', '将来完成时'),
    (v_user_id, 'The book ______ I borrowed from the library is very interesting.', 'choice', '["A. who", "B. which", "C. what", "D. whom"]'::jsonb, 'B', '英语', '定语从句', '知识盲区', '简单', '先行词是 the book (物)，在定语从句中作宾语，所以用关系代词 which 或 that。', '定语从句关系代词的用法'),
    (v_user_id, 'Hardly ______ the station when the train left.', 'choice', '["A. I had reached", "B. had I reached", "C. I reached", "D. did I reach"]'::jsonb, 'B', '英语', '句型与倒装', '方法不熟', '困难', 'Hardly 位于句首时，主句要部分倒装，且主句通常用过去完成时。', '部分倒装、过去完成时');

    -- Insert Choice Questions (Physics)
    INSERT INTO questions (user_id, question, question_type, options, correct_answer, subject, sub_topic, error_tag, difficulty, analysis, knowledge)
    VALUES 
    (v_user_id, '关于牛顿第一定律，下列说法正确的是？', 'choice', '["A. 它是通过实验直接得出的", "B. 它说明力是维持物体运动的原因", "C. 它指出了物体都具有惯性", "D. 它只适用于宏观低速物体"]'::jsonb, 'C', '物理', '力学基础', '概念混淆', '简单', '牛顿第一定律是在实验基础上通过逻辑推理得出的；力是改变物体运动状态的原因；一切物体都有惯性。', '牛顿第一定律、惯性'),
    (v_user_id, '一小球做自由落体运动，第2秒内的位移是？(g=10m/s²)', 'choice', '["A. 5m", "B. 10m", "C. 15m", "D. 20m"]'::jsonb, 'C', '物理', '运动学', '审题失误', '中等', '第2秒内的位移 = 前2秒的总位移 - 第1秒的位移。h2 = 1/2*g*2² - 1/2*g*1² = 20 - 5 = 15m。', '自由落体运动规律');

    -- Insert Choice Questions (Chemistry)
    INSERT INTO questions (user_id, question, question_type, options, correct_answer, subject, sub_topic, error_tag, difficulty, analysis, knowledge)
    VALUES 
    (v_user_id, '下列物质中，属于强电解质的是？', 'choice', '["A. 醋酸", "B. 氨水", "C. 氯化钠", "D. 水"]'::jsonb, 'C', '化学', '溶液中的离子反应', '知识盲区', '简单', '强酸、强碱和绝大多数盐是强电解质。氯化钠是盐，在水溶液中完全电离，属于强电解质。醋酸和氨水是弱电解质，水是极弱电解质。', '强弱电解质的判断');

    -- Insert Choice Questions (Biology)
    INSERT INTO questions (user_id, question, question_type, options, correct_answer, subject, sub_topic, error_tag, difficulty, analysis, knowledge)
    VALUES 
    (v_user_id, '人体细胞有氧呼吸产生 ATP 最多的阶段是？', 'choice', '["A. 第一阶段", "B. 第二阶段", "C. 第三阶段", "D. 三个阶段一样多"]'::jsonb, 'C', '生物', '细胞的代谢', '记忆模糊', '简单', '有氧呼吸第三阶段前两阶段产生的[H]与氧气结合生成水，释放大量能量，产生大量ATP。', '有氧呼吸的过程');

    -- Insert Fill-in-the-blank Questions (Programming/Other)
    INSERT INTO questions (user_id, question, question_type, correct_answer, subject, sub_topic, error_tag, difficulty, analysis, knowledge)
    VALUES 
    (v_user_id, '在 Python 中，用于获取列表长度的内置函数是 ______。', 'fill', 'len()', '编程', '基础语法', '粗心大意', '简单', 'len() 函数可以返回对象（如字符串、列表、元组等）的长度或项目个数。', 'Python 内置函数'),
    (v_user_id, 'React 中用于在函数组件中管理副作用的 Hook 是 ______。', 'fill', 'useEffect', '编程', 'React', '知识盲区', '中等', 'useEffect Hook 可以看做是 componentDidMount，componentDidUpdate 和 componentWillUnmount 这三个函数的组合，用于处理副作用。', 'React Hooks'),
    (v_user_id, 'HTTP 状态码中，表示“未找到资源”的状态码是 ______。', 'fill', '404', '编程', '网络协议', '记忆模糊', '简单', '404 Not Found 是一种 HTTP 状态码，表示客户端能够与服务器通信，但服务器找不到客户端请求的资源。', 'HTTP 状态码'),
    (v_user_id, '在标准大气压下，水的沸点是 ______ 摄氏度。', 'fill', '100', '物理', '热学', '粗心大意', '简单', '在一个标准大气压下，水的冰点是0℃，沸点是100℃。', '温度与物态变化');

    -- Insert Essay Questions (History/Geography/Politics)
    INSERT INTO questions (user_id, question, question_type, correct_answer, subject, sub_topic, error_tag, difficulty, analysis, knowledge)
    VALUES 
    (v_user_id, '简述辛亥革命的历史意义。', 'essay', '推翻了清朝统治，结束了君主专制制度；建立了民主共和国；使民主共和观念深入人心。', '历史', '中国近代史', '要点不全', '困难', '辛亥革命是近代中国比较完全意义上的民族民主革命。它在政治上、思想上给中国人民带来了不可低估的解放作用。', '辛亥革命的意义'),
    (v_user_id, '分析我国西南地区喀斯特地貌发育的自然条件。', 'essay', '岩石条件：大面积分布可溶性的石灰岩；气候条件：亚热带季风气候，降水丰富，流水溶蚀作用强。', '地理', '地貌', '分析不透彻', '困难', '喀斯特地貌的形成需要同时具备可溶性岩石（主要是碳酸盐类岩石）和具有溶蚀力的流水。西南地区恰好满足这两个条件。', '喀斯特地貌成因'),
    (v_user_id, '为什么说市场在资源配置中起决定性作用？', 'essay', '市场通过价格、供求、竞争机制，能自发、及时、灵敏地传递信息，引导资源向效率高的领域流动；能激发市场主体的活力。', '政治', '经济生活', '理解偏差', '中等', '市场经济本质上就是市场决定资源配置的经济。理论和实践都证明，市场配置资源是最有效率的形式。', '市场经济体制');

    -- Insert 2 more mixed questions to reach 20 total (We had 5+3+2+1+1+3+3 = 18, need 2 more)
    INSERT INTO questions (user_id, question, question_type, options, correct_answer, subject, sub_topic, error_tag, difficulty, analysis, knowledge)
    VALUES 
    (v_user_id, 'JavaScript 中，以下哪个关键字用于声明常量？', 'choice', '["A. var", "B. let", "C. const", "D. function"]'::jsonb, 'C', '编程', '基础语法', '知识盲区', '简单', 'ES6 引入了 const 关键字用来声明一个只读的常量。一旦声明，常量的值就不能改变。', 'ES6 变量声明');

END $$;