UPDATE questions
SET subject = 'C语言'
WHERE subject = '编程';

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
