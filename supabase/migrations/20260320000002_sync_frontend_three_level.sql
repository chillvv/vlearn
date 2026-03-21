ALTER TABLE questions
ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS node TEXT;

UPDATE questions
SET subject = 'C语言'
WHERE subject = '编程';

UPDATE questions
SET category = CASE
  WHEN subject = '英语' AND knowledge_point IN ('完型填空','语法填空','时态','主谓一致','从句','被动语态','非谓语动词','介词','冠词','代词','固定搭配','词形变化','句子结构','逻辑连接') THEN '语法'
  WHEN subject = '英语' AND knowledge_point IN ('阅读理解','主旨理解','细节理解','推理判断') THEN '阅读'
  WHEN subject = '英语' AND knowledge_point IN ('书面表达','翻译','表达准确') THEN '写作'
  WHEN subject = 'C语言' AND knowledge_point IN ('基础语法','变量','数据类型','变量与数据类型','运算符与表达式','选择结构','条件判断','循环结构','循环','函数') THEN '基础'
  WHEN subject = 'C语言' AND knowledge_point IN ('数组与字符串','指针','结构体','文件操作') THEN '语法进阶'
  WHEN subject = 'C语言' AND knowledge_point IN ('算法题','算法','排序与查找','代码阅读','逻辑理解','调试','边界条件') THEN '算法'
  ELSE COALESCE(category, '未分类')
END
WHERE category IS NULL OR category = '';

UPDATE questions
SET node = knowledge_point
WHERE (node IS NULL OR node = '') AND knowledge_point IS NOT NULL;
